import type { Rng } from "../rng/rng.js";
import { type Card, type SavedShoe, Shoe, handValue } from "./cards.js";
import {
  type Action,
  type CardSource,
  type HandOutcome,
  type RoundState,
  type SeatBet,
  type SideBetResult,
  RoundError,
  act,
  costOf,
  decideInsurance,
  legalActions,
  startRound,
} from "./engine.js";
import { type BlackjackRules, getRules } from "./rules.js";
import { basicStrategy } from "./strategy.js";

/**
 * One player's blackjack table: the real player in the middle seat and house
 * bots in the other four. Bots play basic strategy with play money that never
 * touches a wallet; they share the shoe, so the cards they take are the cards
 * a full table would really take.
 *
 * Every call runs the table forward until the real player has a decision to
 * make (or the round is settled) and returns one frame per step, so a client
 * can animate the bots' turns and the dealer's draws in order. The server and
 * the browser demo both drive tables through this module; the server adds the
 * wallet, the round records and persistence around it.
 */

export const SEATS = 5;
export const PLAYER_SEAT = 2;

export interface Bot {
  seat: number;
  name: string;
  /** Index into the client's avatar set. */
  avatar: number;
  balanceCents: number;
}

/** Everything a table needs to carry on after a restart. Plain JSON. */
export interface TableData {
  rulesId: string;
  shoe: SavedShoe;
  bots: Bot[];
  /** The current or last round; the next bet replaces it. */
  round: RoundState | null;
  roundId: string | null;
  /** The player's last bet, for REBET. */
  lastBet: PlayerBet | null;
  updatedAt: string;
}

export interface PlayerBet {
  betCents: number;
  perfectPairsCents?: number;
  plus3Cents?: number;
}

export interface HandView {
  cards: Card[];
  total: number;
  soft: boolean;
  betCents: number;
  doubled: boolean;
  outcome: HandOutcome | null;
  returnCents: number;
}

export interface SeatView {
  seat: number;
  name: string;
  avatar: number;
  bot: boolean;
  /** Bots only: their play-money stack. The player's balance is the wallet's. */
  balanceCents: number | null;
  /** True when this seat is in the round. */
  playing: boolean;
  hands: HandView[];
  insuranceCents: number;
  perfectPairs: SideBetResult | null;
  plus3: SideBetResult | null;
  stakeCents: number;
  returnCents: number;
}

export interface TableView {
  rulesId: string;
  rulesName: string;
  minBetCents: number;
  maxBetCents: number;
  maxSideBetCents: number;
  blackjackPays: [number, number];
  dealerHitsSoft17: boolean;
  phase: "betting" | RoundState["phase"];
  roundId: string | null;
  seats: SeatView[];
  /** The hole card is null until the dealer turns it over. */
  dealer: { cards: (Card | null)[]; total: number | null };
  turn: { seat: number; hand: number } | null;
  /** The player's legal moves right now (doubles and splits it can't afford are left out). */
  legal: Action[];
  /** Insurance is on offer to the player. */
  insuranceOffered: boolean;
  insuranceCostCents: number;
  shoeLeft: number;
  shoeSize: number;
  lastBet: PlayerBet | null;
}

export type FrameEvent =
  | { type: "shuffle" }
  | { type: "deal" }
  | { type: "insurance"; seat: number; take: boolean }
  | { type: "action"; seat: number; hand: number; action: Action }
  | { type: "settle" };

export interface Frame {
  event: FrameEvent;
  view: TableView;
}

const BOT_NAMES = [
  "Hubery Fowler", "Marguerite", "Uriah Hemingway", "Jodie Edie", "Rosalind Kerr", "Dexter Vance", "Imogen Hale",
  "Calvin Ortiz", "Beatrix Lowe", "Felix Arden", "Noor Haddad", "Mateo Silva", "Priya Nair", "Oscar Lind",
  "Hazel Quinn", "Ruben Cole", "Lena Fischer", "Kai Morgan", "Sienna Brooks", "Tobias Reed",
];
export const AVATARS = 8;

const BOT_BETS = [100, 100, 200, 200, 300, 500, 500, 1_000];

function randomBot(seat: number, rng: Rng, taken: Set<string>): Bot {
  let name = BOT_NAMES[rng.int(BOT_NAMES.length)];
  while (taken.has(name)) name = BOT_NAMES[rng.int(BOT_NAMES.length)];
  taken.add(name);
  return { seat, name, avatar: rng.int(AVATARS), balanceCents: 5_000 + rng.int(75_000) };
}

export function newTable(rulesId: string, rng: Rng, at: string): TableData {
  const rules = getRules(rulesId);
  const taken = new Set<string>();
  const bots: Bot[] = [];
  for (let seat = 0; seat < SEATS; seat++) if (seat !== PLAYER_SEAT) bots.push(randomBot(seat, rng, taken));
  return {
    rulesId,
    shoe: new Shoe(rules.decks, rules.penetration, rng).save(),
    bots,
    round: null,
    roundId: null,
    lastBet: null,
    updatedAt: at,
  };
}

