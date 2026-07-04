// ConnectWallet.js — links Phantom wallet to current session.

function connectWallet(onConnect) {
  const btn  = document.getElementById("wallet-btn");
  const info = document.getElementById("wallet-info");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // Get sessionId safely
    const sessionId = (typeof state !== "undefined" && state.sessionId)
      ? state.sessionId
      : localStorage.getItem("sessionId");

    if (!sessionId) {
      alert("Please enter a username and start playing first.");
      return;
    }

    btn.textContent = "Connecting...";
    btn.disabled    = true;

    try {
      const result = await connectAndLinkWallet(sessionId, (pubkey, data) => {
        btn.style.display = "none";
        if (info) {
          info.textContent = "✓ " + pubkey.slice(0,4) + "..." + pubkey.slice(-4) + " — score saved permanently";
          info.className   = "wallet-connected";
        }
        if (onConnect) onConnect(pubkey);

        // If server found existing wallet account, sync the score
        if (data.recovered && data.player) {
          if (typeof state !== "undefined") {
            state.score  = data.player.score  || state.score;
            state.streak = data.player.streak || state.streak;
            UI.updateStreakDisplay(state.score, state.streak, state.rank);
          }
        }
      });

      if (!result) {
        btn.textContent = "⬡ Connect Wallet to save streak on-chain";
        btn.disabled    = false;
      }
    } catch(e) {
      console.error("[wallet] connect error:", e.message);
      btn.textContent = "⬡ Connect Wallet to save streak on-chain";
      btn.disabled    = false;
    }
  });
}
