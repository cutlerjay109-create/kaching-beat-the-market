const EventSource = require("eventsource");
const { withReconnect } = require("./reconnectGuard");
function startScoresStream(handler) {
  withReconnect("ScoresStream", () => {
    const es = new EventSource("https://txline.txodds.com/api/scores/stream", {
      headers: { "Authorization": `Bearer ${process.env.TXLINE_JWT}`, "X-Api-Token": process.env.TXLINE_API_TOKEN },
    });
    es.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch(_) {} };
    return es;
  });
}
module.exports = { startScoresStream };
