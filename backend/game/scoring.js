// backend/game/scoring.js — calculates points based on timing.

const { BASE_POINTS, TIMING_BANDS, STREAK_BONUS_PER, STREAK_BONUS_MAX } = require("../../shared/scoringRules");

function calcScore(correct, secondsBefore, currentStreak) {
  if (!correct) {
    return {
      points:      0,
      basePoints:  0,
      streakBonus: 0,
      timingLabel: "Wrong",
      newStreak:   0,
    };
  }

  // Find timing band
  let multiplier = TIMING_BANDS[TIMING_BANDS.length - 1].multiplier;
  let label      = TIMING_BANDS[TIMING_BANDS.length - 1].label;
  for (const band of TIMING_BANDS) {
    if (secondsBefore >= band.minSeconds) {
      multiplier = band.multiplier;
      label      = band.label;
      break;
    }
  }

  const basePoints  = Math.round(BASE_POINTS * multiplier);
  const newStreak   = currentStreak + 1;
  const streakBonus = Math.min(newStreak * STREAK_BONUS_PER, STREAK_BONUS_MAX);
  const points      = basePoints + streakBonus;

  return { points, basePoints, streakBonus, timingLabel: label, newStreak };
}

module.exports = { calcScore };
