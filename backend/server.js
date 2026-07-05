// backend/server.js — main entry point.

require("dotenv").config({ override: true });

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection (caught):", reason?.message || reason);
});

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");

const { PORT }                    = require("./config/env");
const { startJwtAutoRefresh }     = require("./config/txline");
const push                        = require("./realtime/push");
const { startOddsSource,
        startScoresSource,
        startReplayIfNeeded,
        getLastOdds }             = require("./data/source");
const { extractProbability,
        calcShift }               = require("./game/probability");
const { maybeAskQuestion,
        getActiveQuestion,
        expireIfOverdue }         = require("./game/questionEngine");
const { resolve }                 = require("./game/resolver");
const { react }                   = require("./pundit/pundit");
const { recordResult,
        savePrediction }          = require("./players/scoreStore");
const { getTopPlayers }           = require("./players/leaderboard");

const sessionRouter     = require("./routes/session");
const predictionsRouter = require("./routes/predictions");
const leaderboardRouter = require("./routes/leaderboard");
const authRouter        = require("./routes/auth");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/api/auth",        authRouter);
app.use("/api/session",     sessionRouter);
app.use("/api/predictions", predictionsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

push.init(io);
startJwtAutoRefresh();

let currentMatchState  = null;
let previousMatchState = null;
let openPredictions    = {};
let maxHomeGoals       = 0;
let maxAwayGoals       = 0;
let connectedPlayers   = 0;
const FEATURED_FIXTURE_ID = process.env.FEATURED_FIXTURE_ID ? String(process.env.FEATURED_FIXTURE_ID) : null;

// ── FIXTURE REGISTRY (live from TxLINE — zero hardcoding) ───────────────────
const fixtureNames = {};   // fixtureId -> { home, away, ts }
const upcomingList = [];   // sorted by kickoff, future only

async function loadFixtureNames() {
  try {
    const res = await fetch("https://txline.txodds.com/api/fixtures/snapshot", {
      headers: {
        "Authorization": `Bearer ${process.env.TXLINE_JWT}`,
        "X-Api-Token":   process.env.TXLINE_API_TOKEN,
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const arr  = Array.isArray(data) ? data : [];
    const now  = Date.now();

    // Clear old data
    Object.keys(fixtureNames).forEach(k => delete fixtureNames[k]);
    upcomingList.length = 0;

    arr.forEach(f => {
      const home = f.Participant1 || f.HomeTeam  || "Home";
      const away = f.Participant2 || f.AwayTeam  || "Away";
      const ts   = f.StartTime   || f.start_time || null;
      fixtureNames[f.FixtureId] = { home, away, ts };
      // Only keep fixtures that haven't finished (within 3h past kickoff)
      if (ts && ts > now - 3 * 60 * 60 * 1000) {
        upcomingList.push({ fixtureId: f.FixtureId, home, away, ts });
      }
    });

    // Sort ascending — next match first
    upcomingList.sort((a, b) => a.ts - b.ts);

    console.log(`[fixtures] loaded ${arr.length} fixtures`);
    const next = getNextUpcoming();
    if (next) {
      const mins = Math.round((next.ts - now) / 60000);
      console.log(`[fixtures] next: ${next.home} vs ${next.away} in ${mins} min`);
    }
  } catch (e) {
    console.error("[fixtures] failed:", e.message);
  }
}

// Returns the next fixture that hasn't kicked off yet
function getNextUpcoming() {
  const now = Date.now();
  return upcomingList.find(f => f.ts > now) || null;
}

// Load on startup (after JWT refresh) and refresh every 30 minutes
setTimeout(loadFixtureNames, 3000);
setInterval(loadFixtureNames, 30 * 60 * 1000);

async function handleOdds(oddsData) {
  const prob = extractProbability(oddsData);
  if (!prob) return;
  if (FEATURED_FIXTURE_ID && String(prob.fixtureId) !== FEATURED_FIXTURE_ID) return;

  // Only process odds for the next upcoming fixture or a live one
  // This prevents pre-match odds for future fixtures overwriting the display
  const next = getNextUpcoming();
  const isLive = prob.inRunning;
  const isNext = next && String(prob.fixtureId) === String(next.fixtureId);
  if (!isLive && !isNext) return;

  // Only track previous state when match is actually running
  // Avoids fake shifts caused by countdown state overwriting real odds
  if (currentMatchState && currentMatchState.inRunning) {
    previousMatchState = { ...currentMatchState };
  }
  const fixture = fixtureNames[prob.fixtureId] || {};

  currentMatchState = {
    ...(currentMatchState || {}),
    homeProb:  prob.home,
    awayProb:  prob.away,
    drawProb:  prob.draw,
    inRunning: prob.inRunning,
    fixtureId: prob.fixtureId,
    oddsTs:    prob.ts,
    homeTeam:  (currentMatchState || {}).homeTeam || fixture.home || "Home",
    awayTeam:  (currentMatchState || {}).awayTeam || fixture.away || "Away",
  };

  const shift = calcShift(previousMatchState, currentMatchState);
  if (shift > 0.02 && previousMatchState && connectedPlayers > 0) {
    const before = Math.round((previousMatchState.homeProb || 0.5) * 100);
    const after  = Math.round((currentMatchState.homeProb  || 0.5) * 100);
    console.log(`[odds] shift: ${before}% -> ${after}%`);
    react({
      type: "odds_shift",
      data: { team: after > before ? currentMatchState.homeTeam : currentMatchState.awayTeam, before, after },
    }).then(r => r && push.pushPundit(r));
  }

  push.pushMatchState({ ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });

  if (connectedPlayers > 0 && currentMatchState.inRunning) {
    const question = maybeAskQuestion(currentMatchState);
    if (question) {
      push.pushQuestion(question);
      react({ type: "question_asked", data: { question: question.text } })
        .then(r => r && push.pushPundit(r));
    }
  }

  await resolveOpenPredictions();
}

async function handleScores(scoresData) {
  const prev    = currentMatchState || {};
  const fid     = scoresData.FixtureId || scoresData.fixture_id;
  if (FEATURED_FIXTURE_ID && fid != null && String(fid) !== FEATURED_FIXTURE_ID) return;

  // Only process scores for the next upcoming fixture or a live one
  const next        = getNextUpcoming();
  const _inRunning  = scoresData.inRunning ||
                      (scoresData.Clock && scoresData.Clock.Running) || false;
  const isNext      = next && fid != null && String(fid) === String(next.fixtureId);
  if (!_inRunning && !isNext) return;
  const fixture = fixtureNames[fid] || {};

  const homeTeam = scoresData.home_team || fixture.home || scoresData.Participant1 || prev.homeTeam || "Home";
  const awayTeam = scoresData.away_team || fixture.away || scoresData.Participant2 || prev.awayTeam || "Away";

  let score = scoresData.score || prev.score || { home: 0, away: 0 };
  if (scoresData.Score) {
    const s  = scoresData.Score;
    const p1 = s.Participant1 || {};
    const p2 = s.Participant2 || {};
    score = {
      home: (p1.H1?.Goals || 0) + (p1.H2?.Goals || 0),
      away: (p2.H1?.Goals || 0) + (p2.H2?.Goals || 0),
    };
  }

  let corners     = scoresData.corners     != null ? scoresData.corners     : (prev.corners     || 0);
  let yellowCards = scoresData.yellowCards != null ? scoresData.yellowCards : (prev.yellowCards || 0);
  let redCards    = scoresData.redCards    != null ? scoresData.redCards    : (prev.redCards    || 0);

  if (scoresData.Score) {
    const s  = scoresData.Score;
    const p1 = s.Participant1 || {};
    const p2 = s.Participant2 || {};
    corners     = (p1.H1?.Corner      || 0) + (p1.H2?.Corner      || 0) + (p2.H1?.Corner      || 0) + (p2.H2?.Corner      || 0);
    yellowCards = (p1.H1?.YellowCards || 0) + (p1.H2?.YellowCards || 0) + (p2.H1?.YellowCards || 0) + (p2.H2?.YellowCards || 0);
    redCards    = (p1.H1?.RedCards    || 0) + (p1.H2?.RedCards    || 0) + (p2.H1?.RedCards    || 0) + (p2.H2?.RedCards    || 0);
  }

  const clock     = scoresData.Clock || {};
  const matchTime = scoresData.match_time != null ? scoresData.match_time
                  : (clock.Seconds ? Math.floor(clock.Seconds / 60) : (prev.matchTime || 0));
  const statusId  = scoresData.StatusId || scoresData.status_id;
  const gameState = (scoresData.GameState || "").toLowerCase();
  const period    = scoresData.period ||
                    (statusId === 4 ? "1H" : statusId === 5 ? "HT" :
                     statusId === 6 ? "2H" : statusId === 7 ? "FT" :
                     gameState.includes("first") ? "1H" :
                     gameState.includes("second") ? "2H" :
                     gameState.includes("half") ? "HT" :
                     gameState === "inprogress" ? "1H" :
                     (prev.period || "PRE"));
  const inRunning = scoresData.inRunning != null ? scoresData.inRunning
                  : (clock.Running != null ? clock.Running : (prev.inRunning || false));

  currentMatchState = {
    ...(currentMatchState || {}),
    homeTeam, awayTeam, score,
    goals: (score.home || 0) + (score.away || 0),
    corners, yellowCards, redCards,
    matchTime, period, inRunning,
  };

  const cleanHome = Math.max(score.home || 0, maxHomeGoals);
  const cleanAway = Math.max(score.away || 0, maxAwayGoals);
  if (cleanHome > maxHomeGoals || cleanAway > maxAwayGoals) {
    const scoringTeam = cleanHome > maxHomeGoals ? homeTeam : awayTeam;
    const scoreStr    = `${cleanHome}-${cleanAway}`;
    console.log(`[scores] GOAL! ${scoringTeam} ${scoreStr}`);
    react({ type: "goal", data: { team: scoringTeam, score: scoreStr } })
      .then(r => r && push.pushPundit(r));
    maxHomeGoals = cleanHome;
    maxAwayGoals = cleanAway;
  }
  score.home = cleanHome;
  score.away = cleanAway;
  currentMatchState.score = score;

  push.pushMatchState({ ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });
  await resolveOpenPredictions();
}

async function resolveOpenPredictions() {
  const question = getActiveQuestion();
  expireIfOverdue();
  if (!question || Object.keys(openPredictions).length === 0) return;

  for (const [predId, pred] of Object.entries(openPredictions)) {
    const result = resolve(question, pred.answer, pred.matchStateBefore, currentMatchState);
    if (!result.resolved) continue;
    delete openPredictions[predId];

    const scoreResult = await recordResult(
      pred.sessionId, predId, result.correct,
      result.secondsBefore, result.oddsBefore, result.oddsAfter
    );
    if (!scoreResult) continue;

    io.to(pred.socketId).emit("prediction_result", {
      predictionId: predId,
      correct:      result.correct,
      points:       scoreResult.points,
      timingLabel:  scoreResult.timingLabel,
      newStreak:    scoreResult.newStreak,
      newScore:     scoreResult.newScore,
      question:     question.text,
      answer:       pred.answer,
    });

    react({ type: "prediction_result", data: {
      correct: result.correct, timingLabel: scoreResult.timingLabel,
      secondsBefore: result.secondsBefore, question: question.text, answer: pred.answer,
    }}).then(r => r && push.pushPundit(r));

    const top = await getTopPlayers(20);
    push.pushLeaderboard(top);
  }
}

io.on("connection", (socket) => {
  console.log("[socket] player connected:", socket.id);
  connectedPlayers++;

  startReplayIfNeeded(handleOdds, handleScores);

  if (currentMatchState) {
    socket.emit("match_state", { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });
  }

  socket.on("submit_prediction", async (data) => {
    const { sessionId, answer } = data;
    if (!sessionId || !answer) return;
    const question = getActiveQuestion();
    if (!question) return socket.emit("error", { message: "No active question" });
    const lastOdds   = getLastOdds();
    const oddsBefore = lastOdds ? (lastOdds.home || 0.5) : 0.5;
    const predId = await savePrediction(sessionId, question.id, answer, oddsBefore);
    openPredictions[predId] = {
      sessionId, socketId: socket.id, question, answer,
      matchStateBefore: { ...currentMatchState },
    };
    socket.emit("prediction_accepted", { predictionId: predId, question: question.text, answer });
  });

  socket.on("disconnect", () => {
    connectedPlayers = Math.max(0, connectedPlayers - 1);
    console.log("[socket] player disconnected:", socket.id);
  });
});

startOddsSource(handleOdds);
startScoresSource(handleScores);

setInterval(async () => {
  const top = await getTopPlayers(20);
  push.pushLeaderboard(top);
}, 30000);


// ── COUNTDOWN (fully automatic from TxLINE fixture data) ────────────────────
setInterval(() => {
  if (currentMatchState && currentMatchState.inRunning) return;
  if (connectedPlayers === 0) return;
  const next = getNextUpcoming();
  if (!next) return;
  const secsUntil = Math.max(0, Math.floor((next.ts - Date.now()) / 1000));
  push.pushMatchState({
    homeTeam: next.home, awayTeam: next.away,
    score: { home: 0, away: 0 }, matchTime: 0,
    period: "PRE", inRunning: false,
    countdown: secsUntil,
    _mode: process.env.SOURCE_MODE || "live",
  });
}, 5000);

let lastCommentaryTs = 0;
setInterval(async () => {
  if (!currentMatchState || !currentMatchState.inRunning) return;
  if (connectedPlayers === 0) return;
  const now = Date.now();
  if (now - lastCommentaryTs < 4 * 60 * 1000) return;
  lastCommentaryTs = now;
  react({ type: "commentary", data: {
    minute:   currentMatchState.matchTime || 0,
    homeTeam: currentMatchState.homeTeam  || "Home",
    awayTeam: currentMatchState.awayTeam  || "Away",
    homeProb: Math.round((currentMatchState.homeProb || 0.5) * 100),
    awayProb: Math.round((currentMatchState.awayProb || 0.5) * 100),
    score:    `${(currentMatchState.score || {}).home || 0}-${(currentMatchState.score || {}).away || 0}`,
    period:   currentMatchState.period || "",
  }}).then(r => r && push.pushPundit(r));
}, 30000);

server.listen(PORT, () => {
  console.log(`\n🚀 Kaching Beat-the-Market running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.SOURCE_MODE || "live"}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
