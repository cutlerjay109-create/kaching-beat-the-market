// backend/config/txline.js — TxLINE endpoint URLs and stream config.

const { TXLINE_API_ORIGIN, TXLINE_API_BASE } = require("./env");

module.exports = {
  // REST snapshots
  ODDS_SNAPSHOT_URL:   `${TXLINE_API_BASE}/odds/snapshot`,
  SCORES_SNAPSHOT_URL: `${TXLINE_API_BASE}/scores/snapshot`,

  // Live streams (Server-Sent Events)
  ODDS_STREAM_URL:   `${TXLINE_API_BASE}/odds/stream`,
  SCORES_STREAM_URL: `${TXLINE_API_BASE}/scores/stream`,

  // Auth
  GUEST_AUTH_URL: `${TXLINE_API_ORIGIN}/auth/guest/start`,

  // World Cup competition ID (FIFA World Cup 2026)
  WORLD_CUP_COMPETITION_ID: 17,

  // How often to refresh the guest JWT (ms) — 45 minutes to be safe
  JWT_REFRESH_INTERVAL: 45 * 60 * 1000,
};
