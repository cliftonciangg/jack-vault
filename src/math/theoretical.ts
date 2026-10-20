import { payLine } from "./evaluate.js";
import { countSymbols } from "./strips.js";
import { JACKPOT_TIERS, JackpotTier, MathProfile, ROWS, Symbol } from "./types.js";

/**
 * Exact (non-simulated) expected return of the math profile.
 *
 * Line pays: each payline reads one row per reel and every stop is equally
 * likely, so the symbol a line sees on a reel is distributed exactly like the
 * strip itself, independently per reel. One line's expected pay is therefore
 * an enumeration over symbol counts, and all 25 lines share it.
 *
 * Scatter / BONUS counts: strips never hold two in one 4-row window, so each
 * reel shows one with probability count * 4 / length, independently per reel.
 *
 * Features combine through linearity of expectation (Wald's identity for the
 * free-spin retrigger chain).
 */

function reelDistributions(strips: Symbol[][]): [Symbol, number][][] {
  return strips.map((strip) =>
    [...countSymbols(strip).entries()].map(([s, c]) => [s, c / strip.length] as [Symbol, number]),
  );
}

const lineCache = new Map<string, number>();

/** Expected pay of a single line, in multiples of line bet. */
export function lineExpectation(strips: Symbol[][], paytable: MathProfile["paytable"]): number {
  const key = JSON.stringify([strips, paytable]);
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  if (lineCache.size > 256) lineCache.clear();
  const dists = reelDistributions(strips);
  const prefix: Symbol[] = [];
  let ev = 0;
  const rec = (reel: number, p: number) => {
    if (reel === dists.length) {
      ev += p * (payLine(prefix, paytable)?.multiplier ?? 0);
      return;
    }
    for (const [s, q] of dists[reel]) {
      prefix.push(s);
      rec(reel + 1, p * q);
      prefix.pop();
    }
  };
  rec(0, 1);
  lineCache.set(key, ev);
  return ev;
}

/** P(exactly k of `symbol` on the grid), k = 0..reels. */
export function countDistribution(strips: Symbol[][], symbol: Symbol): number[] {
  let dist = [1];
  for (const strip of strips) {
    const c = strip.filter((s) => s === symbol).length;
    const p = Math.min(1, (c * ROWS) / strip.length);
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => {
      next[k] += v * (1 - p);
      next[k + 1] += v * p;
    });
    dist = next;
  }
  return dist;
}

const atLeast = (dist: number[], n: number) => dist.slice(n).reduce((a, b) => a + b, 0);

/** Wheel weights after scaling jackpot segments by bet / max bet. Integer weights. */
export function wheelWeights(profile: MathProfile, betCents: number): number[] {
  const maxBet = Math.max(...profile.betLevelsCents);
  const w = profile.wheel.segments.map((s) => (s.kind === "JACKPOT" ? s.weight * betCents : s.weight * maxBet));
  let freed = 0;
  profile.wheel.segments.forEach((s) => {
    if (s.kind === "JACKPOT") freed += s.weight * (maxBet - betCents);
  });
  w[profile.wheel.jackpotFallbackSegment] += freed;
  return w;
}

export interface TheoreticalReport {
  profileId: string;
  betCents: number;
  rtp: number;
  components: {
    baseLines: number;
    baseScatterPays: number;
    freeSpins: number;
    wheelCredits: number;
    wheelFreeSpins: number;
    jackpotContributions: number;
    jackpotSeeds: number;
  };
  freeSpins: {
    triggerProbability: number;
    retriggerProbability: number;
    expectedSpinsPerTrigger: number;
    expectedWinPerTrigger: number; // total-bet units
  };
  wheel: {
    triggerProbability: number;
    expectedCreditsPerTrigger: number;
  };
  jackpotHitProbabilityPerSpin: Record<JackpotTier, number>;
  baseLineExpectation: number;
  freeLineExpectation: number;
}

export function theoreticalRtp(profile: MathProfile, betCents = Math.max(...profile.betLevelsCents)): TheoreticalReport {
  const fs = profile.freeSpins;
  const baseLine = lineExpectation(profile.reels.base, profile.paytable);
  const freeLine = lineExpectation(profile.reels.free, profile.paytable);

  const scatterPay = (dist: number[]) =>
    dist.reduce((a, p, k) => a + p * (profile.scatterPays[Math.min(k, 5) as 3 | 4 | 5] ?? 0), 0);

  const baseScat = countDistribution(profile.reels.base, "SCATTER");
  const freeScat = countDistribution(profile.reels.free, "SCATTER");
  const baseBonus = countDistribution(profile.reels.base, "BONUS");

  const pFs = atLeast(baseScat, fs.triggerCount);
  const q = atLeast(freeScat, fs.triggerCount);
  if (q * fs.retriggerSpins >= 1) throw new Error("Free spins retrigger chain does not terminate in expectation");
  const freeSpinEv = fs.multiplier * (freeLine + scatterPay(freeScat));
  const spinsPerAward = (n: number) => n / (1 - q * fs.retriggerSpins);
  const fsFeatureEv = spinsPerAward(fs.spinsAwarded) * freeSpinEv;

  const pWheel = atLeast(baseBonus, profile.wheel.triggerCount);
  const weights = wheelWeights(profile, betCents);
  const W = weights.reduce((a, b) => a + b, 0);
  let wheelCredits = 0;
  let wheelFs = 0;
  const jackpotHit = Object.fromEntries(JACKPOT_TIERS.map((t) => [t, 0])) as Record<JackpotTier, number>;
  let jackpotSeeds = 0;
  profile.wheel.segments.forEach((s, i) => {
    const p = weights[i] / W;
    if (s.kind === "CREDIT") wheelCredits += p * s.multiplier;
    else if (s.kind === "FREE_SPINS") wheelFs += p * spinsPerAward(s.spins) * freeSpinEv;
    else {
      jackpotHit[s.tier] += pWheel * p;
      jackpotSeeds += (pWheel * p * profile.jackpots[s.tier].seedCents) / betCents;
    }
  });

  const contributions = JACKPOT_TIERS.reduce((a, t) => a + profile.jackpots[t].contributionBps / 10000, 0);

  const components = {
    baseLines: baseLine,
    baseScatterPays: scatterPay(baseScat),
    freeSpins: pFs * fsFeatureEv,
    wheelCredits: pWheel * wheelCredits,
    wheelFreeSpins: pWheel * wheelFs,
    jackpotContributions: contributions,
    jackpotSeeds,
  };
  return {
    profileId: profile.id,
    betCents,
    rtp: Object.values(components).reduce((a, b) => a + b, 0),
    components,
    freeSpins: {
      triggerProbability: pFs,
      retriggerProbability: q,
      expectedSpinsPerTrigger: spinsPerAward(fs.spinsAwarded),
      expectedWinPerTrigger: fsFeatureEv,
    },
    wheel: { triggerProbability: pWheel, expectedCreditsPerTrigger: wheelCredits },
    jackpotHitProbabilityPerSpin: jackpotHit,
    baseLineExpectation: baseLine,
    freeLineExpectation: freeLine,
  };
}

/** RTP excluding progressive jackpots (what a fixed-pool simulation measures directly). */
export function nonJackpotRtp(r: TheoreticalReport): number {
  const c = r.components;
  return c.baseLines + c.baseScatterPays + c.freeSpins + c.wheelCredits + c.wheelFreeSpins;
}
