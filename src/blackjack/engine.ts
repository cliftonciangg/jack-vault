import { type Card, handValue, isTwentyOne2, pointsOf } from "./cards.js";
import type { BlackjackRules } from "./rules.js";
import { perfectPairs, twentyOnePlus3 } from "./sidebets.js";

/**
 * Pure round engine for one blackjack table. The table (or the simulator)
 * owns the shoe and the clock; this module only applies rules. Every amount
 * is integer cents. The engine never checks balances: the caller debits
 * `costOf(...)` before calling `act` / `decideInsurance`.
 */

export type Action = "hit" | "stand" | "double" | "split" | "surrender";
export type HandOutcome = "blackjack" | "win" | "push" | "lose" | "bust" | "surrender";

export interface CardSource {
  draw(): Card;
}

export interface SeatBet {
  seat: number;
  betCents: number;
  perfectPairsCents?: number;
  plus3Cents?: number;
}

export interface PlayerHand {
  cards: Card[];
  betCents: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  surrendered: boolean;
  done: boolean;
  outcome?: HandOutcome;
  returnCents: number;
}

export interface SideBetResult {
  betCents: number;
  kind: string | null;
  multiplier: number;
  returnCents: number;
}

export interface SeatRound {
  seat: number;
  hands: PlayerHand[];
  insuranceDecided: boolean;
  insuranceCents: number;
  insuranceReturnCents: number;
  perfectPairs: SideBetResult | null;
  plus3: SideBetResult | null;
  /** Everything this seat put on the table this round, side bets and insurance included. */
  stakeCents: number;
  /** Everything paid back to it (stakes returned plus winnings). */
  returnCents: number;
}

export type Phase = "insurance" | "players" | "settled";

export interface ActionRecord {
  seat: number;
  hand: number;
  action: Action | "insurance" | "noInsurance";
}

export interface RoundState {
  rules: BlackjackRules;
  seats: SeatRound[];
  /** dealer[1] is the hole card; it stays hidden from players until `phase` is "settled". */
  dealer: Card[];
  phase: Phase;
  /** Whose turn it is in the "players" phase. */
  turn: { seat: number; hand: number } | null;
  dealerBlackjack: boolean;
  /** Every card in the order it left the shoe, and every decision: enough to replay the round. */
  dealt: Card[];
  actions: ActionRecord[];
}

export class RoundError extends Error {
  constructor(
    readonly code: "INVALID_BET" | "WRONG_PHASE" | "NOT_YOUR_TURN" | "ILLEGAL_ACTION",
    message: string,
  ) {
    super(message);
  }
}

function newHand(cards: Card[], betCents: number, fromSplit: boolean, splitAces: boolean): PlayerHand {
  return { cards, betCents, doubled: false, fromSplit, splitAces, surrendered: false, done: false, returnCents: 0 };
}

const isNatural = (h: PlayerHand) => !h.fromSplit && isTwentyOne2(h.cards);

function checkSideBet(rules: BlackjackRules, cents: number | undefined, label: string): number {
  const v = cents ?? 0;
  if (v === 0) return 0;
  if (!Number.isInteger(v) || v < 100 || v > rules.maxSideBetCents) {
    throw new RoundError("INVALID_BET", `${label} must be 0 or 1.00 to ${(rules.maxSideBetCents / 100).toFixed(2)}`);
  }
  return v;
}

/** Deals a new round to the seats that bet. Side bets are settled on the deal. */
export function startRound(rules: BlackjackRules, bets: readonly SeatBet[], shoe: CardSource): RoundState {
  if (bets.length === 0) throw new RoundError("INVALID_BET", "No bets");
  const seen = new Set<number>();
  const sorted = [...bets].sort((a, b) => a.seat - b.seat);
  for (const b of sorted) {
    if (seen.has(b.seat)) throw new RoundError("INVALID_BET", `Seat ${b.seat} bet twice`);
    seen.add(b.seat);
    if (!Number.isInteger(b.betCents) || b.betCents < rules.minBetCents || b.betCents > rules.maxBetCents) {
      throw new RoundError("INVALID_BET", `Bet must be ${(rules.minBetCents / 100).toFixed(2)} to ${(rules.maxBetCents / 100).toFixed(2)}`);
    }
  }

  const s: RoundState = {
    rules,
    seats: [],
    dealer: [],
    phase: "players",
    turn: null,
    dealerBlackjack: false,
    dealt: [],
    actions: [],
  };
  const draw = () => {
    const c = shoe.draw();
    s.dealt.push(c);
    return c;
  };

  for (const b of sorted) {
    const pp = checkSideBet(rules, b.perfectPairsCents, "Perfect Pairs");
    const p3 = checkSideBet(rules, b.plus3Cents, "21+3");
    s.seats.push({
      seat: b.seat,
      hands: [newHand([], b.betCents, false, false)],
      insuranceDecided: false,
      insuranceCents: 0,
      insuranceReturnCents: 0,
      perfectPairs: pp ? { betCents: pp, kind: null, multiplier: 0, returnCents: 0 } : null,
      plus3: p3 ? { betCents: p3, kind: null, multiplier: 0, returnCents: 0 } : null,
      stakeCents: b.betCents + pp + p3,
      returnCents: 0,
    });
  }

  // One card to each seat left to right, one to the dealer, then again (the second dealer card face down).
  for (let round = 0; round < 2; round++) {
    for (const seat of s.seats) seat.hands[0].cards.push(draw());
    s.dealer.push(draw());
  }

  const up = s.dealer[0];
  for (const seat of s.seats) {
    const [a, b] = seat.hands[0].cards;
    for (const [res, hit] of [
      [seat.perfectPairs, seat.perfectPairs && perfectPairs(a, b)],
      [seat.plus3, seat.plus3 && twentyOnePlus3(a, b, up)],
    ] as const) {
      if (!res) continue;
      if (hit) {
        res.kind = hit.kind;
        res.multiplier = hit.multiplier;
        res.returnCents = res.betCents * (hit.multiplier + 1);
        seat.returnCents += res.returnCents;
      }
    }
    if (isNatural(seat.hands[0])) seat.hands[0].done = true;
  }

  s.dealerBlackjack = isTwentyOne2(s.dealer);
  if (pointsOf(up) === 1) {
    s.phase = "insurance";
    return s;
  }
  if (pointsOf(up) === 10 && rules.dealerPeeks && s.dealerBlackjack) {
    settle(s);
    return s;
  }
  advance(s, 0, shoe);
  return s;
}

