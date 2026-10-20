import { settings } from "./dom";

/**
 * Small synthesized sound set (no audio files yet): spin whoosh, reel thunk,
 * scatter chime, win ticks, fanfares. Swap in recorded sounds later by
 * replacing these functions; the game only calls sfx.<name>().
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  applyVolume();
}

export function applyVolume() {
  if (master) master.gain.value = settings.sound ? (settings.volume / 100) * 0.6 : 0;
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.3, when = 0, slideTo?: number) {
  if (!ctx || !master || !settings.sound) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.2, freq = 1200, when = 0, q = 1) {
  if (!ctx || !master || !settings.sound) return;
  const t = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  click: () => tone(900, 0.05, "square", 0.06),
  spin: () => noise(0.35, 0.18, 900, 0, 0.7),
  reelStop: (i: number) => {
    tone(120 - i * 6, 0.09, "triangle", 0.35);
    noise(0.05, 0.12, 2400);
  },
  scatter: (n: number) => [0, 0.08, 0.16].forEach((w, k) => tone(660 * Math.pow(1.26, n + k * 0.5), 0.35, "sine", 0.18, w)),
  bonus: () => [0, 0.1].forEach((w, k) => tone(520 + k * 260, 0.4, "triangle", 0.2, w)),
  anticipation: () => tone(220, 1.1, "sawtooth", 0.06, 0, 660),
  win: (big = false) => [0, 0.09, 0.18, big ? 0.27 : -1].forEach((w, k) => w >= 0 && tone([523, 659, 784, 1047][k], 0.28, "triangle", 0.18, w)),
  tick: () => tone(1500 + Math.random() * 300, 0.03, "square", 0.03),
  coin: () => tone(1800 + Math.random() * 900, 0.08, "sine", 0.08),
  fanfare: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, 0.32, "sawtooth", 0.09, k * 0.12)),
  wheelTick: () => tone(2200, 0.025, "square", 0.05),
  whoosh: () => noise(0.6, 0.2, 500, 0, 0.5),
  boom: () => {
    tone(70, 0.5, "sine", 0.4, 0, 40);
    noise(0.4, 0.25, 300);
  },
};
