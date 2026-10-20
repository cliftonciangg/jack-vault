import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { AccountService } from "../src/accounts/accounts.js";
import { createApp } from "../src/api/app.js";
import { loadProfile } from "../src/math/profile.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";

const profile = loadProfile("rtp95");
const rid = () => randomUUID();

function setup(store = new Store()) {
  const svc = new GameService({ profile, store });
  const acc = new AccountService({ store });
  return { svc, acc, store };
}

/** Operator -> distributor (100,000.00) -> agent (5,000.00) -> player (1,000.00). */
function chain(acc: AccountService) {
  const d = acc.createDistributor("dist1", "dist-pass");
  acc.issue(d.id, rid(), 10_000_000);
  const dist = acc.account(d.id);
  const agentView = acc.createChild(dist, "agent1", "agent-pass");
  acc.load(dist, agentView.id, rid(), 500_000);
  const agent = acc.account(agentView.id);
  const playerView = acc.createChild(agent, "player1", "player-pass");
  acc.load(agent, playerView.id, rid(), 100_000);
  return { dist, agent, player: acc.account(playerView.id) };
}

test("distributor -> agent -> player: loads move points and every move is in the ledger", () => {
  const { svc, acc } = setup();
  const { dist, agent, player } = chain(acc);
  assert.equal(acc.balanceOf(acc.account(dist.id)), 10_000_000 - 500_000);
  assert.equal(acc.balanceOf(acc.account(agent.id)), 500_000 - 100_000);
  assert.equal(svc.state(player.id).balanceCents, 100_000);
  assert.equal(agent.role, "AGENT");
  assert.equal(player.role, "PLAYER");

  const ledger = acc.ledger(acc.account(dist.id));
  assert.deepEqual(ledger.map((e) => e.type), ["LOAD", "LOAD", "ISSUE"]);
  assert.equal(ledger[0].from, "agent1");
  assert.equal(ledger[0].to, "player1");
  assert.deepEqual(acc.audit(), { staffBalancesMatchLedger: true, pointsConserved: true, issuedCents: 10_000_000, ledgerEntries: 3 });
  assert.equal(svc.audit().ledgerBalancesMatch, true);
});

test("player logs in with agent-made credentials and plays with the loaded balance; agent redeems", () => {
  const { svc, acc } = setup();
  const { agent, player } = chain(acc);
  assert.throws(() => acc.playerLogin("player1", "wrong-pass"), (e: any) => e.code === "BAD_LOGIN");
  assert.throws(() => acc.playerLogin("agent1", "agent-pass"), (e: any) => e.code === "BAD_LOGIN", "agents can't log into the game");
  assert.throws(() => acc.staffLogin("player1", "player-pass"), (e: any) => e.code === "BAD_LOGIN", "players can't log into the back office");
  assert.throws(() => svc.createSession(player.id, { allowCreate: true }), (e: any) => e.code === "LOGIN_REQUIRED");

  const { token, playerId } = acc.playerLogin("PLAYER1", "player-pass");
  assert.equal(svc.playerForToken(token), player.id);
  assert.equal(svc.state(playerId).username, "player1");
  const r = svc.play(playerId, rid(), "spin", 1000);
  const bal = r.balanceCents;
  assert.equal(bal, 100_000 - 1000 + r.step.winCents);

  const a = acc.account(agent.id);
  assert.throws(() => acc.redeem(a, player.id, rid(), bal + 1), (e: any) => e.code === "INSUFFICIENT_FUNDS");
  const red = acc.redeem(a, player.id, rid(), bal);
  assert.equal(red.balanceCents, 400_000 + bal);
  assert.equal(svc.state(playerId).balanceCents, 0);
  assert.throws(() => svc.play(playerId, rid(), "spin", 25), (e: any) => e.code === "INSUFFICIENT_FUNDS");
  assert.equal(acc.audit().staffBalancesMatchLedger, true);
  assert.equal(svc.audit().ledgerBalancesMatch, true);
});

