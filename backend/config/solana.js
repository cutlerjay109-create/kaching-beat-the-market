// backend/config/solana.js — Solana network config.

const { SOLANA_NETWORK, SOLANA_RPC_URL } = require("./env");

module.exports = {
  NETWORK:     SOLANA_NETWORK,
  RPC_URL:     SOLANA_RPC_URL,
  PROGRAM_ID:  "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
  TXL_MINT:    "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
};
