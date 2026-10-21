/**
 * Posted table rules. Unlike the reels game, nothing here is hidden: the rules
 * fully decide the odds, so a "win ratio" for blackjack is a choice between
 * these rule sets, each printed on the felt.
 */
export interface BlackjackRules {
  id: string;
  name: string;
  decks: number;
  /** Natural pays num:den, e.g. [3, 2]. */
  blackjackPays: [number, number];
  /** H17: the dealer hits soft 17. */
  dealerHitsSoft17: boolean;
  doubleOn: "any" | "9-11" | "10-11";
  doubleAfterSplit: boolean;
  /** Most hands one seat can hold after splitting. */
  maxHands: number;
  resplitAces: boolean;
  hitSplitAces: boolean;
  lateSurrender: boolean;
  /** American hole card: the dealer checks for blackjack under an Ace or 10, and the round ends early on one. */
  dealerPeeks: boolean;
  /** Share of the shoe dealt before the cut card. */
  penetration: number;
  minBetCents: number;
  maxBetCents: number;
  /** Each side bet is optional: 0, or 1.00 up to this. */
  maxSideBetCents: number;
}

const base = {
  decks: 6,
  blackjackPays: [3, 2] as [number, number],
  dealerHitsSoft17: true,
  doubleOn: "any" as const,
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  lateSurrender: false,
  dealerPeeks: true,
  penetration: 0.5,
  minBetCents: 100,
  maxBetCents: 1_000,
  maxSideBetCents: 500,
};

export const RULE_SETS: Record<string, BlackjackRules> = {
  classic: { ...base, id: "classic", name: "Classic: 6 decks, 3:2, S17, DAS", dealerHitsSoft17: false },
  standard: { ...base, id: "standard", name: "Standard: 6 decks, 3:2, H17, DAS" },
  tight: {
    ...base,
    id: "tight",
    name: "Tight: 8 decks, 3:2, H17, no DAS, double on 10-11",
    decks: 8,
    doubleOn: "10-11",
    doubleAfterSplit: false,
  },
  shortpay: { ...base, id: "shortpay", name: "Short pay: 6 decks, 6:5, H17, DAS", blackjackPays: [6, 5] },
};

/** The table's default, as chosen on Oct 21: 6 decks, 3:2, H17, DAS, limits 1.00-10.00. */
export const DEFAULT_RULES = RULE_SETS.standard;

export function getRules(id: string): BlackjackRules {
  const r = RULE_SETS[id];
  if (!r) throw new Error(`Unknown blackjack rule set: ${id}`);
  return r;
}