/** True while the player owes a decision in the current round. */
export const roundOpen = (t: TableData) => !!t.round && t.round.phase !== "settled";

/**
 * The live table: a TableData plus the shoe and rules objects. All changes
 * happen on `data` in place, so callers work on a copy and keep it only if
 * the wallet accepts the result.
 */
export class Table {
  readonly rules: BlackjackRules;
  private readonly shoe: Shoe;
  private readonly source: CardSource;
  private frames: Frame[] = [];

  constructor(
    readonly data: TableData,
    private readonly rng: Rng,
    /** The player's balance, so the view only offers doubles and splits they can pay for. */
    private balanceCents: () => number = () => Infinity,
  ) {
    this.rules = getRules(data.rulesId);
    this.shoe = new Shoe(this.rules.decks, this.rules.penetration, rng, data.shoe);
    this.source = { draw: () => this.shoe.draw() };
  }

  private sync(): void {
    this.data.shoe = this.shoe.save();
  }

  private frame(event: FrameEvent): void {
    this.sync();
    this.frames.push({ event, view: this.view() });
  }

  private takeFrames(): Frame[] {
    const f = this.frames;
    this.frames = [];
    return f;
  }

  /**
   * Starts a round with the player's bet. Bots sit in and bet too; a bot
   * sometimes sits a hand out so the table doesn't look scripted.
   */
  bet(b: PlayerBet, roundId: string): Frame[] {
    if (roundOpen(this.data)) throw new RoundError("WRONG_PHASE", "Finish the current hand first");
    if (this.shoe.needsShuffle) {
      this.shoe.shuffle();
      this.frame({ type: "shuffle" });
    }
    const bets: SeatBet[] = [{ seat: PLAYER_SEAT, betCents: b.betCents, perfectPairsCents: b.perfectPairsCents ?? 0, plus3Cents: b.plus3Cents ?? 0 }];
    for (const bot of this.data.bots) {
      if (this.rng.int(10) === 0) continue;
      bets.push({ seat: bot.seat, betCents: Math.min(this.rules.maxBetCents, BOT_BETS[this.rng.int(BOT_BETS.length)]) });
    }
    this.data.round = startRound(this.rules, bets, this.source);
    this.data.roundId = roundId;
    this.data.lastBet = { betCents: b.betCents, perfectPairsCents: b.perfectPairsCents ?? 0, plus3Cents: b.plus3Cents ?? 0 };
    for (const s of this.data.round.seats) {
      const bot = this.data.bots.find((x) => x.seat === s.seat);
      if (bot) bot.balanceCents -= s.stakeCents;
    }
    this.frame({ type: "deal" });
    this.run();
    return this.takeFrames();
  }

  insurance(take: boolean): Frame[] {
    this.doInsurance(take);
    return this.takeFrames();
  }

  act(action: Action): Frame[] {
    this.doAct(action);
    return this.takeFrames();
  }

  /** What the player's timer running out does: decline insurance, then stand on every hand. */
  autoFinish(): Frame[] {
    while (roundOpen(this.data)) {
      if (this.data.round!.phase === "insurance") this.doInsurance(false);
      else this.doAct("stand");
    }
    return this.takeFrames();
  }

  private doInsurance(take: boolean): void {
    const r = this.requireRound();
    if (r.phase !== "insurance") throw new RoundError("WRONG_PHASE", "Insurance is not on offer");
    const seat = r.seats.find((s) => s.seat === PLAYER_SEAT)!;
    if (seat.insuranceDecided) throw new RoundError("ILLEGAL_ACTION", "Insurance already decided");
    decideInsurance(r, PLAYER_SEAT, take, this.source);
    this.frame({ type: "insurance", seat: PLAYER_SEAT, take });
    this.run();
  }

  private doAct(action: Action): void {
    const r = this.requireRound();
    if (r.phase !== "players" || r.turn?.seat !== PLAYER_SEAT) throw new RoundError("NOT_YOUR_TURN", "It isn't your turn");
    const hand = r.turn.hand;
    if (!this.view().legal.includes(action)) throw new RoundError("ILLEGAL_ACTION", `Cannot ${action} now`);
    act(r, PLAYER_SEAT, action, this.source);
    this.frame({ type: "action", seat: PLAYER_SEAT, hand, action });
    this.run();
  }

  /** Plays the bots until the player has a decision or the round is settled. */
  private run(): void {
    const r = this.data.round!;
    for (;;) {
      if (r.phase === "insurance") {
        for (const s of r.seats) {
          if (s.seat === PLAYER_SEAT || s.insuranceDecided) continue;
          decideInsurance(r, s.seat, false, this.source);
          if (r.phase !== "insurance") break;
        }
        if (r.phase === "insurance") return; // waiting on the player
        continue;
      }
      if (r.phase === "players" && r.turn) {
        if (r.turn.seat === PLAYER_SEAT) return;
        const seat = r.seats.find((s) => s.seat === r.turn!.seat)!;
        const hand = r.turn.hand;
        const a = basicStrategy(this.rules, seat.hands[hand].cards, r.dealer[0], legalActions(r));
        act(r, seat.seat, a, this.source);
        this.frame({ type: "action", seat: seat.seat, hand, action: a });
        continue;
      }
      // Settled: bots pay for their doubles and splits and collect, and a bot that runs low buys back in.
      for (const s of r.seats) {
        const bot = this.data.bots.find((x) => x.seat === s.seat);
        if (!bot) continue;
        bot.balanceCents += s.returnCents - (s.stakeCents - initialStake(r, s.seat));
        if (bot.balanceCents < 2_000) bot.balanceCents += 20_000 + this.rng.int(30_000);
      }
      this.frame({ type: "settle" });
      return;
    }
  }

