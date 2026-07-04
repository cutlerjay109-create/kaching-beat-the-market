// backend/routes/session.js — player session management.

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getOrCreatePlayer, getPlayer } = require("../players/scoreStore");
const { getPlayerRank }                = require("../players/leaderboard");

const router = express.Router();

// POST /api/session/start — start or resume a session
router.post("/start", async (req, res) => {
  try {
    const sessionId = req.body.sessionId || uuidv4();
    const nickname  = req.body.nickname  || "Anonymous";
    const player    = await getOrCreatePlayer(sessionId, nickname);
    const rank      = await getPlayerRank(sessionId);
    res.json({ sessionId, player, rank });
  } catch (e) {
    console.error("[session] start error:", e.message);
    res.status(500).json({ error: "Could not start session" });
  }
});

// GET /api/session/:id — get player state
router.get("/:id", async (req, res) => {
  try {
    const player = await getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: "Player not found" });
    const rank   = await getPlayerRank(req.params.id);
    res.json({ player, rank });
  } catch (e) {
    res.status(500).json({ error: "Could not get session" });
  }
});

// POST /api/session/link-wallet — links a wallet address to a player record
router.post("/link-wallet", async (req, res) => {
  try {
    const { sessionId, publicKey, signature, message } = req.body;
    if (!sessionId || !publicKey || !signature || !message) {
      return res.status(400).json({ error: "sessionId, publicKey, signature and message required" });
    }

    // Verify the signature
    const { verifyWalletSignature } = require("../chain/wallet");
    const valid = verifyWalletSignature(message, signature, publicKey);
    if (!valid) return res.status(401).json({ error: "Invalid wallet signature" });

    // Link wallet to player
    const { getDb, save } = require("../players/db");
    const db = await getDb();

    // Check if this wallet is already linked to another account
    const existing = db.exec(
      `SELECT * FROM players WHERE wallet = ?`, [publicKey]
    );

    if (existing.length && existing[0].values.length) {
      // Wallet already has an account — return that account
      const cols   = existing[0].columns;
      const player = Object.fromEntries(cols.map((c, i) => [c, existing[0].values[0][i]]));
      console.log(`[session] wallet ${publicKey.slice(0,8)}... already linked to ${player.nickname}`);
      return res.json({ sessionId: player.id, player, recovered: true });
    }

    // Link wallet to current session
    db.run(`UPDATE players SET wallet = ? WHERE id = ?`, [publicKey, sessionId]);
    save();

    const player = await require("../players/scoreStore").getPlayer(sessionId);
    console.log(`[session] linked wallet ${publicKey.slice(0,8)}... to ${player?.nickname}`);
    res.json({ sessionId, player, linked: true });
  } catch (e) {
    console.error("[session] link-wallet error:", e.message);
    res.status(500).json({ error: "Could not link wallet" });
  }
});

// POST /api/session/restore-wallet — restore session from wallet signature
router.post("/restore-wallet", async (req, res) => {
  try {
    const { publicKey, signature, message } = req.body;
    if (!publicKey || !signature || !message) {
      return res.status(400).json({ error: "publicKey, signature and message required" });
    }

    // Verify signature
    const { verifyWalletSignature } = require("../chain/wallet");
    const valid = verifyWalletSignature(message, signature, publicKey);
    if (!valid) return res.status(401).json({ error: "Invalid wallet signature" });

    // Find player by wallet
    const { getDb } = require("../players/db");
    const db = await getDb();
    const res2 = db.exec(`SELECT * FROM players WHERE wallet = ?`, [publicKey]);

    if (!res2.length || !res2[0].values.length) {
      return res.status(404).json({ error: "No account found for this wallet" });
    }

    const cols   = res2[0].columns;
    const player = Object.fromEntries(cols.map((c, i) => [c, res2[0].values[0][i]]));
    const { getPlayerRank } = require("../players/leaderboard");
    const rank = await getPlayerRank(player.id);

    console.log(`[session] restored ${player.nickname} via wallet — score: ${player.score}`);
    res.json({ sessionId: player.id, player, rank, restored: true });
  } catch (e) {
    console.error("[session] restore-wallet error:", e.message);
    res.status(500).json({ error: "Could not restore wallet session" });
  }
});

module.exports = router;
