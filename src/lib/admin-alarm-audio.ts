/**
 * Full-volume Admin Order Alarm audio engine.
 *
 * Uses TWO simultaneous playback channels on every ring:
 * 1. HTML5 `<audio>` playing `/notification.mp3` at `volume = 1.0` — on iOS Safari
 *    and mobile browsers, media `<audio>` playback uses the media channel and still
 *    plays aloud even when the hardware silent/vibrate switch is on (as long as
 *    media volume is up and the browser has been tapped once).
 * 2. Web Audio API dual-tone alarm routed through a DynamicsCompressorNode at
 *    maximum gain (`1.0`) for unmistakable loudness even in noisy shops.
 */

export const INSTANT_ORDER_EVENT = "campu:new-order-instant";

let sharedCtx: AudioContext | null = null;
let sharedAudioEl: HTMLAudioElement | null = null;
let audioUnlocked = false;
let unlockListenersAttached = false;
const readyListeners = new Set<() => void>();

function notifyReady() {
  readyListeners.forEach((fn) => fn());
}

export function isAdminAlarmAudioReady(): boolean {
  return audioUnlocked;
}

export function subscribeAdminAlarmAudioReady(cb: () => void): () => void {
  readyListeners.add(cb);
  return () => {
    readyListeners.delete(cb);
  };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedCtx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      sharedCtx = new Ctx();
    }
    if (sharedCtx.state === "suspended") {
      void sharedCtx.resume().catch(() => undefined);
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

function getNotificationAudioEl(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudioEl) {
    const audio = new Audio("/notification.mp3");
    audio.preload = "auto";
    audio.volume = 1.0;
    sharedAudioEl = audio;
  }
  return sharedAudioEl;
}

/**
 * Unlocks both the HTML5 `<audio>` element (media channel) and `AudioContext`
 * on the very first user gesture anywhere in the app.
 */
export function unlockAdminAlarmAudioNow(): void {
  if (typeof window === "undefined") return;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    const el = getNotificationAudioEl();
    if (el && !audioUnlocked) {
      el.muted = true;
      el.volume = 1.0;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === "function") {
        void playPromise
          .then(() => {
            el.pause();
            el.currentTime = 0;
            el.muted = false;
            audioUnlocked = true;
            notifyReady();
          })
          .catch(() => {
            el.muted = false;
          });
      }
    }
    if (ctx && ctx.state === "running" && !audioUnlocked) {
      audioUnlocked = true;
      notifyReady();
    }
  } catch {
    /* ignore audio init errors */
  }
}

/** Attaches global gesture listeners once so audio unlocks on ANY page tap/click/key. */
export function initAdminAlarmUnlock(): void {
  if (typeof window === "undefined" || unlockListenersAttached) return;
  unlockListenersAttached = true;

  const handler = () => {
    unlockAdminAlarmAudioNow();
    if (audioUnlocked) {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("touchstart", handler);
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    }
  };

  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("touchstart", handler, { passive: true });
  window.addEventListener("click", handler, { passive: true });
  window.addEventListener("keydown", handler, { passive: true });
}

/**
 * Plays `/notification.mp3` at 100% media volume PLUS a full-volume Web Audio
 * dual-tone siren + strong vibration burst.
 */
export function playFullVolumeOrderAlarm(): void {
  if (typeof window === "undefined") return;

  // 1. HTML5 <audio> on the media channel at 100% volume (plays even when phone ringer is silent)
  try {
    const el = getNotificationAudioEl();
    if (el) {
      el.muted = false;
      el.volume = 1.0;
      el.currentTime = 0;
      void el
        .play()
        .then(() => {
          if (!audioUnlocked) {
            audioUnlocked = true;
            notifyReady();
          }
        })
        .catch(() => {
          /* Autoplay blocked until first tap */
        });
    }
  } catch {
    /* ignore */
  }

  // 2. Full-volume Web Audio dual-tone alarm through DynamicsCompressor for maximum clarity
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.15, ctx.currentTime);

      const master = ctx.createGain();
      master.gain.setValueAtTime(1.0, ctx.currentTime);
      compressor.connect(master).connect(ctx.destination);

      const notes = [960, 1440, 960, 1440];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const harmonic = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.24;

        osc.type = "square";
        osc.frequency.value = freq;
        harmonic.type = "sawtooth";
        harmonic.frequency.value = freq * 1.5;

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.95, t + 0.015);
        gain.gain.setValueAtTime(0.95, t + 0.17);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.connect(gain);
        harmonic.connect(gain);
        gain.connect(compressor);

        osc.start(t);
        harmonic.start(t);
        osc.stop(t + 0.23);
        harmonic.stop(t + 0.23);
      });

      if (ctx.state === "running" && !audioUnlocked) {
        audioUnlocked = true;
        notifyReady();
      }
    }
  } catch {
    /* audio unavailable */
  }

  // 3. Strong vibration alert on mobile devices
  try {
    navigator.vibrate?.([400, 120, 400, 120, 400]);
  } catch {
    /* vibration unavailable */
  }
}
