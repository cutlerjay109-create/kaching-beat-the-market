// backend/game/questionEngine.js — decides which question to ask and when.
//
// PROFESSIONAL TIMING MODEL
// ─────────────────────────
//  1. ANSWER WINDOW  — 60 s of wall-clock time to lock in YES/NO.
//  2. QUESTION WINDOW — 3–5 MATCH minutes. The window is tracked against the
//     real match clock (askedAtMinute + windowMinutes), so stoppages and slow
//     feeds don't desync the result from what actually happened on the pitch.
//  3. HARD CAP — wall-clock failsafe (windowMinutes × 90 s) so a stalled feed
//     or halftime can never leave a question hanging forever.

const QUESTIONS = require("../../shared/questions");

const ANSWER_WINDOW_MS = 60 * 1000;                       // 60 s to answer
const HARD_CAP_MS_PER_MIN = 90 * 1000;                    // stoppage allowance
const MIN_GAP_MS = process.env.SOURCE_MODE === "replay"
  ? 15 * 1000                                             // 15 s in replay
  : 4 * 60 * 1000;                                        // 4 min live

let lastQuestionTs = Date.now(); // delay first question by MIN_GAP_MS
let activeQuestion = null;

// ── TEMPLATE RENDERING ──────────────────────────────────────────────────────
// Fills {home} {away} {leading} {trailing} {team} with real team names.
// Returns { text, targetSide } — targetSide tells the resolver which team
// a team-specific question is about ("home" | "away" | null).
function renderQuestion(q, matchState) {
  const home = matchState.homeTeam || "the home side";
  const away = matchState.awayTeam || "the away side";
  const homeProb = matchState.homeProb || 0.5;
  const awayProb = matchState.awayProb || 0.5;
  const leadingIsHome = homeProb >= awayProb;
  const leading  = leadingIsHome ? home : away;
  const trailing = leadingIsHome ? away : home;

  let targetSide = null;
  let team = leading;
  if (q.target === "home")        { team = home; targetSide = "home"; }
  else if (q.target === "away")   { team = away; targetSide = "away"; }
  else if (q.target === "leading"){ team = leading; targetSide = leadingIsHome ? "home" : "away"; }
  else if (q.target === "either") {
    const pickHome = Math.random() < 0.5;
    team = pickHome ? home : away;
    targetSide = pickHome ? "home" : "away";
  }

  const text = (q.text || "")
    .replace(/\{home\}/g, home)
    .replace(/\{away\}/g, away)
    .replace(/\{leading\}/g, leading)
    .replace(/\{trailing\}/g, trailing)
    .replace(/\{team\}/g, team);

  return { text, targetSide };
}

// ── VALIDITY FILTER ─────────────────────────────────────────────────────────
function getValidQuestions(matchState) {
  const minute   = matchState.matchTime || 0;
  const period   = matchState.period    || "";
  const homeProb = matchState.homeProb  || 0.5;
  const awayProb = matchState.awayProb  || 0.5;
  const leading  = Math.max(homeProb, awayProb);
  const diff     = Math.abs(homeProb - awayProb);

  return QUESTIONS.filter(q => {
    const win = q.windowMinutes || 5;

    // Never ask a question whose window would span halftime —
    // the clock stops and the result would feel broken.
    if (period === "1H" && minute + win > 45) return false;

    // Near full time, only ask if the window fits before 90'.
    if (period === "2H" && minute + win > 90) return false;

    // Probability questions need live odds data
    if (q.source === "odds" && !matchState.homeProb) return false;

    // Team-specific goal question about the leader only if there IS a clear leader
    if (q.id === "team_goal_next_3" && diff < 0.05) return false;

    // "Climb past X%" only if not already there
    if (q.id === "prob_climb_70" && leading >= 0.70) return false;
    if (q.id === "prob_climb_60" && leading >= 0.60) return false;

    // "Hold above 65%" only if the leader is actually above 65%
    if (q.id === "prob_stay_above_65" && leading < 0.65) return false;

    // "Market stays tight" only if it IS tight
    if (q.id === "market_stays_tight" && diff > 0.20) return false;

    // A 10% swing is unrealistic in a one-sided market
    if (q.id === "prob_shift_10" && leading > 0.80) return false;

    // "Stay goalless" only in a low-scoring game
    if (q.id === "no_goal_next_5" && (matchState.goals || 0) > 2) return false;

    // "Deadlock shift" phrasing only makes sense while level
    if (q.id === "goal_next_3" && (matchState.score &&
        (matchState.score.home || 0) !== (matchState.score.away || 0))) return false;

    return true;
  });
}

