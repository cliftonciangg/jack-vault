import { test } from "node:test";
import assert from "node:assert/strict";
import { SeededRng } from "../src/rng/rng.js";
import { type Card, Shoe, cardLabel, handValue } from "../src/blackjack/cards.js";
import { RoundError, act, decideInsurance, legalActions, startRound } from "../src/blackjack/engine.js";
import { RULE_SETS } from "../src/blackjack/rules.js";
import { perfectPairs, sideBetEdges, twentyOnePlus3 } from "../src/blackjack/sidebets.js";
import { simulateBlackjack } from "../src/blackjack/simulate.js";
import { basicStrategy } from "../src/blackjack/strategy.js";

const rules = RULE_SETS.standard;

/** Card from a label like "AS", "10H", "KD". */
function c(label: string): Card {
  const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(label.slice(0, -1));
  const suit = "SHDC".indexOf(label.slice(-1));
  assert.ok(rank >= 0 && suit >= 0, label);
  return suit * 13 + rank;
}

/** A stacked shoe dealing these cards in order. */
function stack(...labels: string[]) {
  const cards = labels.map(c);
  let i = 0;
  return { draw: () => cards[i++] ?? assert.fail("stacked shoe ran out"), get left() { return cards.length - i; } };
}

test("hand values count Aces as 1 or 11", () => {
  assert.deepEqual(handValue([c("AS"), c("6H")]), { total: 17, soft: true });
  assert.deepEqual(handValue([c("AS"), c("6H"), c("KD")]), { total: 17, soft: false });
  assert.deepEqual(handValue([c("AS"), c("AH"), c("9D")]), { total: 21, soft: true });
  assert.deepEqual(handValue([c("KS"), c("QH"), c("2D")]), { total: 22, soft: false });
  assert.equal(cardLabel(c("10C")), "10C");
});

test("a 6-deck shoe holds each card six times, cuts at half and reshuffles", () => {
  const shoe = new Shoe(6, 0.5, new SeededRng(1));
  assert.equal(shoe.remaining, 312);
  const counts = new Array(52).fill(0);
  for (const x of shoe.cards) counts[x]++;
  assert.ok(counts.every((n) => n === 6));
  const h1 = shoe.hash();
  for (let i = 0; i < 155; i++) shoe.draw();
  assert.equal(shoe.needsShuffle, false);
  shoe.draw();
  assert.equal(shoe.needsShuffle, true);
  shoe.shuffle();
  assert.equal(shoe.remaining, 312);
  assert.notEqual(shoe.hash(), h1);
});

test("a natural pays 3 to 2 (6 to 5 on the short-pay table) and settles without a turn", () => {
  // seat 0: A K   dealer: 9 7
  const s = startRound(rules, [{ seat: 0, betCents: 1000 }], stack("AS", "9H", "KD", "7C"));
  assert.equal(s.phase, "settled");
  assert.equal(s.seats[0].hands[0].outcome, "blackjack");
  assert.equal(s.seats[0].returnCents, 2500);
  const p = startRound(RULE_SETS.shortpay, [{ seat: 0, betCents: 1000 }], stack("AS", "9H", "KD", "7C"));
  assert.equal(p.seats[0].returnCents, 2200);
});

test("the dealer peeks under a 10: a dealer blackjack ends the round, a player natural pushes", () => {
  // seat 0: A K   seat 1: 9 9   dealer: K A
  const s = startRound(rules, [{ seat: 0, betCents: 500 }, { seat: 1, betCents: 500 }], stack("AS", "9H", "KD", "KH", "9C", "AD"));
  assert.equal(s.phase, "settled");
  assert.equal(s.dealer.length, 2);
  assert.equal(s.seats[0].hands[0].outcome, "push");
  assert.equal(s.seats[0].returnCents, 500);
  assert.equal(s.seats[1].hands[0].outcome, "lose");
  assert.equal(s.seats[1].returnCents, 0);
});

test("insurance pays 2 to 1 against a dealer blackjack", () => {
  // seat 0: 10 9   dealer: A K
  const shoe = stack("10S", "AH", "9D", "KC");
  const s = startRound(rules, [{ seat: 0, betCents: 1000 }], shoe);
  assert.equal(s.phase, "insurance");
  assert.throws(() => act(s, 0, "stand", shoe), RoundError);
  decideInsurance(s, 0, true, shoe);
  assert.equal(s.phase, "settled");
  assert.equal(s.seats[0].stakeCents, 1500);
  assert.equal(s.seats[0].insuranceReturnCents, 1500);
  assert.equal(s.seats[0].returnCents, 1500); // main bet lost, insurance covers it
});

