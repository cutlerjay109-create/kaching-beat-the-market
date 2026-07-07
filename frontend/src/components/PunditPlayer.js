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

// Text queue matches audio queue — each text pairs with its audio
let textQueue = [];

function showPundit(reaction) {
  const el = document.getElementById("pundit-player");
  if (!el) return;
  if (reaction.audioBase64) {
    // Queue both text and audio together
    textQueue.push(reaction.text || "");
    audioQueue.push(reaction.audioBase64);
    if (!isPlaying) playNext();
  } else if (reaction.text) {
    // Text only — show for 5 seconds
    const textEl = document.getElementById("pundit-text");
    if (textEl) textEl.textContent = reaction.text;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 5000);
  }
}

function playNext() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    // Hide pundit panel when queue is empty
    const el = document.getElementById("pundit-player");
    if (el) el.classList.remove("visible");
    return;
  }
  isPlaying = true;
  const base64 = audioQueue.shift();
  const text   = textQueue.shift() || "";

  // Show text for this audio clip
  const el     = document.getElementById("pundit-player");
  const textEl = document.getElementById("pundit-text");
  if (textEl) textEl.textContent = text;
  if (el) el.classList.add("visible");

  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob  = new Blob([bytes], { type: "audio/mpeg" });
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume  = 1.0;

    // FAILSAFE: the text must NEVER stay on screen forever. If 'ended' never
    // fires (codec quirk, tab suspend), force-advance after the clip length
    // (or 20 s max if duration is unknown).
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      URL.revokeObjectURL(url);
      setTimeout(() => {
        if (audioQueue.length === 0 && el) el.classList.remove("visible");
        playNext();
      }, 400);
    };
    let failsafe = setTimeout(advance, 20000);
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        clearTimeout(failsafe);
        failsafe = setTimeout(advance, audio.duration * 1000 + 2500);
      }
    };
    audio.onended = () => { clearTimeout(failsafe); advance(); };
    audio.onerror = () => { clearTimeout(failsafe); advance(); };
    audio.play().catch(e => {
      console.warn("[pundit] autoplay blocked:", e.message);
      clearTimeout(failsafe);
      // Hide the panel — text must not sit on screen while nothing plays.
      // The clip is re-queued and will play after the user's first tap.
      if (el) el.classList.remove("visible");
      audioQueue.unshift(base64);
      textQueue.unshift(text);
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

if (typeof module !== "undefined") module.exports = { showPundit, flushAudioQueue };
