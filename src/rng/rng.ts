import { randomBytes } from "node:crypto";

/** Source of uniform integers. All outcome randomness goes through this. */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). maxExclusive must be in 1..2^32. */
  int(maxExclusive: number): number;
}

const TWO_32 = 0x1_0000_0000;

/**
 * Cryptographically secure RNG backed by node:crypto. Draws 32-bit words from
 * a buffered randomBytes pool and maps them to a range by rejection sampling,
 * so there is no modulo bias.
 */
export class CryptoRng implements Rng {
  private buf: Buffer = Buffer.alloc(0);
  private off = 0;
  constructor(private readonly poolBytes = 64 * 1024) {}

  private next32(): number {
    if (this.off + 4 > this.buf.length) {
      this.buf = randomBytes(this.poolBytes);
      this.off = 0;
    }
    const v = this.buf.readUInt32LE(this.off);
    this.off += 4;
    return v;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_32) {
      throw new RangeError(`Bad range ${maxExclusive}`);
    }
    const limit = TWO_32 - (TWO_32 % maxExclusive);
    for (;;) {
      const v = this.next32();
      if (v < limit) return v % maxExclusive;
    }
  }
}

/**
 * Deterministic RNG (xoshiro128**) for tests and reproducible simulations.
 * Never use it to decide real rounds.
 */
export class SeededRng implements Rng {
  private s = new Uint32Array(4);
  constructor(seed: number) {
    // splitmix32 to expand the seed
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }
  private next32(): number {
    const s = this.s;
    const result = Math.imul(((Math.imul(s[1], 5) << 7) | (Math.imul(s[1], 5) >>> 25)) >>> 0, 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0;
    return result;
  }
  int(maxExclusive: number): number {
    const limit = TWO_32 - (TWO_32 % maxExclusive);
    for (;;) {
      const v = this.next32();
      if (v < limit) return v % maxExclusive;
    }
  }
}

/** Wraps an RNG and records every draw, so a round stores the exact values that decided it. */
export class RecordingRng implements Rng {
  readonly draws: { max: number; value: number }[] = [];
  constructor(private readonly inner: Rng) {}
  int(maxExclusive: number): number {
    const value = this.inner.int(maxExclusive);
    this.draws.push({ max: maxExclusive, value });
    return value;
  }
}

/** Replays recorded draws in order; throws if the engine asks for anything different. */
export class ReplayRng implements Rng {
  private i = 0;
  constructor(private readonly draws: readonly { max: number; value: number }[]) {}
  int(maxExclusive: number): number {
    const d = this.draws[this.i++];
    if (!d || d.max !== maxExclusive) throw new Error(`Replay mismatch at draw ${this.i - 1}`);
    return d.value;
  }
}

/** Picks an index with probability proportional to its integer weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.int(total);
  for (let i = 0; i < weights.length; i++) {
    if (x < weights[i]) return i;
    x -= weights[i];
  }
  throw new Error("unreachable");
}
