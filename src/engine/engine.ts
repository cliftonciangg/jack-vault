import { evaluateGrid, Grid, LineWin, windowFor } from "../math/evaluate.js";
import { wheelWeights } from "../math/theoretical.js";
import { JackpotTier, MathProfile, WheelSegment } from "../math/types.js";
import { RecordingRng, Rng, weightedIndex } from "../rng/rng.js";

/**
 * The round engine. Pure functions over a profile and an RNG: no wallet, no
 * storage, no clock. The game service and the simulator both drive rounds
 * through these, so the simulated math is the shipped math.
 *
 * All money is integer cents. Line bet = total bet / 25, so every pay is exact.
 */

export type Draw = { max: number; value: number };

export interface ReelStep {
  type: "BASE" | "FREE";
  stops: number[];
  grid: Grid;
  lineWins: (LineWin & { winCents: number })[];
  scatter: { count: number; positions: [number, number][]; winCents: number };
  bonus: { count: number; positions: [number, number][] };
  /** Win multiplier applied to this spin (free spins x2). */
  multiplier: number;
  winCents: number;
  freeSpinsAwarded: number;
  wheelTriggered: boolean;
  draws: Draw[];
}

export interface WheelStep {
  type: "WHEEL";
  segmentIndex: number;
  segment: WheelSegment;
  /** Weights used for this bet (jackpot segments scale with bet). */
  weights: number[];
  /** Credit prize; jackpot amounts are filled in by the jackpot pools. */
  winCents: number;
  freeSpinsAwarded: number;
  jackpotTier: JackpotTier | null;
  jackpotWinCents: number;
  draws: Draw[];
}

export type Step = ReelStep | WheelStep;

export interface PendingFeatures {
  wheel: boolean;
  freeSpins: null | {
    remaining: number;
    played: number;
    awarded: number;
    multiplier: number;
    winCents: number;
  };
}

export type NextAction = "spin" | "wheel" | "freeSpin";

export function lineBetCents(profile: MathProfile, betCents: number): number {
  return betCents / profile.paylines.length;
}

export function assertBet(profile: MathProfile, betCents: number): void {
  if (!profile.betLevelsCents.includes(betCents)) {
    throw new GameError("INVALID_BET", `Bet must be one of ${profile.betLevelsCents.join(", ")} (cents)`);
  }
}

export class GameError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

function reelSpin(profile: MathProfile, betCents: number, rng: Rng, free: boolean): ReelStep {
  const rec = new RecordingRng(rng);
  const strips = free ? profile.reels.free : profile.reels.base;
  const stops = strips.map((s) => rec.int(s.length));
  const grid = windowFor(strips, stops);
  const ev = evaluateGrid(grid, profile);
  const lb = lineBetCents(profile, betCents);
  const mult = free ? profile.freeSpins.multiplier : 1;
  const lineWins = ev.lineWins.map((w) => ({ ...w, winCents: w.multiplier * lb * mult }));
  const scatterWin = ev.scatterMultiplier * betCents * mult;
  const winCents = lineWins.reduce((a, w) => a + w.winCents, 0) + scatterWin;
  const fs = profile.freeSpins;
  return {
    type: free ? "FREE" : "BASE",
    stops,
    grid,
    lineWins,
    scatter: { count: ev.scatterCount, positions: ev.scatterPositions, winCents: scatterWin },
    bonus: { count: ev.bonusCount, positions: ev.bonusPositions },
    multiplier: mult,
    winCents,
    freeSpinsAwarded: ev.scatterCount >= fs.triggerCount ? (free ? fs.retriggerSpins : fs.spinsAwarded) : 0,
    wheelTriggered: !free && ev.bonusCount >= profile.wheel.triggerCount,
    draws: rec.draws,
  };
}

/** Base-game spin. Returns the step and the features it leaves pending. */
export function baseSpin(profile: MathProfile, betCents: number, rng: Rng): { step: ReelStep; pending: PendingFeatures } {
  assertBet(profile, betCents);
  const step = reelSpin(profile, betCents, rng, false);
  const pending: PendingFeatures = { wheel: step.wheelTriggered, freeSpins: null };
  if (step.freeSpinsAwarded > 0) pending.freeSpins = newFreeSpins(profile, step.freeSpinsAwarded);
  return { step, pending };
}

