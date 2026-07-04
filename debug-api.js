// debug-api.js — see raw response shapes.

require("dotenv").config({ override: true });

const API_ORIGIN = process.env.TXLINE_API_ORIGIN || "https://txline.txodds.com";
const JWT        = process.env.TXLINE_JWT;
const API_TOKEN  = process.env.TXLINE_API_TOKEN;

const headers = {
  "Authorization": `Bearer ${JWT}`,
  "X-Api-Token":   API_TOKEN,
};

async function get(url) {
  const res  = await fetch(`${API_ORIGIN}${url}`, { headers });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  // See raw fixture response
  console.log("=== RAW FIXTURES RESPONSE (first 1000 chars) ===");
  const fr = await get("/api/fixtures/snapshot");
  console.log("Status:", fr.status);
  console.log(fr.text.slice(0, 1000));

  // See raw scores response for Colombia vs Ghana
  console.log("\n=== RAW SCORES SNAPSHOT (first 500 chars) ===");
  const sr = await get("/api/scores/snapshot/18179549");
  console.log("Status:", sr.status);
  console.log(sr.text.slice(0, 500));

  // Check if there is a live scores stream we can peek at
  console.log("\n=== SCORES STREAM PEEK (2 seconds) ===");
  const EventSource = require("eventsource");
  const es = new EventSource(`${API_ORIGIN}/api/scores/stream`, { headers });
  let count = 0;
  es.onmessage = (e) => {
    if (count < 2) {
      console.log("Stream event:", e.data.slice(0, 200));
      count++;
    }
    if (count >= 2) { es.close(); process.exit(0); }
  };
  es.onerror = () => { es.close(); process.exit(0); };
  setTimeout(() => { es.close(); console.log("(no stream events in 2s — no live match right now)"); process.exit(0); }, 2000);
}

main().catch(e => console.error("Fatal:", e.message));
