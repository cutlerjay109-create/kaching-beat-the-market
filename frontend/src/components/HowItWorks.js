// HowItWorks.js — first-load hint overlay. Shows once then disappears.

function HowItWorks(onDismiss) {
  const el = document.getElementById("how-it-works");
  if (!el) return;

  const btn = el.querySelector(".dismiss-btn");
  if (btn) btn.addEventListener("click", () => {
    el.style.display = "none";
    localStorage.setItem("howItWorksSeen", "1");
    if (onDismiss) onDismiss();
  });

  // Auto-dismiss after 8 seconds if user does not tap
  setTimeout(() => {
    if (el.style.display !== "none") {
      el.style.display = "none";
      if (onDismiss) onDismiss();
    }
  }, 8000);
}

module.exports = { HowItWorks };
