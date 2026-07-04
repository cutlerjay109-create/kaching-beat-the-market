// build-replay.js — builds a replay from the Colombia vs Ghana scores data.
// Simulates probability movement from score events since historical odds are unavailable.

require("dotenv").config({ override: true });
const fs   = require("fs");
const path = require("path");

const API_ORIGIN = process.env.TXLINE_API_ORIGIN || "https://txline.txodds.com";
const JWT        = process.env.TXLINE_JWT;
const API_TOKEN  = process.env.TXLINE_API_TOKEN;
const FIXTURE_ID = 18179549; // Colombia vs Ghana

const headers = {
  "Authorization": `Bearer ${JWT}`,
  "X-Api-Token":   API_TOKEN,
};

// Simulate home win probability from score and clock
function simulateProb(score, clockSeconds, isGoal) {
  const p1 = score.Participant1 || {};
  const p2 = score.Participant2 || {};
  const h1Goals = (p1.H1 || {}).Goals || 0;
  const h2Goals = (p1.H2 || {}).Goals || 0;
  const homeGoals = h1Goals + h2Goals;
  const h1GoalsAway = (p2.H1 || {}).Goals || 0;
  const h2GoalsAway = (p2.H2 || {}).Goals || 0;
  const awayGoals = h1GoalsAway + h2GoalsAway;

  // Base probability shifts with goals and time
  let homeProb = 0.45; // Colombia slight underdog at home
  const minute = Math.floor((clockSeconds || 0) / 60);
  const diff   = homeGoals - awayGoals;

  if (diff > 0)       homeProb = 0.72 + (minute / 90) * 0.15;
  else if (diff < 0)  homeProb = 0.18 - (minute / 90) * 0.08;
  else                homeProb = 0.45 + (minute / 90) * 0.05;

  // Add small random market noise
  homeProb += (Math.random() - 0.5) * 0.04;
  homeProb   = Math.max(0.05, Math.min(0.92, homeProb));
  const drawProb = diff === 0 ? Math.max(0.05, 0.35 - (minute / 90) * 0.20) : 0.08;
  const awayProb = Math.max(0.03, 1 - homeProb - drawProb);

  return {
    fixture_id:   FIXTURE_ID,
    price_names:  ["home", "draw", "away"],
    prices:       [
      Math.round(homeProb * 10000),
      Math.round(drawProb * 10000),
      Math.round(awayProb * 10000),
    ],
    in_running:   true,
    ts:           Date.now(),
  };
}

async function main() {
  console.log("Loading saved scores...");
  const scoresPath = path.join(__dirname, "backend/replay/recordings/scores.json");
  if (!fs.existsSync(scoresPath)) {
    throw new Error("scores.json not found. Run record-match.js first.");
  }

  const scoresEvents = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  console.log(`Loaded ${scoresEvents.length} score events`);

  // Build enriched scores replay with team names and proper field mapping
  const enrichedScores = scoresEvents.map(ev => {
    const d = ev.data;
    return {
      delayMs: ev.delayMs,
      data: {
        fixture_id:   d.FixtureId   || FIXTURE_ID,
        home_team:    "Colombia",
        away_team:    "Ghana",
        score: {
          home: ((d.Score?.Participant1?.H1?.Goals || 0) + (d.Score?.Participant1?.H2?.Goals || 0)),
          away: ((d.Score?.Participant2?.H1?.Goals || 0) + (d.Score?.Participant2?.H2?.Goals || 0)),
        },
        goals:        ((d.Score?.Participant1?.H1?.Goals || 0) +
                       (d.Score?.Participant1?.H2?.Goals || 0) +
                       (d.Score?.Participant2?.H1?.Goals || 0) +
                       (d.Score?.Participant2?.H2?.Goals || 0)),
        corners:      ((d.Score?.Participant1?.H1?.Corner || 0) +
                       (d.Score?.Participant1?.H2?.Corner || 0) +
                       (d.Score?.Participant2?.H1?.Corner || 0) +
                       (d.Score?.Participant2?.H2?.Corner || 0)),
        yellowCards:  ((d.Score?.Participant1?.H1?.YellowCards || 0) +
                       (d.Score?.Participant2?.H1?.YellowCards || 0)),
        redCards:     ((d.Score?.Participant1?.H1?.RedCards || 0) +
                       (d.Score?.Participant2?.H1?.RedCards || 0)),
        match_time:   d.Clock ? Math.floor(d.Clock.Seconds / 60) : 0,
        period:       d.StatusId === 4 ? "1H" : d.StatusId === 5 ? "HT" : d.StatusId === 6 ? "2H" : "FT",
        inRunning:    d.Clock?.Running || false,
        gameState:    d.GameState,
      }
    };
  });

  // Build simulated odds replay synced to score events
  const oddsEvents = scoresEvents.map((ev, i) => {
    const d   = ev.data;
    const prob = simulateProb(d.Score || {}, d.Clock?.Seconds || 0, false);
    return {
      delayMs: ev.delayMs,
      data:    { ...prob, ts: d.Ts || Date.now() }
    };
  });

  const dir = path.join(__dirname, "backend/replay/recordings");
  fs.writeFileSync(path.join(dir, "scores.json"), JSON.stringify(enrichedScores, null, 2));
  fs.writeFileSync(path.join(dir, "odds.json"),   JSON.stringify(oddsEvents,    null, 2));

  console.log(`\n✅ Saved ${enrichedScores.length} enriched score events`);
  console.log(`✅ Saved ${oddsEvents.length} simulated odds events`);
  console.log("\nRun replay with:");
  console.log("  SOURCE_MODE=replay node backend/server.js");

  // Preview first few events
  console.log("\nFirst score event preview:");
  console.log(JSON.stringify(enrichedScores[0]?.data, null, 2));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