test("declined insurance with no dealer blackjack goes on to play", () => {
  // seat 0: 10 9   dealer: A 8 (soft 19, stands)
  const shoe = stack("10S", "AH", "9D", "8C");
  const s = startRound(rules, [{ seat: 0, betCents: 1000 }], shoe);
  decideInsurance(s, 0, false, shoe);
  assert.equal(s.phase, "players");
  act(s, 0, "stand", shoe);
  assert.equal(s.seats[0].hands[0].outcome, "push");
});

test("H17: the dealer hits soft 17; S17 stands on it", () => {
  // seat 0: 10 8   dealer: 6 A, then a 2
  const deal = () => stack("10S", "6H", "8D", "AC", "2S");
  const shoeH = deal();
  const h2 = startRound(RULE_SETS.standard, [{ seat: 0, betCents: 100 }], shoeH);
  act(h2, 0, "stand", shoeH);
  assert.equal(handValue(h2.dealer).total, 19);
  assert.equal(h2.seats[0].hands[0].outcome, "lose");
  const shoeS = deal();
  const s = startRound(RULE_SETS.classic, [{ seat: 0, betCents: 100 }], shoeS);
  act(s, 0, "stand", shoeS);
  assert.equal(handValue(s.dealer).total, 17);
  assert.equal(s.seats[0].hands[0].outcome, "win");
});

test("split, then double after split, are staked and paid per hand", () => {
  // seat 0: 8 8   dealer: 6 10   split -> 8+3 (double, +10 = 21), 8+10 (stand)   dealer draws 9 -> 25 bust
  const shoe = stack("8S", "6H", "8D", "10C", "3S", "10H", "10D", "9C");
  const s = startRound(rules, [{ seat: 0, betCents: 200 }], shoe);
  assert.deepEqual(legalActions(s), ["hit", "stand", "double", "split"]);
  act(s, 0, "split", shoe);
  assert.equal(s.seats[0].hands.length, 2);
  assert.deepEqual(s.turn, { seat: 0, hand: 0 });
  assert.ok(legalActions(s).includes("double"));
  act(s, 0, "double", shoe);
  assert.deepEqual(s.turn, { seat: 0, hand: 1 });
  act(s, 0, "stand", shoe);
  assert.equal(s.phase, "settled");
  assert.equal(handValue(s.dealer).total, 25);
  assert.equal(s.seats[0].stakeCents, 600); // 2.00 + 2.00 split + 2.00 double
  assert.equal(s.seats[0].returnCents, 1200);
  assert.equal(shoe.left, 0);
});

test("no double after split on the tight table", () => {
  const shoe = stack("8S", "6H", "8D", "10C", "3S", "10H", "10D", "9C");
  const s = startRound(RULE_SETS.tight, [{ seat: 0, betCents: 200 }], shoe);
  act(s, 0, "split", shoe);
  assert.deepEqual(legalActions(s), ["hit", "stand"]);
});

test("split Aces get one card each and a two-card 21 after a split is not a blackjack", () => {
  // seat 0: A A   dealer: 9 8   split -> A+K, A+5
  const shoe = stack("AS", "9H", "AD", "8C", "KS", "5H");
  const s = startRound(rules, [{ seat: 0, betCents: 100 }], shoe);
  act(s, 0, "split", shoe);
  assert.equal(s.phase, "settled");
  const [h1, h2] = s.seats[0].hands;
  assert.equal(h1.outcome, "win"); // 21 beats 17, paid 1:1
  assert.equal(h1.returnCents, 200);
  assert.equal(h2.outcome, "lose");
});

test("turns go seat by seat and out-of-turn or illegal moves are refused", () => {
  // seat 1: 10 6   seat 3: 9 2   dealer: 7 10
  const shoe = stack("10S", "9H", "7D", "6C", "2S", "10H", "KD");
  const s = startRound(rules, [{ seat: 3, betCents: 100 }, { seat: 1, betCents: 100 }], shoe);
  assert.deepEqual(s.turn, { seat: 1, hand: 0 });
  assert.throws(() => act(s, 3, "hit", shoe), /turn/);
  assert.throws(() => act(s, 1, "split", shoe), /Cannot split/);
  act(s, 1, "hit", shoe); // 10 6 K = bust
  assert.equal(s.seats[0].hands[0].done, true);
  assert.deepEqual(s.turn, { seat: 3, hand: 0 });
  act(s, 3, "stand", shoe);
  assert.equal(s.seats[0].hands[0].outcome, "bust");
  assert.equal(s.seats[1].hands[0].outcome, "lose"); // 11 vs 17
});

