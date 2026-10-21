import { type Card, isRed, rankOf, suitOf } from "./cards.js";

/** Perfect Pairs on the player's first two cards. Pays x to 1. */
export const PERFECT_PAIRS = { perfect: 25, colored: 12, mixed: 6 } as const;
/** 21+3 on the player's first two cards plus the dealer's up card. Pays x to 1. */
export const TWENTY_ONE_PLUS_3 = { suitedTrips: 100, straightFlush: 40, trips: 30, straight: 10, flush: 5 } as const;

export interface SideBetHit {
  kind: string;
  multiplier: number;
}

export function perfectPairs(a: Card, b: Card): SideBetHit | null {
  if (rankOf(a) !== rankOf(b)) return null;
  if (suitOf(a) === suitOf(b)) return { kind: "perfect", multiplier: PERFECT_PAIRS.perfect };
  if (isRed(a) === isRed(b)) return { kind: "colored", multiplier: PERFECT_PAIRS.colored };
  return { kind: "mixed", multiplier: PERFECT_PAIRS.mixed };
}

function isStraight(ranks: number[]): boolean {
  const [x, y, z] = [...ranks].sort((p, q) => p - q);
  if (y === x + 1 && z === y + 1) return true;
  return x === 1 && y === 12 && z === 13; // Q-K-A
}

export function twentyOnePlus3(a: Card, b: Card, up: Card): SideBetHit | null {
  const ranks = [rankOf(a), rankOf(b), rankOf(up)];
  const flush = suitOf(a) === suitOf(b) && suitOf(b) === suitOf(up);
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const straight = isStraight(ranks);
  const T = TWENTY_ONE_PLUS_3;
  if (trips && flush) return { kind: "suitedTrips", multiplier: T.suitedTrips };
  if (straight && flush) return { kind: "straightFlush", multiplier: T.straightFlush };
  if (trips) return { kind: "trips", multiplier: T.trips };
  if (straight) return { kind: "straight", multiplier: T.straight };
  if (flush) return { kind: "flush", multiplier: T.flush };
  return null;
}

/**
 * Exact house edge of each side bet off a full shoe, by enumerating every
 * ordered draw of distinct cards. (The table reshuffles at the cut card, so
 * the full-shoe figure is the long-run one; card removal moves it only
 * slightly mid-shoe.)
 */
export function sideBetEdges(decks: number): { perfectPairs: number; twentyOnePlus3: number } {
  const n = decks * 52;
  let pp = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = 0; b < 52; b++) {
      const ways = decks * (a === b ? decks - 1 : decks);
      const hit = perfectPairs(a, b);
      pp += ways * (hit ? hit.multiplier : -1);
    }
  }
  const ppEv = pp / (n * (n - 1));

  let tp = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = 0; b < 52; b++) {
      for (let c = 0; c < 52; c++) {
        // Copies of each card type still in the shoe as the three are drawn in turn.
        const wa = decks;
        const wb = decks - (b === a ? 1 : 0);
        const wc = decks - (c === a ? 1 : 0) - (c === b ? 1 : 0);
        if (wb <= 0 || wc <= 0) continue;
        const hit = twentyOnePlus3(a, b, c);
        tp += wa * wb * wc * (hit ? hit.multiplier : -1);
      }
    }
  }
  const tpEv = tp / (n * (n - 1) * (n - 2));
  return { perfectPairs: -ppEv, twentyOnePlus3: -tpEv };
}
