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
        expireIfOverdue,
        closeQuestion,
        renderQuestion,
        resetForNewMatch,
        ANSWER_WINDOW_MS }        = require("./game/questionEngine");
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
let stoppageAnchorTs   = null;
let clockConvention    = null;

const HT_FREEZE_MS = Number(process.env.HT_FREEZE_MS || 360 * 1000);
const FT_FREEZE_MS = Number(process.env.FT_FREEZE_MS || 480 * 1000);
let lastClockSeconds  = null;
let lastClockChangeTs = 0;

let htLatched       = false;
let htFrozenSeconds = null;
let ftLatched       = false;
let ftFrozenSeconds = null;
let ftDeclaredTs    = 0;

let stoppedAtBoundaryTs = null;
const HT_STOP_SUSTAIN_MS = Number(process.env.HT_STOP_SUSTAIN_MS || 25 * 1000);
const FT_STOP_SUSTAIN_MS = Number(process.env.FT_STOP_SUSTAIN_MS || 45 * 1000);

let lastOddsActivityTs = 0;
let lastOddsInRunning  = null;
const ODDS_QUIET_MS        = Number(process.env.ODDS_QUIET_MS || 90 * 1000);
const BREAK_CONFIRM_MS     = Number(process.env.BREAK_CONFIRM_MS || 120 * 1000);
const ODDS_LIVE_WINDOW_MS  = Number(process.env.ODDS_LIVE_WINDOW_MS || 60 * 1000);

function oddsSayLive() {
  return lastOddsActivityTs > 0 &&
         (Date.now() - lastOddsActivityTs) < ODDS_LIVE_WINDOW_MS &&
         lastOddsInRunning === true;
}
function oddsSayBreak() {
  if (lastOddsActivityTs === 0) return null;
  return (Date.now() - lastOddsActivityTs) >= ODDS_QUIET_MS || lastOddsInRunning === false;
}

function latchHalftime() {
  if (!htLatched) console.log("[scores] HALFTIME latched — holding HT until real 2H evidence");
  htLatched = true;
  htFrozenSeconds = lastClockSeconds;
}
function latchFullTime() {
  if (!ftLatched) console.log("[scores] FULL TIME latched");
  ftLatched = true;
  ftFrozenSeconds = lastClockSeconds;
  ftDeclaredTs = Date.now();
}
function releaseLatches() {
  htLatched = false; htFrozenSeconds = null;
  ftLatched = false; ftFrozenSeconds = null;
  stoppedAtBoundaryTs = null;
}

function trackClock(seconds) {
  if (seconds == null) return;
  const s = Number(seconds);
  if (Number.isNaN(s)) return;
  if (s !== lastClockSeconds) {
    lastClockSeconds  = s;
    lastClockChangeTs = Date.now();
  }
}

function clockFrozenFor() {
  if (lastClockSeconds == null || !lastClockChangeTs) return 0;
  return Date.now() - lastClockChangeTs;
}

function resetClockTracker() {
  lastClockSeconds  = null;
  lastClockChangeTs = 0;
}

let socketsBySession   = {};
let lastCardCount      = 0;
let lastRedCount       = 0;
let lastCornerCount    = 0;
let recentEvents       = [];

function logEvent(minute, type, team, detail) {
  recentEvents.push({ minute, type, team, detail, ts: Date.now() });
  if (recentEvents.length > 12) recentEvents.shift();
}

const demoSockets = new Set();
const FEATURED_FIXTURE_ID = process.env.FEATURED_FIXTURE_ID ? String(process.env.FEATURED_FIXTURE_ID) : null;

const fixtureNames = {};
const upcomingList = [];

function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

function realName(...candidates) {
  for (const c of candidates) {
    if (c && c !== "Home" && c !== "Away") return c;
  }
  return candidates[candidates.length - 1] || null;
}

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

    Object.keys(fixtureNames).forEach(k => delete fixtureNames[k]);
    upcomingList.length = 0;

    arr.forEach(f => {
      const home = f.Participant1 || f.HomeTeam  || "Home";
      const away = f.Participant2 || f.AwayTeam  || "Away";
      const ts   = toMs(f.StartTime || f.start_time || null);
      fixtureNames[f.FixtureId] = { home, away, ts };
      if (ts && ts > now - 3 * 60 * 60 * 1000) {
        upcomingList.push({ fixtureId: f.FixtureId, home, away, ts });
      }
    });

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

function getNextUpcoming() {
  const now = Date.now();
  return upcomingList.find(f => f.ts > now) || null;
}

let lastAnnouncedPeriod = "PRE";
let ftCleanupTimer = null;
let lastPunditPushTs = 0;

function broadcastPundit(r) {
  if (!r) return;
  lastPunditPushTs = Date.now();
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("pundit_reaction", r);
  });
}

// Fixed: was calling itself recursively — now broadcasts correctly
function pushPunditLive(r) {
  if (!r) return;
  lastPunditPushTs = Date.now();
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("pundit_reaction", r);
  });
}

async function forceSettleOpenPredictions(reason) {
  const q = getActiveQuestion();
  if (q) q.hardExpiryTs = 0;
  if (Object.keys(openPredictions).length) {
    console.log(`[lifecycle] force-settling ${Object.keys(openPredictions).length} prediction(s) at ${reason}`);
  }
  await resolveOpenPredictions();
  closeQuestion();
}

