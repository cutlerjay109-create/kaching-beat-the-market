// backend/server.js — main entry point. Wires all pieces together.

require("dotenv").config({ override: true });

// Catch unhandled promise rejections so one bad DB call never crashes the server
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection (caught):", reason?.message || reason);
});
const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");

const { PORT }             = require("./config/env");
const push                 = require("./realtime/push");
const { startOddsSource,
        startScoresSource,
        startReplayIfNeeded,
        getLastOdds,
        getLastScores }    = require("./data/source");
const { extractProbability,
        calcShift }        = require("./game/probability");
const { maybeAskQuestion,
        getActiveQuestion,
        expireIfOverdue }  = require("./game/questionEngine");
const { resolve }          = require("./game/resolver");
const { react }            = require("./pundit/pundit");
const { recordResult,
        getPlayer }        = require("./players/scoreStore");
const { getTopPlayers }    = require("./players/leaderboard");

const sessionRouter     = require("./routes/session");
const predictionsRouter = require("./routes/predictions");
const leaderboardRouter = require("./routes/leaderboard");
const authRouter        = require("./routes/auth");

// ── APP SETUP ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use("/api/auth",        authRouter);
app.use("/api/session",     sessionRouter);
app.use("/api/predictions", predictionsRouter);
app.use("/api/leaderboard", leaderboardRouter);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));

// Serve frontend for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ── INIT PUSH ─────────────────────────────────────────────────────────────────
push.init(io);

// ── GAME STATE ────────────────────────────────────────────────────────────────
let currentMatchState  = null;
let previousMatchState = null;
let openPredictions    = {};
let maxHomeGoals       = 0; // never let score go backwards
let maxAwayGoals       = 0;
let replayDone         = false;

// ── ODDS HANDLER ─────────────────────────────────────────────────────────────
async function handleOdds(oddsData) {
  // Support both raw TxLINE format and our simulated replay format
  let prob = extractProbability(oddsData);
  if (!prob && oddsData.prices && oddsData.price_names) {
    prob = extractProbability({
      ...oddsData,
      fixture_id: oddsData.fixture_id || oddsData.fixtureId,
    });
  }
  if (!prob) return;

  previousMatchState = currentMatchState;
  currentMatchState  = {
    ...( currentMatchState || {} ),
    homeProb:   prob.home,
    awayProb:   prob.away,
    drawProb:   prob.draw,
    inRunning:  prob.inRunning,
    fixtureId:  prob.fixtureId,
    oddsTs:     prob.ts,
    oddsShiftTs: null,
  };

  // Detect significant odds shift (>3%)
  const shift = calcShift(previousMatchState, currentMatchState);
  if (shift > 0.03 && previousMatchState) {
    currentMatchState.oddsShiftTs = Date.now();
    const before = Math.round((previousMatchState.homeProb || 0.5) * 100);
    const after  = Math.round((currentMatchState.homeProb  || 0.5) * 100);
    console.log(`[odds] shift detected: ${before}% -> ${after}%`);

    // Pundit reacts to odds shift
    react({
      type: "odds_shift",
      data: { team: "home", before, after },
    }).then(r => r && push.pushPundit(r));
  }

  // Push updated match state to frontend
  push.pushMatchState(currentMatchState);

  // Maybe ask a new question
  const question = maybeAskQuestion(currentMatchState);
  if (question) {
    push.pushQuestion(question);
    react({ type: "question_asked", data: { question: question.text } })
      .then(r => r && push.pushPundit(r));
  }

  // Try to resolve open predictions
  await resolveOpenPredictions();
}

