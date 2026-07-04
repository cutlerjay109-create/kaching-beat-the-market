// Leaderboard.js — renders top players and share button.

function updateLeaderboard(players) {
  const list = document.getElementById("lb-list");
  if (!list) return;
  list.innerHTML = players.slice(0, 10).map((p, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${p.nickname}</span>
      <span class="lb-score">${p.score || 0}</span>
      <span class="lb-streak">🔥${p.streak}</span>
    </div>
  `).join("");
}

function initShareButton(getPlayerData) {
  const btn = document.getElementById("share-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const { score, streak, nickname } = getPlayerData();
    const text = `I scored ${score} pts with a ${streak}-streak on Kaching Beat the Market! Can you beat the market? #WorldCup2026`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard!"));
    }
  });
}

module.exports = { updateLeaderboard, initShareButton };
