// backend/pundit/generateVoice.js — sends text to ElevenLabs and returns audio buffer.

const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } = require("../config/env");

const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

async function generateVoice(text) {
  if (!text) return null;

  try {
    const res = await fetch(ELEVENLABS_URL, {
      method:  "POST",
      headers: {
        "xi-api-key":     ELEVENLABS_API_KEY,
        "Content-Type":   "application/json",
        "Accept":         "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          // Broadcast-commentator tuning:
          // higher stability = composed, professional delivery (no wobble);
          // higher style = expressive rise-and-fall like a live TV call.
          stability:        0.55,
          similarity_boost: 0.85,
          style:            0.65,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[generateVoice] ElevenLabs error:", res.status, err);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer); // raw mp3 bytes
  } catch (e) {
    console.error("[generateVoice] fetch error:", e.message);
    return null;
  }
}

module.exports = { generateVoice };
