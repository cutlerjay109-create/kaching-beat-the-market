// ResultFlash.js — shows win/lose result + why line after each guess.

function showResult(data) {
  const el        = document.getElementById("result-flash");
  const headline  = document.getElementById("result-headline");
  const why       = document.getElementById("result-why");
  const points    = document.getElementById("result-points");
  if (!el) return;

  el.className = `visible ${data.correct ? "correct" : "wrong"}`;

  if (headline) headline.textContent = data.correct
    ? `${data.timingLabel} call!`
    : "Not this time.";

  if (why) why.textContent = data.correct
    ? `You called it ${data.secondsBefore || 0}s before the market moved.`
    : `The market did not agree with you on this one.`;

  if (points) points.textContent = data.correct
    ? `+${data.points} pts`
    : "";

  // Auto-hide after 4 seconds
  setTimeout(() => { el.className = ""; }, 4000);
}

module.exports = { showResult };
