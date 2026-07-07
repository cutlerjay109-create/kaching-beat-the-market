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
let stoppageAnchorTs   = null;   // wall-clock anchor for estimating 45+X / 90+X
let clockConvention    = null;   // "per-half" | "cumulative" — latched per match
let socketsBySession   = {};     // sessionId -> live socket id (survives reconnects)
let lastCardCount      = 0;
let lastRedCount       = 0;
let lastCornerCount    = 0;
let recentEvents       = [];     // [{minute, type, team, detail}] — real match events
                                 // feeding the commentator so lines reflect reality

function logEvent(minute, type, team, detail) {
  recentEvents.push({ minute, type, team, detail, ts: Date.now() });
  if (recentEvents.length > 12) recentEvents.shift();
}
const demoSockets = new Set(); // sockets currently in demo mode
const FEATURED_FIXTURE_ID = process.env.FEATURED_FIXTURE_ID ? String(process.env.FEATURED_FIXTURE_ID) : null;

// ── FIXTURE REGISTRY (live from TxLINE — zero hardcoding) ───────────────────
const fixtureNames = {};   // fixtureId -> { home, away, ts }
const upcomingList = [];   // sorted by kickoff, future only

// Normalize a timestamp that may arrive as epoch ms, epoch seconds, or ISO string
function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts; // seconds -> ms
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

// Pick the first candidate that is a REAL team name (not a placeholder).
// Fixes flags stuck on ⚽: once "Home"/"Away" was stored it was truthy and
// permanently blocked the real fixture name from the registry.
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

    // Clear old data
    Object.keys(fixtureNames).forEach(k => delete fixtureNames[k]);
    upcomingList.length = 0;

    arr.forEach(f => {
      const home = f.Participant1 || f.HomeTeam  || "Home";
      const away = f.Participant2 || f.AwayTeam  || "Away";
      const ts   = toMs(f.StartTime || f.start_time || null);
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

// ── MATCH LIFECYCLE TRANSITION ENGINE ───────────────────────────────────────
// One central place that reacts the moment the match changes phase:
//   PRE → 1H   kickoff call, counters reset, questions armed (~2 min in)
//   1H  → HT   halftime summary, open predictions settled, questions paused
//   HT  → 2H   "back underway" call, questions instantly re-armed
//   any → FT   full-time call, everything settled and silenced, countdown next
let lastAnnouncedPeriod = "PRE";
let ftCleanupTimer = null;

function broadcastPundit(r) {
  if (!r) return;
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("pundit_reaction", r);
  });
}

