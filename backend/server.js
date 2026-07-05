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
let lastOddsShiftPunditTs = 0;
let previousMatchState = null;
let openPredictions    = {};
let maxHomeGoals       = 0;
let maxAwayGoals       = 0;
let connectedPlayers   = 0;
const demoSockets = new Set(); // sockets currently in demo mode
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

  const prevPeriod = (currentMatchState || {}).period || "PRE";
  const prevTime   = (currentMatchState || {}).matchTime || 0;
  // If odds say inRunning but period is still PRE, infer period from match time
  let inferredPeriod = prevPeriod;
  if (prob.inRunning && (prevPeriod === "PRE" || !prevPeriod)) {
    inferredPeriod = prevTime <= 46 ? "1H" : "2H";
  }

  currentMatchState = {
    ...(currentMatchState || {}),
    homeProb:  prob.home,
    awayProb:  prob.away,
    drawProb:  prob.draw,
    inRunning: prob.inRunning,
    fixtureId: prob.fixtureId,
    oddsTs:      prob.ts,
    oddsShiftTs: prob.ts,
    period:    inferredPeriod,
    homeTeam:  (currentMatchState || {}).homeTeam || fixture.home || "Home",
    awayTeam:  (currentMatchState || {}).awayTeam || fixture.away || "Away",
  };

  const shift = calcShift(previousMatchState, currentMatchState);
  const now_odds = Date.now();
  if (shift > 0.08 && previousMatchState && connectedPlayers > 0 &&
      currentMatchState.inRunning && prob.inRunning &&
      now_odds - lastOddsShiftPunditTs > 2 * 60 * 1000) {
    lastOddsShiftPunditTs = now_odds;
    const before = Math.round((previousMatchState.homeProb || 0.5) * 100);
    const after  = Math.round((currentMatchState.homeProb  || 0.5) * 100);
    console.log(`[odds] shift: ${before}% -> ${after}%`);
    react({
      type: "odds_shift",
      data: { team: after > before ? currentMatchState.homeTeam : currentMatchState.awayTeam, before, after },
    }).then(r => {
      if (!r) return;
      io.sockets.sockets.forEach((s) => {
        if (!demoSockets.has(s.id)) s.emit("pundit_reaction", r);
      });
    });
  }

  // Only broadcast to frontend when match is live — pre-match odds update internal state only
  if (currentMatchState.inRunning) {
    const liveState = { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" };
    io.sockets.sockets.forEach((s) => {
      if (!demoSockets.has(s.id)) s.emit("match_state", liveState);
    });
  }

  if (connectedPlayers > 0 && currentMatchState.inRunning) {
    const question = maybeAskQuestion(currentMatchState);
    if (question) {
      io.sockets.sockets.forEach((s) => {
        if (!demoSockets.has(s.id)) s.emit("new_question", {
          id: question.id, text: question.text, type: question.type,
          expiresAt: question.expiresAt,
          windowMs: Math.max(question.expiresAt - Date.now(), 10000),
        });
      });
      react({ type: "question_asked", data: { question: question.text } })
        .then(r => {
          if (!r) return;
          io.sockets.sockets.forEach((s) => {
            if (!demoSockets.has(s.id)) s.emit("pundit_reaction", r);
          });
        });
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
                      (scoresData.Clock && scoresData.Clock.Running) ||
                      (currentMatchState && currentMatchState.inRunning) || false;
  const isNext      = next && fid != null && String(fid) === String(next.fixtureId);
  const isLiveFid   = currentMatchState && fid != null && String(fid) === String(currentMatchState.fixtureId);
  if (!_inRunning && !isNext && !isLiveFid) return;
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
                  : (clock.Seconds != null ? Math.floor(clock.Seconds / 60) : (prev.matchTime || 0));

  // Trust odds stream inRunning over scores stream — scores sends "scheduled" even mid-game
  const scoresInRunning = scoresData.inRunning != null ? scoresData.inRunning
                        : (clock.Running != null ? clock.Running : false);
  const inRunning = prev.inRunning ? prev.inRunning : scoresInRunning;

  const statusId  = scoresData.StatusId || scoresData.status_id;
  const gameState = (scoresData.GameState || "").toLowerCase();

  let period = prev.period || "PRE";

  if (clock.Period != null) {
    if      (clock.Period === 1) period = "1H";
    else if (clock.Period === 2) period = "2H";
    else if (clock.Period === 3) period = "ET1";
    else if (clock.Period === 4) period = "ET2";
  } else if (statusId != null) {
    if      (statusId === 4)  period = "1H";
    else if (statusId === 5)  period = "HT";
    else if (statusId === 6)  period = "2H";
    else if (statusId === 7)  period = "FT";
    else if (statusId === 31) period = "ET1";
    else if (statusId === 32) period = "ET2";
  } else if (gameState && gameState !== "scheduled" && gameState !== "") {
    if      (gameState.includes("first_half")  || gameState === "1h") period = "1H";
    else if (gameState.includes("second_half") || gameState === "2h") period = "2H";
    else if (gameState.includes("half_time")   || gameState === "ht") period = "HT";
    else if (gameState.includes("full_time")   || gameState === "ft") period = "FT";
    else if (gameState === "inprogress" || gameState === "live") {
      period = (matchTime <= 46) ? "1H" : "2H";
    }
  } else if (inRunning && matchTime > 0) {
    if      (matchTime <= 46) period = "1H";
    else if (matchTime <= 93) period = "2H";
  } else if (inRunning && period === "PRE") {
    period = "1H";
  }
  const prevMatchTime = prev.matchTime || 0;

  // Detect halftime: matchTime drops to 0 or stuck at 45 and NOT running
  if (!inRunning && prev.period === "1H" && matchTime === 0 && prevMatchTime >= 44) period = "HT";
  if (!inRunning && period === "1H" && matchTime === 45) period = "HT";

  // Detect second half: matchTime goes back to 46+ after HT
  if (inRunning && matchTime >= 46 && (period === "HT" || prev.period === "HT")) period = "2H";

  currentMatchState = {
    ...(currentMatchState || {}),
    homeTeam, awayTeam, score,
    goals: (score.home || 0) + (score.away || 0),
    corners, yellowCards, redCards,
    matchTime, period, inRunning,
  };

  // Reset goal counters when a new match starts (different fixture)
  const currentFid = currentMatchState && currentMatchState.fixtureId;
  if (currentFid && fid && String(currentFid) !== String(fid)) {
    maxHomeGoals = 0;
    maxAwayGoals = 0;
    console.log("[scores] new fixture detected — resetting goal counters");
  }

  const cleanHome = Math.max(score.home || 0, maxHomeGoals);
  const cleanAway = Math.max(score.away || 0, maxAwayGoals);
  if (cleanHome > maxHomeGoals || cleanAway > maxAwayGoals) {
    const scoringTeam = cleanHome > maxHomeGoals ? homeTeam : awayTeam;
    const scoreStr    = `${cleanHome}-${cleanAway}`;
    console.log(`[scores] GOAL! ${scoringTeam} ${scoreStr}`);
    react({ type: "goal", data: { team: scoringTeam, score: scoreStr } })
      .then(r => r && push.pushPundit(r, demoSockets));
    maxHomeGoals = cleanHome;
    maxAwayGoals = cleanAway;
  }
  score.home = cleanHome;
  score.away = cleanAway;
  currentMatchState.score = score;

  const liveScoreState = { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" };
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("match_state", liveScoreState);
  });
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
    }}).then(r => r && push.pushPundit(r, demoSockets));

    const top = await getTopPlayers(20);
    push.pushLeaderboard(top);
  }
}

