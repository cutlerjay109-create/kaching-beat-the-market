// backend/config/txline.js
const fs = require("fs"), path = require("path");
const API_ORIGIN = "https://txline.txodds.com";
const API_BASE   = "https://txline.txodds.com/api";
const ENV_PATH   = path.join(__dirname, "../../.env");
async function refreshJwt() {
  try {
    const res = await fetch(`${API_ORIGIN}/auth/guest/start`, { method: "POST" });
    const text = await res.text();
    let jwt; try { jwt = JSON.parse(text).token; } catch { jwt = text.trim(); }
    if (!jwt) throw new Error("Empty JWT");
    process.env.TXLINE_JWT = jwt;
    if (fs.existsSync(ENV_PATH)) {
      let env = fs.readFileSync(ENV_PATH, "utf8");
      env = env.includes("TXLINE_JWT=") ? env.replace(/TXLINE_JWT=.*/, "TXLINE_JWT=" + jwt) : env + "\nTXLINE_JWT=" + jwt;
      fs.writeFileSync(ENV_PATH, env);
    }
    console.log("[txline] JWT refreshed successfully.");
    return jwt;
  } catch(e) { console.error("[txline] JWT refresh failed:", e.message); return null; }
}
function startJwtAutoRefresh() {
  refreshJwt();
  setInterval(refreshJwt, 45 * 60 * 1000);
  console.log("[txline] JWT auto-refresh started (every 45 min).");
}
module.exports = {
  ODDS_SNAPSHOT_URL: `${API_BASE}/odds/snapshot`,
  SCORES_SNAPSHOT_URL: `${API_BASE}/scores/snapshot`,
  ODDS_STREAM_URL: `${API_BASE}/odds/stream`,
  SCORES_STREAM_URL: `${API_BASE}/scores/stream`,
  GUEST_AUTH_URL: `${API_ORIGIN}/auth/guest/start`,
  WORLD_CUP_COMPETITION_ID: 72,
  JWT_REFRESH_INTERVAL: 45 * 60 * 1000,
  refreshJwt, startJwtAutoRefresh,
};