// Settle every open prediction RIGHT NOW (window truncated by HT/FT):
// "happens" questions that never happened settle NO, holds settle by state.
async function forceSettleOpenPredictions(reason) {
  const q = getActiveQuestion();
  if (q) q.hardExpiryTs = 0;              // resolver now sees the window as closed
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

  // ── KICKOFF ── the match has just started (feature 3 + 5)
  if (newPeriod === "1H" && (prevP === "PRE" || prevP === "FT")) {
    console.log(`[lifecycle] KICKOFF — ${home} vs ${away}`);
    if (ftCleanupTimer) { clearTimeout(ftCleanupTimer); ftCleanupTimer = null; }
    maxHomeGoals = 0;
    maxAwayGoals = 0;
    lastCardCount = 0; lastRedCount = 0; lastCornerCount = 0;
    recentEvents = [];
    stoppageAnchorTs = null;
    clockConvention = null;
    openPredictions = {};
    resetForNewMatch(2 * 60 * 1000);      // first question ~2 min after the whistle
    react({ type: "kickoff", data: { home, away } }).then(broadcastPundit);
  }

  // ── HALFTIME ── (feature 4)
  else if (newPeriod === "HT") {
    console.log(`[lifecycle] HALFTIME — ${home} ${sc.home}-${sc.away} ${away}`);
    forceSettleOpenPredictions("halftime");
    react({ type: "half_time", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
  }

  // ── SECOND HALF UNDERWAY ── instant restart (feature 4)
  else if (newPeriod === "2H" && (prevP === "HT" || prevP === "1H")) {
    console.log("[lifecycle] SECOND HALF underway");
    resetForNewMatch(60 * 1000);          // questions resume ~1 min into the half
    react({ type: "second_half", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
  }

  // ── FULL TIME ── silence everything, settle, enter countdown (feature 1)
  else if (newPeriod === "FT") {
    console.log(`[lifecycle] FULL TIME — ${home} ${sc.home}-${sc.away} ${away}`);
    forceSettleOpenPredictions("full time");
    // Kill any question card still on screen — no answers after the whistle
    io.sockets.sockets.forEach((s) => {
      if (!demoSockets.has(s.id)) s.emit("question_expired", { reason: "full_time" });
    });
    react({ type: "full_time", data: { home, away, score: `${sc.home || 0}-${sc.away || 0}` } })
      .then(broadcastPundit);
    // After the full-time moment has been shown, clear the state entirely so
    // the next-match countdown takes over cleanly and no stale odds bleed in.
    if (ftCleanupTimer) clearTimeout(ftCleanupTimer);
    ftCleanupTimer = setTimeout(() => {
      if (currentMatchState && currentMatchState.period === "FT") {
        console.log("[lifecycle] post-match cleanup — switching to next-match countdown");
        currentMatchState = null;
        previousMatchState = null;
        lastAnnouncedPeriod = "PRE";
        maxHomeGoals = 0;
        maxAwayGoals = 0;
        loadFixtureNames();               // refresh so the countdown is accurate
      }
    }, 90 * 1000);
  }
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
  // If odds say inRunning but period is still PRE, infer kickoff.
  // NOTE: the odds stream must NEVER flip 1H->2H by minute — first-half
  // stoppage (45+X) is still 1H; the scores stream owns period detection.
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
    // realName() lets the registry name replace a stored "Home"/"Away"
    // placeholder — fixes flags never rendering once names resolved late.
    homeTeam:  realName((currentMatchState || {}).homeTeam, fixture.home, "Home"),
    awayTeam:  realName((currentMatchState || {}).awayTeam, fixture.away, "Away"),
  };

  const shift = calcShift(previousMatchState, currentMatchState);

  // If the odds stream detects the match going live before the scores stream
  // does, announce kickoff immediately — the app must start on the dot.
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
          expiresAt: question.answerDeadline,
          // Card countdown = 60 s ANSWER window (question keeps watching the
          // match for its full windowMinutes after answers lock)
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

  // Only process scores for the next upcoming fixture or a live one
  const next        = getNextUpcoming();
  const _inRunning  = scoresData.inRunning ||
                      (scoresData.Clock && scoresData.Clock.Running) ||
                      (currentMatchState && currentMatchState.inRunning) || false;
  const isNext      = next && fid != null && String(fid) === String(next.fixtureId);
  const isLiveFid   = currentMatchState && fid != null && String(fid) === String(currentMatchState.fixtureId);
  if (!_inRunning && !isNext && !isLiveFid) return;
  const fixture = fixtureNames[fid] || {};

  // realName() skips "Home"/"Away" placeholders so the real fixture name
  // wins as soon as it's available from feed or registry (fixes stuck ⚽ flags)
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

  // Coerce feed values that may arrive as strings ("2", "6") — strict ===
  // against numbers silently failed and froze the period at "1H" forever.
  const clockPeriod = clock.Period  != null ? Number(clock.Period)  : null;
  const statusId    = (scoresData.StatusId  != null || scoresData.status_id != null)
                    ? Number(scoresData.StatusId != null ? scoresData.StatusId : scoresData.status_id)
                    : null;
  const gameState   = (scoresData.GameState || "").toLowerCase();

  // Raw minute from the feed. Clock.Seconds can be PER-HALF on TxLINE.
  let rawMins = null;
  if (scoresData.match_time != null) {
    rawMins = Number(scoresData.match_time) || 0;
  } else if (clock.Seconds != null) {
    rawMins = Math.floor(Number(clock.Seconds) / 60);
  }

  // What THIS scores message says about the clock running (not sticky)
  const scoresInRunning = scoresData.inRunning != null ? scoresData.inRunning
                        : (clock.Running != null ? clock.Running : false);
  let inRunning = prev.inRunning ? prev.inRunning : scoresInRunning;

  // ── PERIOD: explicit feed signals ALWAYS win ────────────────────────────
  // The old minute-based "safety net" wrongly forced 2H at minute 46 while the
  // real match was in FIRST-HALF STOPPAGE TIME (45+6). Explicit signals from
  // the feed (Clock.Period / StatusId / GameState) now take absolute priority;
  // minute-based inference runs ONLY when the feed gives no period at all.
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

  // ── CUMULATIVE MATCH TIME + STOPPAGE TIME (45+X / 90+X) ─────────────────
  // Real broadcasts never jump to 46' in first-half stoppage — they show 45+X.
  // matchTime is capped at the half boundary; addedTime carries the +X, and
  // displayTime is the exact string a professional scoreboard would show.
  //
  // The feed's clock convention (per-half vs cumulative) is LATCHED on the
  // first second-half sample and kept for the whole match — a feed never
  // switches conventions mid-game, and guessing per-sample misreads 90+X.
  if (clockPeriod === 2 && rawMins != null && clockConvention == null) {
    clockConvention = rawMins < 45 ? "per-half" : "cumulative";
    console.log(`[scores] clock convention latched: ${clockConvention}`);
  }
  const perHalfClock = clockConvention === "per-half";

  let matchTime, addedTime = 0, displayTime = null;

  if (rawMins == null) {
    matchTime = prev.matchTime || 0;
    addedTime = prev.addedTime || 0;
  } else if (period === "1H") {
    if (rawMins > 45) { matchTime = 45; addedTime = rawMins - 45; }
    else              { matchTime = rawMins; }
  } else if (period === "2H") {
    const cum = perHalfClock ? rawMins + 45 : rawMins;
    if (cum > 90) { matchTime = 90; addedTime = cum - 90; }
    else          { matchTime = Math.max(cum, 45); }
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

  // If the feed's clock FREEZES at 45:00 / 90:00 during stoppage (common),
  // estimate the added minutes from the wall clock so our display keeps
  // moving exactly like the broadcast does. (feature: accurate real time)
  if (inRunning && addedTime === 0 &&
      ((period === "1H" && matchTime === 45) || (period === "2H" && matchTime === 90))) {
    if (!stoppageAnchorTs) stoppageAnchorTs = Date.now();
    addedTime = Math.max(1, Math.floor((Date.now() - stoppageAnchorTs) / 60000) + 1);
  } else if (addedTime > 0) {
    if (!stoppageAnchorTs) stoppageAnchorTs = Date.now();
    // Feed reports stoppage directly — trust it, keep the anchor for continuity
  } else {
    stoppageAnchorTs = null;
  }

  displayTime =
      period === "HT" ? "HT"
    : period === "FT" ? "FT"
    : addedTime > 0   ? `${matchTime}+${addedTime}'`
    : `${matchTime || 0}'`;

  const prevMatchTime = prev.matchTime || 0;

  // ── HT / FT: the whistle is the clock STOPPING ──────────────────────────
  // TxLINE keeps reporting Clock.Period=1 during the halftime break — the
  // break is signalled by Running flipping false at/after 45'. This check
  // therefore runs even when the period signal is explicit. (An explicit
  // HT/FT StatusId still wins above.)
  if (period === "1H" && !scoresInRunning &&
      (matchTime >= 45 || (rawMins === 0 && prevMatchTime >= 44))) {
    period = "HT"; matchTime = 45; addedTime = 0; displayTime = "HT";
  }
  if (period === "2H" && !scoresInRunning && matchTime >= 90) {
    period = "FT"; matchTime = 90; addedTime = 0; displayTime = "FT";
  }
  // Second half restarts after the break
  if (period === "HT" && scoresInRunning && rawMins != null &&
      (rawMins >= 45 || clockConvention === "per-half" || rawMins < 45)) {
    period = "2H";
    matchTime = clockConvention === "per-half" || rawMins < 45
              ? Math.min(rawMins + 45, 90)
              : Math.max(Math.min(rawMins, 90), 46);
    displayTime = `${matchTime}'`;
  }

  // Minute-based inference ONLY when the feed never says which period it is.
  // Generous stoppage allowance: 1H can legitimately run to 45+15.
  if (!explicitSignal) {
    if (inRunning && period === "PRE" && matchTime > 0) {
      period = matchTime <= 45 ? "1H" : "2H";
    }
    // A raw minute far beyond any plausible first-half stoppage → it's 2H
    if (inRunning && period === "1H" && rawMins != null && rawMins >= 60) {
      period = "2H";
      matchTime = Math.min(rawMins, 90);
      addedTime = rawMins > 90 ? rawMins - 90 : 0;
      displayTime = addedTime > 0 ? `90+${addedTime}'` : `${matchTime}'`;
    }
  }

  // inRunning must reflect reality: clock stopped at HT, match over at FT.
  if (period === "FT" || period === "HT") inRunning = false;

  currentMatchState = {
    ...(currentMatchState || {}),
    homeTeam, awayTeam, score,
    fixtureId: fid != null ? fid : (currentMatchState || {}).fixtureId,
    goals: (score.home || 0) + (score.away || 0),
    corners, yellowCards, redCards,
    matchTime, addedTime, displayTime, period, inRunning,
  };

  // Fire lifecycle announcements the instant the phase changes
  handlePeriodTransition(period, currentMatchState);

  // Reset goal counters when a new match starts (different fixture)
  const currentFid = prev.fixtureId;
  if (currentFid && fid && String(currentFid) !== String(fid)) {
    maxHomeGoals = 0;
    maxAwayGoals = 0;
    lastAnnouncedPeriod = "PRE";     // new match — transition engine starts fresh
    console.log("[scores] new fixture detected — resetting for new match");
  }

  const cleanHome = Math.max(score.home || 0, maxHomeGoals);
  const cleanAway = Math.max(score.away || 0, maxAwayGoals);
  if (cleanHome > maxHomeGoals || cleanAway > maxAwayGoals) {
    const scoringTeam = cleanHome > maxHomeGoals ? homeTeam : awayTeam;
    const scoreStr    = `${cleanHome}-${cleanAway}`;
    // Only call goals during live play — never after full time or at the break
    // (late feed corrections must not trigger commentary; feature 1)
    const livePeriod = period === "1H" || period === "2H" || period === "ET1" || period === "ET2";
    if (inRunning && livePeriod) {
      console.log(`[scores] GOAL! ${scoringTeam} ${scoreStr}`);
      logEvent(currentMatchState.displayTime || matchTime, "goal", scoringTeam, scoreStr);
      react({ type: "goal", data: { team: scoringTeam, score: scoreStr, minute: currentMatchState.displayTime || matchTime + "'" } })
        .then(r => r && push.pushPundit(r, demoSockets));
    }
    maxHomeGoals = cleanHome;
    maxAwayGoals = cleanAway;
  }

  // Real-event log for the commentator: bookings and corners as they happen.
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
      }}).then(r => r && push.pushPundit(r, demoSockets));
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
  // Match-clock-aware expiry: closes the question when its window of MATCH
  // minutes has elapsed (askedAtMinute + windowMinutes) or the hard cap hits
  expireIfOverdue(currentMatchState);
  if (!question || Object.keys(openPredictions).length === 0) return;

  let resolvedAny = false;
  for (const [predId, pred] of Object.entries(openPredictions)) {
    const result = resolve(question, pred.answer, pred.matchStateBefore, currentMatchState);
    if (!result.resolved) continue;
    resolvedAny = true;
    delete openPredictions[predId];

    const scoreResult = await recordResult(
      pred.sessionId, predId, result.correct,
      result.secondsBefore, result.oddsBefore, result.oddsAfter
    );
    // Deliver to the CURRENT socket for this session — phones reconnect with a
    // new socket id mid-window, which used to send the win card into the void.
    const targetId = socketsBySession[pred.sessionId] || pred.socketId;
    io.to(targetId).emit("prediction_result", {
      predictionId:  predId,
      correct:       result.correct,
      points:        scoreResult ? scoreResult.points      : 0,
      timingLabel:   scoreResult ? scoreResult.timingLabel : (result.correct ? "On the Nose" : "Wrong"),
      newStreak:     scoreResult ? scoreResult.newStreak   : null,
      newScore:      scoreResult ? scoreResult.newScore    : null,
      secondsBefore: result.secondsBefore || 0,
      question:      question.text,
      answer:        pred.answer,
    });
    if (!scoreResult) continue;

    react({ type: "prediction_result", data: {
      correct: result.correct, timingLabel: scoreResult.timingLabel,
      secondsBefore: result.secondsBefore, question: question.text, answer: pred.answer,
    }}).then(r => r && push.pushPundit(r, demoSockets));

    const top = await getTopPlayers(20);
    push.pushLeaderboard(top);
  }

  // Resolver is pure now — the caller closes the shared live question
  if (resolvedAny) closeQuestion();
}

io.on("connection", (socket) => {
  console.log("[socket] player connected:", socket.id);
  connectedPlayers++;

  startReplayIfNeeded(handleOdds, handleScores);

  if (currentMatchState && currentMatchState.inRunning) {
    // Live match — send immediately
    socket.emit("match_state", { ...currentMatchState, _mode: process.env.SOURCE_MODE || "live" });
    // Send active question to reconnecting player if answers are still open
    const aq = getActiveQuestion();
    if (aq && Date.now() < aq.answerDeadline) {
      const windowMs = Math.max(aq.answerDeadline - Date.now(), 5000);
      socket.emit("new_question", {
        id: aq.id, text: aq.text, type: aq.type,
        expiresAt: aq.answerDeadline, windowMs,
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
    // Answers lock 60 s after the question is asked — the question keeps
    // watching the match for its full window, but late taps don't count.
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
    socketsBySession[sessionId] = socket.id;   // results follow the session, not a dead socket
    openPredictions[predId] = {
      sessionId, socketId: socket.id, question, answer,
      matchStateBefore: { ...currentMatchState, score: { ...(currentMatchState.score || {}) } },
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
      const demoPrevPeriod = demoPeriod;
      demoMatchTime = data.match_time != null ? data.match_time : demoMatchTime;
      demoPeriod    = data.period   || demoPeriod;
      const inRunning = data.inRunning != null ? data.inRunning : true;

      // Safety net (same as live): never show 1H past minute 45
      if (demoPeriod === "1H" && demoMatchTime >= 46) demoPeriod = "2H";
      if (demoPeriod === "PRE" && inRunning && demoMatchTime > 0) {
        demoPeriod = demoMatchTime <= 45 ? "1H" : "2H";
      }

      // Lifecycle announcements — same professional calls as live mode
      if (demoPeriod !== demoPrevPeriod) {
        const scoreStr = `${score.home || 0}-${score.away || 0}`;
        if (demoPeriod === "1H" && demoPrevPeriod === "PRE") {
          react({ type: "kickoff", data: { home, away } })
            .then(r => r && socket.emit("pundit_reaction", r));
        } else if (demoPeriod === "HT") {
          demoQuestion = null;   // no questions at the break
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

          // Save to real DB so score persists across refreshes.
          // Even if scoring fails (unregistered session), the player must
          // still SEE the result — never leave them without an outcome.
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

      // Ask question every 15 seconds during live play
      const now = Date.now();
      if (inRunning && !demoQuestion && !demoPrediction && now - demoLastQTs > 15000 &&
          demoPeriod !== "FT" && demoPeriod !== "HT" && demoPeriod !== "PRE") {
        demoLastQTs = now;
        // Use the SAME professional validity rules as live mode
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
          // Render {team}/{home}/{away} with the real recorded team names
          const { text, targetSide } = renderQuestion(base, {
            homeTeam: demoHome, awayTeam: demoAway,
            homeProb: demoHomeProb, awayProb: demoAwayProb,
          });
          const REPLAY_SECS_PER_MIN = 4;              // replay clock speed
          const windowMinutes  = base.windowMinutes || 5;
          // Hard cap in real time = window in replay time + small buffer
          const hardExpiryTs   = now + windowMinutes * REPLAY_SECS_PER_MIN * 1000 + 8000;
          const answerWindowMs = 15000;               // compressed answer window
          const askedAt        = now;
          demoQuestion = {
            ...base, text, targetSide,
            askedAt,
            askedAtMinute: demoMatchTime,             // synced to replay match clock
            windowMinutes,
            answerDeadline: now + answerWindowMs,
            hardExpiryTs,
            expiresAt: hardExpiryTs,
          };
          console.log(`[demo] asking: "${text}" | window ${windowMinutes} match-min from ${demoMatchTime}'`);
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

// ── RESULT SWEEP ────────────────────────────────────────────────────────────
// Feeds can go quiet for stretches; without this, a window that closed at
// minute 63 wouldn't announce its result until the next feed message.
// This sweep guarantees results come out within 5 s of the window closing.
setInterval(() => {
  if (!currentMatchState) return;
  resolveOpenPredictions().catch(e =>
    console.error("[sweep] resolve error:", e.message));
}, 5000);

setInterval(async () => {
  const top = await getTopPlayers(20);
  push.pushLeaderboard(top);
}, 30000);


// ── COUNTDOWN (fully automatic from TxLINE fixture data) ────────────────────
// Professional precision: emits every 5 s normally, then every SECOND inside
// the final minute so the timer lands on the dot. At zero it flips straight
// into a "KICK-OFF" state; the live feed takes over the moment data arrives.
let lastCountdownEmit = 0;
setInterval(() => {
  if (currentMatchState && currentMatchState.inRunning) return;
  if (currentMatchState && (currentMatchState.period === "1H" || currentMatchState.period === "2H" || currentMatchState.period === "HT")) return;
  if (process.env.SOURCE_MODE === "replay") return;
  if (connectedPlayers === 0) return;
  const next = getNextUpcoming();
  if (!next) {
    // Tournament over — no more matches
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

  // Emit cadence: every 1 s inside the final minute, every 5 s otherwise
  const cadence = secsUntil <= 60 ? 1000 : 5000;
  if (Date.now() - lastCountdownEmit < cadence) return;
  lastCountdownEmit = Date.now();

  const countdownState = {
    homeTeam: next.home, awayTeam: next.away,
    score: { home: 0, away: 0 }, matchTime: 0,
    period: "PRE", inRunning: false,
    countdown: secsUntil,
    kickoffImminent: secsUntil === 0,   // timer is up — waiting on first live data
    _mode: process.env.SOURCE_MODE || "live",
  };
  io.sockets.sockets.forEach((s) => {
    if (!demoSockets.has(s.id)) s.emit("match_state", countdownState);
  });
}, 1000);

// ── LIVE COMMENTARY ─────────────────────────────────────────────────────────
// A real broadcast commentator speaks regularly throughout the match — not
// only when a player answers a question. Cadence ~75 s, always built from
// REAL live data: exact displayed minute (incl. 45+X), score, market state,
// and the actual recent events (goals, cards, corners) from the feed.
// Silent for the first 2 minutes so the match establishes itself first.
let lastCommentaryTs = 0;
setInterval(async () => {
  if (!currentMatchState || !currentMatchState.inRunning) return;
  const p = currentMatchState.period;
  if (p !== "1H" && p !== "2H" && p !== "ET1" && p !== "ET2") return;
  if (connectedPlayers === 0) return;
  if ((currentMatchState.matchTime || 0) < 2) return;   // 2-min professional lead-in
  const now = Date.now();
  if (now - lastCommentaryTs < 75 * 1000) return;
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
  }}).then(r => r && push.pushPundit(r, demoSockets));
}, 15000);

server.listen(PORT, () => {
  console.log(`\n🚀 Kaching Beat-the-Market running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.SOURCE_MODE || "live"}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
