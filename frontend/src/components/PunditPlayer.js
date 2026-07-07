// PunditPlayer.js — plays the AI commentator voice with its text as ONE unit.
//
// PROFESSIONAL RULES (all enforced here):
//   • Text and voice are inseparable: the text appears the instant ITS clip
//     starts and stays on screen until ITS clip finishes — never earlier,
//     never later, never swapped mid-speech.
//   • Strictly one voice at a time. The current clip is always stopped
//     before anything else may start — overlap is impossible.
//   • Text-only reactions (voice unavailable) join the SAME queue and hold
//     the screen for a natural reading time, so they can never stomp the
//     text of a clip that is currently speaking.
//   • A short breath (700 ms) separates consecutive lines, like a real
//     broadcast rhythm.
//   • The queue is capped: if the commentator falls behind, the oldest
//     unplayed lines are dropped so the audio never lags the match.

let queue         = [];      // [{ text, audioBase64 }]
let isPlaying     = false;
let currentAudio  = null;    // the ONLY audio element allowed to exist
let audioUnlocked = false;
const MAX_QUEUE   = 3;
const GAP_MS      = 700;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const silence = new Audio("data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6ur///////////////////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA");
  silence.play().catch(() => {});
  if (!isPlaying && queue.length > 0) playNext();
}

// Unlock on the very FIRST interaction of any kind — the sooner audio is
// unlocked, the sooner text and voice run together from kickoff.
document.addEventListener("click",       unlockAudio, { once: true });
document.addEventListener("touchstart",  unlockAudio, { once: true });
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown",     unlockAudio, { once: true });
document.addEventListener("scroll",      unlockAudio, { once: true, passive: true });

function showPundit(reaction) {
  if (!reaction || (!reaction.text && !reaction.audioBase64)) return;
  // Text + voice enter the queue TOGETHER as one unit
  queue.push({ text: reaction.text || "", audioBase64: reaction.audioBase64 || null });
  // Never let the commentator fall behind the match — drop the oldest
  // unplayed lines (the currently-speaking clip is never touched).
  while (queue.length > MAX_QUEUE) queue.shift();
  if (!isPlaying) playNext();
}

function setPanel(text, visible) {
  const el     = document.getElementById("pundit-player");
  const textEl = document.getElementById("pundit-text");
  if (textEl && text != null) textEl.textContent = text;
  if (el) el.classList.toggle("visible", !!visible);
}

// Stop whatever is currently speaking — the single point of truth.
function stopCurrent() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch (e) {}
    if (currentAudio._url) { try { URL.revokeObjectURL(currentAudio._url); } catch (e) {} }
    currentAudio = null;
  }
}

function playNext() {
  if (queue.length === 0) {
    isPlaying = false;
    setPanel(null, false);           // hide only when there is nothing left
    return;
  }
  isPlaying = true;
  const item = queue.shift();

  // ── TEXT-ONLY LINE ── same queue, natural reading time (no voice to sync)
  if (!item.audioBase64) {
    setPanel(item.text, true);
    // Generous reading time — a text line must never feel like it flashed away
    const readMs = Math.min(12000, Math.max(5000, item.text.split(/\s+/).length * 450));
    setTimeout(() => {
      if (queue.length === 0) setPanel(null, false);
      setTimeout(playNext, GAP_MS);
    }, readMs);
    return;
  }

  // ── VOICED LINE ── text appears WITH the clip, leaves WITH the clip
  try {
    const binary = atob(item.audioBase64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url    = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));

    stopCurrent();                    // absolute guarantee: nothing else is speaking
    const audio  = new Audio(url);
    audio._url   = url;
    audio.volume = 1.0;
    currentAudio = audio;

    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      stopCurrent();                  // kills this clip if it is somehow still going
      if (queue.length === 0) setPanel(null, false);   // text leaves WITH the voice
      setTimeout(playNext, GAP_MS);   // a breath before the next line
    };

    // Failsafe only for a clip whose 'ended' never fires — generous 30 s so a
    // full line is never cut off; tightened to real duration once known.
    let failsafe = setTimeout(advance, 30000);
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        clearTimeout(failsafe);
        failsafe = setTimeout(advance, audio.duration * 1000 + 3000);
      }
    };
    audio.onended = () => { clearTimeout(failsafe); advance(); };
    audio.onerror = () => { clearTimeout(failsafe); advance(); };

    audio.play().then(() => {
      // Voice is actually speaking — NOW the text appears with it
      setPanel(item.text, true);
    }).catch(e => {
      console.warn("[pundit] autoplay blocked:", e.message);
      clearTimeout(failsafe);
      stopCurrent();
      setPanel(null, false);          // no silent text on screen
      queue.unshift(item);            // replays after the user's first tap
      isPlaying = false;
    });
  } catch (e) {
    console.error("[pundit] playNext error:", e.message);
    setTimeout(playNext, GAP_MS);
  }
}

function flushAudioQueue() {
  if (!isPlaying && queue.length > 0) playNext();
}

if (typeof module !== "undefined") module.exports = { showPundit, flushAudioQueue };
