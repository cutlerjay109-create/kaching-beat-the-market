// frontend/src/main.js — boots the app and wires all components together.

// ── STATE
const state = {
  sessionId:  null,
  nickname:   null,
  score:      0,
  streak:     0,
  rank:       null,
  matchState: null,
};

function getOrCreateSessionId() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    id = "player_" + Math.random().toString(36).slice(2, 11);
    localStorage.setItem("sessionId", id);
  }
  return id;
}

async function startSession(nickname) {
  state.sessionId = getOrCreateSessionId();
  state.nickname  = nickname;
  const data = await API.startSession(state.sessionId, nickname);
  if (data.player) {
    state.score  = data.player.score  || 0;
    state.streak = data.player.streak || 0;
    state.rank   = data.rank          || null;
  }
  UI.updateStreakDisplay(state.score, state.streak, state.rank);
}

function onMatchState(matchState) {
  state.matchState = matchState;
  const reconnEl = document.getElementById("reconnecting");
  if (reconnEl) reconnEl.classList.remove("visible");

  // If this is a countdown push and we already have real team names, keep them
  if (matchState.countdown != null && !matchState.inRunning && state.liveHomeTeam) {
    matchState = {
      ...matchState,
      homeTeam: state.liveHomeTeam,
      awayTeam: state.liveAwayTeam,
    };
  }

  // Track real team names from live data
  if (matchState.inRunning && matchState.homeTeam && matchState.homeTeam !== "Home") {
    state.liveHomeTeam = matchState.homeTeam;
    state.liveAwayTeam = matchState.awayTeam;
  }

  // Reset live teams when match ends
  if (matchState.period === "FT") {
    state.liveHomeTeam = null;
    state.liveAwayTeam = null;
  }

  UI.updateMatchView(matchState);
  UI.updateProbabilityBar(
    matchState.homeProb,
    matchState.awayProb,
    matchState.homeTeam,
    matchState.awayTeam
  );
}

function onQuestion(question) {
  UI.showPredictionCard(question, (answer) => {
    if (UI.flushAudioQueue) UI.flushAudioQueue();
    // Use demo event if in demo mode
    if (state.demoMode) {
      socket.emit("submit_prediction_demo", { answer, sessionId: state.sessionId });
    } else {
      socket.emit("submit_prediction", { sessionId: state.sessionId, answer });
    }
  });
}

function onPredictionResult(result) {
  // Results are broadcast with a sessionId so they survive socket reconnects —
  // show only the card that belongs to THIS player.
  if (result.sessionId && result.sessionId !== state.sessionId) return;
  state.score  = result.newScore  != null ? result.newScore  : state.score;
  state.streak = result.newStreak != null ? result.newStreak : state.streak;
  UI.updateStreakDisplay(state.score, state.streak, state.rank);
  UI.showResult(result);
}

function onPundit(reaction) {
  UI.showPundit(reaction);
}

function onLeaderboard(players) {
  UI.updateLeaderboard(players);
  const myPos = players.findIndex(p => p.id === state.sessionId);
  if (myPos >= 0) {
    state.rank = myPos + 1;
    UI.updateStreakDisplay(state.score, state.streak, state.rank);
  }
}

function onReconnecting() {
  const el = document.getElementById("reconnecting");
  if (el) el.classList.add("visible");
  UI.showPundit({ text: "Bear with us, reconnecting to the live feed...", audioBase64: null });
}

function onDisconnect() {
  const el = document.getElementById("reconnecting");
  if (el) el.classList.add("visible");
}

function showNicknameError(msg) {
  let errEl = document.getElementById("nickname-error");
  if (!errEl) {
    errEl = document.createElement("div");
    errEl.id = "nickname-error";
    errEl.style.cssText = "color:#ff4757;font-size:0.8rem;margin-top:0.5rem;text-align:center;";
    const btn = document.getElementById("start-btn");
    if (btn) btn.parentNode.insertBefore(errEl, btn.nextSibling);
  }
  errEl.textContent = msg;
  setTimeout(() => { if (errEl) errEl.textContent = ""; }, 4000);
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  if (el) {
    el.textContent = msg;
    setTimeout(() => { if (el) el.textContent = ""; }, 4000);
  }
}

let socket;
function initShareButton() {
  UI.initShareButton(() => ({
    score:    state.score,
    streak:   state.streak,
    nickname: state.nickname,
  }));
}

function initWallet() {
  UI.connectWallet(async (pubkey) => {
    console.log("[wallet] connected:", pubkey);
    await WALLET.saveStreakOnChain(pubkey, state.sessionId, state.streak, state.score);
  });
}

