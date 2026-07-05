// frontend/src/services/socket.js — connects to the backend via Socket.io.

function initSocket(handlers) {
  const socket = io();

  socket.on("connect", () => {
    console.log("[socket] connected:", socket.id);
    if (handlers.onConnect) handlers.onConnect(socket.id);
  });

  socket.on("disconnect", () => {
    console.log("[socket] disconnected");
    if (handlers.onDisconnect) handlers.onDisconnect();
  });

  socket.on("match_state", (state) => {
    if (handlers.onMatchState) handlers.onMatchState(state);
  });

  socket.on("new_question", (question) => {
    if (handlers.onQuestion) handlers.onQuestion(question);
  });

  socket.on("question_result", (result) => {
    if (handlers.onResult) handlers.onResult(result);
  });

  socket.on("pundit_reaction", (reaction) => {
    if (handlers.onPundit) handlers.onPundit(reaction);
  });

  socket.on("leaderboard_update", (players) => {
    if (handlers.onLeaderboard) handlers.onLeaderboard(players);
  });

  socket.on("reconnecting", (data) => {
    if (handlers.onReconnecting) handlers.onReconnecting(data);
  });

  socket.on("prediction_result", (result) => {
    if (handlers.onPredictionResult) handlers.onPredictionResult(result);
  });

  socket.on("prediction_accepted", (data) => {
    if (handlers.onPredictionAccepted) handlers.onPredictionAccepted(data);
  });
  socket.on("demo_complete", (data) => {
    if (handlers.onDemoComplete) handlers.onDemoComplete(data);
  });
  socket.on("question_expired", () => {
    if (handlers.onQuestionExpired) handlers.onQuestionExpired();
  });
  return socket;
}
