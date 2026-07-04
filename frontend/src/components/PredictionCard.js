// PredictionCard.js — the one-tap prediction question card.

let timerInterval = null;

function showPredictionCard(question, onAnswer) {
  const card     = document.getElementById("prediction-card");
  const text     = document.getElementById("question-text");
  const btnYes   = document.getElementById("btn-yes");
  const btnNo    = document.getElementById("btn-no");
  const timerBar = document.getElementById("timer-bar");
  if (!card) return;

  if (text) text.textContent = question.text;

  // Reset buttons
  if (btnYes) { btnYes.disabled = false; btnYes.textContent = "YES"; }
  if (btnNo)  { btnNo.disabled  = false; btnNo.textContent  = "NO";  }

  card.classList.add("visible");

  // Timer bar countdown
  if (timerInterval) clearInterval(timerInterval);
  if (timerBar && question.expiresAt) {
    const total    = question.expiresAt - Date.now();
    const start    = Date.now();
    timerBar.style.width = "100%";
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct     = Math.max(0, 100 - (elapsed / total) * 100);
      timerBar.style.width = `${pct}%`;
      if (pct <= 0) {
        clearInterval(timerInterval);
        hidePredictionCard();
      }
    }, 200);
  }

  // Answer handlers
  function answer(val) {
    if (btnYes) btnYes.disabled = true;
    if (btnNo)  btnNo.disabled  = true;
    if (timerInterval) clearInterval(timerInterval);
    if (onAnswer) onAnswer(val);
    setTimeout(hidePredictionCard, 800);
  }

  if (btnYes) btnYes.onclick = () => answer("yes");
  if (btnNo)  btnNo.onclick  = () => answer("no");
}

function hidePredictionCard() {
  const card = document.getElementById("prediction-card");
  if (card) card.classList.remove("visible");
  if (timerInterval) clearInterval(timerInterval);
}

module.exports = { showPredictionCard, hidePredictionCard };
