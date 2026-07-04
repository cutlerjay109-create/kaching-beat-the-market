// backend/routes/predictions.js — receive and store player predictions.

const express  = require("express");
const { savePrediction, getPlayer } = require("../players/scoreStore");
const { getActiveQuestion }         = require("../game/questionEngine");

const router = express.Router();

// POST /api/predictions — submit a prediction tap
router.post("/", async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    if (!sessionId || !answer) {
      return res.status(400).json({ error: "sessionId and answer required" });
    }

    const player = await getPlayer(sessionId);
    if (!player) return res.status(404).json({ error: "Player not found" });

    const question = getActiveQuestion();
    if (!question) return res.status(400).json({ error: "No active question" });

    // Get current odds for timing reference
    const { getLastOdds } = require("../data/source");
    const lastOdds  = getLastOdds();
    const oddsBefore = lastOdds ? (lastOdds.home || 0.5) : 0.5;

    const predictionId = await savePrediction(
      sessionId,
      question.id,
      answer,
      oddsBefore
    );

    res.json({
      predictionId,
      question: question.text,
      answer,
      message: "Prediction recorded. Watch the match!",
    });
  } catch (e) {
    console.error("[predictions] error:", e.message);
    res.status(500).json({ error: "Could not save prediction" });
  }
});

module.exports = router;
