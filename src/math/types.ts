/** Symbol ids used by the math model and sent to the client. */
export const SYMBOLS = [
  "CROWN", "GEM", "PLANET", "COMET",
  "A", "K", "Q", "J", "TEN",
  "WILD", "SCATTER", "BONUS",
] as const;
export type Symbol = (typeof SYMBOLS)[number];

export const WILD: Symbol = "WILD";
export const SCATTER: Symbol = "SCATTER";
export const BONUS: Symbol = "BONUS";

export const REELS = 5;
export const ROWS = 4;

/** Pays for 3, 4 and 5 of a kind, indexed by count. */
export type PayRow = Partial<Record<3 | 4 | 5, number>>;

export type WheelSegment =
  | { kind: "CREDIT"; multiplier: number; weight: number }
  | { kind: "FREE_SPINS"; spins: number; weight: number }
  | { kind: "JACKPOT"; tier: JackpotTier; weight: number };

export const JACKPOT_TIERS = ["GRAND", "MAJOR", "MINOR", "MINI"] as const;
export type JackpotTier = (typeof JACKPOT_TIERS)[number];

export interface JackpotTierConfig {
  /** Value the pool resets to after a hit, in cents. */
  seedCents: number;
  /** Share of every base-game bet added to the pool, in basis points (1 bp = 0.01%). */
  contributionBps: number;
}

/**
 * A complete math profile. Everything that affects outcomes lives here, so the
 * profile file plus the engine code is the whole math sheet.
 */
export interface MathProfile {
  id: string;
  description: string;
  /** Total bet levels in cents. Each must be divisible by the number of lines. */
  betLevelsCents: number[];
  paylines: number[][];
  /** Line pays in multiples of line bet. */
  paytable: Partial<Record<Symbol, PayRow>>;
  /** Scatter pays in multiples of total bet, by scatter count (3, 4, 5). */
  scatterPays: PayRow;
  reels: {
    base: Symbol[][];
    free: Symbol[][];
  };
  freeSpins: {
    /** Scatters needed to trigger (anywhere on the grid). */
    triggerCount: number;
    spinsAwarded: number;
    retriggerSpins: number;
    multiplier: number;
  };
  wheel: {
    /** BONUS symbols needed to trigger the Super Wheel (base game only). */
    triggerCount: number;
    segments: WheelSegment[];
    /**
     * Jackpot segment weights scale with bet / max bet so jackpot hit odds per
     * unit staked are the same at every bet. The weight removed at lower bets
     * moves to this segment index.
     */
    jackpotFallbackSegment: number;
  };
  jackpots: Record<JackpotTier, JackpotTierConfig>;
}
