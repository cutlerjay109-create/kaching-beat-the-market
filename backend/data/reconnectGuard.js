// backend/data/reconnectGuard.js
const MAX_BACKOFF = 30000;
function withReconnect(name, connect) {
  let backoff = 1000;
  function attempt() {
    console.log(`[${name}] connecting...`);
    const es = connect();
    es.onopen  = () => { console.log(`[${name}] connected.`); backoff = 1000; };
    es.onerror = () => {
      console.error(`[${name}] error — reconnecting in ${backoff / 1000}s`);
      try { es.close(); } catch (e) {}
      setTimeout(() => { backoff = Math.min(backoff * 2, MAX_BACKOFF); attempt(); }, backoff);
    };
  }
  attempt();
}
module.exports = { withReconnect };
