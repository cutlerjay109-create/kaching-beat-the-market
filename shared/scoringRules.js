// shared/scoringRules.js — single source of truth for scoring.
// Both backend and frontend read from here so they never disagree.

module.exports = {
  // Base points for a correct prediction
  BASE_POINTS: 100,

  // Timing multiplier bands (seconds BEFORE the odds moved).
  // The earlier you called it, the bigger the multiplier.
  TIMING_BANDS: [
    { minSeconds: 120, multiplier: 3.0, label: "Way Early"   }, // 2+ min before
    { minSeconds:  60, multiplier: 2.0, label: "Early"       }, // 1-2 min before
    { minSeconds:  20, multiplier: 1.5, label: "Just in Time" }, // 20-60s before
    { minSeconds:   0, multiplier: 1.0, label: "On the Nose" }, // 0-20s before
  ],

  // Points for a wrong prediction
  WRONG_POINTS: 0,

  // Streak bonus: extra points per consecutive correct answer
  STREAK_BONUS_PER: 25,

  // Max streak bonus cap
  STREAK_BONUS_MAX: 200,
};
