// frontend/src/services/wallet.js — Phantom wallet connect, link, and restore.

const RESTORE_MESSAGE = "kaching:restore:v1";

// Convert Uint8Array to base64 without using Buffer (browser safe)
function toBase64(uint8array) {
  let binary = "";
  for (let i = 0; i < uint8array.length; i++) {
    binary += String.fromCharCode(uint8array[i]);
  }
  return btoa(binary);
}

async function connectAndLinkWallet(sessionId, onLinked) {
  try {
    const solana = window.solana;
    if (!solana || !solana.isPhantom) {
      alert("Phantom wallet not found. Install it from phantom.app to save your score permanently.");
      return null;
    }

    const resp   = await solana.connect();
    const pubkey = resp.publicKey.toBase58();

    const message   = "kaching:link:" + sessionId;
    const encoded   = new TextEncoder().encode(message);
    const signed    = await solana.signMessage(encoded, "utf8");
    const signature = toBase64(signed.signature);

    const res = await fetch("/api/session/link-wallet", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sessionId, publicKey: pubkey, signature, message }),
    });
    const data = await res.json();
    if (res.ok && data.player && onLinked) onLinked(pubkey, data);
    return data;
  } catch (e) {
    console.error("[wallet] link error:", e.message);
    return null;
  }
}

async function restoreWithWallet(onRestored) {
  try {
    const solana = window.solana;
    if (!solana || !solana.isPhantom) {
      alert("Phantom wallet not found. Install it from phantom.app.");
      return null;
    }

    const resp   = await solana.connect();
    const pubkey = resp.publicKey.toBase58();

    const encoded   = new TextEncoder().encode(RESTORE_MESSAGE);
    const signed    = await solana.signMessage(encoded, "utf8");
    const signature = toBase64(signed.signature);

    const res = await fetch("/api/session/restore-wallet", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        publicKey: pubkey,
        signature,
        message: RESTORE_MESSAGE,
      }),
    });

    if (res.status === 404) return { notFound: true };

    const data = await res.json();
    if (res.ok && data.player && onRestored) onRestored(pubkey, data);
    return data;
  } catch (e) {
    console.error("[wallet] restore error:", e.message);
    return null;
  }
}

async function saveStreakOnChain(publicKey, sessionId, streak, score) {
  console.log("[wallet] streak " + streak + " score " + score + " linked to " + publicKey.slice(0,8) + "...");
  return { success: true };
}
