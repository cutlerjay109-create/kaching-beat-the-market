// PunditPlayer.js — plays the AI pundit voice and shows the text.

let audioQueue    = [];
let isPlaying     = false;
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const silence = new Audio("data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6ur///////////////////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA");
  silence.play().catch(() => {});
  if (!isPlaying && audioQueue.length > 0) playNext();
}

document.addEventListener("click",      unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });

function showPundit(reaction) {
  const el   = document.getElementById("pundit-player");
  const text = document.getElementById("pundit-text");
  if (!el) return;
  if (text) text.textContent = reaction.text || "";
  el.classList.add("visible");
  if (reaction.audioBase64) {
    audioQueue.push(reaction.audioBase64);
    if (!isPlaying) playNext();
  }
  setTimeout(() => el.classList.remove("visible"), 8000);
}

function playNext() {
  if (audioQueue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const base64 = audioQueue.shift();
  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob  = new Blob([bytes], { type: "audio/mpeg" });
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume  = 1.0;
    audio.onended = () => { URL.revokeObjectURL(url); playNext(); };
    audio.onerror = () => { URL.revokeObjectURL(url); playNext(); };
    audio.play().catch(e => {
      console.warn("[pundit] autoplay blocked:", e.message);
      audioQueue.unshift(base64);
      isPlaying = false;
    });
  } catch (e) {
    console.error("[pundit] playNext error:", e.message);
    playNext();
  }
}

function flushAudioQueue() {
  if (!isPlaying && audioQueue.length > 0) playNext();
}

module.exports = { showPundit, flushAudioQueue };