function seatOf(s: RoundState, seatNo: number): SeatRound {
  const seat = s.seats.find((x) => x.seat === seatNo);
  if (!seat) throw new RoundError("NOT_YOUR_TURN", `Seat ${seatNo} is not in this round`);
  return seat;
}

/** What taking insurance, doubling or splitting costs right now (the caller debits it first). */
export function costOf(s: RoundState, seatNo: number, action: Action | "insurance"): number {
  const seat = seatOf(s, seatNo);
  if (action === "insurance") return Math.floor(seat.hands[0].betCents / 2);
  if (action === "double" || action === "split") {
    if (!s.turn || s.turn.seat !== seatNo) return 0;
    return seat.hands[s.turn.hand].betCents;
  }
  return 0;
}

/** Insurance is offered to every seat while the dealer shows an Ace. Declining costs nothing. */
export function decideInsurance(s: RoundState, seatNo: number, take: boolean, shoe: CardSource): RoundState {
  if (s.phase !== "insurance") throw new RoundError("WRONG_PHASE", "Insurance is not on offer");
  const seat = seatOf(s, seatNo);
  if (seat.insuranceDecided) throw new RoundError("ILLEGAL_ACTION", "Insurance already decided");
  seat.insuranceDecided = true;
  if (take) {
    seat.insuranceCents = Math.floor(seat.hands[0].betCents / 2);
    seat.stakeCents += seat.insuranceCents;
  }
  s.actions.push({ seat: seatNo, hand: 0, action: take ? "insurance" : "noInsurance" });
  if (s.seats.every((x) => x.insuranceDecided)) {
    if (s.rules.dealerPeeks && s.dealerBlackjack) settle(s);
    else {
      s.phase = "players";
      advance(s, 0, shoe);
    }
  }
  return s;
}

function splittable(rules: BlackjackRules, seat: SeatRound, h: PlayerHand): boolean {
  if (h.cards.length !== 2 || seat.hands.length >= rules.maxHands) return false;
  if (pointsOf(h.cards[0]) !== pointsOf(h.cards[1])) return false;
  if (h.splitAces && !rules.resplitAces) return false;
  return true;
}

export function legalActions(s: RoundState): Action[] {
  if (s.phase !== "players" || !s.turn) return [];
  const seat = seatOf(s, s.turn.seat);
  const h = seat.hands[s.turn.hand];
  const rules = s.rules;
  // A split Ace that drew another Ace can only be re-split or stood on.
  if (h.splitAces) return splittable(rules, seat, h) ? ["split", "stand"] : ["stand"];

  const out: Action[] = ["hit", "stand"];
  if (h.cards.length === 2) {
    const t = handValue(h.cards).total;
    const totalOk = rules.doubleOn === "any" || (rules.doubleOn === "9-11" ? t >= 9 && t <= 11 : t >= 10 && t <= 11);
    // Hard totals only for the 9-11 / 10-11 rules: soft 19 is "9" only to nobody.
    const softBlocked = rules.doubleOn !== "any" && handValue(h.cards).soft;
    if (totalOk && !softBlocked && (!h.fromSplit || rules.doubleAfterSplit)) out.push("double");
    if (splittable(rules, seat, h)) out.push("split");
    if (rules.lateSurrender && !h.fromSplit && seat.hands.length === 1) out.push("surrender");
  }
  return out;
}

