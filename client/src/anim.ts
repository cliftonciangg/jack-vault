/**
 * One clock for everything that moves: reels, tweens, count-ups and delays all
 * advance on the same requestAnimationFrame tick, so nothing drifts apart and a
 * background tab pauses everything together (unlike setTimeout).
 */

type Job = (dtMs: number) => boolean | void; // return true when finished

const jobs = new Set<Job>();
let last = 0;
let running = false;

function frame(now: number) {
  const dt = last ? Math.min(now - last, 100) : 16.7;
  last = now;
  for (const j of [...jobs]) if (j(dt)) jobs.delete(j);
  for (const f of afterFrame) f();
  requestAnimationFrame(frame);
}

const afterFrame: (() => void)[] = [];
/** Called once per frame after every job ran (the Pixi render goes here, so it draws this frame's state). */
export function onFrameEnd(f: () => void) {
  afterFrame.push(f);
}

export function startClock() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

/** Runs fn every frame until it returns true. Returns a cancel function. */
export function every(fn: Job): () => void {
  jobs.add(fn);
  return () => jobs.delete(fn);
}

/** Global speed: turbo halves durations (Tokens: turbo/factor 0.5). */
export const speed = { factor: 1 };

export class Cancelled extends Error {}

/** A group of waits/tweens that can be skipped (jump to the end) together. */
export class Skippable {
  skipped = false;
  private listeners = new Set<() => void>();
  skip() {
    if (this.skipped) return;
    this.skipped = true;
    this.listeners.forEach((f) => f());
  }
  onSkip(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
}

export function wait(ms: number, skip?: Skippable, scaled = true): Promise<void> {
  return new Promise((resolve) => {
    if (skip?.skipped) return resolve();
    let t = 0;
    const total = scaled ? ms * speed.factor : ms;
    const off = skip?.onSkip(() => {
      cancel();
      resolve();
    });
    const cancel = every((dt) => {
      t += dt;
      if (t >= total) {
        off?.();
        resolve();
        return true;
      }
    });
  });
}

export type Ease = (k: number) => number;
export const ease = {
  linear: (k: number) => k,
  outCubic: (k: number) => 1 - Math.pow(1 - k, 3),
  inCubic: (k: number) => k * k * k,
  inOutSine: (k: number) => -(Math.cos(Math.PI * k) - 1) / 2,
  outSine: (k: number) => Math.sin((k * Math.PI) / 2),
  inOutCubic: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (s = 1.6) => (k: number) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
};

/** Animates k from 0 to 1 over ms. Skipping jumps straight to k = 1. */
export function tween(ms: number, update: (v: number, k: number) => void, e: Ease = ease.outCubic, skip?: Skippable, scaled = true): Promise<void> {
  return new Promise((resolve) => {
    const total = Math.max(1, scaled ? ms * speed.factor : ms);
    if (skip?.skipped) {
      update(e(1), 1);
      return resolve();
    }
    let t = 0;
    const finish = () => {
      update(e(1), 1);
      resolve();
    };
    const off = skip?.onSkip(() => {
      cancel();
      finish();
    });
    const cancel = every((dt) => {
      t += dt;
      const k = Math.min(1, t / total);
      if (k >= 1) {
        off?.();
        finish();
        return true;
      }
      update(e(k), k);
    });
  });
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
