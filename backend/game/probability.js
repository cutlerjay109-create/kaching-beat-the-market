// backend/game/probability.js — converts raw TxLINE odds into win probabilities.
// TxLINE returns prices as implied probability integers (scaled by 10000).
// e.g. 5000 = 50.00%, 6500 = 65.00%

// Convert a raw TxLINE odds snapshot into a clean probability object.
function extractProbability(oddsData) {
  try {
    // TxLINE odds snapshot shape:
    // { fixture_id, price_names: ["home","draw","away"], prices: [4500,2500,3000] }
    const { fixture_id, price_names, prices, in_running, ts } = oddsData;
    if (!price_names || !prices || prices.length < 2) return null;

    const homeIdx = price_names.findIndex(n =>
      n.toLowerCase().includes("home") || n === "1");
    const awayIdx = price_names.findIndex(n =>
      n.toLowerCase().includes("away") || n === "2");

    const homeProb = homeIdx >= 0 ? prices[homeIdx] / 10000 : null;
    const awayProb = awayIdx >= 0 ? prices[awayIdx] / 10000 : null;
    const drawProb = prices.length > 2
      ? 1 - (homeProb || 0) - (awayProb || 0)
      : null;

    return {
      fixtureId: fixture_id,
      home:      homeProb,
      away:      awayProb,
      draw:      drawProb,
      inRunning: in_running || false,
      ts:        ts || Date.now(),
    };
  } catch (e) {
    return null;
  }
}

// Calculate how much the probability shifted between two snapshots.
function calcShift(probBefore, probAfter) {
  if (!probBefore || !probAfter) return 0;
  return Math.abs((probAfter.home || 0) - (probBefore.home || 0));
}

module.exports = { extractProbability, calcShift };