/** Applies one decision for the seat whose turn it is. */
export function act(s: RoundState, seatNo: number, action: Action, shoe: CardSource): RoundState {
  if (s.phase !== "players" || !s.turn) throw new RoundError("WRONG_PHASE", "No player turn now");
  if (s.turn.seat !== seatNo) throw new RoundError("NOT_YOUR_TURN", `It is seat ${s.turn.seat}'s turn`);
  if (!legalActions(s).includes(action)) throw new RoundError("ILLEGAL_ACTION", `Cannot ${action} now`);
  const seat = seatOf(s, seatNo);
  const hi = s.turn.hand;
  const h = seat.hands[hi];
  const draw = () => {
    const c = shoe.draw();
    s.dealt.push(c);
    return c;
  };
  s.actions.push({ seat: seatNo, hand: hi, action });

  switch (action) {
    case "hit": {
      h.cards.push(draw());
      if (handValue(h.cards).total >= 21) h.done = true;
      break;
    }
    case "stand":
      h.done = true;
      break;
    case "double": {
      seat.stakeCents += h.betCents;
      h.betCents *= 2;
      h.doubled = true;
      h.cards.push(draw());
      h.done = true;
      break;
    }
    case "split": {
      const aces = pointsOf(h.cards[0]) === 1;
      const second = h.cards.pop()!;
      seat.stakeCents += h.betCents;
      h.fromSplit = true;
      h.splitAces = aces;
      seat.hands.splice(hi + 1, 0, newHand([second], h.betCents, true, aces));
      break;
    }
    case "surrender":
      h.surrendered = true;
      h.done = true;
      break;
  }
  advance(s, s.seats.indexOf(seat), shoe);
  return s;
}

/** Deals the second card to a hand that came out of a split, and closes it if nothing is left to decide. */
function prepare(s: RoundState, seat: SeatRound, h: PlayerHand, shoe?: CardSource): void {
  if (h.cards.length === 1) {
    if (!shoe) throw new Error("A split hand needs a card source");
    const c = shoe.draw();
    s.dealt.push(c);
    h.cards.push(c);
    if (h.splitAces && !s.rules.hitSplitAces && !splittable(s.rules, seat, h)) h.done = true;
  }
  if (!h.done && handValue(h.cards).total === 21) h.done = true;
}

/** Moves the turn to the next open hand from seat index `from`, or plays the dealer and settles. */
function advance(s: RoundState, from: number, shoe?: CardSource): void {
  for (let si = from; si < s.seats.length; si++) {
    const seat = s.seats[si];
    for (let hi = 0; hi < seat.hands.length; hi++) {
      const h = seat.hands[hi];
      if (h.done) continue;
      prepare(s, seat, h, shoe);
      if (h.done) continue;
      s.turn = { seat: seat.seat, hand: hi };
      return;
    }
  }
  s.turn = null;
  playDealer(s, shoe);
  settle(s);
}

function playDealer(s: RoundState, shoe?: CardSource): void {
  // The dealer only draws if some hand is still waiting on the dealer's total.
  const live = s.seats.some((seat) =>
    seat.hands.some((h) => !h.surrendered && !isNatural(h) && handValue(h.cards).total <= 21),
  );
  if (!live || s.dealerBlackjack) return;
  for (;;) {
    const v = handValue(s.dealer);
    if (v.total > 17 || (v.total === 17 && !(v.soft && s.rules.dealerHitsSoft17))) return;
    if (!shoe) throw new Error("The dealer needs a card source");
    const c = shoe.draw();
    s.dealt.push(c);
    s.dealer.push(c);
  }
}

function settle(s: RoundState): void {
  const dealer = handValue(s.dealer).total;
  const [num, den] = s.rules.blackjackPays;
  for (const seat of s.seats) {
    if (seat.insuranceCents > 0 && s.dealerBlackjack) {
      seat.insuranceReturnCents = seat.insuranceCents * 3;
      seat.returnCents += seat.insuranceReturnCents;
    }
    for (const h of seat.hands) {
      h.done = true;
      const t = handValue(h.cards).total;
      let ret = 0;
      if (s.dealerBlackjack) {
        // With a peek the round ended before any double or split, so only original bets are lost.
        h.outcome = isNatural(h) ? "push" : "lose";
        ret = isNatural(h) ? h.betCents : 0;
      } else if (isNatural(h)) {
        h.outcome = "blackjack";
        ret = h.betCents + Math.floor((h.betCents * num) / den);
      } else if (h.surrendered) {
        h.outcome = "surrender";
        ret = Math.floor(h.betCents / 2);
      } else if (t > 21) {
        h.outcome = "bust";
      } else if (dealer > 21 || t > dealer) {
        h.outcome = "win";
        ret = h.betCents * 2;
      } else if (t === dealer) {
        h.outcome = "push";
        ret = h.betCents;
      } else {
        h.outcome = "lose";
      }
      h.returnCents = ret;
      seat.returnCents += ret;
    }
  }
  s.turn = null;
  s.phase = "settled";
}

/** What the table does for a player whose timer runs out. */
export const TIMEOUT_ACTION: Action = "stand";
