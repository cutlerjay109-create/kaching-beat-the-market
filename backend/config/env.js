// backend/config/env.js — loads and validates all environment variables.
// Every other file imports from here. Never read process.env directly elsewhere.

require("dotenv").config({ override: true });

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,

  // TxLINE
  TXLINE_API_ORIGIN: process.env.TXLINE_API_ORIGIN || "https://txline.txodds.com",
  TXLINE_API_BASE:   process.env.TXLINE_API_BASE   || "https://txline.txodds.com/api",
  TXLINE_API_TOKEN:  required("TXLINE_API_TOKEN"),
  TXLINE_JWT:        required("TXLINE_JWT"),

  // Groq
  GROQ_API_KEY: required("GROQ_API_KEY"),

  // ElevenLabs
  ELEVENLABS_API_KEY:  required("ELEVENLABS_API_KEY"),
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || "onwK4e9ZLuTAKqWW03F9",

  // Solana
  SOLANA_NETWORK:  process.env.SOLANA_NETWORK  || "mainnet-beta",
  SOLANA_RPC_URL:  process.env.SOLANA_RPC_URL  || "https://api.mainnet-beta.solana.com",
};
