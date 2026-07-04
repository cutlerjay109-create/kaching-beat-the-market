// backend/pundit/pundit.js — orchestrates the full pundit reaction pipeline.
// text -> Groq -> ElevenLabs -> base64 audio pushed to frontend via socket.

const { generatePunditText } = require("./generateText");
const { generateVoice }      = require("./generateVoice");

// Generate a full pundit reaction (text + audio) for a given event.
// Returns { text, audioBase64 } or null if generation fails.
async function react(event) {
  try {
    const text = await generatePunditText(event);
    if (!text) return null;

    console.log(`[pundit] "${text}"`);

    const audioBuf = await generateVoice(text);
    const audioBase64 = audioBuf ? audioBuf.toString("base64") : null;

    return { text, audioBase64 };
  } catch (e) {
    console.error("[pundit] error:", e.message);
    return null;
  }
}

module.exports = { react };
