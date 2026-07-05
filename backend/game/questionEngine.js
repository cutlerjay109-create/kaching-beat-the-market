// backend/game/questionEngine.js — decides which question to ask and when.

const QUESTIONS = require("../../shared/questions");

// Minimum gap between questions (ms)
const MIN_GAP_MS = process.env.SOURCE_MODE === 'replay' ? 15 * 1000 : 4 * 60 * 1000; // 15s replay, 4min live

let lastQuestionTs = Date.now(); // delay first question by MIN_GAP_MS
let activeQuestion = null;

// Pick a random question from the list
function pickQuestion() {
  const idx = Math.floor(Math.random() * QUESTIONS.length);
  return QUESTIONS[idx];
}

// Filter questions that make no sense for the current match state
function getValidQuestions(matchState) {
  const minute  = matchState.matchTime || 0;
  const period  = matchState.period    || "";
  const homeProb = matchState.homeProb || 0.5;
  const awayProb = matchState.awayProb || 0.5;
  const leading  = Math.max(homeProb, awayProb);
  const diff     = Math.abs(homeProb - awayProb);

  return QUESTIONS.filter(q => {
    // Halftime-specific questions — only in first half before 40 mins
    if (q.id === "goal_before_half" && (minute > 40 || period === "2H" || period === "FT")) return false;

    // Probability questions need odds data
    if (q.source === "odds" && !matchState.homeProb) return false;

    // "Climb past 70%" only makes sense if leading team is not already there
    if (q.id === "prob_climb_70"      && leading >= 0.70) return false;

    // "Climb past 60%" only if not already past 60%
    if (q.id === "prob_climb_60"      && leading >= 0.60) return false;

    // "Stay above 65%" only if leading team is actually above 65%
    if (q.id === "prob_stay_above_65" && leading < 0.65) return false;

    // "Market stays tight" only if match is actually tight (within 20%)
    if (q.id === "market_stays_tight" && diff > 0.20) return false;

    // "Shift by 10%" only in tighter matches where a 10% swing is realistic
    if (q.id === "prob_shift_10"      && leading > 0.80) return false;

    // Short-window questions (3 min) only in second half when tension is high
    if (q.id === "corner_next_3"      && period !== "2H") return false;

    // "Stay goalless" only if match has been goalless recently
    if (q.id === "no_goal_next_10"    && (matchState.goals || 0) > 2) return false;

    return true;
  });
}

// Called on every match state update.
// Returns a new question object if it is time to ask one, otherwise null.
function maybeAskQuestion(matchState) {
  const now    = Date.now();
  const minute = matchState ? (matchState.matchTime || 0) : 0;

  // Do not ask if a question is already open
  if (activeQuestion) return null;

  // Do not ask if not enough time has passed
  if (now - lastQuestionTs < MIN_GAP_MS) return null;

  // Do not ask until match is actually running and past minute 1
  if (!matchState || !matchState.inRunning) return null;
  if (minute < 1) return null;

  // Do not ask during halftime, extra time or after match ends
  if (matchState.period === "HT") return null;
  if (matchState.period === "FT") return null;
  // Stop questions if match time is exactly 45 (halftime clock reset) or 0
  if (minute === 45 && matchState.period !== "2H") return null;

  const valid = getValidQuestions(matchState);
  if (!valid.length) return null;

  const question = valid[Math.floor(Math.random() * valid.length)];
  activeQuestion = {
    ...question,
    askedAt:    now,
    matchState: matchState,
    expiresAt:  now + (process.env.SOURCE_MODE === 'replay' ? 60 * 1000 : 60 * 1000),
  };
  lastQuestionTs = now;

  console.log("[questionEngine] asking:", question.text);
  return activeQuestion;
}

// Called when a question resolves (correct or wrong).
function closeQuestion() {
  activeQuestion = null;
}

// Get the current open question
function getActiveQuestion() {
  return activeQuestion;
}

// Force-expire a question that timed out without resolving
function expireIfOverdue() {
  if (!activeQuestion) return false;
  if (Date.now() > activeQuestion.expiresAt) {
    console.log("[questionEngine] question expired:", activeQuestion.text);
    activeQuestion = null;
    return true;
  }
  return false;
}

let _stopped = false;
function stopQuestions() { _stopped = true; console.log("[questionEngine] stopped."); }

// Wrap maybeAskQuestion to respect stopped state
const _maybeAskQuestion = maybeAskQuestion;
function maybeAskQuestionGuarded(matchState) {
  if (_stopped) return null;
  return _maybeAskQuestion(matchState);
}

module.exports = { maybeAskQuestion: maybeAskQuestionGuarded, closeQuestion, getActiveQuestion, expireIfOverdue, stopQuestions };