// ── ASK ─────────────────────────────────────────────────────────────────────
// Called on every match state update.
// Returns a new question object if it is time to ask one, otherwise null.
function maybeAskQuestion(matchState) {
  const now    = Date.now();
  const minute = matchState ? (matchState.matchTime || 0) : 0;

  if (activeQuestion) return null;
  if (now - lastQuestionTs < MIN_GAP_MS) return null;
  if (!matchState || !matchState.inRunning) return null;
  if (minute < 1) return null;
  if (matchState.period === "HT" || matchState.period === "FT" ||
      matchState.period === "PRE") return null;

  const valid = getValidQuestions(matchState);
  if (!valid.length) return null;

  const base = valid[Math.floor(Math.random() * valid.length)];
  const { text, targetSide } = renderQuestion(base, matchState);
  const windowMinutes = base.windowMinutes || 5;

  activeQuestion = {
    ...base,
    text,                                   // rendered with real team names
    targetSide,                             // which team, for the resolver
    askedAt:        now,
    askedAtMinute:  minute,                 // MATCH clock anchor
    windowMinutes,                          // window measured in MATCH minutes
    matchState,
    answerDeadline: now + ANSWER_WINDOW_MS, // 60 s to tap YES/NO
    hardExpiryTs:   now + windowMinutes * HARD_CAP_MS_PER_MIN, // failsafe
    // Kept for backwards compatibility with any expiresAt readers:
    expiresAt:      now + windowMinutes * HARD_CAP_MS_PER_MIN,
  };
  lastQuestionTs = now;

  console.log(`[questionEngine] asking: "${text}" | window ${windowMinutes} match-min from ${minute}'`);
  return activeQuestion;
}

// True once the question's match-minute window has closed (or hard cap hit)
function isWindowClosed(question, matchState) {
  if (!question) return true;
  const nowMinute = matchState ? (matchState.matchTime || 0) : 0;
  if (nowMinute >= question.askedAtMinute + question.windowMinutes) return true;
  if (Date.now() >= question.hardExpiryTs) return true;
  return false;
}

function closeQuestion() {
  activeQuestion = null;
}

function getActiveQuestion() {
  return activeQuestion;
}

// Force-expire a question whose window has fully closed (match-clock aware)
function expireIfOverdue(matchState) {
  if (!activeQuestion) return false;
  if (isWindowClosed(activeQuestion, matchState || activeQuestion.matchState)) {
    console.log("[questionEngine] window closed:", activeQuestion.text);
    activeQuestion = null;
    return true;
  }
  return false;
}

let _stopped = false;
function stopQuestions() { _stopped = true; console.log("[questionEngine] stopped."); }

// Called at kickoff (and at the start of the second half).
// Professional pacing: the first question lands ~2 minutes after the whistle —
// long enough to let the commentator set the scene, soon enough to hook players.
function resetForNewMatch(firstQuestionDelayMs = 2 * 60 * 1000) {
  activeQuestion = null;
  _stopped = false;
  lastQuestionTs = Date.now() - MIN_GAP_MS + firstQuestionDelayMs;
  console.log(`[questionEngine] reset — first question in ~${Math.round(firstQuestionDelayMs / 1000)}s`);
}

const _maybeAskQuestion = maybeAskQuestion;
function maybeAskQuestionGuarded(matchState) {
  if (_stopped) return null;
  return _maybeAskQuestion(matchState);
}

module.exports = {
  maybeAskQuestion: maybeAskQuestionGuarded,
  closeQuestion,
  getActiveQuestion,
  expireIfOverdue,
  isWindowClosed,
  renderQuestion,
  getValidQuestions,
  resetForNewMatch,
  stopQuestions,
  ANSWER_WINDOW_MS,
};