test("agents can't overspend, act on other agents' players, or move twice on a retry", () => {
  const { acc } = setup();
  const { dist, agent, player } = chain(acc);
  const other = acc.createChild(acc.account(dist.id), "agent2", "agent-pass");
  const a2 = acc.account(other.id);
  assert.throws(() => acc.load(a2, player.id, rid(), 100), (e: any) => e.code === "ACCOUNT_NOT_FOUND");
  assert.throws(() => acc.list(a2, player.id), (e: any) => e.code === "ACCOUNT_NOT_FOUND");

  const a = acc.account(agent.id);
  assert.throws(() => acc.load(a, player.id, rid(), 400_001), (e: any) => e.code === "INSUFFICIENT_FUNDS");
  assert.throws(() => acc.load(a, player.id, rid(), 0), (e: any) => e.code === "BAD_AMOUNT");
  assert.throws(() => acc.load(a, player.id, rid(), 10.5), (e: any) => e.code === "BAD_AMOUNT");

  const id = rid();
  const first = acc.load(a, player.id, id, 5000);
  const again = acc.load(acc.account(agent.id), player.id, id, 5000);
  assert.deepEqual(again, first);
  assert.equal(acc.balanceOf(acc.account(player.id)), 105_000);
  assert.throws(() => acc.load(acc.account(agent.id), player.id, id, 6000), (e: any) => e.code === "IDEMPOTENCY_CONFLICT");

  assert.throws(() => acc.createChild(a, "player1", "whatever1"), (e: any) => e.code === "USERNAME_TAKEN");
  assert.throws(() => acc.createChild(a, "x", "whatever1"), (e: any) => e.code === "BAD_USERNAME");
  assert.throws(() => acc.createChild(a, "player9", "123"), (e: any) => e.code === "BAD_PASSWORD");
  // A distributor sees its agents' players, read-only.
  assert.equal(acc.list(acc.account(dist.id), agent.id)[0].username, "player1");
});

test("disable and password reset end sessions; five bad passwords lock the login", () => {
  const { svc, acc } = setup();
  const { agent, player } = chain(acc);
  const a = acc.account(agent.id);
  const { token } = acc.playerLogin("player1", "player-pass");
  acc.setStatus(acc.account(player.id), "DISABLED");
  assert.throws(() => svc.playerForToken(token), (e: any) => e.code === "UNAUTHORIZED");
  assert.throws(() => acc.playerLogin("player1", "player-pass"), (e: any) => e.code === "ACCOUNT_DISABLED");
  assert.throws(() => acc.load(a, player.id, rid(), 100), (e: any) => e.code === "ACCOUNT_DISABLED");
  acc.redeem(a, player.id, rid(), 100); // coins can still come back out
  acc.setStatus(acc.account(player.id), "ACTIVE");

  const staff = acc.staffLogin("agent1", "agent-pass");
  acc.setPassword(acc.account(agent.id), "new-agent-pass");
  assert.throws(() => acc.staffForToken(staff.token), (e: any) => e.code === "UNAUTHORIZED");
  acc.staffLogin("agent1", "new-agent-pass");

  for (let i = 0; i < 5; i++) assert.throws(() => acc.playerLogin("player1", "nope-nope"), (e: any) => e.code === "BAD_LOGIN");
  assert.throws(() => acc.playerLogin("player1", "player-pass"), (e: any) => e.code === "LOCKED");
});

test("accounts, balances and the ledger survive a restart from the journal", () => {
  const path = join(mkdtempSync(join(tmpdir(), "jv-acc-")), "journal.jsonl");
  const { acc } = setup(new Store(path));
  const { agent, player } = chain(acc);
  const { svc: svc2, acc: acc2 } = setup(new Store(path));
  assert.equal(acc2.balanceOf(acc2.account(agent.id)), 400_000);
  assert.equal(svc2.state(player.id).balanceCents, 100_000);
  assert.equal(acc2.playerLogin("player1", "player-pass").playerId, player.id);
  assert.equal(acc2.audit().pointsConserved, true);
});

