// record-match.js — pulls historical odds + scores for a finished match
// and saves them as replay recordings.
//
// Usage: node record-match.js
// Output: backend/replay/recordings/odds.json
//         backend/replay/recordings/scores.json

require("dotenv").config({ override: true });
const fs   = require("fs");
const path = require("path");

const API_ORIGIN = process.env.TXLINE_API_ORIGIN || "https://txline.txodds.com";
const JWT        = process.env.TXLINE_JWT;
const API_TOKEN  = process.env.TXLINE_API_TOKEN;
const COMPETITION_ID = 17; // FIFA World Cup 2026

const headers = {
  "Authorization": `Bearer ${JWT}`,
  "X-Api-Token":   API_TOKEN,
  "Content-Type":  "application/json",
};

async function get(url) {
  const res = await fetch(`${API_ORIGIN}${url}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function toReplayEvents(snapshots, speedMultiplier = 4) {
  const sorted = [...snapshots].sort((a, b) => {
    const ta = a.Ts || a.ts || 0;
    const tb = b.Ts || b.ts || 0;
    return ta - tb;
  });
  return sorted.map((snap, i) => {
    let delayMs = 1500;
    if (i > 0) {
      const tPrev = sorted[i-1].Ts || sorted[i-1].ts || 0;
      const tCurr = snap.Ts        || snap.ts        || 0;
      const real  = (tCurr - tPrev) * 1000;
      delayMs = Math.max(500, Math.min(real / speedMultiplier, 8000));
    }
    return { delayMs, data: snap };
  });
}

async function main() {
  console.log("Fetching fixtures for World Cup...");
  let fixtures;
  try {
    fixtures = await get(`/api/fixtures/snapshot?competitionId=${COMPETITION_ID}`);
  } catch(e) {
    console.error("Fixtures fetch failed:", e.message);
    console.log("Trying without competitionId filter...");
    fixtures = await get(`/api/fixtures/snapshot`);
  }

  const list = Array.isArray(fixtures) ? fixtures : (fixtures.fixtures || fixtures.data || []);
  console.log(`Got ${list.length} fixtures`);

  // Find Colombia vs Ghana
  const match = list.find(f => {
    const p1 = (f.Participant1 || f.participant1 || f.home_team || "").toLowerCase();
    const p2 = (f.Participant2 || f.participant2 || f.away_team || "").toLowerCase();
    return (p1.includes("colomb") || p2.includes("colomb")) &&
           (p1.includes("ghana")  || p2.includes("ghana"));
  });

  if (!match) {
    console.log("Colombia vs Ghana not found. Showing all fixtures:");
    list.slice(0, 20).forEach(f =>
      console.log(`  ID:${f.FixtureId || f.fixture_id} | ${f.Participant1 || f.participant1} vs ${f.Participant2 || f.participant2}`)
    );
    return;
  }

  const fixtureId = match.FixtureId || match.fixture_id;
  console.log(`Found: ${match.Participant1 || match.participant1} vs ${match.Participant2 || match.participant2} — ID: ${fixtureId}`);

  console.log("Fetching odds history...");
  const odds = await get(`/api/odds/snapshot/${fixtureId}`);
  const oddsList = Array.isArray(odds) ? odds : (odds.odds || odds.data || []);
  console.log(`Got ${oddsList.length} odds snapshots`);

  console.log("Fetching scores history...");
  const scores = await get(`/api/scores/snapshot/${fixtureId}`);
  const scoresList = Array.isArray(scores) ? scores : (scores.scores || scores.data || []);
  console.log(`Got ${scoresList.length} scores snapshots`);

  const oddsEvents   = toReplayEvents(oddsList,   4);
  const scoresEvents = toReplayEvents(scoresList, 4);

  const dir = path.join(__dirname, "backend/replay/recordings");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "odds.json"),   JSON.stringify(oddsEvents,   null, 2));
  fs.writeFileSync(path.join(dir, "scores.json"), JSON.stringify(scoresEvents, null, 2));

  console.log(`\n✅ Saved ${oddsEvents.length} odds events`);
  console.log(`✅ Saved ${scoresEvents.length} scores events`);
  console.log(`\nTo run replay mode:`);
  console.log(`  SOURCE_MODE=replay node backend/server.js`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
