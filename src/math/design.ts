import { buildStrip } from "./strips.js";
import { PAYLINES_25 } from "./paylines.js";
import { MathProfile, Symbol } from "./types.js";

/**
 * Design inputs for the Jack Vault math. `npm run tune` turns these into
 * concrete reel strips and writes one profile per RTP target to profiles/.
 * The JSON profiles, not this file, are what the server loads.
 */

type Counts = Partial<Record<Symbol, number>>;

const BASE_COUNTS: Counts[] = [
  { CROWN: 3, GEM: 4, PLANET: 5, COMET: 6, A: 7, K: 7, Q: 8, J: 8, TEN: 8, SCATTER: 1, BONUS: 3 },
  { CROWN: 3, GEM: 4, PLANET: 5, COMET: 6, A: 7, K: 7, Q: 8, J: 8, TEN: 8, WILD: 5, SCATTER: 2 },
  { CROWN: 3, GEM: 4, PLANET: 5, COMET: 6, A: 7, K: 7, Q: 8, J: 8, TEN: 8, WILD: 5, SCATTER: 1, BONUS: 3 },
  { CROWN: 3, GEM: 4, PLANET: 5, COMET: 6, A: 7, K: 7, Q: 8, J: 8, TEN: 8, WILD: 5, SCATTER: 2 },
  { CROWN: 3, GEM: 4, PLANET: 5, COMET: 6, A: 7, K: 7, Q: 8, J: 8, TEN: 8, WILD: 5, SCATTER: 1, BONUS: 2 },
];

/** Free-spin strips: more WILD, more high-pay symbols, no BONUS. */
const FREE_COUNTS: Counts[] = [
  { CROWN: 4, GEM: 5, PLANET: 6, COMET: 6, A: 6, K: 6, Q: 7, J: 7, TEN: 7, SCATTER: 1 },
  { CROWN: 4, GEM: 5, PLANET: 6, COMET: 6, A: 6, K: 6, Q: 7, J: 7, TEN: 7, WILD: 5, SCATTER: 1 },
  { CROWN: 4, GEM: 5, PLANET: 6, COMET: 6, A: 6, K: 6, Q: 7, J: 7, TEN: 7, WILD: 5, SCATTER: 1 },
  { CROWN: 4, GEM: 5, PLANET: 6, COMET: 6, A: 6, K: 6, Q: 7, J: 7, TEN: 7, WILD: 5, SCATTER: 1 },
  { CROWN: 4, GEM: 5, PLANET: 6, COMET: 6, A: 6, K: 6, Q: 7, J: 7, TEN: 7, WILD: 5, SCATTER: 1 },
];

/**
 * The RTP knob: extra low-pay filler symbols added to base reels 2-5. More
 * filler dilutes every combination that reaches those reels, lowering RTP in
 * small steps. `tune` searches this to hit a target.
 */
export interface TuningKnob {
  /** Extra TEN symbols on each of base reels 2..5. */
  filler: [number, number, number, number];
}

export function buildProfile(id: string, knob: TuningKnob): MathProfile {
  const base = BASE_COUNTS.map((c, i) => {
    const counts = { ...c };
    if (i > 0) counts.TEN = (counts.TEN ?? 0) + knob.filler[i - 1];
    return buildStrip(counts, 7700 + i);
  });
  const free = FREE_COUNTS.map((c, i) => buildStrip(c, 8800 + i));
  return {
    id,
    description: "Jack Vault: 5x4, 25 lines, free spins x2, Super Wheel, 4 progressive jackpots",
    betLevelsCents: [25, 50, 100, 250, 500, 1000, 2500, 5000],
    paylines: PAYLINES_25,
    paytable: {
      CROWN: { 3: 50, 4: 200, 5: 1000 },
      GEM: { 3: 40, 4: 150, 5: 500 },
      PLANET: { 3: 30, 4: 100, 5: 300 },
      COMET: { 3: 25, 4: 75, 5: 200 },
      A: { 3: 20, 4: 50, 5: 150 },
      K: { 3: 15, 4: 40, 5: 120 },
      Q: { 3: 12, 4: 30, 5: 100 },
      J: { 3: 10, 4: 25, 5: 80 },
      TEN: { 3: 8, 4: 20, 5: 60 },
    },
    scatterPays: { 3: 2, 4: 10, 5: 50 },
    reels: { base, free },
    freeSpins: { triggerCount: 3, spinsAwarded: 12, retriggerSpins: 5, multiplier: 2 },
    wheel: {
      triggerCount: 3,
      // Clockwise from the pointer's rest position; the client draws them in this order.
      segments: [
        { kind: "CREDIT", multiplier: 10, weight: 220 },
        { kind: "JACKPOT", tier: "MINI", weight: 40 },
        { kind: "CREDIT", multiplier: 15, weight: 170 },
        { kind: "FREE_SPINS", spins: 10, weight: 90 },
        { kind: "CREDIT", multiplier: 25, weight: 110 },
        { kind: "JACKPOT", tier: "MINOR", weight: 15 },
        { kind: "CREDIT", multiplier: 12, weight: 200 },
        { kind: "JACKPOT", tier: "MAJOR", weight: 4 },
        { kind: "CREDIT", multiplier: 50, weight: 40 },
        { kind: "CREDIT", multiplier: 20, weight: 140 },
        { kind: "JACKPOT", tier: "GRAND", weight: 1 },
        { kind: "CREDIT", multiplier: 100, weight: 10 },
      ],
      jackpotFallbackSegment: 0,
    },
    jackpots: {
      GRAND: { seedCents: 1_000_000, contributionBps: 50 },
      MAJOR: { seedCents: 100_000, contributionBps: 40 },
      MINOR: { seedCents: 25_000, contributionBps: 30 },
      MINI: { seedCents: 5_000, contributionBps: 30 },
    },
  };
}
