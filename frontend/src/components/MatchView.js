// MatchView.js
function formatCountdown(secs) {
  if (secs <= 0) return "STARTING NOW";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}
function updateMatchView(state) {
  const homeEl     = document.getElementById("home-team");
  const awayEl     = document.getElementById("away-team");
  const homeFlagEl = document.getElementById("home-flag");
  const awayFlagEl = document.getElementById("away-flag");
  const scoreHome  = document.getElementById("score-home");
  const scoreAway  = document.getElementById("score-away");
  const timeEl     = document.getElementById("match-time-badge");
  const periodEl   = document.getElementById("period-badge");
  const probHome   = document.getElementById("prob-home-label");
  const probAway   = document.getElementById("prob-away-label");
  const liveBadge  = document.querySelector(".live-badge");
  const homeTeam = state.homeTeam || "Home";
  const awayTeam = state.awayTeam || "Away";
  const mode     = state._mode   || "live";
  if (homeEl)     homeEl.textContent     = homeTeam;
  if (awayEl)     awayEl.textContent     = awayTeam;
  if (homeFlagEl) homeFlagEl.textContent = typeof getFlag === "function" ? getFlag(homeTeam) : "⚽";
  if (awayFlagEl) awayFlagEl.textContent = typeof getFlag === "function" ? getFlag(awayTeam) : "⚽";
  if (scoreHome)  scoreHome.textContent  = state.score ? state.score.home : 0;
  if (scoreAway)  scoreAway.textContent  = state.score ? state.score.away : 0;
  if (probHome)   probHome.textContent   = homeTeam;
  if (probAway)   probAway.textContent   = awayTeam;
  if (liveBadge) {
    if (mode === "replay") {
      liveBadge.textContent = "⏺ DEMO";
      liveBadge.style.cssText = "display:flex;align-items:center;gap:0.4rem;background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.3);border-radius:99px;padding:0.25rem 0.65rem;font-size:0.7rem;font-weight:600;letter-spacing:2px;color:#f5a623;text-transform:uppercase;";
    } else if (state.inRunning) {
      liveBadge.innerHTML = "<span class=\"live-dot\"></span> LIVE";
      liveBadge.style.cssText = "display:flex;align-items:center;gap:0.4rem;background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.3);border-radius:99px;padding:0.25rem 0.65rem;font-size:0.7rem;font-weight:600;letter-spacing:2px;color:#ff4757;text-transform:uppercase;";
    } else if (state.countdown != null && state.countdown > 0) {
      liveBadge.textContent = "⏱ UPCOMING";
      liveBadge.style.cssText = "display:flex;align-items:center;gap:0.4rem;background:rgba(90,114,150,0.1);border:1px solid rgba(90,114,150,0.3);border-radius:99px;padding:0.25rem 0.65rem;font-size:0.7rem;font-weight:600;letter-spacing:2px;color:#5a7296;text-transform:uppercase;";
    }
  }
  if (state.countdown != null && !state.inRunning && (state.countdown > 0 || state.kickoffImminent || state.period === "PRE")) {
    if (state.countdown <= 0) {
      // Timer is up — the whistle is moments away (live feed takes over instantly)
      if (timeEl)   timeEl.textContent   = "KICK-OFF";
      if (periodEl) periodEl.textContent = "LIVE SOON";
    } else {
      if (timeEl)   timeEl.textContent   = formatCountdown(state.countdown);
      if (periodEl) periodEl.textContent = "NEXT";
    }
  } else {
    // Display-level safety net: a match past minute 45 can never be "1H",
    // even if a stale period slipped through from the backend.
    let period = state.period || "PRE";
    const mt   = state.matchTime || 0;
    if (period === "1H" && mt >= 46) period = "2H";
    if (period === "PRE" && state.inRunning && mt > 0) period = mt <= 45 ? "1H" : "2H";
    if (timeEl)   timeEl.textContent   = mt ? mt + "\'" : (period === "HT" ? "45\'" : period === "FT" ? "90\'" : "0\'");
    if (periodEl) periodEl.textContent = period;
  }
}
