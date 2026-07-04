// backend/players/auth.js — signup and login with password hashing.

const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { getDb, save } = require("./db");

// Sign up a new user. Throws if username taken.
async function signup(username, password) {
  const db = await getDb();
  username = (username || "").trim();

  if (!username || username.length < 2) {
    const e = new Error("Username must be at least 2 characters"); e.code = "BAD_INPUT"; throw e;
  }
  if (!password || password.length < 4) {
    const e = new Error("Password must be at least 4 characters"); e.code = "BAD_INPUT"; throw e;
  }

  // Check if username exists
  const existing = db.exec(
    `SELECT id FROM players WHERE nickname = ? COLLATE NOCASE LIMIT 1`,
    [username]
  );
  if (existing.length && existing[0].values.length) {
    const e = new Error("Username already taken"); e.code = "USERNAME_TAKEN"; throw e;
  }

  const id           = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO players (id, nickname, password_hash) VALUES (?, ?, ?)`,
    [id, username, passwordHash]
  );
  save();

  return { id, nickname: username, score: 0, streak: 0, best_streak: 0, wallet: null };
}

// Log in an existing user. Throws if wrong username or password.
async function login(username, password) {
  const db = await getDb();
  username = (username || "").trim();

  const res = db.exec(
    `SELECT * FROM players WHERE nickname = ? COLLATE NOCASE LIMIT 1`,
    [username]
  );
  if (!res.length || !res[0].values.length) {
    const e = new Error("No account with that username"); e.code = "NO_USER"; throw e;
  }

  const cols   = res[0].columns;
  const player = Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i]]));

  if (!player.password_hash) {
    const e = new Error("This account has no password set"); e.code = "NO_PASSWORD"; throw e;
  }

  const ok = bcrypt.compareSync(password, player.password_hash);
  if (!ok) {
    const e = new Error("Wrong password"); e.code = "WRONG_PASSWORD"; throw e;
  }

  // Never return the hash to the client
  delete player.password_hash;
  return player;
}

module.exports = { signup, login };
