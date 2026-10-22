import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadProfile } from "../src/math/profile.js";
import { SeededRng } from "../src/rng/rng.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";
import type { BjResponse } from "../src/blackjack/service.js";
import { PLAYER_SEAT, Table, newTable, replayRound } from "../src/blackjack/table.js";

const profile = loadProfile("rtp95");
const rid = () => randomUUID();

function setup(o: { store?: Store; seed?: number; balance?: number; clock?: { t: number } } = {}) {
  const clock = o.clock ?? { t: Date.parse("2026-10-22T12:00:00Z") };
  const svc = new GameService({
    profile,
    store: o.store ?? new Store(),
    rng: new SeededRng(o.seed ?? 5),
    startingBalanceCents: o.balance ?? 100_000,
    now: () => new Date(clock.t),
  });
  const playerId = o.store?.players.has("p1") ? "p1" : svc.createSession("p1", { allowCreate: true }).player.id;
  return { svc, bj: svc.blackjack, playerId, clock };
}

/** Plays the open hand to the end: declines insurance, stands on everything. */
function finish(bj: GameService["blackjack"], playerId: string, r: BjResponse): BjResponse {
  while (r.view.phase !== "settled") {
    r = r.view.insuranceOffered ? bj.insurance(playerId, rid(), false) : bj.action(playerId, rid(), "stand");
  }
  return r;
}

test("a table seats the player in the middle with four bots, and a bet deals to every seat that sat in", () => {
  const data = newTable("standard", new SeededRng(1), "2026-10-22T00:00:00Z");
  const t = new Table(data, new SeededRng(2));
  assert.equal(data.bots.length, 4);
  assert.ok(data.bots.every((b) => b.seat !== PLAYER_SEAT));
  assert.equal(t.view().phase, "betting");
  const frames = t.bet({ betCents: 500 }, "r1");
  const deal = frames.find((f) => f.event.type === "deal")!;
  const me = deal.view.seats[PLAYER_SEAT];
  assert.equal(me.hands[0].cards.length, 2);
  assert.equal(deal.view.dealer.cards.length, 2);
  // The hole card stays hidden until the hand is over.
  const last = frames[frames.length - 1].view;
  if (last.phase !== "settled") assert.equal(last.dealer.cards[1], null);
  else assert.notEqual(last.dealer.cards[1], null);
  // Seats before the player have all acted by the time the player is asked.
  if (last.phase === "players") assert.deepEqual(last.turn, { seat: PLAYER_SEAT, hand: 0 });
});

test("the wallet pays for every hand exactly: stake out, winnings in, ledger balanced", () => {
  const { svc, bj, playerId } = setup();
  let balance = 100_000;
  for (let i = 0; i < 300; i++) {
    const first = bj.bet(playerId, rid(), { betCents: 100 + (i % 10) * 100, perfectPairsCents: i % 3 === 0 ? 100 : 0, plus3Cents: i % 4 === 0 ? 200 : 0 });
    const end = finish(bj, playerId, first);
    const me = end.view.seats[PLAYER_SEAT];
    balance += me.returnCents - me.stakeCents;
    assert.equal(end.balanceCents, balance, `hand ${i}`);
    const rec = svc.blackjack.round(end.roundId!)!;
    assert.equal(rec.status, "COMPLETE");
    assert.equal(rec.verified, true, `replay of hand ${i}`);
    assert.equal(rec.balanceAfterCents, balance);
  }
  assert.equal(svc.state(playerId).balanceCents, balance);
  assert.equal(svc.audit().ledgerBalancesMatch, true);
  const totals = bj.totals([playerId]);
  assert.equal(totals.rounds, 300);
  assert.equal(100_000 - totals.betCents + totals.winCents, balance);
});

test("doubling and splitting take the extra stake when made", () => {
  // Find a hand where the player may double, then double it.
  const { bj, playerId } = setup({ seed: 9 });
  for (let i = 0; i < 200; i++) {
    let r = bj.bet(playerId, rid(), { betCents: 300 });
    if (r.view.insuranceOffered) r = bj.insurance(playerId, rid(), false);
    if (r.view.legal.includes("double")) {
      const before = r.balanceCents;
      const after = bj.action(playerId, rid(), "double");
      const me = after.view.seats[PLAYER_SEAT];
      assert.equal(me.stakeCents, 600);
      assert.equal(after.balanceCents, before - 300 + me.returnCents);
      return;
    }
    finish(bj, playerId, r);
  }
  assert.fail("never got a hand to double");
});

