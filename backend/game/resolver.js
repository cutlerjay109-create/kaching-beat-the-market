// backend/game/resolver.js — checks if an open prediction won or lost.

const { closeQuestion } = require("./questionEngine");

// Resolve a yes/no prediction against current match state.
// Returns { resolved: true, correct: bool, secondsBefore, oddsBefore, oddsAfter }
// or { resolved: false } if not enough data yet.
function resolve(question, answer, matchStateBefore, matchStateNow) {
  if (!question || !matchStateNow) return { resolved: false };

  const { id, source, field, threshold } = question;
  const askedAt = question.askedAt;
  const now     = Date.now();

  // Check if window has passed
  if (now < question.expiresAt && !_conditionMet(question, matchStateBefore, matchStateNow)) {
    return { resolved: false };
  }

  const conditionMet = _conditionMet(question, matchStateBefore, matchStateNow);
  const correct      = (answer === "yes") === conditionMet;

  // How many seconds before the odds moved did the player call it
  const oddsShiftTs  = matchStateNow.oddsShiftTs || now;
  const secondsBefore = Math.max(0, Math.round((oddsShiftTs - askedAt) / 1000));

  closeQuestion();

  return {
    resolved:     true,
    correct,
    conditionMet,
    secondsBefore,
    oddsBefore:   matchStateBefore ? matchStateBefore.homeProb : null,
    oddsAfter:    matchStateNow    ? matchStateNow.homeProb    : null,
  };
}

function _conditionMet(question, before, now) {
  const { field, threshold, source } = question;

  if (source === "scores") {
    if (field === "goals") {
      const goalsBefore = before ? (before.goals || 0) : 0;
      const goalsNow    = now    ? (now.goals    || 0) : 0;
      return goalsNow > goalsBefore;
    }
    if (field === "no_goals") {
      // Condition met (YES correct) if NO goal happened
      const goalsBefore = before ? (before.goals || 0) : 0;
      const goalsNow    = now    ? (now.goals    || 0) : 0;
      return goalsNow === goalsBefore;
    }
    if (field === "corners") {
      const before_ = before ? (before.corners || 0) : 0;
      const now_    = now    ? (now.corners    || 0) : 0;
      return now_ > before_;
    }
    if (field === "corners_2plus") {
      const before_ = before ? (before.corners || 0) : 0;
      const now_    = now    ? (now.corners    || 0) : 0;
      return (now_ - before_) >= 2;
    }
    if (field === "cards") {
      const before_ = before ? ((before.yellowCards || 0) + (before.redCards || 0)) : 0;
      const now_    = now    ? ((now.yellowCards    || 0) + (now.redCards    || 0)) : 0;
      return now_ > before_;
    }
  }

  if (source === "odds") {
    if (field === "probability") {
      const leading = Math.max(now.homeProb || 0, now.awayProb || 0);
      return leading >= (threshold || 0.6);
    }
    if (field === "probability_shift") {
      const before_ = before ? (before.homeProb || 0) : 0;
      const now_    = now    ? (now.homeProb    || 0) : 0;
      return Math.abs(now_ - before_) >= (threshold || 0.05);
    }
    if (field === "probability_hold") {
      // YES if leading team stays above threshold
      const leading = Math.max(now.homeProb || 0, now.awayProb || 0);
      return leading >= (threshold || 0.65);
    }
    if (field === "probability_tight") {
      // YES if difference between home and away stays within threshold
      const diff = Math.abs((now.homeProb || 0) - (now.awayProb || 0));
      return diff <= (threshold || 0.10);
    }
  }

  return false;
}

module.exports = { resolve };
