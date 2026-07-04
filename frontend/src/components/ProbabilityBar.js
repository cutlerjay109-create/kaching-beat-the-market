// ProbabilityBar.js — the moving win-probability bar.

function updateProbabilityBar(homeProb, awayProb, homeTeam, awayTeam) {
  const fill     = document.getElementById("prob-fill");
  const homePct  = document.getElementById("prob-home-pct");
  const awayPct  = document.getElementById("prob-away-pct");
  const homeLabel = document.getElementById("prob-home-label");
  const awayLabel = document.getElementById("prob-away-label");

  const hp = Math.round((homeProb || 0.5) * 100);
  const ap = Math.round((awayProb || 0.5) * 100);

  if (fill)      fill.style.width     = `${hp}%`;
  if (homePct)   homePct.textContent  = `${hp}%`;
  if (awayPct)   awayPct.textContent  = `${ap}%`;
  if (homeLabel) homeLabel.textContent = homeTeam || "Home";
  if (awayLabel) awayLabel.textContent = awayTeam || "Away";
}

module.exports = { updateProbabilityBar };
