// StreakDisplay.js — always-visible score, streak, and rank bar.

function updateStreakDisplay(score, streak, rank) {
  const scoreEl  = document.getElementById("stat-score");
  const streakEl = document.getElementById("stat-streak");
  const rankEl   = document.getElementById("stat-rank");
  if (scoreEl)  scoreEl.textContent  = score  || 0;
  if (streakEl) streakEl.textContent = streak || 0;
  if (rankEl)   rankEl.textContent   = rank   ? `#${rank}` : "--";
}

module.exports = { updateStreakDisplay };
