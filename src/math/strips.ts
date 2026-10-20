import { BONUS, ROWS, SCATTER, Symbol } from "./types.js";

/** Symbols that must never appear twice in one 4-row window on a reel. */
export const SPACED_SYMBOLS: readonly Symbol[] = [SCATTER, BONUS];

/** Small deterministic PRNG, used only to lay out strips at design time. Never for outcomes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lays out one reel strip from symbol counts. SCATTER and BONUS are spread
 * evenly so no 4-row window holds two of the same; the rest is shuffled with a
 * fixed seed so the strip is stable between runs and symbols interleave.
 */
export function buildStrip(counts: Partial<Record<Symbol, number>>, seed: number): Symbol[] {
  const length = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const strip: (Symbol | null)[] = new Array(length).fill(null);

  SPACED_SYMBOLS.forEach((sym, k) => {
    const c = counts[sym] ?? 0;
    if (c === 0) return;
    if (length / c < ROWS) throw new Error(`Too many ${sym} (${c}) for strip length ${length}`);
    const offset = Math.floor((k * length) / (2 * c)) + k;
    for (let i = 0; i < c; i++) {
      let pos = (Math.floor((i * length) / c) + offset) % length;
      while (strip[pos] !== null) pos = (pos + 1) % length;
      strip[pos] = sym;
    }
  });

  const rest: Symbol[] = [];
  for (const [sym, c] of Object.entries(counts) as [Symbol, number][]) {
    if (SPACED_SYMBOLS.includes(sym)) continue;
    for (let i = 0; i < c; i++) rest.push(sym);
  }
  const rand = mulberry32(seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // Break up runs of 3+ identical symbols so the window doesn't look stacked.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 2; i < rest.length; i++) {
      if (rest[i] === rest[i - 1] && rest[i] === rest[i - 2]) {
        const j = (i + 3 + Math.floor(rand() * (rest.length - 3))) % rest.length;
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
    }
  }
  let k = 0;
  for (let i = 0; i < length; i++) if (strip[i] === null) strip[i] = rest[k++];
  return strip as Symbol[];
}

/** Throws if a spaced symbol can appear twice in one window (the exact math relies on this). */
export function assertSpacing(strip: readonly Symbol[], reelIndex: number): void {
  for (const sym of SPACED_SYMBOLS) {
    const pos = strip.flatMap((s, i) => (s === sym ? [i] : []));
    for (let i = 0; i < pos.length; i++) {
      const next = i + 1 < pos.length ? pos[i + 1] : pos[0] + strip.length;
      if (pos.length > 1 && next - pos[i] < ROWS) {
        throw new Error(`Reel ${reelIndex + 1}: ${sym} at ${pos[i]} and ${next % strip.length} share a window`);
      }
    }
  }
}

export function countSymbols(strip: readonly Symbol[]): Map<Symbol, number> {
  const m = new Map<Symbol, number>();
  for (const s of strip) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}
