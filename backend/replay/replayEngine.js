// backend/replay/replayEngine.js — plays back a recorded match at real speed.
// Used for demo recording and testing. Never player-facing.
// Recording files live in backend/replay/recordings/*.json

const fs   = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.join(__dirname, "recordings");

// Play back a recorded feed (type = "odds" or "scores")
function replayMatch(type, onData) {
  const file = path.join(RECORDINGS_DIR, `${type}.json`);

  if (!fs.existsSync(file)) {
    console.warn(`[replay] No recording found at ${file}. Skipping.`);
    return;
  }

  let events;
  try {
    events = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[replay] Failed to parse recording:", e.message);
    return;
  }

  if (!Array.isArray(events) || events.length === 0) {
    console.warn("[replay] Recording is empty.");
    return;
  }

  console.log(`[replay] Playing back ${events.length} ${type} events...`);

  // Each event has a { delayMs, data } shape.
  // We fire them with the same relative timing as the original match.
  let i = 0;
  function fireNext() {
    if (i >= events.length) {
      console.log(`[replay] ${type} replay complete.`);
      // Stop question engine when scores replay finishes
      if (type === "scores") {
        try {
          const { stopQuestions } = require("../game/questionEngine");
          stopQuestions();
        } catch(e) {}
      }
      return;
    }
    const { delayMs, data } = events[i++];
    setTimeout(() => {
      onData(data);
      fireNext();
    }, delayMs || 1000);
  }

  fireNext();
}

// Record live events to a file (call this during a real match to build a recording).
// Usage: pass this as the onData callback to startOddsSource / startScoresSource,
// then call stopRecording() when done.
function createRecorder(type) {
  const events   = [];
  let lastTs     = null;

  function record(data) {
    const now     = Date.now();
    const delayMs = lastTs ? now - lastTs : 1000;
    lastTs        = now;
    events.push({ delayMs, data });
  }

  function stopRecording() {
    const file = path.join(RECORDINGS_DIR, `${type}.json`);
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(events, null, 2));
    console.log(`[replay] Saved ${events.length} events to ${file}`);
  }

  return { record, stopRecording };
}

module.exports = { replayMatch, createRecorder };
