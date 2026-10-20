import { Rng, SeededRng } from "../src/rng/rng.js";
import { MathProfile, Symbol } from "../src/math/types.js";

/** Returns queued values first (each must fit the requested range), then falls back to a seeded RNG. */
export class ScriptedRng implements Rng {
  private fallback = new SeededRng(99);
  constructor(public queue: number[] = []) {}
  int(max: number): number {
    if (this.queue.length) {
      const v = this.queue.shift()!;
      if (v < 0 || v >= max) throw new Error(`Scripted value ${v} out of range ${max}`);
      return v;
    }
    return this.fallback.int(max);
  }
}

/** Stop that puts `sym` on the top row of the reel, or a stop showing none of `avoid` if sym is null. */
export function stopFor(strip: Symbol[], sym: Symbol | null, avoid: Symbol[] = ["SCATTER", "BONUS"]): number {
  for (let i = 0; i < strip.length; i++) {
    const win = [0, 1, 2, 3].map((r) => strip[(i + r) % strip.length]);
    if (sym ? strip[i] === sym : !win.some((s) => avoid.includes(s))) return i;
  }
  throw new Error(`No stop for ${sym}`);
}

/** Stops for a base spin that triggers the wheel (3 BONUS) and no free spins. */
export function wheelStops(p: MathProfile): number[] {
  return p.reels.base.map((s, i) => ([0, 2, 4].includes(i) ? stopFor(s, "BONUS", []) : stopFor(s, null)));
}

/** Stops for a base spin with SCATTER on reels 1-3 (free spins) and no BONUS trigger. */
export function freeSpinStops(p: MathProfile): number[] {
  return p.reels.base.map((s, i) => (i < 3 ? stopFor(s, "SCATTER", []) : stopFor(s, null)));
}

/** Draw value that lands the wheel on `segment` given its weights. */
export function wheelDrawFor(weights: number[], segment: number): number {
  return weights.slice(0, segment).reduce((a, b) => a + b, 0);
}
