import { type Card, handValue, pointsOf } from "./cards.js";
import type { Action } from "./engine.js";
import type { BlackjackRules } from "./rules.js";

/**
 * Multi-deck basic strategy (dealer peeks), with the H17 and no-DAS changes.
 * Bots play it, and the simulator uses it to measure each rule set's house
 * edge. Insurance is always declined.
 *
 * Codes: H hit, S stand, D double else hit, Ds double else stand, P split,
 * R surrender else hit.
 */
type Code = "H" | "S" | "D" | "Ds" | "P" | "R";

/** Dealer up card as 2..11 (Ace = 11). */
const upValue = (c: Card) => (pointsOf(c) === 1 ? 11 : pointsOf(c));
const between = (u: number, lo: number, hi: number) => u >= lo && u <= hi;

function pairCode(p: number, u: number, das: boolean): Code | null {
  switch (p) {
    case 1:
    case 8:
      return "P";
    case 10:
    case 5:
      return null; // play as a hard total
    case 9:
      return between(u, 2, 6) || u === 8 || u === 9 ? "P" : "S";
    case 7:
      return u <= 7 ? "P" : null;
    case 6:
      return (das ? between(u, 2, 6) : between(u, 3, 6)) ? "P" : null;
    case 4:
      return das && between(u, 5, 6) ? "P" : null;
    default: // 2, 3
      return (das ? between(u, 2, 7) : between(u, 4, 7)) ? "P" : null;
  }
}

function softCode(t: number, u: number, h17: boolean): Code {
  if (t >= 20) return "S";
  if (t === 19) return h17 && u === 6 ? "Ds" : "S";
  if (t === 18) {
    if (between(u, 3, 6) || (h17 && u === 2)) return "Ds";
    if (u <= 8) return "S";
    return "H";
  }
  if (t === 17) return between(u, 3, 6) ? "D" : "H";
  if (t >= 15) return between(u, 4, 6) ? "D" : "H";
  return between(u, 5, 6) ? "D" : "H"; // soft 13-14
}

function hardCode(t: number, u: number, h17: boolean, canSurrender: boolean): Code {
  if (canSurrender) {
    if (t === 16 && u >= 9) return "R";
    if (t === 15 && (u === 10 || (h17 && u === 11))) return "R";
    if (t === 17 && h17 && u === 11) return "R";
  }
  if (t >= 17) return "S";
  if (t >= 13) return u <= 6 ? "S" : "H";
  if (t === 12) return between(u, 4, 6) ? "S" : "H";
  if (t === 11) return u === 11 && !h17 ? "H" : "D";
  if (t === 10) return u <= 9 ? "D" : "H";
  if (t === 9) return between(u, 3, 6) ? "D" : "H";
  return "H";
}

export function basicStrategy(rules: BlackjackRules, cards: readonly Card[], up: Card, legal: readonly Action[]): Action {
  const u = upValue(up);
  const can = (a: Action) => legal.includes(a);
  if (can("split")) {
    const code = pairCode(pointsOf(cards[0]), u, rules.doubleAfterSplit);
    if (code === "P") return "split";
    if (code === "S") return "stand";
  }
  if (!can("hit")) return "stand"; // split Aces
  const v = handValue(cards);
  const code = v.soft ? softCode(v.total, u, rules.dealerHitsSoft17) : hardCode(v.total, u, rules.dealerHitsSoft17, can("surrender"));
  switch (code) {
    case "D":
      return can("double") ? "double" : "hit";
    case "Ds":
      return can("double") ? "double" : "stand";
    case "R":
      return can("surrender") ? "surrender" : "hit";
    case "S":
      return "stand";
    default:
      return "hit";
  }
}
