import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import pg from "pg";
import { AccountService } from "../src/accounts/accounts.js";
import { createApp } from "../src/api/app.js";
import { loadProfile } from "../src/math/profile.js";
import { GameService } from "../src/service/gameService.js";
import { PgStore } from "../src/store/pgStore.js";
import { freeSpinStops, ScriptedRng, wheelStops } from "./helpers.js";

/**
 * Runs against a real PostgreSQL when TEST_DATABASE_URL is set, e.g.
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/jackvault_test npm test
 * The tests drop and recreate the game tables in that database.
 */
const url = process.env.TEST_DATABASE_URL;
const profile = loadProfile("rtp95");
const rid = () => randomUUID();
const TABLES = ["players", "txs", "rounds", "jackpots", "sessions", "staff_sessions", "idempotency", "accounts", "ledger", "settings", "change_log"];

async function resetDb() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")}`);
  await c.end();
}

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const opts = { skip: url ? false : "set TEST_DATABASE_URL to run PostgreSQL tests" };

test("PostgreSQL: everything survives a restart, and only one server may hold the database", opts, async () => {
  await resetDb();
  const store = await PgStore.open({ connectionString: url!, onFatal: () => undefined });
  const rng = new ScriptedRng();
  const svc = new GameService({ profile, store, rng });
  const acc = new AccountService({ store });

  const dist = acc.seed("dist1", "secret123", 1_000_000)!;
  const distAcc = acc.account(dist.id);
  const agent = acc.createChild(distAcc, "agent1", "secret123");
  acc.load(distAcc, agent.id, rid(), 500_000);
  const agentAcc = acc.account(agent.id);
  const player = acc.createChild(agentAcc, "player1", "secret123");
  acc.load(agentAcc, player.id, rid(), 100_000);
  const { token } = acc.playerLogin("player1", "secret123");
  const playerId = svc.playerForToken(token);

  // A wheel round, then a free-spins round left half played.
  rng.queue.push(...wheelStops(profile));
  svc.play(playerId, rid(), "spin", 5000);
  const wheel = svc.play(playerId, rid(), "wheel");
  rng.queue.push(...freeSpinStops(profile));
  const fs = svc.play(playerId, rid(), "spin", 250);
  svc.play(playerId, rid(), "freeSpin");
  const retryId = rid();
  const last = svc.play(playerId, retryId, "freeSpin");
  await store.flushed();

  // A second server on the same database is refused while the first runs.
  await assert.rejects(PgStore.open({ connectionString: url! }), /already using this database/);

  const before = {
    state: svc.state(playerId),
    jackpots: svc.jackpots(),
    history: svc.history(playerId),
    agent: acc.view(acc.account(agent.id)),
    ledger: acc.ledger(distAcc).length,
  };
  await store.close();

  const rows = await sql<{ n: string }>("SELECT count(*) AS n FROM rounds");
  assert.equal(Number(rows[0].n), 2);
  const bal = await sql<{ balance_cents: string }>("SELECT balance_cents FROM players WHERE id = $1", [playerId]);
  assert.equal(Number(bal[0].balance_cents), before.state.balanceCents);

  const store2 = await PgStore.open({ connectionString: url!, onFatal: () => undefined });
  try {
    const svc2 = new GameService({ profile, store: store2, rng: new ScriptedRng() });
    const acc2 = new AccountService({ store: store2 });
    assert.deepEqual(svc2.state(playerId), before.state);
    assert.deepEqual(svc2.jackpots(), before.jackpots);
    assert.deepEqual(svc2.history(playerId), before.history);
    assert.deepEqual(acc2.view(acc2.account(agent.id)), before.agent);
    assert.equal(acc2.ledger(acc2.account(dist.id)).length, before.ledger);
    assert.equal(svc2.playerForToken(token), playerId, "game sessions survive");
    assert.equal(acc2.staffLogin("agent1", "secret123").account.id, agent.id, "passwords survive");

    // The retried request still returns the stored response, and the open round continues.
    assert.deepEqual(svc2.play(playerId, retryId, "freeSpin"), last);
    assert.equal(svc2.state(playerId).nextAction, "freeSpin");
    const next = svc2.play(playerId, rid(), "freeSpin");
    assert.equal(next.roundId, fs.roundId);
    assert.equal(svc2.replay(playerId, wheel.roundId).verified, true);

    const audit = svc2.audit();
    assert.equal(audit.ledgerBalancesMatch, true);
    assert.ok(Object.values(audit.jackpotsReconcile).every(Boolean));
    assert.deepEqual(
      { staff: acc2.audit().staffBalancesMatchLedger, conserved: acc2.audit().pointsConserved },
      { staff: true, conserved: true },
    );

    // Logout deletes the session row.
    acc2.logout(token);
    await store2.flushed();
    assert.equal((await sql("SELECT 1 FROM sessions WHERE token = $1", [token])).length, 0);
  } finally {
    await store2.close();
  }
});