test("a retried request is answered from the first result and moves no money twice", () => {
  const { svc, bj, playerId } = setup();
  const id = rid();
  const a = bj.bet(playerId, id, { betCents: 500 });
  const b = bj.bet(playerId, id, { betCents: 500 });
  assert.deepEqual(b, a);
  assert.throws(() => bj.bet(playerId, id, { betCents: 600 }), (e: any) => e.code === "IDEMPOTENCY_CONFLICT");
  finish(bj, playerId, a);
  assert.equal(svc.audit().ledgerBalancesMatch, true);
});

test("bets the wallet can't cover, bets off the limits and moves out of turn are refused without changes", () => {
  const { svc, bj, playerId } = setup({ balance: 250 });
  assert.throws(() => bj.bet(playerId, rid(), { betCents: 300 }), (e: any) => e.code === "INSUFFICIENT_FUNDS");
  assert.throws(() => bj.bet(playerId, rid(), { betCents: 1_100 }), (e: any) => e.code === "INVALID_BET");
  assert.throws(() => bj.bet(playerId, rid(), { betCents: 100, plus3Cents: 600 }), (e: any) => e.code === "INVALID_BET");
  assert.throws(() => bj.action(playerId, rid(), "hit"), (e: any) => e.code === "WRONG_PHASE");
  assert.throws(() => bj.action(playerId, rid(), "fold"), (e: any) => e.code === "BAD_ACTION");
  assert.equal(svc.state(playerId).balanceCents, 250);
  assert.equal(bj.table(playerId).view.phase, "betting");
  // 2.50 covers a 2.00 bet but not a double or split of it.
  for (let i = 0; i < 50; i++) {
    const r = bj.bet(playerId, rid(), { betCents: 200 });
    assert.ok(!r.view.legal.includes("double") && !r.view.legal.includes("split"));
    const end = finish(bj, playerId, r);
    if (end.balanceCents < 200) break;
  }
});

test("maintenance mode stops new hands", () => {
  const { svc, bj, playerId } = setup();
  svc.updateSettings({ maintenance: { on: true, message: "Back soon" } }, "operator");
  assert.throws(() => bj.bet(playerId, rid(), { betCents: 100 }), (e: any) => e.code === "MAINTENANCE");
});

test("a hand left waiting on the player is finished for them after the timeout", () => {
  const { svc, bj, playerId, clock } = setup({ seed: 3 });
  let open: BjResponse | null = null;
  for (let i = 0; i < 50 && !open; i++) {
    const r = bj.bet(playerId, rid(), { betCents: 200 });
    if (r.view.phase === "settled") continue;
    open = r;
  }
  assert.ok(open);
  assert.equal(bj.expireStale(), 0);
  clock.t += 61_000;
  assert.equal(bj.expireStale(), 1);
  const t = bj.table(playerId);
  assert.equal(t.view.phase, "settled");
  const rec = bj.round(open.roundId!)!;
  assert.equal(rec.status, "COMPLETE");
  assert.equal(rec.verified, true);
  assert.equal(svc.audit().ledgerBalancesMatch, true);
});

test("an open hand survives a restart and finishes on the same shoe", () => {
  const dir = mkdtempSync(join(tmpdir(), "bj-"));
  const journal = join(dir, "journal.jsonl");
  const first = setup({ store: new Store(journal), seed: 4 });
  let open: BjResponse | null = null;
  for (let i = 0; i < 50 && !open; i++) {
    const r = first.bj.bet(first.playerId, rid(), { betCents: 200 });
    if (r.view.phase !== "settled") open = r;
  }
  assert.ok(open);
  const again = setup({ store: new Store(journal), seed: 77 });
  const t = again.bj.table(again.playerId);
  assert.equal(t.view.roundId, open.roundId);
  assert.equal(t.view.shoeLeft, open.view.shoeLeft);
  assert.deepEqual(t.view.seats[PLAYER_SEAT].hands, open.view.seats[PLAYER_SEAT].hands);
  const end = finish(again.bj, again.playerId, { ...open, view: t.view });
  assert.equal(end.roundId, open.roundId);
  assert.equal(again.svc.audit().ledgerBalancesMatch, true);
  assert.equal(again.bj.round(open.roundId!)!.verified, true);
});

test("replay catches a tampered hand", () => {
  const { bj, playerId } = setup();
  const end = finish(bj, playerId, bj.bet(playerId, rid(), { betCents: 500 }));
  const rec = bj.round(end.roundId!)!;
  assert.equal(replayRound(rec.round), true);
  const forged = structuredClone(rec.round);
  forged.seats.find((s) => s.seat === PLAYER_SEAT)!.returnCents += 1000;
  assert.equal(replayRound(forged), false);
});
