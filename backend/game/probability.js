// backend/game/probability.js
function extractProbability(oddsData) {
  try {
    const fixtureId  = oddsData.FixtureId    || oddsData.fixture_id;
    const priceNames = oddsData.PriceNames   || oddsData.price_names;
    const prices     = oddsData.Prices       || oddsData.prices;
    const inRunning  = oddsData.InRunning    != null ? oddsData.InRunning : (oddsData.in_running || false);
    const ts         = oddsData.Ts           || oddsData.ts || Date.now();
    const oddsType   = oddsData.SuperOddsType || oddsData.super_odds_type || "";
    const pct        = oddsData.Pct          || oddsData.pct || [];
    const isMatchWinner = oddsType === "" || oddsType.includes("1X2") ||
      oddsType.includes("PARTICIPANT_RESULT") || oddsType.includes("MATCH_RESULT") || oddsType.includes("WINNER");
    if (!isMatchWinner) return null;
    if (!prices || prices.length < 2) return null;
    let homeProb, awayProb, drawProb;
    if (pct.length >= 2 && pct[0] !== "NA" && pct[0] !== undefined) {
      homeProb = parseFloat(pct[0]) / 100;
      drawProb = pct.length > 2 ? parseFloat(pct[1]) / 100 : null;
      awayProb = parseFloat(pct[pct.length - 1]) / 100;
    } else if (priceNames && priceNames.length >= 2) {
      const homeIdx = priceNames.findIndex(n => n === "part1" || n.toLowerCase().includes("home") || n === "1");
      const awayIdx = priceNames.findIndex(n => n === "part2" || n.toLowerCase().includes("away") || n === "2");
      const drawIdx = priceNames.findIndex(n => n.toLowerCase().includes("draw") || n === "x");
      homeProb = homeIdx >= 0 ? prices[homeIdx] / 10000 : 0.45;
      awayProb = awayIdx >= 0 ? prices[awayIdx] / 10000 : 0.30;
      drawProb = drawIdx >= 0 ? prices[drawIdx] / 10000 : null;
    } else {
      homeProb = prices[0] / 10000;
      awayProb = prices[prices.length - 1] / 10000;
      drawProb = prices.length > 2 ? prices[1] / 10000 : null;
    }
    homeProb = Math.max(0.02, Math.min(0.96, homeProb || 0.45));
    awayProb = Math.max(0.02, Math.min(0.96, awayProb || 0.30));
    return { fixtureId, home: homeProb, away: awayProb, draw: drawProb, inRunning, ts };
  } catch (e) { return null; }
}
function calcShift(probBefore, probAfter) {
  if (!probBefore || !probAfter) return 0;
  return Math.abs((probAfter.homeProb || 0) - (probBefore.homeProb || 0));
}
module.exports = { extractProbability, calcShift };
