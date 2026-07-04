// backend/routes/leaderboard.js — serve leaderboard data.

const express = require("express");
const { getTopPlayers, getPlayerRank } = require("../players/leaderboard");

const router = express.Router();

// GET /api/leaderboard — top 20 players
router.get("/", async (req, res) => {
  try {
    const players = await getTopPlayers(20);
    res.json({ players });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch leaderboard" });
  }
});

// GET /api/leaderboard/:id — single player rank
router.get("/:id", async (req, res) => {
  try {
    const rank = await getPlayerRank(req.params.id);
    res.json({ rank });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch rank" });
  }
});

module.exports = router;
