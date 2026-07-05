// backend/players/db.js — SQLite database using sql.js (pure JS, no native build).

const path = require("path");
const fs   = require("fs");
const init = require("sql.js");

const DB_PATH = path.join(__dirname, "../../data/game.db");
let db;

async function getDb() {
  if (db) return db;

  const SQL = await init();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new SQL.Database();
  }

  // Players table with password_hash and UNIQUE nickname
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id            TEXT PRIMARY KEY,
      nickname      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT DEFAULT NULL,
      score         INTEGER DEFAULT 0,
      streak        INTEGER DEFAULT 0,
      best_streak   INTEGER DEFAULT 0,
      wallet        TEXT DEFAULT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add password_hash if missing (migration for old databases)
  try {
    const cols = db.exec("PRAGMA table_info(players)");
    const names = cols.length ? cols[0].values.map(r => r[1]) : [];
    if (!names.includes("password_hash")) {
      db.run("ALTER TABLE players ADD COLUMN password_hash TEXT DEFAULT NULL");
      console.log("[db] migrated: added password_hash");
    }
    if (!names.includes("wallet")) {
      db.run("ALTER TABLE players ADD COLUMN wallet TEXT DEFAULT NULL");
      console.log("[db] migrated: added wallet");
    }
  } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS predictions (
      id           TEXT PRIMARY KEY,
      player_id    TEXT NOT NULL,
      question_id  TEXT NOT NULL,
      answer       TEXT NOT NULL,
      correct      INTEGER DEFAULT NULL,
      points       INTEGER DEFAULT 0,
      timing_label TEXT DEFAULT NULL,
      odds_before  REAL DEFAULT NULL,
      odds_after   REAL DEFAULT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  save();
  return db;
}

async function clearAllPlayers() {
  const db = await getDb();
  db.run("DELETE FROM players");
  db.run("DELETE FROM predictions");
  save();
  console.log("[db] all player data cleared");
}

function save() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch(e) {
    console.error("[db] SAVE FAILED:", e.message);
  }
}

// Auto-save every 30 seconds as a safety net
setInterval(() => { save(); }, 30000);

module.exports = { getDb, save, clearAllPlayers };
