import { createHash } from "node:crypto";
import type { Rng } from "../rng/rng.js";

/**
 * A card is an integer 0..51: rank = card % 13 + 1 (1 = Ace, 11-13 = J, Q, K),
 * suit = floor(card / 13) (0 spades, 1 hearts, 2 diamonds, 3 clubs).
 * Plain numbers keep shoes cheap to shuffle, store and hash.
 */
export type Card = number;

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];

export const rankOf = (c: Card) => (c % 13) + 1;
export const suitOf = (c: Card) => Math.floor(c / 13);
export const isRed = (c: Card) => suitOf(c) === 1 || suitOf(c) === 2;
/** Blackjack value with Ace as 1: 2-10 face value, J/Q/K 10. */
export const pointsOf = (c: Card) => Math.min(rankOf(c), 10);
export const cardLabel = (c: Card) => RANKS[c % 13] + SUITS[suitOf(c)];

export interface HandValue {
  total: number;
  /** An Ace is counted as 11 in `total`. */
  soft: boolean;
}

export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const p = pointsOf(c);
    total += p;
    if (p === 1) aces++;
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Two-card 21. Whether it counts as a natural (not after a split) is the engine's call. */
export const isTwentyOne2 = (cards: readonly Card[]) => cards.length === 2 && handValue(cards).total === 21;

export interface SavedShoe {
  cards: Card[];
  pos: number;
  shuffles: number;
}

/**
 * A shoe of `decks` decks, shuffled with Fisher-Yates from the given RNG and
 * reshuffled once `penetration` of it has been dealt (checked between rounds).
 */
export class Shoe {
  cards: Card[] = [];
  pos = 0;
  /** Bumped on every shuffle, so a round can name the shoe it was dealt from. */
  shuffles = 0;
  readonly cutAt: number;

  constructor(
    readonly decks: number,
    readonly penetration: number,
    private readonly rng: Rng,
    saved?: SavedShoe,
  ) {
    this.cutAt = Math.floor(decks * 52 * penetration);
    if (saved && saved.cards.length === decks * 52) {
      this.cards = [...saved.cards];
      this.pos = saved.pos;
      this.shuffles = saved.shuffles;
    } else this.shuffle();
  }

  /** The shoe's order and position, to store with a table and pick up after a restart. */
  save(): SavedShoe {
    return { cards: [...this.cards], pos: this.pos, shuffles: this.shuffles };
  }

  shuffle(): void {
    const n = this.decks * 52;
    const a: Card[] = new Array(n);
    for (let i = 0; i < n; i++) a[i] = i % 52;
    for (let i = n - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    this.cards = a;
    this.pos = 0;
    this.shuffles++;
  }

  draw(): Card {
    // A round never runs a 6-deck shoe dry from the cut, but stay safe on tiny test shoes.
    if (this.pos >= this.cards.length) throw new Error("Shoe is empty");
    return this.cards[this.pos++];
  }

  get remaining(): number {
    return this.cards.length - this.pos;
  }

  /** True once the cut card is out; the table reshuffles before the next round. */
  get needsShuffle(): boolean {
    return this.pos >= this.cutAt;
  }

  /** SHA-256 of the shuffled order, so a shoe can be committed to before dealing and checked after. */
  hash(): string {
    return createHash("sha256").update(Uint8Array.from(this.cards)).digest("hex");
  }
}
