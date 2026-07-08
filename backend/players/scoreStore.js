// backend/players/scoreStore.js — player creation, scoring, and streak tracking.

const { v4: uuidv4 } = require("uuid");
const { getDb, save } = require("./db");
const { BASE_POINTS, TIMING_BANDS, STREAK_BONUS_PER, STREAK_BONUS_MAX } = require("../../shared/scoringRules");

// Get or create a player by session id.
// Throws { code: "NICKNAME_TAKEN" } if the nickname belongs to a different session.
async function getOrCreatePlayer(sessionId, nickname) {
  const db = await getDb();

  // Already exists by sessionId? Return it.
  const bySession = db.exec(`SELECT * FROM players WHERE id = ?`, [sessionId]);
  if (bySession.length && bySession[0].values.length) {
    const cols = bySession[0].columns;
    return Object.fromEntries(cols.map((c, i) => [c, bySession[0].values[0][i]]));
  }

  const name = (nickname || "Anonymous").trim();

  // Nickname taken by a different session? Block it.
  const byName = db.exec(
    `SELECT id FROM players WHERE nickname = ? COLLATE NOCASE LIMIT 1`,
    [name]
  );
  if (byName.length && byName[0].values.length) {
    const ownerId = byName[0].values[0][0];
    if (ownerId !== sessionId) {
      const err = new Error("Username already taken");
      err.code = "NICKNAME_TAKEN";
      throw err;
    }
  }

  // Safe to create
  try {
    db.run(`INSERT INTO players (id, nickname) VALUES (?, ?)`, [sessionId || uuidv4(), name]);
    save();
  } catch (e) {
    // UNIQUE constraint hit (race condition) — treat as taken
    const err = new Error("Username already taken");
    err.code = "NICKNAME_TAKEN";
    throw err;
  }

  return { id: sessionId, nickname: name, score: 0, streak: 0, best_streak: 0, wallet: null };
}

// Calculate points based on timing
function calcPoints(correct, secondsBefore) {
  if (!correct) return 0;
  let multiplier = 1.0;
  let label = "Late";
  for (const band of TIMING_BANDS) {
    if (secondsBefore >= band.minSeconds) {
      multiplier = band.multiplier;
      label = band.label;
      break;
    }
  }
  return { points: Math.round(BASE_POINTS * multiplier), label };
}

// Record a prediction result and update player score
async function recordResult(playerId, predictionId, correct, secondsBefore, oddsBefore, oddsAfter) {
  const db = await getDb();
  // Sanitise all values so nothing undefined reaches SQLite
  secondsBefore = secondsBefore || 0;
  oddsBefore    = oddsBefore    || 0.5;
  oddsAfter     = oddsAfter     || 0.5;
  playerId      = playerId      || "unknown";
  predictionId  = predictionId  || "unknown";
  const { points, label } = calcPoints(correct, secondsBefore);

  // Get current streak
  let res = db.exec(`SELECT streak, best_streak, score FROM players WHERE id = ?`, [playerId]);

  // SELF-HEAL: if the player row is missing (hosting platforms wipe the disk
  // on redeploy, but the browser still holds its old sessionId), recreate it
  // on the spot instead of silently scoring zero forever.
  if (!res.length || !res[0].values.length) {
    console.warn(`[scoreStore] player ${playerId} missing (DB reset?) — recreating`);
    try {
      db.run(
        `INSERT INTO players (id, nickname) VALUES (?, ?)`,
        [playerId, "Player-" + String(playerId).slice(0, 6)]
      );
      save();
    } catch (e) {
      // Nickname collision — retry with a unique suffix
      try {
        db.run(
          `INSERT INTO players (id, nickname) VALUES (?, ?)`,
          [playerId, "Player-" + String(playerId).slice(0, 6) + "-" + Date.now() % 10000]
        );
        save();
      } catch (e2) {
        console.error("[scoreStore] could not recreate player:", e2.message);
        return null;
      }
    }
    res = db.exec(`SELECT streak, best_streak, score FROM players WHERE id = ?`, [playerId]);
    if (!res.length || !res[0].values.length) return null;
  }
  const [streak, bestStreak, currentScore] = res[0].values[0];

  const newStreak     = correct ? streak + 1 : 0;
  const newBestStreak = Math.max(bestStreak, newStreak);
  const streakBonus   = Math.min(newStreak * STREAK_BONUS_PER, STREAK_BONUS_MAX);
  const totalPoints   = points + (correct ? streakBonus : 0);
  const newScore      = currentScore + totalPoints;

  // Update player
  db.run(
    `UPDATE players SET score = ?, streak = ?, best_streak = ? WHERE id = ?`,
    [newScore, newStreak, newBestStreak, playerId]
  );

  // Update prediction record — guard every value against undefined
  db.run(
    `UPDATE predictions SET correct = ?, points = ?, timing_label = ?, odds_before = ?, odds_after = ?
     WHERE id = ?`,
    [
      correct ? 1 : 0,
      totalPoints  || 0,
      label        || "Unknown",
      oddsBefore   != null ? oddsBefore : 0.5,
      oddsAfter    != null ? oddsAfter  : 0.5,
      predictionId || "unknown",
    ]
  );

  save();

  return {
    correct,
    points: totalPoints,
    basePoints: points,
    streakBonus: correct ? streakBonus : 0,
    timingLabel: label,
    newStreak,
    newScore,
  };
}

// Save a new prediction (before it resolves)
async function savePrediction(playerId, questionId, answer, oddsBefore) {
  const db  = await getDb();
  const id  = uuidv4();
  db.run(
    `INSERT INTO predictions (id, player_id, question_id, answer, odds_before)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      playerId   || "unknown",
      questionId || "unknown",
      answer     || "yes",
      oddsBefore != null ? oddsBefore : 0.5,
    ]
  );
  save();
  return id;
}

// Get a player's current state
async function getPlayer(playerId) {
  const db  = await getDb();
  const res = db.exec(`SELECT * FROM players WHERE id = ?`, [playerId]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i]]));
}

module.exports = { getOrCreatePlayer, savePrediction, recordResult, getPlayer };
