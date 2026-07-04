// MatchView.js — teams, score, match time display with flags.

function updateMatchView(state) {
  const homeEl    = document.getElementById("home-team");
  const awayEl    = document.getElementById("away-team");
  const homeFlagEl = document.getElementById("home-flag");
  const awayFlagEl = document.getElementById("away-flag");
  const scoreHome = document.getElementById("score-home");
  const scoreAway = document.getElementById("score-away");
  const timeEl    = document.getElementById("match-time-badge");
  const periodEl  = document.getElementById("period-badge");
  const probHome  = document.getElementById("prob-home-label");
  const probAway  = document.getElementById("prob-away-label");

  const homeTeam = state.homeTeam || "Home";
  const awayTeam = state.awayTeam || "Away";

  if (homeEl)     homeEl.textContent     = homeTeam;
  if (awayEl)     awayEl.textContent     = awayTeam;
  if (homeFlagEl) homeFlagEl.textContent = getFlag(homeTeam);
  if (awayFlagEl) awayFlagEl.textContent = getFlag(awayTeam);
  if (scoreHome)  scoreHome.textContent  = state.score?.home ?? 0;
  if (scoreAway)  scoreAway.textContent  = state.score?.away ?? 0;
  if (timeEl)     timeEl.textContent     = state.matchTime ? `${state.matchTime}\'` : "0\'";
  if (periodEl)   periodEl.textContent   = state.period || "PRE";
  if (probHome)   probHome.textContent   = homeTeam;
  if (probAway)   probAway.textContent   = awayTeam;
}