test("bets outside the table limits are refused", () => {
  const shoe = stack("10S", "9H", "7D", "6C");
  assert.throws(() => startRound(rules, [{ seat: 0, betCents: 99 }], shoe), /Bet must be 1.00 to 10.00/);
  assert.throws(() => startRound(rules, [{ seat: 0, betCents: 1001 }], shoe), RoundError);
  assert.throws(() => startRound(rules, [{ seat: 0, betCents: 100, plus3Cents: 600 }], shoe), /21\+3/);
});

test("side bets are classified and paid on the deal", () => {
  assert.equal(perfectPairs(c("7S"), c("7S"))?.kind, "perfect");
  assert.equal(perfectPairs(c("7H"), c("7D"))?.kind, "colored");
  assert.equal(perfectPairs(c("7H"), c("7C"))?.kind, "mixed");
  assert.equal(perfectPairs(c("7H"), c("8H")), null);
  assert.equal(twentyOnePlus3(c("QS"), c("KS"), c("AS"))?.kind, "straightFlush");
  assert.equal(twentyOnePlus3(c("2H"), c("AD"), c("3C"))?.kind, "straight");
  assert.equal(twentyOnePlus3(c("KH"), c("AD"), c("2C")), null);
  assert.equal(twentyOnePlus3(c("5D"), c("5D"), c("5D"))?.kind, "suitedTrips");
  assert.equal(twentyOnePlus3(c("5D"), c("5S"), c("5D"))?.kind, "trips");
  assert.equal(twentyOnePlus3(c("2D"), c("9D"), c("KD"))?.kind, "flush");

  // seat 0: 7H 7D (colored pair, 12:1)   dealer up 7D -> trips on 21+3 (30:1)
  const shoe = stack("7H", "7D", "7D", "9C");
  const s = startRound(rules, [{ seat: 0, betCents: 100, perfectPairsCents: 100, plus3Cents: 200 }], shoe);
  assert.equal(s.seats[0].perfectPairs?.returnCents, 1300);
  assert.equal(s.seats[0].plus3?.returnCents, 6200);
});

test("exact side-bet edges match the published 6- and 8-deck figures", () => {
  const six = sideBetEdges(6);
  const eight = sideBetEdges(8);
  // Perfect Pairs 25/12/6: 6.11% at 6 decks, 4.10% at 8 decks.
  assert.ok(Math.abs(six.perfectPairs - 0.0611) < 0.0005, String(six.perfectPairs));
  assert.ok(Math.abs(eight.perfectPairs - 0.041) < 0.0005, String(eight.perfectPairs));
  assert.ok(six.twentyOnePlus3 > 0.02 && six.twentyOnePlus3 < 0.07, String(six.twentyOnePlus3));
});

test("basic strategy picks the textbook plays", () => {
  const legal2 = ["hit", "stand", "double", "split"] as const;
  const play = (cards: string[], up: string, legal: readonly string[] = legal2) =>
    basicStrategy(rules, cards.map(c), c(up), legal as never);
  assert.equal(play(["8S", "8D"], "AH"), "split");
  assert.equal(play(["10S", "10D"], "6H"), "stand");
  assert.equal(play(["5S", "6D"], "AH"), "double"); // H17: double 11 vs A
  assert.equal(basicStrategy(RULE_SETS.classic, [c("5S"), c("6D")], c("AH"), ["hit", "stand", "double"]), "hit");
  assert.equal(play(["10S", "6D"], "10H", ["hit", "stand"]), "hit");
  assert.equal(play(["10S", "2D"], "4H", ["hit", "stand"]), "stand");
  assert.equal(play(["AS", "7D"], "9H", ["hit", "stand", "double"]), "hit");
  assert.equal(play(["AS", "7D"], "3H", ["hit", "stand"]), "stand"); // Ds without a double stands
  assert.equal(play(["9S", "9D"], "7H"), "stand");
});

test("basic strategy at the default table loses about 0.6% (seeded Monte Carlo)", () => {
  const r = simulateBlackjack(rules, 150_000, new SeededRng(11));
  assert.equal(r.hands, 750_000);
  assert.ok(Math.abs(r.houseEdge - 0.0062) < r.ci95 * 1.5, `edge ${r.houseEdge} ± ${r.ci95}`);
  assert.ok(r.stdDev > 1.1 && r.stdDev < 1.2);
});
