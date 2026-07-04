// frontend/src/services/api.js — REST calls to the backend.

async function startSession(sessionId, nickname) {
  const res  = await fetch("/api/session/start", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sessionId, nickname }),
  });
  const data = await res.json();
  // Surface nickname-taken error so the UI can handle it
  if (res.status === 409) {
    data._error  = true;
    data._status = 409;
  }
  return data;
}

async function getLeaderboard() {
  const res = await fetch("/api/leaderboard");
  return res.json();
}

async function getPlayerRank(sessionId) {
  const res = await fetch(`/api/leaderboard/${sessionId}`);
  return res.json();
}


async function signupUser(username, password) {
  try {
    const res  = await fetch("/api/auth/signup", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
    });
    const text = await res.text();
    console.log("[signup] status:", res.status, "body:", text.slice(0, 200));
    let data = {};
    try { data = JSON.parse(text); } catch(e) { data = { error: text }; }
    data._status = res.status;
    data._ok     = res.ok;
    return data;
  } catch(e) {
    console.error("[signup] fetch error:", e.message);
    throw e;
  }
}

async function loginUser(username, password) {
  try {
    const res  = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
    });
    const text = await res.text();
    console.log("[login] status:", res.status, "body:", text.slice(0, 200));
    let data = {};
    try { data = JSON.parse(text); } catch(e) { data = { error: text }; }
    data._status = res.status;
    data._ok     = res.ok;
    return data;
  } catch(e) {
    console.error("[login] fetch error:", e.message);
    throw e;
  }
}
