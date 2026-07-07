// backend/game/probability.js — extracts REAL win probabilities from TxLINE odds.
//
// ACCURACY RULES:
//   • Only real market data is ever used. If the message can't be parsed into
//     home/away probabilities, return null — NEVER invent placeholder numbers.
//     (The old code substituted hardcoded 0.45/0.30, which made the bar drift
//     away from the real match. That is gone.)
//   • The bookmaker margin (overround) is removed by normalising the implied
//     probabilities so home + draw + away = 100% — the same figure a
//     professional trading screen shows.

function extractProbability(oddsData) {
  try {
    const fixtureId  = oddsData.FixtureId    || oddsData.fixture_id;
    const priceNames = oddsData.PriceNames   || oddsData.price_names;
    const prices     = oddsData.Prices       || oddsData.prices;
    const inRunning  = oddsData.InRunning    != null ? oddsData.InRunning : (oddsData.in_running || false);
    const ts         = oddsData.Ts           || oddsData.ts || Date.now();
    const oddsType   = oddsData.SuperOddsType || oddsData.super_odds_type || "";
    const pct        = oddsData.Pct          || oddsData.pct || [];

    // Only the match-winner market drives the probability bar
    const isMatchWinner = oddsType === "" || oddsType.includes("1X2") ||
      oddsType.includes("PARTICIPANT_RESULT") || oddsType.includes("MATCH_RESULT") ||
      oddsType.includes("WINNER");
    if (!isMatchWinner) return null;

    let homeProb = null, awayProb = null, drawProb = null;

    // 1) Pct array — the feed's own percentages (most direct real source)
    if (pct.length >= 2 && pct[0] !== "NA" && pct[0] !== undefined && pct[0] !== null) {
      homeProb = parseFloat(pct[0]) / 100;
      drawProb = pct.length > 2 ? parseFloat(pct[1]) / 100 : null;
      awayProb = parseFloat(pct[pct.length - 1]) / 100;
    }
    // 2) Named price columns
    else if (priceNames && priceNames.length >= 2 && prices && prices.length >= 2) {
      const homeIdx = priceNames.findIndex(n => n === "part1" || String(n).toLowerCase().includes("home") || n === "1");
      const awayIdx = priceNames.findIndex(n => n === "part2" || String(n).toLowerCase().includes("away") || n === "2");
      const drawIdx = priceNames.findIndex(n => String(n).toLowerCase().includes("draw") || String(n).toLowerCase() === "x");
      // No real column found -> no data. Do NOT invent a number.
      if (homeIdx < 0 || awayIdx < 0) return null;
      homeProb = prices[homeIdx] / 10000;
      awayProb = prices[awayIdx] / 10000;
      drawProb = drawIdx >= 0 ? prices[drawIdx] / 10000 : null;
    }
    // 3) Positional fallback (home, [draw], away)
    else if (prices && prices.length >= 2) {
      homeProb = prices[0] / 10000;
      awayProb = prices[prices.length - 1] / 10000;
      drawProb = prices.length > 2 ? prices[1] / 10000 : null;
    } else {
      return null;
    }

    if (!isFinite(homeProb) || !isFinite(awayProb) ||
        homeProb <= 0 || awayProb <= 0) return null;
    if (drawProb != null && (!isFinite(drawProb) || drawProb < 0)) drawProb = null;

    // ── REMOVE THE BOOKMAKER MARGIN ────────────────────────────────────────
    // Implied probabilities from odds sum to >100% (the overround). Normalise
    // so the displayed chances are the true market-consensus probabilities —
    // matching what viewers see on professional broadcast graphics.
    const total = homeProb + awayProb + (drawProb || 0);
    if (total > 0 && (total > 1.01 || total < 0.99)) {
      homeProb = homeProb / total;
      awayProb = awayProb / total;
      if (drawProb != null) drawProb = drawProb / total;
    }

    // Light clamp for display only (a 0%/100% bar renders badly)
    homeProb = Math.max(0.01, Math.min(0.98, homeProb));
    awayProb = Math.max(0.01, Math.min(0.98, awayProb));

    return { fixtureId, home: homeProb, away: awayProb, draw: drawProb, inRunning, ts };
  } catch (e) {
    return null;
  }
}

function calcShift(probBefore, probAfter) {
  if (!probBefore || !probAfter) return 0;
  return Math.abs((probAfter.homeProb || 0) - (probBefore.homeProb || 0));
}

module.exports = { extractProbability, calcShift };
