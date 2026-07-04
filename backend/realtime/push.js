// backend/realtime/push.js — pushes live updates to all connected players via Socket.io.

let io;

function init(socketIo) {
  io = socketIo;
  console.log("[push] Socket.io initialised.");
}

// Push a match state update (probability bar, score)
function pushMatchState(state) {
  if (!io) return;
  io.emit("match_state", state);
}

// Push a new prediction question to all players
function pushQuestion(question) {
  if (!io) return;
  io.emit("new_question", {
    id:       question.id,
    text:     question.text,
    type:     question.type,
    expiresAt: question.expiresAt,
  });
}

// Push a question result to all players
function pushResult(result) {
  if (!io) return;
  io.emit("question_result", result);
}

// Push a pundit reaction (text + audio) to all players
function pushPundit(reaction) {
  if (!io) return;
  io.emit("pundit_reaction", reaction);
}

// Push leaderboard update
function pushLeaderboard(players) {
  if (!io) return;
  io.emit("leaderboard_update", players);
}

// Push reconnecting state (feed hiccup)
function pushReconnecting(feed) {
  if (!io) return;
  io.emit("reconnecting", { feed });
}

module.exports = {
  init,
  pushMatchState,
  pushQuestion,
  pushResult,
  pushPundit,
  pushLeaderboard,
  pushReconnecting,
};