function onDemoComplete(data) {
  state.demoMode = false;
  const btn   = document.getElementById("demo-btn");
  const label = document.getElementById("demo-label");
  if (btn) { btn.textContent = "⏺ Watch Demo Match"; btn.disabled = false; btn.style.color = ""; btn.style.borderColor = ""; }
  if (label) label.style.display = "none";
  console.log("[demo] complete:", data.home, data.away, data.score);
}

function initSocketConnection() {
  socket = SOCKET.initSocket({
    onMatchState:       onMatchState,
    onQuestion:         onQuestion,
    onPredictionResult: onPredictionResult,
    onPundit:           onPundit,
    onLeaderboard:      onLeaderboard,
    onReconnecting:     onReconnecting,
    onDisconnect:       onDisconnect,
    onDemoComplete:     onDemoComplete,
    onQuestionExpired:  () => UI.hidePredictionCard(),
  });
}

async function enterGame(data) {
  state.sessionId = data.sessionId;
  state.nickname  = data.player.nickname;
  state.score     = data.player.score      || 0;
  state.streak    = data.player.streak     || 0;
  state.rank      = data.rank              || null;
  localStorage.setItem("sessionId", data.sessionId);
  localStorage.setItem("nickname",  data.player.nickname);
  const authScreen = document.getElementById("auth-screen");
  if (authScreen) authScreen.style.display = "none";
  UI.updateStreakDisplay(state.score, state.streak, state.rank);
  initSocketConnection();
  showHowItWorks();
}

function initAuthScreen() {
  const authScreen = document.getElementById("auth-screen");
  if (!authScreen) return;

  // Auto-login if a valid session exists
  const savedSession  = localStorage.getItem("sessionId");
  const savedNickname = localStorage.getItem("nickname");
  if (savedSession && savedNickname) {
    API.resumeSession(savedSession).then(data => {
      if (data && data.player) {
        enterGame({ sessionId: savedSession, player: data.player, rank: data.rank });
      }
    });
  }

  const tabLogin   = document.getElementById("tab-login");
  const tabSignup  = document.getElementById("tab-signup");
  const loginForm  = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");

  // Tab switching
  if (tabLogin) tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
    loginForm.style.display  = "flex";
    signupForm.style.display = "none";
    showAuthError("");
  });
  if (tabSignup) tabSignup.addEventListener("click", () => {
    tabSignup.classList.add("active");
    tabLogin.classList.remove("active");
    signupForm.style.display = "flex";
    loginForm.style.display  = "none";
    showAuthError("");
  });

  // LOGIN
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) loginBtn.addEventListener("click", async () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    if (!username || !password) { showAuthError("Enter username and password."); return; }
    loginBtn.textContent = "Logging in..."; loginBtn.disabled = true;
    try {
      const data = await API.loginUser(username, password);
      if (!data._ok) { showAuthError(data.error || "Login failed."); return; }
      await enterGame(data);
    } catch(e) { showAuthError("Something went wrong."); }
    finally { loginBtn.textContent = "Log In"; loginBtn.disabled = false; }
  });

  // SIGNUP
  const signupBtn = document.getElementById("signup-btn");
  if (signupBtn) signupBtn.addEventListener("click", async () => {
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value;
    if (!username || !password) { showAuthError("Choose a username and password."); return; }
    if (username.length < 2)   { showAuthError("Username must be at least 2 characters."); return; }
    if (password.length < 4)   { showAuthError("Password must be at least 4 characters."); return; }
    signupBtn.textContent = "Creating..."; signupBtn.disabled = true;
    try {
      const data = await API.signupUser(username, password);
      if (!data._ok) { showAuthError(data.error || "Signup failed."); return; }
      await enterGame(data);
    } catch(e) { showAuthError("Something went wrong."); }
    finally { signupBtn.textContent = "Create Account"; signupBtn.disabled = false; }
  });

  // Enter key submits
  ["login-password","signup-password"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        (id === "login-password" ? loginBtn : signupBtn).click();
      }
    });
  });
}

function triggerDemo() {
  const btn   = document.getElementById("demo-btn");
  const label = document.getElementById("demo-label");
  if (!socket) return;
  if (btn) {
    btn.textContent       = "Loading demo...";
    btn.disabled          = true;
    btn.style.color       = "#f5a623";
    btn.style.borderColor = "#f5a623";
  }
  state.demoMode = true;
  socket.emit("start_demo");
  setTimeout(() => {
    if (label) label.style.display = "block";
    if (btn)   btn.textContent     = "⏺ Demo Playing";
  }, 1000);
}

document.addEventListener("DOMContentLoaded", () => {

  initAuthScreen();
  initShareButton();
  initWallet();
});