test("REST: office login, create, load, redeem, ledger; player login and spin; admin issue", async () => {
  const store = new Store();
  const service = new GameService({ profile, store });
  const accounts = new AccountService({ store });
  const { server } = createApp({ service, accounts, allowPlayerCreate: false, adminKey: "secret" });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text.startsWith("{") ? JSON.parse(text) : text } as { status: number; json: any };
  };
  const adminH = { "x-admin-key": "secret" };
  try {
    const page = await call("GET", "/office");
    assert.equal(page.status, 200);
    assert.match(page.json, /Back office/i);

    assert.equal((await call("POST", "/api/admin/distributors", { username: "boss", password: "boss-pass" })).status, 403);
    const d = (await call("POST", "/api/admin/distributors", { username: "boss", password: "boss-pass" }, adminH)).json;
    assert.equal((await call("POST", `/api/admin/accounts/${d.id}/issue`, { requestId: rid(), amountCents: 2_000_000 }, adminH)).json.balanceCents, 2_000_000);

    assert.equal((await call("POST", "/api/office/login", { username: "boss", password: "nope-nope" })).status, 401);
    const dl = (await call("POST", "/api/office/login", { username: "boss", password: "boss-pass" })).json;
    const dh = { authorization: `Bearer ${dl.token}` };
    assert.equal(dl.account.role, "DISTRIBUTOR");
    const agent = (await call("POST", "/api/office/accounts", { username: "agent7", password: "ag-pass" }, dh)).json
    assert.equal(agent.role, "AGENT");
    assert.equal((await call("POST", `/api/office/accounts/${agent.id}/load`, { requestId: rid(), amountCents: 300_000 }, dh)).json.balanceCents, 1_700_000);

    const al = (await call("POST", "/api/office/login", { username: "agent7", password: "ag-pass" })).json;
    const ah = { authorization: `Bearer ${al.token}` };
    const pl = (await call("POST", "/api/office/accounts", { username: "player7", password: "pl-pass" }, ah)).json;
    assert.equal(pl.role, "PLAYER");
    await call("POST", `/api/office/accounts/${pl.id}/load`, { requestId: rid(), amountCents: 50_000 }, ah);
    assert.equal((await call("GET", "/api/office/me", undefined, ah)).json.balanceCents, 250_000);
    assert.equal((await call("GET", "/api/office/accounts", undefined, ah)).json.accounts[0].balanceCents, 50_000);
    assert.equal((await call("POST", `/api/office/accounts/${pl.id}/load`, { requestId: rid(), amountCents: 50_000 }, dh)).status, 404, "distributor can't load players directly");

    // Guests are off; the player logs in with the agent's credentials.
    assert.equal((await call("POST", "/api/sessions", { playerId: "guest" })).status, 404);
    const login = (await call("POST", "/api/player/login", { username: "player7", password: "pl-pass" })).json;
    assert.equal(login.state.balanceCents, 50_000);
    const ph = { authorization: `Bearer ${login.token}` };
    const spin = (await call("POST", "/api/spin", { requestId: rid(), betCents: 500 }, ph)).json;
    assert.equal(spin.balanceCents, 49_500 + spin.step.winCents);
    let next = spin.nextAction;
    while (next !== "spin") next = (await call("POST", next === "wheel" ? "/api/wheel" : "/api/free-spin", { requestId: rid() }, ph)).json.nextAction;
    assert.equal((await call("GET", "/api/office/me", undefined, ph)).status, 401, "a game token is not a back-office token");

    const bal = (await call("GET", "/api/state", undefined, ph)).json.balanceCents;
    assert.equal((await call("POST", `/api/office/accounts/${pl.id}/redeem`, { requestId: rid(), amountCents: bal }, ah)).json.balanceCents, 250_000 + bal);
    const ledger = (await call("GET", `/api/office/ledger?account=${pl.id}`, undefined, ah)).json.entries;
    assert.deepEqual(ledger.map((e: any) => e.type), ["REDEEM", "LOAD"]);

    await call("POST", "/api/player/logout", {}, ph);
    assert.equal((await call("GET", "/api/state", undefined, ph)).status, 401);
    const audit = (await call("GET", "/api/admin/audit", undefined, adminH)).json;
    assert.equal(audit.ledgerBalancesMatch, true);
    assert.equal(audit.accounts.staffBalancesMatchLedger, true);
    assert.equal(audit.accounts.pointsConserved, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
