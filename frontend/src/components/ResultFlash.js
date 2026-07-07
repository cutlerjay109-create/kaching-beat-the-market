// ResultFlash.js — the WIN/LOSS card shown the moment a prediction settles.

function showResult(data) {
  const el        = document.getElementById("result-flash");
  const headline  = document.getElementById("result-headline");
  const why       = document.getElementById("result-why");
  const points    = document.getElementById("result-points");
  if (!el) return;

  el.className = `visible ${data.correct ? "correct" : "wrong"}`;

  if (headline) headline.textContent = data.correct
    ? `✓ ${data.timingLabel || "Correct"} call!`
    : "✗ Not this time";

  if (why) {
    const q = data.question ? `"${data.question}" — you said ${String(data.answer || "").toUpperCase()}. ` : "";
    why.textContent = data.correct
      ? q + (data.secondsBefore ? `Called it ${data.secondsBefore}s before the market moved.` : `The match proved you right.`)
      : q + `The match went the other way.`;
  }

  if (points) points.textContent = data.correct ? `+${data.points || 0} pts` : "";

  // Hold the card long enough to read, then clear
  clearTimeout(showResult._t);
  showResult._t = setTimeout(() => { el.className = ""; }, 6000);
}

if (typeof module !== "undefined") module.exports = { showResult };
