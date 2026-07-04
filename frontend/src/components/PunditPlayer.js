// PunditPlayer.js — plays the AI pundit voice and shows the text.

let audioQueue = [];
let isPlaying  = false;

function showPundit(reaction) {
  const el   = document.getElementById("pundit-player");
  const text = document.getElementById("pundit-text");
  if (!el) return;

  if (text) text.textContent = reaction.text || "";
  el.classList.add("visible");

  // Play audio if present
  if (reaction.audioBase64) {
    audioQueue.push(reaction.audioBase64);
    if (!isPlaying) playNext();
  }

  // Hide text after 6 seconds
  setTimeout(() => el.classList.remove("visible"), 6000);
}

function playNext() {
  if (audioQueue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const base64 = audioQueue.shift();
  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); playNext(); };
    audio.onerror = () => { URL.revokeObjectURL(url); playNext(); };
    audio.play().catch(() => playNext());
  } catch (e) {
    playNext();
  }
}

module.exports = { showPundit };
