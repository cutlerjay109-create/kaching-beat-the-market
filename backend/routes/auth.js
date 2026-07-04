// backend/routes/auth.js — signup and login endpoints.

const express = require("express");
const { signup, login } = require("../players/auth");
const { getPlayerRank } = require("../players/leaderboard");

const router = express.Router();

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const player = await signup(username, password);
    const rank   = await getPlayerRank(player.id);
    res.json({ sessionId: player.id, player, rank });
  } catch (e) {
    if (e.code === "USERNAME_TAKEN")
      return res.status(409).json({ error: "That username is already taken.", code: e.code });
    if (e.code === "BAD_INPUT")
      return res.status(400).json({ error: e.message, code: e.code });
    console.error("[auth] signup error:", e.message);
    res.status(500).json({ error: "Could not create account" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const player = await login(username, password);
    const rank   = await getPlayerRank(player.id);
    res.json({ sessionId: player.id, player, rank });
  } catch (e) {
    if (e.code === "NO_USER")
      return res.status(404).json({ error: "No account with that username.", code: e.code });
    if (e.code === "WRONG_PASSWORD")
      return res.status(401).json({ error: "Wrong password.", code: e.code });
    if (e.code === "NO_PASSWORD")
      return res.status(400).json({ error: "This account has no password.", code: e.code });
    console.error("[auth] login error:", e.message);
    res.status(500).json({ error: "Could not log in" });
  }
});

module.exports = router;