function handlePeriodTransition(newPeriod, state) {
  if (!newPeriod || newPeriod === lastAnnouncedPeriod) return;
  const prevP = lastAnnouncedPeriod;
  lastAnnouncedPeriod = newPeriod;
  const home = (state && state.homeTeam) || "the home side";
  const away = (state && state.awayTeam) || "the away side";
  const sc   = (state && state.score) || { home: 0, away: 0 };

  if (newPeriod === "1H" && (prevP === "PRE" || prevP === "FT")) {
    console.log(`[lifecycle] KICKOFF — ${home} vs ${away}`);
    if (ftCleanupTimer) { clearTimeout(ftCleanupTimer); ftCleanupTimer = null; }
    maxHomeGoals = 0;
    maxAwayGoals = 0;
    lastCardCount = 0; lastRedCount = 0; lastCornerCount = 0;
    recentEvents = [];
    stoppageAnchorTs = null;
    clockConvention = null;
    resetClockTracker();
    releaseLatches();
    lastOddsActivityTs = 0;
    lastOddsInRunning  = null;
    openPredictions = {};
    resetForNewMatch(2 * 60 * 1000);
    react({ type: "kickoff", data: { home, away } }).then(broadcastPundit);
  }
  else if (newPeriod === "HT") {
    console.log(`[lifecycle] HALFTIME — ${home} ${sc.home}-${sc.away} ${away}`);
    forceSettleOpenPredictions("halftime");
    react({ type: "half_time", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
  }
  else if (newPeriod === "2H" && (prevP === "HT" || prevP === "1H")) {
    console.log("[lifecycle] SECOND HALF underway");
    resetForNewMatch(60 * 1000);
    react({ type: "second_half", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
  }
  else if ((newPeriod === "ET1" || newPeriod === "ET2") && prevP !== "ET1") {
    console.log(`[lifecycle] EXTRA TIME (${newPeriod}) — ${home} ${sc.home}-${sc.away} ${away}`);
    if (ftCleanupTimer) { clearTimeout(ftCleanupTimer); ftCleanupTimer = null; }
    resetForNewMatch(60 * 1000);
    react({ type: "extra_time", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
  }
  else if (newPeriod === "FT") {
    console.log(`[lifecycle] FULL TIME — ${home} ${sc.home}-${sc.away} ${away}`);
    forceSettleOpenPredictions("full time");
    io.sockets.sockets.forEach((s) => {
      if (!demoSockets.has(s.id)) s.emit("question_expired", { reason: "full_time" });
    });
    react({ type: "full_time", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
    if (ftCleanupTimer) clearTimeout(ftCleanupTimer);
    ftCleanupTimer = setTimeout(() => {
      if (currentMatchState && currentMatchState.period === "FT") {
        console.log("[lifecycle] post-match cleanup — switching to next-match countdown");
        currentMatchState = null;
        previousMatchState = null;
        lastAnnouncedPeriod = "PRE";
        maxHomeGoals = 0;
        maxAwayGoals = 0;
        loadFixtureNames();
      }
    }, 20 * 1000);
  }
}

setTimeout(loadFixtureNames, 3000);
setInterval(loadFixtureNames, 30 * 60 * 1000);

async function handleOdds(oddsData) {
  const prob = extractProbability(oddsData);
  if (!prob) return;
  if (FEATURED_FIXTURE_ID && String(prob.fixtureId) !== FEATURED_FIXTURE_ID) return;

  const next = getNextUpcoming();
  const isLive = prob.inRunning;
  const isNext = next && String(prob.fixtureId) === String(next.fixtureId);
  if (!isLive && !isNext) return;

  if (currentMatchState && currentMatchState.inRunning) {
    previousMatchState = { ...currentMatchState };
  }
  const fixture = fixtureNames[prob.fixtureId] || {};

  lastOddsActivityTs = Date.now();
  lastOddsInRunning  = prob.inRunning === true;

  const prevPeriod = (currentMatchState || {}).period || "PRE";
  let inferredPeriod = prevPeriod;
  if (prob.inRunning && (prevPeriod === "PRE" || !prevPeriod)) {
    inferredPeriod = "1H";
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
    homeTeam:  realName((currentMatchState || {}).homeTeam, fixture.home, "Home"),
    awayTeam:  realName((currentMatchState || {}).awayTeam, fixture.away, "Away"),
  };

  const shift = calcShift(previousMatchState, currentMatchState);

  handlePeriodTransition(currentMatchState.period, currentMatchState);

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
          expiresAt: question.answerDeadline,
          windowMs: Math.max(question.answerDeadline - Date.now(), 10000),
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

  const next        = getNextUpcoming();
  const _inRunning  = scoresData.inRunning ||
                      (scoresData.Clock && scoresData.Clock.Running) ||
                      (currentMatchState && currentMatchState.inRunning) || false;
  const isNext      = next && fid != null && String(fid) === String(next.fixtureId);
  const isLiveFid   = currentMatchState && fid != null && String(fid) === String(currentMatchState.fixtureId);
  if (!_inRunning && !isNext && !isLiveFid) return;
  const fixture = fixtureNames[fid] || {};

  const homeTeam = realName(scoresData.home_team, scoresData.Participant1, fixture.home, prev.homeTeam, "Home");
  const awayTeam = realName(scoresData.away_team, scoresData.Participant2, fixture.away, prev.awayTeam, "Away");

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

  const clock = scoresData.Clock || {};

  const clockPeriod = clock.Period  != null ? Number(clock.Period)  : null;
  const statusId    = (scoresData.StatusId  != null || scoresData.status_id != null)
                    ? Number(scoresData.StatusId != null ? scoresData.StatusId : scoresData.status_id)
                    : null;
  const gameState   = (scoresData.GameState || "").toLowerCase();

  let rawMins = null;
  if (scoresData.match_time != null) {
    rawMins = Number(scoresData.match_time) || 0;
  } else if (clock.Seconds != null) {
    rawMins = Math.floor(Number(clock.Seconds) / 60);
  }

  const scoresInRunning = scoresData.inRunning != null ? scoresData.inRunning
                        : (clock.Running != null ? clock.Running : false);
  // Trust an explicit Running/inRunning field when present; only fall back to
  // the previous state when the message carries no running signal at all.
  const hasRunningSignal = scoresData.inRunning != null || clock.Running != null;
  const explicitStopped  = scoresData.inRunning === false || clock.Running === false;
  let inRunning = hasRunningSignal ? scoresInRunning : (prev.inRunning || false);

  let period = prev.period || "PRE";
  let explicitSignal = false;

  if (clockPeriod != null && !Number.isNaN(clockPeriod)) {
    explicitSignal = true;
    if      (clockPeriod === 1) period = "1H";
    else if (clockPeriod === 2) period = "2H";
    else if (clockPeriod === 3) period = "ET1";
    else if (clockPeriod === 4) period = "ET2";
    else if (clockPeriod === 10 || clockPeriod === 5) period = "HT";
    else explicitSignal = false;
  }
  if (!explicitSignal && statusId != null && !Number.isNaN(statusId)) {
    explicitSignal = true;
    if      (statusId === 4)  period = "1H";
    else if (statusId === 5)  period = "HT";
    else if (statusId === 6)  period = "2H";
    else if (statusId === 7)  period = "FT";
    else if (statusId === 31) period = "ET1";
    else if (statusId === 32) period = "ET2";
    else explicitSignal = false;
  }
  if (!explicitSignal && gameState && gameState !== "scheduled") {
    if      (gameState.includes("first_half")  || gameState === "1h") { period = "1H"; explicitSignal = true; }
    else if (gameState.includes("second_half") || gameState === "2h") { period = "2H"; explicitSignal = true; }
    else if (gameState.includes("half_time")   || gameState === "ht") { period = "HT"; explicitSignal = true; }
    else if (gameState.includes("full_time")   || gameState === "ft" ||
             gameState.includes("ended")       || gameState.includes("finished")) { period = "FT"; explicitSignal = true; }
  }

  // ── SECOND-HALF RESTART DETECTION (per-half clocks) ──────────────────
  // A clock that resets to ~0 after the match already reached 44'+ can only
  // be the second-half kickoff. This catches feeds that never sent an
  // explicit HT/2H signal, so the display never lingers on "1H 45+X".
  const prevMT = prev.matchTime || 0;
  if (!explicitSignal && !ftLatched && rawMins != null && rawMins <= 2 &&
      (prevMT >= 44 || htLatched) && (period === "1H" || period === "HT") &&
      (rawMins >= 1 || scoresData.inRunning === true || clock.Running === true)) {
    console.log("[scores] clock reset after 44'+ — SECOND HALF restart detected");
    htLatched = false; htFrozenSeconds = null; stoppedAtBoundaryTs = null;
    period = "2H";
    explicitSignal = true;
    if (clockConvention !== "per-half") {
      clockConvention = "per-half";
      console.log("[scores] clock convention latched: per-half (via 2H restart)");
    }
  }

  if (period === "HT") latchHalftime();
  if (period === "FT") latchFullTime();

  if (ftLatched) {
    const secsNowFT = clock.Seconds != null ? Number(clock.Seconds) : null;
    const ftClockAdvancing = (secsNowFT != null && ftFrozenSeconds != null &&
                              secsNowFT > ftFrozenSeconds + 15)
                          || oddsSayLive();
    if (clockPeriod === 3 || statusId === 31)      { releaseLatches(); period = "ET1"; }
    else if (clockPeriod === 4 || statusId === 32) { releaseLatches(); period = "ET2"; }
    else if (ftClockAdvancing) {
      console.log("[scores] clock moving again after FT call — SELF-HEAL, back to 2H");
      releaseLatches();
      if (ftCleanupTimer) { clearTimeout(ftCleanupTimer); ftCleanupTimer = null; }
      lastAnnouncedPeriod = "2H";
      period = "2H";
    }
    else period = "FT";
  } else if (htLatched) {
    const secsNow = clock.Seconds != null ? Number(clock.Seconds) : null;
    const frozenAt = htFrozenSeconds != null ? htFrozenSeconds : 45 * 60;
    const clockAdvancing = secsNow != null && secsNow > frozenAt + 15;
    const clockResetLow  = secsNow != null && secsNow < Math.min(frozenAt, 2700) - 600;
    const explicit2H     = clockPeriod === 2 || statusId === 6 ||
                           gameState.includes("second_half") || gameState === "2h";
    if (explicit2H || clockAdvancing || clockResetLow) {
      htLatched = false; htFrozenSeconds = null;
      stoppedAtBoundaryTs = null;
      period = "2H";
      if (clockConvention == null && secsNow != null) {
        clockConvention = secsNow < 44 * 60 ? "per-half" : "cumulative";
        console.log(`[scores] clock convention latched: ${clockConvention} (via 2H restart)`);
      }
    } else {
      period = "HT";
    }
  }

  if (clockPeriod === 2 && rawMins != null && clockConvention == null) {
    clockConvention = rawMins < 45 ? "per-half" : "cumulative";
    console.log(`[scores] clock convention latched: ${clockConvention}`);
  }
  let matchTime, addedTime = 0, displayTime = null;

  if (rawMins == null) {
    matchTime = prev.matchTime || 0;
    addedTime = prev.addedTime || 0;
  } else if (period === "1H") {
    if (rawMins > 45) { matchTime = 45; addedTime = rawMins - 45; }
    else              { matchTime = rawMins; }
  } else if (period === "2H") {
    // Self-heal: a cumulative clock can never read below 45' in the second
    // half, so a low reading proves the feed counts per-half. Without this
    // the display would sit frozen on 45' for the whole half.
    if (rawMins <= 44 && clockConvention !== "per-half") {
      clockConvention = "per-half";
      console.log("[scores] clock convention corrected: per-half (2H reading < 45')");
    }
    const cum = clockConvention === "per-half" ? rawMins + 45 : rawMins;
    if (cum > 90) { matchTime = 90; addedTime = cum - 90; }
    else          { matchTime = Math.max(cum, 46); } // 2H display starts at 46'
  } else if (period === "HT") {
    matchTime = 45; addedTime = 0;
  } else if (period === "FT") {
    matchTime = 90; addedTime = 0;
  } else if (period === "ET1" || period === "ET2") {
    const base = period === "ET1" ? 90 : 105;
    const cum  = rawMins < base ? rawMins + base : rawMins;
    const cap  = base + 15;
    if (cum > cap) { matchTime = cap; addedTime = cum - cap; }
    else           { matchTime = cum; }
  } else {
    matchTime = rawMins;
  }

  if (inRunning && addedTime === 0 &&
      ((period === "1H" && matchTime === 45) || (period === "2H" && matchTime === 90))) {
    if (!stoppageAnchorTs) stoppageAnchorTs = Date.now();
    // First 60s at the cap is still the 45th (or 90th) minute — show 45',
    // then tick 45+1', 45+2'... as real time elapses.
    addedTime = Math.min(15, Math.floor((Date.now() - stoppageAnchorTs) / 60000));
  } else if (addedTime > 0) {
    if (!stoppageAnchorTs) stoppageAnchorTs = Date.now();
  } else {
    stoppageAnchorTs = null;
  }

  displayTime =
      period === "HT" ? "HT"
    : period === "FT" ? "FT"
    : addedTime > 0   ? `${matchTime}+${addedTime}'`
    : `${matchTime || 0}'`;

  const prevMatchTime = prev.matchTime || 0;

  if (clock.Seconds != null) trackClock(clock.Seconds);

  const atBoundary = (period === "1H" && (matchTime >= 45 || (rawMins === 0 && prevMatchTime >= 44)))
                  || (period === "2H" && matchTime >= 90);
  if (!scoresInRunning && atBoundary) {
    if (!stoppedAtBoundaryTs) stoppedAtBoundaryTs = Date.now();
  } else {
    stoppedAtBoundaryTs = null;
  }
  const stoppedForMs = stoppedAtBoundaryTs ? Date.now() - stoppedAtBoundaryTs : 0;

  const marketLive = oddsSayLive();

  // ── INSTANT HALFTIME ──────────────────────────────────────────────────
  // The feed explicitly reports the clock stopped at 45'+: that IS the
  // halftime whistle. Flip to HT immediately — no sustain wait, no lingering
  // on 45+X. (Guard: if the clock is capped at exactly 45' with the market
  // clearly still trading in-running, hold — stoppage is still being played.)
  if (period === "1H" && matchTime >= 45 && explicitStopped &&
      !(addedTime === 0 && rawMins != null && rawMins <= 45 && marketLive)) {
    console.log("[scores] clock explicitly stopped at 45'+ — HALFTIME (instant)");
    period = "HT"; matchTime = 45; addedTime = 0; displayTime = "HT";
    latchHalftime();
  }
  if (period === "1H" && stoppedForMs >= HT_STOP_SUSTAIN_MS && !marketLive) {
    console.log(`[scores] clock stopped ${Math.round(stoppedForMs/1000)}s at 45'+ — HALFTIME`);
    period = "HT"; matchTime = 45; addedTime = 0; displayTime = "HT";
    latchHalftime();
  }
  if (period === "2H" && stoppedForMs >= FT_STOP_SUSTAIN_MS && !marketLive) {
    console.log(`[scores] clock stopped ${Math.round(stoppedForMs/1000)}s at 90'+ — FULL TIME`);
    period = "FT"; matchTime = 90; addedTime = 0; displayTime = "FT";
    latchFullTime();
  }

  const frozenMs = clockFrozenFor();
  const breakByOdds = oddsSayBreak();
  const htFreezeHit = (breakByOdds === true && frozenMs >= BREAK_CONFIRM_MS && !marketLive)
                   || frozenMs >= HT_FREEZE_MS;
  const ftFreezeHit = (breakByOdds === true && frozenMs >= BREAK_CONFIRM_MS && !marketLive)
                   || frozenMs >= FT_FREEZE_MS;
  if (period === "1H" && matchTime >= 45 && htFreezeHit) {
    console.log(`[scores] clock frozen ${Math.round(frozenMs / 1000)}s at 45'+ (odds break: ${breakByOdds}) — HALFTIME`);
    period = "HT"; matchTime = 45; addedTime = 0; displayTime = "HT";
    latchHalftime();
  }
  if (period === "2H" && matchTime >= 90 && ftFreezeHit) {
    console.log(`[scores] clock frozen ${Math.round(frozenMs / 1000)}s at 90'+ (odds break: ${breakByOdds}) — FULL TIME`);
    period = "FT"; matchTime = 90; addedTime = 0; displayTime = "FT";
    latchFullTime();
  }

  if (period === "HT") { matchTime = 45; addedTime = 0; displayTime = "HT"; }
  if (period === "FT") { matchTime = 90; addedTime = 0; displayTime = "FT"; }

  if (!explicitSignal) {
    if (inRunning && period === "PRE" && matchTime > 0) {
      period = matchTime <= 45 ? "1H" : "2H";
    }
    if (inRunning && period === "1H" && rawMins != null && rawMins >= 60) {
      period = "2H";
      if (clockConvention == null) clockConvention = "cumulative";
      matchTime = Math.min(rawMins, 90);
      addedTime = rawMins > 90 ? rawMins - 90 : 0;
      displayTime = addedTime > 0 ? `90+${addedTime}'` : `${matchTime}'`;
    }
  }

  if (period === "FT" || period === "HT") inRunning = false;

  currentMatchState = {
    ...(currentMatchState || {}),
    homeTeam, awayTeam, score,
    fixtureId: fid != null ? fid : (currentMatchState || {}).fixtureId,
    goals: (score.home || 0) + (score.away || 0),
    corners, yellowCards, redCards,
    matchTime, addedTime, displayTime, period, inRunning,
  };

  handlePeriodTransition(period, currentMatchState);

  const currentFid = prev.fixtureId;
  if (currentFid && fid && String(currentFid) !== String(fid)) {
    maxHomeGoals = 0;
    maxAwayGoals = 0;
    lastAnnouncedPeriod = "PRE";
    console.log("[scores] new fixture detected — resetting for new match");
  }

  const cleanHome = Math.max(score.home || 0, maxHomeGoals);
  const cleanAway = Math.max(score.away || 0, maxAwayGoals);
  if (cleanHome > maxHomeGoals || cleanAway > maxAwayGoals) {
    const scoringTeam = cleanHome > maxHomeGoals ? homeTeam : awayTeam;
    const scoreStr    = `${cleanHome}-${cleanAway}`;
    const livePeriod = period === "1H" || period === "2H" || period === "ET1" || period === "ET2";
    if (inRunning && livePeriod) {
      console.log(`[scores] GOAL! ${scoringTeam} ${scoreStr}`);
      logEvent(currentMatchState.displayTime || matchTime, "goal", scoringTeam, scoreStr);
      react({ type: "goal", data: { team: scoringTeam, score: scoreStr, minute: currentMatchState.displayTime || matchTime + "'" } })
        .then(r => r && pushPunditLive(r));
    }
    maxHomeGoals = cleanHome;
    maxAwayGoals = cleanAway;
  }

  const totalCards = (yellowCards || 0) + (redCards || 0);
  if (totalCards > lastCardCount && inRunning &&
      (period === "1H" || period === "2H")) {
    logEvent(currentMatchState.displayTime || matchTime, "card", null,
             redCards > lastRedCount ? "red card" : "yellow card");
    if (redCards > lastRedCount) {
      react({ type: "red_card", data: {
        home: homeTeam, away: awayTeam,
        minute: currentMatchState.displayTime || matchTime + "'",
        score: `${score.home || 0}-${score.away || 0}`,
      }}).then(r => r && pushPunditLive(r));
    }
  }
  lastCardCount = totalCards;
  lastRedCount  = redCards || 0;
  if ((corners || 0) > lastCornerCount && inRunning) {
    logEvent(currentMatchState.displayTime || matchTime, "corner", null, `corner #${corners}`);
  }
  lastCornerCount = corners || 0;
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
  expireIfOverdue(currentMatchState);
  if (!question || Object.keys(openPredictions).length === 0) return;

  let resolvedAny = false;
  for (const [predId, pred] of Object.entries(openPredictions)) {
    const result = resolve(question, pred.answer, pred.matchStateBefore, currentMatchState, pred);
    if (!result.resolved) continue;
    resolvedAny = true;
    delete openPredictions[predId];

    const scoreResult = await recordResult(
      pred.sessionId, predId, result.correct,
      result.secondsBefore, result.oddsBefore, result.oddsAfter
    );
    const payload = {
      predictionId:  predId,
      sessionId:     pred.sessionId,
      correct:       result.correct,
      points:        scoreResult ? scoreResult.points      : 0,
      timingLabel:   scoreResult ? scoreResult.timingLabel : (result.correct ? "On the Nose" : "Wrong"),
      newStreak:     scoreResult ? scoreResult.newStreak   : null,
      newScore:      scoreResult ? scoreResult.newScore    : null,
      secondsBefore: result.secondsBefore || 0,
      question:      question.text,
      answer:        pred.answer,
    };
    io.sockets.sockets.forEach((s) => {
      if (!demoSockets.has(s.id)) s.emit("prediction_result", payload);
    });
    if (!scoreResult) continue;

    react({ type: "prediction_result", data: {
      correct: result.correct, timingLabel: scoreResult.timingLabel,
      secondsBefore: result.secondsBefore, question: question.text, answer: pred.answer,
    }}).then(r => r && pushPunditLive(r));

    const top = await getTopPlayers(20);
    push.pushLeaderboard(top);
  }

  if (resolvedAny) closeQuestion();
}

io.on("connection", (socket) => {
  console.log("[socket] player connected:", socket.id);
  connectedPlayers++;

  startReplayIfNeeded(handleOdds, handleScores);

  if (currentMatchState && currentMatchState.inRunning) {
    socket.emit("match_state", { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });
    const aq = getActiveQuestion();
    if (aq && Date.now() < aq.answerDeadline) {
      const windowMs = Math.max(aq.answerDeadline - Date.now(), 5000);
      socket.emit("new_question", {
        id: aq.id, text: aq.text, type: aq.type,
        expiresAt: aq.answerDeadline, windowMs,
      });
    }
  } else {
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
    if (Date.now() > question.answerDeadline) {
      return socket.emit("error", { message: "Answers are locked for this question" });
    }
    const lastOdds   = getLastOdds();
    let oddsBefore   = 0.5;
    if (lastOdds) {
      const extracted = extractProbability(lastOdds);
      if (extracted) oddsBefore = extracted.home;
    }
    const predId = await savePrediction(sessionId, question.id, answer, oddsBefore);
    socketsBySession[sessionId] = socket.id;
    openPredictions[predId] = {
      sessionId, socketId: socket.id, question, answer,
      submittedAt: Date.now(),
      matchStateBefore: { ...currentMatchState, score: { ...(currentMatchState.score || {}) } },
    };
    socket.emit("prediction_accepted", { predictionId: predId, question: question.text, answer });
  });

  socket.on("start_demo", () => {
    console.log("[demo] starting demo for:", socket.id);
    demoSockets.add(socket.id);

    const { replayMatch }        = require("./replay/replayEngine");
    const { extractProbability } = require("./game/probability");
    const QUESTIONS              = require("../shared/questions");
    const path                   = require("path");
    const fs                     = require("fs");

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

    // Synthetic probability engine — starts near 50/50, drifts per tick, spikes on goals.
    // The recording odds came from a lopsided match and barely moved, so we ignore them.
    let demoHomeProb = 0.48;
    let demoAwayProb = 0.35;
    let _demoSeed    = 1;
    function _demoRand() { _demoSeed = (_demoSeed * 1664525 + 1013904223) & 0xffffffff; return (_demoSeed >>> 0) / 0xffffffff; }
    function _clampProb(h, a) {
      h = Math.max(0.04, Math.min(0.91, h));
      a = Math.max(0.04, Math.min(0.91, a));
      const t = h + a + 0.10;
      return { home: h / t, away: a / t };
    }
    function _driftProb() {
      const drift = (_demoRand() - 0.48) * 0.025;
      const p = _clampProb(demoHomeProb + drift, demoAwayProb - drift * 0.6);
      demoHomeProb = p.home; demoAwayProb = p.away;
    }
    function _goalSpike(scoringTeam) {
      const spike = 0.12 + _demoRand() * 0.08;
      const p = scoringTeam === "home"
        ? _clampProb(demoHomeProb + spike, demoAwayProb - spike * 0.8)
        : _clampProb(demoHomeProb - spike * 0.8, demoAwayProb + spike);
      demoHomeProb = p.home; demoAwayProb = p.away;
    }
    let demoLastHome   = 0;
    let demoLastAway   = 0;
    let demoMatchTime  = 0;
    let demoPeriod     = "PRE";
    let demoLastQTs    = Date.now(); // delay first question (gap checked below)
    let demoQuestion   = null;
    let demoPrediction = null;

    socket.on("submit_prediction_demo", async ({ answer, sessionId: sid }) => {
      if (!demoQuestion) return;
      // Use the baseline snapshot from ASK time — never the state at submission
      // time. If we used current state here, probability drift between ask and
      // submit would shift the baseline and could make the condition look
      // already-met the instant the next tick arrives.
      // Ask-time baseline (for score questions: goals/corners/cards —
      // "did X happen after the question was asked?")
      const askBaseline = demoQuestion.baselineState || {
        score:     { home: demoLastHome, away: demoLastAway },
        goals:     demoLastHome + demoLastAway,
        corners:   0,
        homeProb:  demoHomeProb,
        awayProb:  demoAwayProb,
        period:    demoPeriod,
        matchTime: demoMatchTime,
        inRunning: true,
      };
      // For odds/probability questions, reset the baseline to NOW (submission time).
      // "Will the market move 5%?" should mean "from where it is when I bet" —
      // not from 3+ minutes ago when the question was asked (bar has already
      // drifted by then and would resolve instantly).
      const isOddsQ = demoQuestion.source === "odds";
      const matchStateBefore = isOddsQ
        ? { ...askBaseline, homeProb: demoHomeProb, awayProb: demoAwayProb, matchTime: demoMatchTime }
        : askBaseline;
      demoPrediction = {
        question: demoQuestion,
        answer,
        sessionId: sid,
        matchStateBefore,
        submittedAt: Date.now(), // guard: minimum wait before resolve fires
      };
      demoQuestion = null;
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
      const demoPrevPeriod = demoPeriod;

      const rawMt    = data.match_time != null ? Number(data.match_time) : null;
      const inRunning = data.inRunning != null ? data.inRunning : true;

      // Trust the recording's explicit period field; fall back to previous.
      if (data.period) demoPeriod = data.period;

      // PRE → live inference when no explicit period yet
      if (demoPeriod === "PRE" && inRunning && rawMt != null && rawMt > 0) {
        demoPeriod = rawMt <= 45 ? "1H" : "2H";
      }

      // Compute display time exactly like the live path does:
      //   1H: cap at 45, extras become 45+N
      //   HT: freeze at "HT"
      //   2H: cumulative (recording already has 46, 47… up to 90)
      //   FT: freeze at "FT"
      let demoAddedTime = 0;
      let demoDisplayTime;
      if (rawMt != null) {
        if (demoPeriod === "1H") {
          if (rawMt > 45) { demoMatchTime = 45; demoAddedTime = rawMt - 45; }
          else            { demoMatchTime = rawMt; }
        } else if (demoPeriod === "2H") {
          if (rawMt > 90) { demoMatchTime = 90; demoAddedTime = rawMt - 90; }
          else            { demoMatchTime = Math.max(rawMt, 46); }
        } else if (demoPeriod === "HT") {
          demoMatchTime = 45;
        } else if (demoPeriod === "FT") {
          demoMatchTime = 90;
        } else {
          demoMatchTime = rawMt;
        }
      }

      if      (demoPeriod === "HT")   demoDisplayTime = "HT";
      else if (demoPeriod === "FT")   demoDisplayTime = "FT";
      else if (demoAddedTime > 0)     demoDisplayTime = `${demoMatchTime}+${demoAddedTime}'`;
      else                            demoDisplayTime = `${demoMatchTime || 0}'`;

      if (demoPeriod !== demoPrevPeriod) {
        const scoreStr = `${score.home || 0}-${score.away || 0}`;
        if (demoPeriod === "1H" && demoPrevPeriod === "PRE") {
          react({ type: "kickoff", data: { home, away } })
            .then(r => r && socket.emit("pundit_reaction", r));
        } else if (demoPeriod === "HT") {
          demoQuestion = null;
          react({ type: "half_time", data: { home, away, score: scoreStr } })
            .then(r => r && socket.emit("pundit_reaction", r));
        } else if (demoPeriod === "2H" && (demoPrevPeriod === "HT" || demoPrevPeriod === "1H")) {
          react({ type: "second_half", data: { home, away, score: scoreStr } })
            .then(r => r && socket.emit("pundit_reaction", r));
        } else if (demoPeriod === "FT") {
          demoQuestion = null;
          react({ type: "full_time", data: { home, away, score: scoreStr } })
            .then(r => r && socket.emit("pundit_reaction", r));
        }
      }

      socket.emit("match_state", {
        homeTeam: home, awayTeam: away, score,
        goals: (score.home||0)+(score.away||0),
        corners: data.corners||0, yellowCards: data.yellowCards||0, redCards: 0,
        matchTime: demoMatchTime, addedTime: demoAddedTime, displayTime: demoDisplayTime,
        period: demoPeriod, inRunning,
        homeProb: demoHomeProb, awayProb: demoAwayProb,
        _mode: "replay",
      });

      // Drift probs on every tick; spike on goals
      _driftProb();
      if (score.home > demoLastHome || score.away > demoLastAway) {
        const scoringTeam = score.home > demoLastHome ? "home" : "away";
        const scoringTeamName = scoringTeam === "home" ? home : away;
        const scoreStr = score.home + "-" + score.away;
        console.log("[demo] GOAL!", scoringTeamName, scoreStr);
        _goalSpike(scoringTeam);
        react({ type: "goal", data: { team: scoringTeamName, score: scoreStr } })
          .then(r => r && socket.emit("pundit_reaction", r));
        demoLastHome = score.home;
        demoLastAway = score.away;
      }

      if (demoPrediction && Date.now() - (demoPrediction.submittedAt || 0) > 8000) {
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
          oddsShiftTs: Date.now(),
        };
        const result = resolve(demoPrediction.question, demoPrediction.answer, demoPrediction.matchStateBefore, currentDemoState, demoPrediction);
        if (result.resolved) {
          const pred = demoPrediction;
          demoPrediction = null;
          const correct  = result.correct;
          const label    = correct ? (result.secondsBefore > 120 ? "Way Early" : result.secondsBefore > 60 ? "Early" : "On the Nose") : "Wrong";
          recordResult(
            pred.sessionId, "demo-" + Date.now(), correct,
            result.secondsBefore || 30, result.oddsBefore || 0.5, result.oddsAfter || 0.5
          ).then(scoreResult => {
            socket.emit("prediction_result", {
              predictionId: "demo-pred",
              correct,
              points:      scoreResult ? scoreResult.points    : 0,
              timingLabel: label,
              newScore:    scoreResult ? scoreResult.newScore  : null,
              newStreak:   scoreResult ? scoreResult.newStreak : null,
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

      const now = Date.now();
      // First question: wait 20s after kickoff; subsequent gap = 15s
      const demoGapMs = demoLastQTs === 0 ? 20000 : 15000;
      if (inRunning && !demoQuestion && !demoPrediction && now - demoLastQTs > demoGapMs &&
          demoPeriod !== "FT" && demoPeriod !== "HT" && demoPeriod !== "PRE") {
        demoLastQTs = now;
        const { getValidQuestions } = require("./game/questionEngine");
        const valid = getValidQuestions({
          homeTeam: demoHome, awayTeam: demoAway,
          homeProb: demoHomeProb, awayProb: demoAwayProb,
          matchTime: demoMatchTime, period: demoPeriod,
          goals: demoLastHome + demoLastAway,
          score: { home: demoLastHome, away: demoLastAway },
          inRunning: true,
        });
        if (valid.length) {
          const base = valid[Math.floor(Math.random() * valid.length)];
          const { text, targetSide } = renderQuestion(base, {
            homeTeam: demoHome, awayTeam: demoAway,
            homeProb: demoHomeProb, awayProb: demoAwayProb,
          });
          const REPLAY_SECS_PER_MIN = 4;
          const windowMinutes  = base.windowMinutes || 5;
          const hardExpiryTs   = now + windowMinutes * REPLAY_SECS_PER_MIN * 1000 + 8000;
          const answerWindowMs = 15000;
          const askedAt        = now;
          // Snapshot match state at ASK TIME — used as baseline by the resolver.
          // Do NOT use state at submission time (probability may have drifted by then).
          const baselineState  = {
            score:     { home: demoLastHome, away: demoLastAway },
            goals:     demoLastHome + demoLastAway,
            corners:   0,
            homeProb:  demoHomeProb,
            awayProb:  demoAwayProb,
            period:    demoPeriod,
            matchTime: demoMatchTime,
            inRunning: true,
          };
          demoQuestion = {
            ...base, text, targetSide,
            askedAt,
            askedAtMinute:    demoMatchTime,
            // Pre-compute the EXACT target minute so the resolver never has
            // to re-derive it. Protects against any drift between ask time
            // and the tick where windowClosedByClock is evaluated.
            _resolveAtMinute: demoMatchTime + windowMinutes,
            windowMinutes,
            answerDeadline: now + answerWindowMs,
            hardExpiryTs,
            expiresAt: hardExpiryTs,
            baselineState,  // ask-time snapshot for resolver
          };
          console.log(`[demo] asking: "${text}" | window ${windowMinutes} match-min from ${demoMatchTime}' → resolves at ${demoMatchTime + windowMinutes}'`);
          socket.emit("new_question", {
            id: base.id, text, type: base.type,
            windowMs: answerWindowMs, expiresAt: demoQuestion.answerDeadline,
          });
          react({ type: "question_asked", data: { question: text } })
            .then(r => r && socket.emit("pundit_reaction", r));
          setTimeout(() => {
            if (demoQuestion && demoQuestion.id === base.id && !demoPrediction) {
              socket.emit("question_expired", { id: base.id });
            }
          }, answerWindowMs);
          setTimeout(() => {
            if (demoQuestion && demoQuestion.id === base.id) {
              demoQuestion = null;
            }
          }, hardExpiryTs - now);
        }
      }
    }

    function sendOddsToSocket(_data) {
      // Synthetic demo: ignore the static recording odds (which barely moved).
      // Just drift the bar a little and push the current synthetic values.
      _driftProb();
      socket.emit("match_state", {
        homeTeam: demoHome, awayTeam: demoAway,
        score: { home: demoLastHome, away: demoLastAway },
        homeProb: demoHomeProb, awayProb: demoAwayProb,
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

function checkFrozenClockTimeout() {
  if (!currentMatchState || !currentMatchState.inRunning) return;
  const frozenMs = clockFrozenFor();
  const stoppedForMs = stoppedAtBoundaryTs ? Date.now() - stoppedAtBoundaryTs : 0;
  const p  = currentMatchState.period;
  const mt = currentMatchState.matchTime || 0;
  let newPeriod = null;
  const marketLive  = oddsSayLive();
  const breakByOdds = oddsSayBreak();
  const htHit = (!marketLive && ((breakByOdds === true && frozenMs >= BREAK_CONFIRM_MS) || stoppedForMs >= HT_STOP_SUSTAIN_MS))
             || frozenMs >= HT_FREEZE_MS;
  const ftHit = (!marketLive && ((breakByOdds === true && frozenMs >= BREAK_CONFIRM_MS) || stoppedForMs >= FT_STOP_SUSTAIN_MS))
             || frozenMs >= FT_FREEZE_MS;
  if (p === "1H" && mt >= 45 && htHit) newPeriod = "HT";
  if (p === "2H" && mt >= 90 && ftHit) newPeriod = "FT";
  if (!newPeriod) return;
  console.log(`[sweep] break confirmed (frozen ${Math.round(frozenMs / 1000)}s, stopped ${Math.round(stoppedForMs / 1000)}s) — declaring ${newPeriod}`);
  if (newPeriod === "HT") latchHalftime(); else latchFullTime();
  currentMatchState = {
    ...currentMatchState,
    period: newPeriod,
    matchTime:  newPeriod === "HT" ? 45 : 90,
    addedTime:  0,
    displayTime: newPeriod,
    inRunning:  false,
  };
  handlePeriodTransition(newPeriod, currentMatchState);
  const state = { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" };
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("match_state", state);
  });
}

setInterval(() => {
  if (!currentMatchState) return;
  checkFrozenClockTimeout();
  resolveOpenPredictions().catch(e =>
    console.error("[sweep] resolve error:", e.message));
}, 5000);

setInterval(async () => {
  const top = await getTopPlayers(20);
  push.pushLeaderboard(top);
}, 30000);

let lastCountdownEmit = 0;
setInterval(() => {
  if (currentMatchState && currentMatchState.inRunning) return;
  if (currentMatchState && (currentMatchState.period === "1H" || currentMatchState.period === "2H" || currentMatchState.period === "HT")) return;
  if (currentMatchState && currentMatchState.period === "FT" &&
      Date.now() - ftDeclaredTs < 20 * 1000) return;
  if (process.env.SOURCE_MODE === "replay") return;
  if (connectedPlayers === 0) return;
  const next = getNextUpcoming();
  if (!next) {
    if (Date.now() - lastCountdownEmit < 5000) return;
    lastCountdownEmit = Date.now();
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
  const cadence = secsUntil <= 60 ? 1000 : 5000;
  if (Date.now() - lastCountdownEmit < cadence) return;
  lastCountdownEmit = Date.now();
  const countdownState = {
    homeTeam: next.home, awayTeam: next.away,
    score: { home: 0, away: 0 }, matchTime: 0,
    period: "PRE", inRunning: false,
    countdown: secsUntil,
    kickoffImminent: secsUntil === 0,
    _mode: process.env.SOURCE_MODE || "live",
  };
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("match_state", countdownState);
  });
}, 1000);

let lastCommentaryTs = 0;
setInterval(async () => {
  if (!currentMatchState || !currentMatchState.inRunning) return;
  const p = currentMatchState.period;
  if (p !== "1H" && p !== "2H" && p !== "ET1" && p !== "ET2") return;
  if (connectedPlayers === 0) return;
  if ((currentMatchState.matchTime || 0) < 2) return;
  const now = Date.now();
  if (now - lastCommentaryTs < 45 * 1000) return;
  if (now - lastPunditPushTs < 25 * 1000) return;
  lastCommentaryTs = now;
  const evLines = recentEvents.slice(-3).map(e =>
    `${e.minute}${typeof e.minute === "number" ? "'" : ""} — ${e.type}${e.team ? " " + e.team : ""}${e.detail ? " (" + e.detail + ")" : ""}`);
  react({ type: "commentary", data: {
    minute:      currentMatchState.displayTime || `${currentMatchState.matchTime || 0}'`,
    period:      p,
    homeTeam:    currentMatchState.homeTeam || "Home",
    awayTeam:    currentMatchState.awayTeam || "Away",
    homeProb:    Math.round((currentMatchState.homeProb || 0.5) * 100),
    awayProb:    Math.round((currentMatchState.awayProb || 0.5) * 100),
    score:       `${(currentMatchState.score || {}).home || 0}-${(currentMatchState.score || {}).away || 0}`,
    corners:     currentMatchState.corners || 0,
    cards:       (currentMatchState.yellowCards || 0) + (currentMatchState.redCards || 0),
    recentEvents: evLines,
    angle:       ["momentum", "market", "stakes", "tactical"][Math.floor(Math.random() * 4)],
  }}).then(r => r && pushPunditLive(r));
}, 15000);

server.listen(PORT, () => {
  console.log(`\n🚀 Kaching Beat-the-Market running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.SOURCE_MODE || "live"}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