test("PostgreSQL: the API answers only after the round is in the database", opts, async () => {
  await resetDb();
  const store = await PgStore.open({ connectionString: url!, onFatal: () => undefined });
  const service = new GameService({ profile, store, startingBalanceCents: 100_000 });
  const { server, wss } = createApp({ service, allowPlayerCreate: true, store });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = async (path: string, body: unknown, token?: string) =>
      (
        await fetch(base + path, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        })
      ).json() as Promise<any>;
    const { token } = await post("/api/sessions", { playerId: "guest1" });
    for (let i = 0; i < 20; i++) {
      const r = await post("/api/spin", { requestId: rid(), betCents: 100 }, token);
      const row = await sql<{ status: string }>("SELECT status FROM rounds WHERE round_id = $1", [r.roundId]);
      assert.equal(row.length, 1, "round is durable before the response arrives");
      const p = await sql<{ balance_cents: string }>("SELECT balance_cents FROM players WHERE id = 'guest1'");
      assert.equal(Number(p[0].balance_cents), r.balanceCents);
      let next = r.nextAction;
      while (next !== "spin") next = (await post(next === "wheel" ? "/api/wheel" : "/api/free-spin", { requestId: rid() }, token)).nextAction;
    }
  } finally {
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
    await store.close();
  }
});

test("PostgreSQL: a failed write stops the server instead of carrying on", opts, async () => {
  await resetDb();
  let fatal: unknown = null;
  const store = await PgStore.open({ connectionString: url!, onFatal: (e) => (fatal = e) });
  const svc = new GameService({ profile, store, startingBalanceCents: 1000 });
  svc.createSession("p1", { allowCreate: true });
  await store.flushed();
  // Break the database under the running server.
  await sql("ALTER TABLE rounds ADD CONSTRAINT no_rounds CHECK (false) NOT VALID");
  svc.play("p1", rid(), "spin", 25);
  await assert.rejects(store.flushed());
  assert.ok(fatal);
  assert.throws(() => svc.play("p1", rid(), "spin", 25), /Database unavailable/);
  await store.close().catch(() => undefined);
});

test("PostgreSQL: win-ratio settings, change log and operator logins survive a restart", opts, async () => {
  await resetDb();
  const profiles = ["rtp94", "rtp95", "rtp96"].map(loadProfile);
  let store = await PgStore.open({ connectionString: url!, onFatal: () => undefined });
  let svc = new GameService({ profile, profiles, store });
  let acc = new AccountService({ store });
  const op = acc.createOperator("op1", "op-pass-1");
  const d = acc.createDistributor("dist1", "secret123");
  svc.setDistributorProfile(d.id, "rtp94", op.id, { allowedOnly: false });
  svc.updateSettings({ allowedProfileIds: ["rtp94"], maintenance: { on: true, message: "Back soon" } }, op.id);
  const login = acc.staffLogin("op1", "op-pass-1", "operator", { ip: "10.0.0.1", userAgent: "test" });
  await store.close();

  store = await PgStore.open({ connectionString: url!, onFatal: () => undefined });
  svc = new GameService({ profile, profiles, store });
  acc = new AccountService({ store });
  try {
    assert.equal(svc.distributorProfileId(d.id), "rtp94");
    assert.deepEqual(svc.settings(), { defaultProfileId: "rtp95", allowedProfileIds: ["rtp94"], maintenance: { on: true, message: "Back soon" } });
    assert.deepEqual(svc.changes().map((c) => c.kind), ["MAINTENANCE", "ALLOWED_PROFILES", "DISTRIBUTOR_PROFILE"]);
    const me = acc.staffForToken(login.token);
    assert.equal(me.role, "OPERATOR");
    assert.ok(me.lastLoginAt);
    assert.equal(acc.sessions(me, login.token)[0].ip, "10.0.0.1");
  } finally {
    await store.close();
  }
});