// ── SCORES HANDLER ───────────────────────────────────────────────────────────
async function handleScores(scoresData) {
  const prev = currentMatchState || {};

  // Support both enriched replay format and raw TxLINE format
  const homeTeam  = scoresData.home_team   || scoresData.Participant1 || prev.homeTeam || "Home";
  const awayTeam  = scoresData.away_team   || scoresData.Participant2 || prev.awayTeam || "Away";
  const score     = scoresData.score       || prev.score || { home: 0, away: 0 };
  const goals     = scoresData.goals       != null ? scoresData.goals
                  : (score.home || 0) + (score.away || 0);
  const corners   = scoresData.corners     != null ? scoresData.corners    : (prev.corners    || 0);
  const yellowCards = scoresData.yellowCards != null ? scoresData.yellowCards : (prev.yellowCards || 0);
  const redCards  = scoresData.redCards    != null ? scoresData.redCards   : (prev.redCards   || 0);
  const matchTime = scoresData.match_time  != null ? scoresData.match_time : (prev.matchTime  || 0);
  const period    = scoresData.period      || prev.period || "";
  const inRunning = scoresData.inRunning   != null ? scoresData.inRunning  : (prev.inRunning  || false);

  currentMatchState = {
    ...(currentMatchState || {}),
    homeTeam, awayTeam, score,
    goals, corners, yellowCards, redCards,
    matchTime, period, inRunning,
  };

  // Detect goal — only count upward changes
  // Never let score go backwards
  const cleanHome = Math.max(score.home || 0, maxHomeGoals);
  const cleanAway = Math.max(score.away || 0, maxAwayGoals);
  if (cleanHome > maxHomeGoals || cleanAway > maxAwayGoals) {
    const scoringTeam = cleanHome > maxHomeGoals ? homeTeam : awayTeam;
    const scoreStr    = `${cleanHome}-${cleanAway}`;
    console.log(`[scores] GOAL! ${scoringTeam} ${scoreStr}`);
    react({
      type: "goal",
      data: { team: scoringTeam, score: scoreStr },
    }).then(r => r && push.pushPundit(r));
    maxHomeGoals = cleanHome;
    maxAwayGoals = cleanAway;
  }
  score.home = cleanHome;
  score.away = cleanAway;
  currentMatchState.score = score;

  push.pushMatchState(currentMatchState);
  await resolveOpenPredictions();
}

// ── RESOLVE OPEN PREDICTIONS ──────────────────────────────────────────────────
async function resolveOpenPredictions() {
  const question = getActiveQuestion();
  expireIfOverdue();

  if (!question || Object.keys(openPredictions).length === 0) return;

  for (const [predId, pred] of Object.entries(openPredictions)) {
    const result = resolve(
      question,
      pred.answer,
      pred.matchStateBefore,
      currentMatchState
    );
    if (!result.resolved) continue;

    delete openPredictions[predId];

    // Record result in DB
    const scoreResult = await recordResult(
      pred.sessionId,
      predId,
      result.correct,
      result.secondsBefore,
      result.oddsBefore,
      result.oddsAfter
    );
    if (!scoreResult) continue;

    // Push result to the specific player
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

    // Pundit reacts
    react({
      type: "prediction_result",
      data: {
        correct:       result.correct,
        timingLabel:   scoreResult.timingLabel,
        secondsBefore: result.secondsBefore,
        oddsBefore:    result.oddsBefore,
        oddsAfter:     result.oddsAfter,
        question:      question.text,
        answer:        pred.answer,
      },
    }).then(r => r && push.pushPundit(r));

    // Push updated leaderboard
    const top = await getTopPlayers(20);
    push.pushLeaderboard(top);
  }
}

// ── SOCKET.IO EVENTS ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("[socket] player connected:", socket.id);

  // Start replay the moment first player connects
  startReplayIfNeeded();

  // Send current match state immediately on connect
  if (currentMatchState) socket.emit("match_state", currentMatchState);

  // Player submits a prediction via socket
  socket.on("submit_prediction", async (data) => {
    const { sessionId, answer } = data;
    if (!sessionId || !answer) return;

    const question = getActiveQuestion();
    if (!question) return socket.emit("error", { message: "No active question" });

    const { getLastOdds } = require("./data/source");
    const lastOdds   = getLastOdds();
    const oddsBefore = lastOdds ? (lastOdds.home || 0.5) : 0.5;

    const { savePrediction } = require("./players/scoreStore");
    const predId = await savePrediction(sessionId, question.id, answer, oddsBefore);

    openPredictions[predId] = {
      sessionId,
      socketId:        socket.id,
      question,
      answer,
      matchStateBefore: { ...currentMatchState },
    };

    socket.emit("prediction_accepted", {
      predictionId: predId,
      question:     question.text,
      answer,
    });
  });

  socket.on("disconnect", () => {
    console.log("[socket] player disconnected:", socket.id);
  });
});

// ── START DATA SOURCES ────────────────────────────────────────────────────────
startOddsSource(handleOdds);
startScoresSource(handleScores);

// ── LEADERBOARD BROADCAST (every 30s) ────────────────────────────────────────
setInterval(async () => {
  const top = await getTopPlayers(20);
  push.pushLeaderboard(top);
}, 30000);

// ── START SERVER ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
🚀 Kaching Beat-the-Market running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.SOURCE_MODE || "live"}`);
  console.log(`   Press Ctrl+C to stop.
`);
});
