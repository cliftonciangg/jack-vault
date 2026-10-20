import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadProfile } from "../src/math/profile.js";
import { wheelWeights } from "../src/math/theoretical.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";
import { freeSpinStops, ScriptedRng, stopFor, wheelDrawFor, wheelStops } from "./helpers.js";

const profile = loadProfile("rtp95");
const rid = () => randomUUID();

function setup(rng = new ScriptedRng(), store = new Store()) {
  const svc = new GameService({ profile, store, rng, startingBalanceCents: 100_000 });
  const { player } = svc.createSession("p1", { allowCreate: true });
  return { svc, rng, store, playerId: player.id };
}

test("spin debits the bet, credits the win, and records the round", () => {
  const { svc, playerId } = setup();
  const r = svc.play(playerId, rid(), "spin", 100);
  assert.equal(r.balanceCents, 100_000 - 100 + r.step.winCents);
  assert.equal(r.round.balanceBeforeCents, 100_000);
  assert.equal(svc.history(playerId)[0].roundId, r.roundId);
  assert.equal(svc.audit().ledgerBalancesMatch, true);
});

test("rejects invalid bets, insufficient funds and unknown sessions", () => {
  const { svc, playerId } = setup();
  assert.throws(() => svc.play(playerId, rid(), "spin", 30), /Bet must be/);
  assert.throws(() => svc.play(playerId, rid(), "spin", -100), /Bet must be/);
  assert.throws(() => svc.playerForToken("nope"), /session/);
  svc.adjustBalance(playerId, rid(), -100_000);
  assert.throws(() => svc.play(playerId, rid(), "spin", 25), (e: any) => e.code === "INSUFFICIENT_FUNDS");
  assert.equal(svc.state(playerId).balanceCents, 0);
});

test("a retried spin with the same requestId is not played or paid twice", () => {
  const { svc, playerId } = setup();
  const id = rid();
  const a = svc.play(playerId, id, "spin", 500);
  const b = svc.play(playerId, id, "spin", 500);
  assert.deepEqual(b, a);
  assert.equal(svc.state(playerId).balanceCents, a.balanceCents);
  assert.equal(svc.history(playerId).length, 1);
  assert.throws(() => svc.play(playerId, id, "spin", 1000), (e: any) => e.code === "IDEMPOTENCY_CONFLICT");
});

test("wallet adjustments are idempotent", () => {
  const { svc, playerId } = setup();
  const id = rid();
  svc.adjustBalance(playerId, id, 5000);
  svc.adjustBalance(playerId, id, 5000);
  assert.equal(svc.state(playerId).balanceCents, 105_000);
});

test("Super Wheel: base spin triggers it, wheel must be spun next, GRAND jackpot pays the pool", () => {
  const rng = new ScriptedRng();
  const { svc, playerId } = setup(rng);
  const bet = 5000;
  rng.queue.push(...wheelStops(profile));
  const s = svc.play(playerId, rid(), "spin", bet);
  assert.equal(s.step.type === "BASE" && s.step.wheelTriggered, true);
  assert.equal(s.nextAction, "wheel");
  assert.equal(s.round.status, "OPEN");
  assert.throws(() => svc.play(playerId, rid(), "spin", bet), (e: any) => e.code === "WRONG_ACTION");

  const grandSeg = profile.wheel.segments.findIndex((x) => x.kind === "JACKPOT" && x.tier === "GRAND");
  const pool = svc.jackpots().GRAND;
  rng.queue.push(wheelDrawFor(wheelWeights(profile, bet), grandSeg));
  const w = svc.play(playerId, rid(), "wheel");
  assert.equal(w.step.type, "WHEEL");
  if (w.step.type !== "WHEEL") return;
  assert.equal(w.step.jackpotTier, "GRAND");
  assert.equal(w.step.jackpotWinCents, pool);
  assert.equal(w.jackpots.GRAND, profile.jackpots.GRAND.seedCents);
  assert.equal(w.round.status, "COMPLETE");
  assert.equal(w.balanceCents, 100_000 - bet + s.step.winCents + pool);
  const audit = svc.audit();
  assert.equal(audit.ledgerBalancesMatch, true);
  assert.equal(Object.values(audit.jackpotsReconcile).every(Boolean), true);
});

test("free spins: triggered by scatters, played one request at a time, total adds up, replay verifies", () => {
  const rng = new ScriptedRng();
  const { svc, playerId } = setup(rng);
  rng.queue.push(...freeSpinStops(profile));
  const s = svc.play(playerId, rid(), "spin", 250);
  assert.equal(s.nextAction, "freeSpin");
  assert.equal(s.round.pending.freeSpins?.remaining, profile.freeSpins.spinsAwarded);

  let last = s;
  let n = 0;
  while (last.nextAction === "freeSpin") {
    last = svc.play(playerId, rid(), "freeSpin");
    n++;
    assert.equal(last.step.type, "FREE");
    assert.ok(n < 500);
  }
  assert.equal(n, last.round.pending.freeSpins?.awarded);
  assert.equal(last.round.status, "COMPLETE");
  assert.equal(last.round.totalWinCents, last.round.steps.reduce((a, x) => a + x.winCents, 0));
  assert.equal(last.balanceCents, 100_000 - 250 + last.round.totalWinCents);
  assert.ok(last.round.steps.slice(1).every((x) => x.type === "FREE" && x.multiplier === profile.freeSpins.multiplier));

  const rep = svc.replay(playerId, s.roundId);
  assert.equal(rep.verified, true);
  assert.equal(rep.steps.length, n + 1);
});

test("replay detects a tampered round record", () => {
  const { svc, store, playerId } = setup();
  const r = svc.play(playerId, rid(), "spin", 100);
  const stored = store.rounds.get(r.roundId)!;
  const step = stored.steps[0];
  if (step.type !== "WHEEL") step.winCents += 1000;
  assert.equal(svc.replay(playerId, r.roundId).verified, false);
});

test("an unfinished round survives a restart from the journal", () => {
  const journal = join(mkdtempSync(join(tmpdir(), "jv-")), "journal.jsonl");
  const rng = new ScriptedRng();
  const a = setup(rng, new Store(journal));
  rng.queue.push(...freeSpinStops(profile));
  const s = a.svc.play(a.playerId, rid(), "spin", 100);
  a.svc.play(a.playerId, rid(), "freeSpin");

  const store2 = new Store(journal);
  const svc2 = new GameService({ profile, store: store2, rng: new ScriptedRng() });
  const st = svc2.state(a.playerId);
  assert.equal(st.balanceCents, a.svc.state(a.playerId).balanceCents);
  assert.equal(st.nextAction, "freeSpin");
  assert.equal(st.openRound?.roundId, s.roundId);
  assert.deepEqual(svc2.jackpots(), a.svc.jackpots());
  const next = svc2.play(a.playerId, rid(), "freeSpin");
  assert.equal(next.roundId, s.roundId);
  assert.equal(svc2.audit().ledgerBalancesMatch, true);
});

test("history pages newest first", () => {
  const { svc, playerId } = setup(new ScriptedRng());
  const stops = profile.reels.base.map((s) => stopFor(s, null));
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    (svc as any).rng.queue.push(...stops);
    ids.push(svc.play(playerId, rid(), "spin", 25).roundId);
  }
  const page1 = svc.history(playerId, 2);
  assert.deepEqual(page1.map((r) => r.roundId), [ids[4], ids[3]]);
  const page2 = svc.history(playerId, 2, ids[3]);
  assert.deepEqual(page2.map((r) => r.roundId), [ids[2], ids[1]]);
});
