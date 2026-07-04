// backend/chain/wallet.js — verifies Phantom wallet signatures.

const { PublicKey } = require("@solana/web3.js");
const nacl          = require("tweetnacl");

function verifyWalletSignature(message, signature, publicKey) {
  try {
    const messageBytes   = new TextEncoder().encode(message);
    const signatureBytes = Uint8Array.from(Buffer.from(signature, "base64"));
    const pubkeyBytes    = new PublicKey(publicKey).toBytes();
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
  } catch (e) {
    console.error("[wallet] verify error:", e.message);
    return false;
  }
}

module.exports = { verifyWalletSignature };
