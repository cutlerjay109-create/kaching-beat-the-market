// backend/players/leaderboard.js — top players ranked by score.

const { getDb } = require("./db");

// Get top N players
async function getTopPlayers(limit = 20) {
  const db  = await getDb();
  const res = db.exec(
    `SELECT id, nickname, score, streak, best_streak, wallet
     FROM players
     ORDER BY score DESC
     LIMIT ?`,
    [limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

// Get a single player's rank
async function getPlayerRank(playerId) {
  const db  = await getDb();
  const res = db.exec(
    `SELECT COUNT(*) as rank FROM players
     WHERE score > (SELECT score FROM players WHERE id = ?)`,
    [playerId]
  );
  if (!res.length) return null;
  return res[0].values[0][0] + 1; // rank is count of players above + 1
}

module.exports = { getTopPlayers, getPlayerRank };