function newFreeSpins(profile: MathProfile, spins: number): NonNullable<PendingFeatures["freeSpins"]> {
  return { remaining: spins, played: 0, awarded: spins, multiplier: profile.freeSpins.multiplier, winCents: 0 };
}

/** The action the client must send next for an open round. Wheel goes before free spins. */
export function nextAction(p: PendingFeatures): NextAction {
  if (p.wheel) return "wheel";
  if (p.freeSpins && p.freeSpins.remaining > 0) return "freeSpin";
  return "spin";
}

export function isComplete(p: PendingFeatures): boolean {
  return nextAction(p) === "spin";
}

export function freeSpin(
  profile: MathProfile,
  betCents: number,
  pending: PendingFeatures,
  rng: Rng,
): { step: ReelStep; pending: PendingFeatures } {
  if (nextAction(pending) !== "freeSpin") throw new GameError("NO_FREE_SPINS", "No free spins to play", 409);
  const step = reelSpin(profile, betCents, rng, true);
  const fs = pending.freeSpins!;
  const next: PendingFeatures = {
    ...pending,
    freeSpins: {
      ...fs,
      remaining: fs.remaining - 1 + step.freeSpinsAwarded,
      played: fs.played + 1,
      awarded: fs.awarded + step.freeSpinsAwarded,
      winCents: fs.winCents + step.winCents,
    },
  };
  return { step, pending: next };
}

/** Spins the Super Wheel. Jackpot payouts are resolved by the caller against the live pools. */
export function spinWheel(
  profile: MathProfile,
  betCents: number,
  pending: PendingFeatures,
  rng: Rng,
): { step: WheelStep; pending: PendingFeatures } {
  if (nextAction(pending) !== "wheel") throw new GameError("NO_WHEEL", "No wheel spin pending", 409);
  const rec = new RecordingRng(rng);
  const weights = wheelWeights(profile, betCents);
  const segmentIndex = weightedIndex(rec, weights);
  const segment = profile.wheel.segments[segmentIndex];
  const step: WheelStep = {
    type: "WHEEL",
    segmentIndex,
    segment,
    weights,
    winCents: segment.kind === "CREDIT" ? segment.multiplier * betCents : 0,
    freeSpinsAwarded: segment.kind === "FREE_SPINS" ? segment.spins : 0,
    jackpotTier: segment.kind === "JACKPOT" ? segment.tier : null,
    jackpotWinCents: 0,
    draws: rec.draws,
  };
  const next: PendingFeatures = { ...pending, wheel: false };
  if (step.freeSpinsAwarded > 0) {
    next.freeSpins = next.freeSpins
      ? {
          ...next.freeSpins,
          remaining: next.freeSpins.remaining + step.freeSpinsAwarded,
          awarded: next.freeSpins.awarded + step.freeSpinsAwarded,
        }
      : newFreeSpins(profile, step.freeSpinsAwarded);
  }
  return { step, pending: next };
}

export interface JackpotResolver {
  /** Adds the bet's contributions to the pools. */
  contribute(betCents: number): void;
  /** Pays out a tier, resets it, returns the amount in cents. */
  award(tier: JackpotTier): number;
}

/**
 * Plays a whole round (base spin and every feature it triggers) in one go.
 * Used by the simulator and tests; the live service plays the same steps one
 * request at a time.
 */
export function playFullRound(profile: MathProfile, betCents: number, rng: Rng, jackpots?: JackpotResolver) {
  jackpots?.contribute(betCents);
  const steps: Step[] = [];
  let { step, pending } = baseSpin(profile, betCents, rng);
  steps.push(step);
  for (let action = nextAction(pending); action !== "spin"; action = nextAction(pending)) {
    if (action === "wheel") {
      const r = spinWheel(profile, betCents, pending, rng);
      if (r.step.jackpotTier && jackpots) r.step.jackpotWinCents = jackpots.award(r.step.jackpotTier);
      steps.push(r.step);
      pending = r.pending;
    } else {
      const r = freeSpin(profile, betCents, pending, rng);
      steps.push(r.step);
      pending = r.pending;
    }
  }
  return { steps, winCents: steps.reduce((a, s) => a + stepWin(s), 0) };
}

/** Total credited by a step, jackpot included. */
export function stepWin(s: Step): number {
  return s.winCents + (s.type === "WHEEL" ? s.jackpotWinCents : 0);
}
