import { JACKPOT_TIERS, JackpotTier, MathProfile } from "../math/types.js";
import type { JackpotResolver } from "./engine.js";

/**
 * Progressive jackpot pools. Pools are held in units of 1/10,000 cent so a
 * contribution (bet x basis points) is always an exact integer. Payouts are
 * whole cents; the sub-cent remainder stays in the pool.
 */
export const UNITS_PER_CENT = 10_000;

export interface JackpotPoolState {
  /** Pool value in 1/10,000 cent units. */
  units: number;
  hits: number;
  contributedUnits: number;
  paidCents: number;
  seededCents: number;
  lastHitAt: string | null;
}

export type JackpotState = Record<JackpotTier, JackpotPoolState>;

export function initialJackpots(profile: MathProfile): JackpotState {
  return Object.fromEntries(
    JACKPOT_TIERS.map((t) => [
      t,
      {
        units: profile.jackpots[t].seedCents * UNITS_PER_CENT,
        hits: 0,
        contributedUnits: 0,
        paidCents: 0,
        seededCents: profile.jackpots[t].seedCents,
        lastHitAt: null,
      },
    ]),
  ) as JackpotState;
}

export class JackpotPools implements JackpotResolver {
  constructor(public state: JackpotState, private readonly profile: MathProfile, private readonly now = () => new Date().toISOString()) {}

  contribute(betCents: number): Record<JackpotTier, number> {
    const out = {} as Record<JackpotTier, number>;
    for (const t of JACKPOT_TIERS) {
      const u = betCents * this.profile.jackpots[t].contributionBps;
      const p = this.state[t];
      p.units += u;
      p.contributedUnits += u;
      out[t] = u;
    }
    return out;
  }

  award(tier: JackpotTier): number {
    const p = this.state[tier];
    const cents = Math.floor(p.units / UNITS_PER_CENT);
    const seed = this.profile.jackpots[tier].seedCents;
    p.units = p.units - cents * UNITS_PER_CENT + seed * UNITS_PER_CENT;
    p.hits += 1;
    p.paidCents += cents;
    p.seededCents += seed;
    p.lastHitAt = this.now();
    return cents;
  }

  /** Display values in cents (floored). */
  display(): Record<JackpotTier, number> {
    return Object.fromEntries(JACKPOT_TIERS.map((t) => [t, Math.floor(this.state[t].units / UNITS_PER_CENT)])) as Record<
      JackpotTier,
      number
    >;
  }
}

/** Reconciliation: every unit in a pool came from a seed or a contribution, minus what was paid. */
export function reconcileJackpots(state: JackpotState): Record<JackpotTier, boolean> {
  return Object.fromEntries(
    JACKPOT_TIERS.map((t) => {
      const p = state[t];
      return [t, p.units === p.seededCents * UNITS_PER_CENT + p.contributedUnits - p.paidCents * UNITS_PER_CENT];
    }),
  ) as Record<JackpotTier, boolean>;
}
