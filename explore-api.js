// explore-api.js — explore what endpoints and fixture IDs are available.

require("dotenv").config({ override: true });

const API_ORIGIN = process.env.TXLINE_API_ORIGIN || "https://txline.txodds.com";
const JWT        = process.env.TXLINE_JWT;
const API_TOKEN  = process.env.TXLINE_API_TOKEN;

const headers = {
  "Authorization": `Bearer ${JWT}`,
  "X-Api-Token":   API_TOKEN,
  "Content-Type":  "application/json",
};

async function get(url) {
  const res = await fetch(`${API_ORIGIN}${url}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 400) };
}

async function main() {
  // First show all 12 fixtures we have
  const fr = await get("/api/fixtures/snapshot");
  let fixtures = [];
  try { fixtures = JSON.parse(fr.body); } catch(e) {}
  const list = Array.isArray(fixtures) ? fixtures : (fixtures.fixtures || fixtures.data || []);
  console.log("\n=== YOUR 12 FIXTURES ===");
  list.forEach(f =>
    console.log(`  ID:${f.FixtureId || f.fixture_id} | ${f.Participant1||f.participant1} vs ${f.Participant2||f.participant2} | ${f.StartTime||f.start_time||""}`)
  );

  // Try odds endpoints for Colombia vs Ghana (ID: 18179549)
  const FID = 18179549;
  console.log("\n=== TRYING ODDS ENDPOINTS FOR ID:", FID, "===");
  const endpoints = [
    `/api/odds/snapshot/${FID}`,
    `/api/odds/snapshot?fixtureId=${FID}`,
    `/api/odds/snapshot?fixture_id=${FID}`,
    `/api/odds/history/${FID}`,
    `/api/odds/history?fixtureId=${FID}`,
    `/api/odds/${FID}`,
    `/api/odds?fixtureId=${FID}`,
  ];
  for (const ep of endpoints) {
    const r = await get(ep);
    console.log(`  [${r.status}] ${ep}`);
    console.log(`         -> ${r.body.slice(0, 120)}`);
  }
}

main().catch(e => console.error("Fatal:", e.message));
