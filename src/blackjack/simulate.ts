import type { Rng } from "../rng/rng.js";
import { Shoe } from "./cards.js";
import { act, decideInsurance, legalActions, startRound } from "./engine.js";
import type { BlackjackRules } from "./rules.js";
import { basicStrategy } from "./strategy.js";

export interface BlackjackSimResult {
  hands: number;
  /** Net loss per initial bet, i.e. the house edge. */
  houseEdge: number;
  /** 95% confidence half-width of `houseEdge`. */
  ci95: number;
  /** Standard deviation of one seat-round's result, in initial bets. */
  stdDev: number;
  blackjacks: number;
  playerWins: number;
  pushes: number;
  shuffles: number;
}

/**
 * Plays `rounds` rounds at a full table (`seats` seats, flat minimum bets,
 * every seat on basic strategy, no insurance, no side bets) from one shoe
 * that reshuffles at the cut card, exactly as the table will.
 */
export function simulateBlackjack(rules: BlackjackRules, rounds: number, rng: Rng, seats = 5): BlackjackSimResult {
  const shoe = new Shoe(rules.decks, rules.penetration, rng);
  const bet = rules.minBetCents;
  const bets = Array.from({ length: seats }, (_, i) => ({ seat: i, betCents: bet }));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let blackjacks = 0;
  let wins = 0;
  let pushes = 0;
  for (let r = 0; r < rounds; r++) {
    if (shoe.needsShuffle) shoe.shuffle();
    const s = startRound(rules, bets, shoe);
    if (s.phase === "insurance") for (const seat of s.seats) decideInsurance(s, seat.seat, false, shoe);
    while (s.phase === "players" && s.turn) {
      const seat = s.seats.find((x) => x.seat === s.turn!.seat)!;
      const h = seat.hands[s.turn.hand];
      act(s, seat.seat, basicStrategy(rules, h.cards, s.dealer[0], legalActions(s)), shoe);
    }
    for (const seat of s.seats) {
      const x = (seat.returnCents - seat.stakeCents) / bet;
      n++;
      sum += x;
      sumSq += x * x;
      if (x > 0) wins++;
      else if (x === 0) pushes++;
      if (seat.hands[0].outcome === "blackjack") blackjacks++;
    }
  }
  const mean = sum / n;
  const sd = Math.sqrt(sumSq / n - mean * mean);
  return {
    hands: n,
    houseEdge: -mean,
    ci95: (1.96 * sd) / Math.sqrt(n),
    stdDev: sd,
    blackjacks: blackjacks / n,
    playerWins: wins / n,
    pushes: pushes / n,
    shuffles: shoe.shuffles,
  };
}
