// backend/data/source.js — THE SWITCH: live feed vs recorded replay.
const { startOddsStream }   = require("./oddsStream");
const { startScoresStream } = require("./scoresStream");
const { replayMatch }       = require("../replay/replayEngine");
const IS_REPLAY = process.env.SOURCE_MODE === "replay";
let replayStarted = false;
let lastOdds      = null;
function startOddsSource(handler) {
  if (IS_REPLAY) return;
  startOddsStream((data) => { lastOdds = data; handler(data); });
}
function startScoresSource(handler) {
  if (IS_REPLAY) return;
  startScoresStream(handler);
}
function startReplayIfNeeded(oddsHandler, scoresHandler) {
  if (!IS_REPLAY) return;
  if (replayStarted) return;
  replayStarted = true;
  console.log("[source] First player connected — starting replay...");
  replayMatch("odds",   oddsHandler);
  replayMatch("scores", scoresHandler);
}
function getLastOdds() { return lastOdds; }
module.exports = { startOddsSource, startScoresSource, startReplayIfNeeded, getLastOdds };