  private requireRound(): RoundState {
    if (!this.data.round || this.data.round.phase === "settled") throw new RoundError("WRONG_PHASE", "No hand in play; place a bet");
    return this.data.round;
  }

  view(): TableView {
    const r = this.data.round;
    const rules = this.rules;
    const settled = !r || r.phase === "settled";
    const seats: SeatView[] = [];
    for (let seat = 0; seat < SEATS; seat++) {
      const bot = this.data.bots.find((b) => b.seat === seat);
      const s = r?.seats.find((x) => x.seat === seat);
      seats.push({
        seat,
        name: bot ? bot.name : "You",
        avatar: bot ? bot.avatar : 0,
        bot: !!bot,
        balanceCents: bot ? bot.balanceCents : null,
        playing: !!s,
        hands: (s?.hands ?? []).map((h) => {
          const v = handValue(h.cards);
          return { cards: [...h.cards], total: v.total, soft: v.soft, betCents: h.betCents, doubled: h.doubled, outcome: h.outcome ?? null, returnCents: h.returnCents };
        }),
        insuranceCents: s?.insuranceCents ?? 0,
        perfectPairs: s?.perfectPairs ? { ...s.perfectPairs } : null,
        plus3: s?.plus3 ? { ...s.plus3 } : null,
        stakeCents: s?.stakeCents ?? 0,
        returnCents: settled ? (s?.returnCents ?? 0) : 0,
      });
    }
    // The hole card shows once the round is over (the dealer's turn is the last step of a round).
    const dealer = r ? (settled ? [...r.dealer] : [r.dealer[0], null]) : [];
    const me = r?.seats.find((s) => s.seat === PLAYER_SEAT);
    let legal: Action[] = [];
    if (r && r.phase === "players" && r.turn?.seat === PLAYER_SEAT) {
      const bal = this.balanceCents();
      legal = legalActions(r).filter((a) => (a === "double" || a === "split" ? costOf(r, PLAYER_SEAT, a) <= bal : true));
    }
    const insuranceCost = me ? costOf(r!, PLAYER_SEAT, "insurance") : 0;
    return {
      rulesId: rules.id,
      rulesName: rules.name,
      minBetCents: rules.minBetCents,
      maxBetCents: rules.maxBetCents,
      maxSideBetCents: rules.maxSideBetCents,
      blackjackPays: rules.blackjackPays,
      dealerHitsSoft17: rules.dealerHitsSoft17,
      phase: r ? r.phase : "betting",
      roundId: this.data.roundId,
      seats,
      dealer: { cards: dealer, total: settled && r ? handValue(r.dealer).total : r ? handValue([r.dealer[0]]).total : null },
      turn: r?.turn ? { ...r.turn } : null,
      legal,
      insuranceOffered: !!r && r.phase === "insurance" && !!me && !me.insuranceDecided && insuranceCost <= this.balanceCents(),
      insuranceCostCents: insuranceCost,
      shoeLeft: this.shoe.remaining,
      shoeSize: this.rules.decks * 52,
      lastBet: this.data.lastBet,
    };
  }
}

/** Deep equality on plain JSON, ignoring key order (PostgreSQL's jsonb reorders keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function initialStake(r: RoundState, seat: number): number {
  const b = r.bets.find((x) => x.seat === seat);
  return b ? b.betCents + (b.perfectPairsCents ?? 0) + (b.plus3Cents ?? 0) : 0;
}

/** The player's seat in a round: what it staked and got back so far. */
export function playerSeat(r: RoundState | null) {
  return r?.seats.find((s) => s.seat === PLAYER_SEAT) ?? null;
}

/**
 * Re-plays a recorded round from its dealt cards and decisions and reports
 * whether every seat ends the same way. Used by the back office to check a
 * stored hand.
 */
export function replayRound(r: RoundState): boolean {
  let i = 0;
  const src: CardSource = {
    draw: () => {
      if (i >= r.dealt.length) throw new Error("Replay ran out of cards");
      return r.dealt[i++];
    },
  };
  try {
    const x = startRound(r.rules, r.bets, src);
    for (const a of r.actions) {
      if (a.action === "insurance" || a.action === "noInsurance") decideInsurance(x, a.seat, a.action === "insurance", src);
      else act(x, a.seat, a.action, src);
    }
    if (x.phase !== "settled" || i !== r.dealt.length) return false;
    return sameJson(x.seats, r.seats) && sameJson(x.dealer, r.dealer);
  } catch {
    return false;
  }
}