io.on("connection", (socket) => {
  console.log("[socket] player connected:", socket.id);
  connectedPlayers++;

  startReplayIfNeeded(handleOdds, handleScores);

  if (currentMatchState && currentMatchState.inRunning) {
    // Live match — send immediately
    socket.emit("match_state", { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });
    // Send active question to reconnecting player so they don't miss it
    const aq = getActiveQuestion();
    if (aq) {
      const windowMs = Math.max(aq.expiresAt - Date.now(), 5000);
      socket.emit("new_question", {
        id: aq.id, text: aq.text, type: aq.type,
        expiresAt: aq.expiresAt, windowMs,
      });
    }
  } else {
    // No live match — send next fixture countdown instantly so screen is never blank
    const next = getNextUpcoming();
    if (next) {
      const secsUntil = Math.max(0, Math.floor((next.ts - Date.now()) / 1000));
      socket.emit("match_state", {
        homeTeam: next.home, awayTeam: next.away,
        score: { home: 0, away: 0 }, matchTime: 0,
        period: "PRE", inRunning: false,
        countdown: secsUntil,
        _mode: process.env.SOURCE_MODE || "live",
      });
    }
  }

  socket.on("submit_prediction", async (data) => {
    const { sessionId, answer } = data;
    if (!sessionId || !answer) return;
    const question = getActiveQuestion();
    if (!question) return socket.emit("error", { message: "No active question" });
    const lastOdds   = getLastOdds();
    let oddsBefore   = 0.5;
    if (lastOdds) {
      const extracted = extractProbability(lastOdds);
      if (extracted) oddsBefore = extracted.home;
    }
    const predId = await savePrediction(sessionId, question.id, answer, oddsBefore);
    openPredictions[predId] = {
      sessionId, socketId: socket.id, question, answer,
      matchStateBefore: { ...currentMatchState },
    };
    socket.emit("prediction_accepted", { predictionId: predId, question: question.text, answer });
  });

  // Demo mode — plays the most recent replay recording to this socket only
  // Works exactly like SOURCE_MODE=replay but isolated to one player
  socket.on("start_demo", () => {
    console.log("[demo] starting demo for:", socket.id);
    demoSockets.add(socket.id);

    const { replayMatch }        = require("./replay/replayEngine");
    const { extractProbability } = require("./game/probability");
    const QUESTIONS              = require("../shared/questions");
    const path                   = require("path");
    const fs                     = require("fs");

    // Read team names from recording file dynamically
    let demoHome = "Home";
    let demoAway = "Away";
    try {
      const recPath  = path.join(__dirname, "replay/recordings/scores.json");
      const recData  = JSON.parse(fs.readFileSync(recPath, "utf8"));
      const firstRec = recData.find(e => e.data && e.data.home_team);
      if (firstRec) {
        demoHome = firstRec.data.home_team;
        demoAway = firstRec.data.away_team;
      }
    } catch(e) { /* use defaults */ }
    console.log("[demo] playing:", demoHome, "vs", demoAway);

    // Demo state
    let demoHomeProb   = 0.42;
    let demoAwayProb   = 0.30;
    let demoLastHome   = 0;
    let demoLastAway   = 0;
    let demoMatchTime  = 0;
    let demoPeriod     = "PRE";
    let demoLastQTs    = 0;
    let demoQuestion   = null;
    let demoScore      = 0;
    let demoStreak     = 0;

    // Track open demo predictions to resolve against actual match events
    let demoPrediction = null;

    // Handle prediction submission for demo player
    socket.on("submit_prediction_demo", async ({ answer, sessionId: sid }) => {
      if (!demoQuestion) return;
      demoPrediction = {
        question:    demoQuestion,
        answer,
        sessionId:   sid,
        matchStateBefore: {
          score:       { home: demoLastHome, away: demoLastAway },
          goals:       demoLastHome + demoLastAway,
          corners:     0,
          homeProb:    demoHomeProb,
          awayProb:    demoAwayProb,
          period:      demoPeriod,
          matchTime:   demoMatchTime,
          inRunning:   true,
        },
        askedAt: Date.now(),
      };
      demoQuestion = null; // clear active question
      socket.emit("prediction_accepted", {
        predictionId: "demo-pred",
        question:     demoPrediction.question.text,
        answer,
      });
    });

    function sendScoresToSocket(data) {
      const home  = data.home_team || demoHome;
      const away  = data.away_team || demoAway;
      const score = data.score     || { home: 0, away: 0 };
      demoMatchTime = data.match_time != null ? data.match_time : demoMatchTime;
      demoPeriod    = data.period   || demoPeriod;
      const inRunning = data.inRunning != null ? data.inRunning : true;

      socket.emit("match_state", {
        homeTeam: home, awayTeam: away, score,
        goals: (score.home||0)+(score.away||0),
        corners: data.corners||0, yellowCards: data.yellowCards||0, redCards: 0,
        matchTime: demoMatchTime, period: demoPeriod, inRunning,
        homeProb: demoHomeProb, awayProb: demoAwayProb,
        _mode: "replay",
      });

      // Goal detection
      if (score.home > demoLastHome || score.away > demoLastAway) {
        const scoringTeam = score.home > demoLastHome ? home : away;
        const scoreStr = score.home + "-" + score.away;
        console.log("[demo] GOAL!", scoringTeam, scoreStr);
        react({ type: "goal", data: { team: scoringTeam, score: scoreStr } })
          .then(r => r && socket.emit("pundit_reaction", r));
        demoLastHome = score.home;
        demoLastAway = score.away;
      }

      // Resolve open demo prediction against current match state
      if (demoPrediction) {
        const { resolve } = require("./game/resolver");
        const currentDemoState = {
          score:    { home: demoLastHome, away: demoLastAway },
          goals:    demoLastHome + demoLastAway,
          corners:  data.corners || 0,
          homeProb: demoHomeProb,
          awayProb: demoAwayProb,
          period:   demoPeriod,
          matchTime: demoMatchTime,
          inRunning: data.inRunning != null ? data.inRunning : true,
        };
        const result = resolve(demoPrediction.question, demoPrediction.answer, demoPrediction.matchStateBefore, currentDemoState);
        if (result.resolved) {
          const pred = demoPrediction;
          demoPrediction = null;
          const correct  = result.correct;
          const label    = correct ? (result.secondsBefore > 120 ? "Way Early" : result.secondsBefore > 60 ? "Early" : "On the Nose") : "Wrong";

          // Save to real DB so score persists across refreshes
          recordResult(
            pred.sessionId, "demo-" + Date.now(), correct,
            result.secondsBefore || 30, result.oddsBefore || 0.5, result.oddsAfter || 0.5
          ).then(scoreResult => {
            if (!scoreResult) return;
            socket.emit("prediction_result", {
              predictionId: "demo-pred",
              correct,
              points:      scoreResult.points,
              timingLabel: label,
              newScore:    scoreResult.newScore,
              newStreak:   scoreResult.newStreak,
              question:    pred.question.text,
              answer:      pred.answer,
            });
            react({ type: "prediction_result", data: {
              correct, timingLabel: label,
              secondsBefore: result.secondsBefore || 30,
              question: pred.question.text, answer: pred.answer,
            }}).then(r => r && socket.emit("pundit_reaction", r));
          });
        }
      }

      // Ask question every 15 seconds during live play
      const now = Date.now();
      if (inRunning && !demoQuestion && !demoPrediction && now - demoLastQTs > 15000 &&
          demoPeriod !== "FT" && demoPeriod !== "HT" && demoPeriod !== "PRE") {
        demoLastQTs = now;
        const valid = QUESTIONS.filter(q => {
          if (q.source === "odds" && !demoHomeProb) return false;
          if (q.id === "goal_before_half" && demoMatchTime > 40) return false;
          if (q.id === "corner_next_3" && demoPeriod !== "2H") return false;
          if (q.id === "prob_climb_70" && Math.max(demoHomeProb, demoAwayProb) >= 0.70) return false;
          return true;
        });
        if (valid.length) {
          const q         = valid[Math.floor(Math.random() * valid.length)];
          const REPLAY_SECS_PER_MIN = 4;
          const questionWindowMins  = q.window ? Math.ceil(q.window / 60) : 10;
          const realWindowMs        = questionWindowMins * REPLAY_SECS_PER_MIN * 1000;
          const answerWindowMs      = 15000;
          const askedAt             = now;
          const expiresAt           = now + realWindowMs;
          demoQuestion = { ...q, askedAt, expiresAt };
          console.log("[demo] asking:", q.text, "| window:", questionWindowMins, "min =", realWindowMs/1000, "real sec");
          socket.emit("new_question", {
            id: q.id, text: q.text, type: q.type,
            windowMs: answerWindowMs, expiresAt,
          });
          react({ type: "question_asked", data: { question: q.text } })
            .then(r => r && socket.emit("pundit_reaction", r));
          setTimeout(() => {
            if (demoQuestion && demoQuestion.id === q.id && !demoPrediction) {
              socket.emit("question_expired", { id: q.id });
            }
          }, answerWindowMs);
          setTimeout(() => {
            if (demoQuestion && demoQuestion.id === q.id) {
              demoQuestion = null;
            }
          }, realWindowMs);
        }
      }
    }

    function sendOddsToSocket(data) {
      const prob = extractProbability(data);
      if (!prob) return;
      demoHomeProb = prob.home;
      demoAwayProb = prob.away;
      socket.emit("match_state", {
        homeTeam: demoHome, awayTeam: demoAway,
        score: { home: demoLastHome, away: demoLastAway },
        homeProb: prob.home, awayProb: prob.away,
        inRunning: true,
        period: demoPeriod || "1H",
        matchTime: demoMatchTime,
        _mode: "replay",
      });
    }

    let demoEnded = false;
    function onDemoComplete() {
      if (demoEnded) return;
      demoEnded = true;
      console.log("[demo] replay complete for:", socket.id);
      demoSockets.delete(socket.id);
      socket.emit("match_state", {
        homeTeam: demoHome, awayTeam: demoAway,
        score: { home: demoLastHome, away: demoLastAway },
        matchTime: 90, period: "FT", inRunning: false,
        homeProb: demoHomeProb, awayProb: demoAwayProb,
        _mode: "replay", demoComplete: true,
      });
      socket.emit("demo_complete", { home: demoHome, away: demoAway, score: { home: demoLastHome, away: demoLastAway } });
    }

    replayMatch("scores", sendScoresToSocket, onDemoComplete);
    replayMatch("odds",   sendOddsToSocket);

    socket.once("disconnect", () => demoSockets.delete(socket.id));
  });

  socket.on("disconnect", () => {
    connectedPlayers = Math.max(0, connectedPlayers - 1);
    demoSockets.delete(socket.id);
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
  if (currentMatchState && (currentMatchState.period === "1H" || currentMatchState.period === "2H" || currentMatchState.period === "HT")) return;
  if (process.env.SOURCE_MODE === "replay") return;
  if (connectedPlayers === 0) return;
  const next = getNextUpcoming();
  if (!next) {
    // Tournament over — no more matches
    io.sockets.sockets.forEach((s) => {
      if (!demoSockets.has(s.id)) s.emit("match_state", {
        homeTeam: "Tournament", awayTeam: "Complete",
        score: { home: 0, away: 0 }, matchTime: 0,
        period: "FT", inRunning: false,
        countdown: 0,
        _mode: "live",
      });
    });
    return;
  }
  const secsUntil = Math.max(0, Math.floor((next.ts - Date.now()) / 1000));
  const countdownState = {
    homeTeam: next.home, awayTeam: next.away,
    score: { home: 0, away: 0 }, matchTime: 0,
    period: "PRE", inRunning: false,
    countdown: secsUntil,
    _mode: process.env.SOURCE_MODE || "live",
  };
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("match_state", countdownState);
  });
}, 5000);

let lastCommentaryTs = 0;
setInterval(async () => {
  if (!currentMatchState || !currentMatchState.inRunning) return;
  if (currentMatchState.period === "FT") return;
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
  }}).then(r => r && push.pushPundit(r, demoSockets));
}, 30000);

server.listen(PORT, () => {
  console.log(`\n🚀 Kaching Beat-the-Market running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.SOURCE_MODE || "live"}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
