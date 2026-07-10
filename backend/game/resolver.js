// backend/game/resolver.js — checks if an open prediction won or lost.
//
// PROFESSIONAL SETTLEMENT (mirrors real in-play markets):
//   • "happens" questions (goal / corner / card / odds move) settle YES the
//     MOMENT the event occurs — instant payout feel.
//   • "hold" questions (stays goalless / stays above 65%) settle only when the
//     window ends — unless the hold breaks, which settles NO immediately.
//   • The window is measured in MATCH minutes (askedAtMinute + windowMinutes),
//     so the result is synced to what actually happened on the pitch, with a
//     wall-clock hard cap as a failsafe for stalled feeds.
//
// NOTE: this module is now PURE — it no longer closes the shared live question
// (that caused demo resolutions to kill live questions). The caller closes it.

// Fields whose YES outcome means "the state HELD for the whole window".
const HOLD_FIELDS = new Set(["no_goals", "probability_hold", "probability_tight"]);

// Resolve a yes/no prediction against current match state.
// Returns { resolved: true, correct, ... } or { resolved: false }.
//
// prediction (optional 5th arg): the stored prediction object { submittedAt, matchStateBefore }
//
//   submittedAt — wall-clock ms when the user locked in their answer.
//   When provided, the minimum-wait guard anchors on submission time instead
//   of ask time. Without this, a user who answers 3 minutes into a 5-minute
//   window bypasses the guard entirely (ask time is long past), and if the
//   probability baseline has already drifted past the threshold the resolver
//   fires on the very next tick — instant resolution.
//
//   For odds/probability questions, prediction.matchStateBefore is used as the
//   baseline instead of the ask-time matchStateBefore. "Will the market move
//   5%?" is measured from when the user bet, not from when the question first
//   appeared minutes earlier.
function resolve(question, answer, matchStateBefore, matchStateNow, prediction) {
  if (!question || !matchStateNow) return { resolved: false };

  const askedAt     = question.askedAt;
  const submittedAt = prediction ? prediction.submittedAt : null;
  const now         = Date.now();

  // Guard anchors on SUBMISSION time when available, otherwise ask time.
  const guardAnchor = submittedAt || askedAt || now;
  const minWaitMs   = submittedAt ? 8000 : 10000; // 8s from submit, 10s from ask
  if (now - guardAnchor < minWaitMs) return { resolved: false };

  // For odds questions use the submission-time baseline when provided.
  const isOddsQ  = question.source === "odds";
  const baseline = (isOddsQ && prediction && prediction.matchStateBefore)
    ? prediction.matchStateBefore
    : matchStateBefore;

  const isHold   = HOLD_FIELDS.has(question.field);
  const stillMet = _conditionMet(question, baseline, matchStateNow);

  // ── MATCH-CLOCK EXPIRY ────────────────────────────────────────────────
  const nowMinute     = matchStateNow.matchTime || 0;
  const askedAtMinute = question.askedAtMinute != null
                      ? question.askedAtMinute
                      : (matchStateBefore ? matchStateBefore.matchTime || 0 : 0);
  const windowMinutes = question.windowMinutes || 5;
  const hardExpiryTs  = question.hardExpiryTs || question.expiresAt || (askedAt + windowMinutes * 90 * 1000);

  const windowClosedByClock = nowMinute >= askedAtMinute + windowMinutes;
  const windowClosedByCap   = now >= hardExpiryTs;
  const expired = windowClosedByClock || windowClosedByCap;

  let resolvedNow = false;
  let conditionMet;

  if (isHold) {
    if (!stillMet) {
      resolvedNow  = true;
      conditionMet = false;
    } else if (expired) {
      resolvedNow  = true;
      conditionMet = true;
    }
  } else {
    if (stillMet) {
      resolvedNow  = true;
      conditionMet = true;
    } else if (expired) {
      resolvedNow  = true;
      conditionMet = false;
    }
  }

  if (!resolvedNow) return { resolved: false };

  const correct = (answer === "yes") === conditionMet;

  const oddsShiftTs   = matchStateNow.oddsShiftTs || now;
  const secondsBefore = Math.max(0, Math.round((oddsShiftTs - askedAt) / 1000));

  return {
    resolved:     true,
    correct,
    conditionMet,
    secondsBefore,
    oddsBefore:   baseline       ? baseline.homeProb       : null,
    oddsAfter:    matchStateNow  ? matchStateNow.homeProb  : null,
  };
}

function _teamGoals(state, side) {
  if (!state) return 0;
  const s = state.score || {};
  return side === "away" ? (s.away || 0) : (s.home || 0);
}

function _conditionMet(question, before, now) {
  const { field, threshold, source, targetSide } = question;

  if (source === "scores") {
    if (field === "goals") {
      const goalsBefore = before ? (before.goals || 0) : 0;
      const goalsNow    = now    ? (now.goals    || 0) : 0;
      return goalsNow > goalsBefore;
    }
    if (field === "team_goals") {
      const side = targetSide || "home";
      return _teamGoals(now, side) > _teamGoals(before, side);
    }
    if (field === "no_goals") {
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
      const leading = Math.max(now.homeProb || 0, now.awayProb || 0);
      return leading >= (threshold || 0.65);
    }
    if (field === "probability_tight") {
      const diff = Math.abs((now.homeProb || 0) - (now.awayProb || 0));
      return diff <= (threshold || 0.10);
    }
  }

  return false;
}

module.exports = { resolve };
