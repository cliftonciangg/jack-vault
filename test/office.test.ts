import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { AccountService } from "../src/accounts/accounts.js";
import { createApp } from "../src/api/app.js";
import { listProfiles, loadProfile } from "../src/math/profile.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";
import { ScriptedRng, wheelStops } from "./helpers.js";

/** Back-office API: operator logins, own account, reports, game records, win ratio, game settings. */

const rid = () => randomUUID();

async function start(rng?: ScriptedRng) {
  const store = new Store();
  const service = new GameService({ profile: loadProfile("rtp95"), profiles: listProfiles().map(loadProfile), store, rng });
  const accounts = new AccountService({ store, profileFor: (id) => service.distributorProfileId(id) });
  accounts.createOperator("op1", "op-pass-1");
  const { server, wss } = createApp({ service, accounts, allowPlayerCreate: false, adminKey: "secret" });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const login = async (username: string, password: string, portal: "staff" | "operator" = "staff") => {
    const r = await call("POST", "/api/office/login", { username, password, portal });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.token as string;
  };
  const close = () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
    return new Promise<void>((r) => server.close(() => r()));
  };
  return { base, store, service, accounts, call, login, close };
}

/** Operator creates dist1 (50,000.00 points), dist1 creates agent1 (5,000.00), agent1 creates player1 (100.00). */
async function chain(t: Awaited<ReturnType<typeof start>>) {
  const op = await t.login("op1", "op-pass-1", "operator");
  const d = await t.call("POST", "/api/office/accounts", { username: "dist1", password: "dist-pass", startingCents: 5_000_000 }, op);
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const dist = await t.login("dist1", "dist-pass");
  const a = await t.call("POST", "/api/office/accounts", { username: "agent1", password: "agent-pass", startingCents: 500_000 }, dist);
  assert.equal(a.status, 201);
  const agent = await t.login("agent1", "agent-pass");
  const p = await t.call("POST", "/api/office/accounts", { username: "player1", password: "player-pass", startingCents: 10_000 }, agent);
  assert.equal(p.status, 201);
  return { op, dist, agent, distId: d.json.id as string, agentId: a.json.id as string, playerId: p.json.id as string };
}

test("operator logs in on the operator tab only, creates and funds distributors", async () => {
  const t = await start();
  try {
    assert.equal((await t.call("POST", "/api/office/login", { username: "op1", password: "op-pass-1" })).status, 401, "not on the staff tab");
    const { op, dist, distId } = await chain(t);
    assert.equal((await t.call("POST", "/api/office/login", { username: "dist1", password: "dist-pass", portal: "operator" })).status, 401);

    const me = (await t.call("GET", "/api/office/me", undefined, op)).json;
    assert.equal(me.role, "OPERATOR");
    assert.ok(me.lastLoginAt);
    const list = (await t.call("GET", "/api/office/accounts", undefined, op)).json.accounts;
    assert.deepEqual(list.map((a: any) => a.username), ["dist1"]);
    assert.equal(list[0].balanceCents, 4_500_000);
    assert.equal(list[0].profileId, "rtp95");

    // Issue with a note, then take back; only the operator may.
    const issue = await t.call("POST", `/api/office/accounts/${distId}/issue`, { requestId: rid(), amountCents: 100_000, note: "October top-up" }, op);
    assert.equal(issue.status, 200);
    assert.equal(issue.json.balanceCents, 4_600_000);
    assert.equal(issue.json.entry.note, "October top-up");
    const back = await t.call("POST", `/api/office/accounts/${distId}/revoke`, { requestId: rid(), amountCents: 200_000 }, op);
    assert.equal(back.json.entry.type, "REVOKE");
    assert.equal(back.json.balanceCents, 4_400_000);
    assert.equal((await t.call("POST", `/api/office/accounts/${distId}/issue`, { requestId: rid(), amountCents: 100 }, dist)).status, 404, "a distributor isn't its own parent");
    assert.equal((await t.call("POST", `/api/office/accounts/${distId}/load`, { requestId: rid(), amountCents: 100 }, op)).status, 403);

    // The operator sees every entry, with roles; type and date filters apply.
    const all = (await t.call("GET", "/api/office/ledger", undefined, op)).json.entries;
    assert.deepEqual(all.map((e: any) => e.type), ["REVOKE", "ISSUE", "LOAD", "LOAD", "ISSUE"]);
    assert.equal(all[1].actor, "op1");
    assert.equal(all[1].fromRole, "OPERATOR");
    assert.equal(all[2].toRole, "PLAYER");
    const issues = (await t.call("GET", "/api/office/ledger?type=ISSUE,REVOKE", undefined, op)).json.entries;
    assert.equal(issues.length, 3);
    const future = new Date(Date.now() + 3600_000).toISOString();
    assert.equal((await t.call("GET", `/api/office/ledger?from=${future}`, undefined, op)).json.entries.length, 0);
    assert.equal((await t.call("GET", "/api/office/ledger?type=BOGUS", undefined, op)).status, 400);
    assert.equal((await t.call("GET", "/api/office/ledger?account=dist1&type=REVOKE", undefined, op)).json.entries.length, 1, "account by username");

    // Platform totals and audit.
    const sum = (await t.call("GET", "/api/office/summary", undefined, op)).json;
    assert.equal(sum.platform.issuedCents, 5_100_000);
    assert.equal(sum.platform.revokedCents, 200_000);
    assert.equal(sum.platform.heldByDistributorsCents + sum.platform.heldByAgentsCents + sum.platform.heldByPlayersCents, 4_900_000);
    const audit = (await t.call("GET", "/api/office/audit", undefined, op)).json;
    assert.ok(audit.checks.every((c: any) => c.ok), JSON.stringify(audit.checks));
    assert.equal((await t.call("GET", "/api/office/audit", undefined, dist)).status, 403);
  } finally {
    await t.close();
  }
});

test("own password change, time zone and session list", async () => {
  const t = await start();
  try {
    const { agent } = await chain(t);
    const second = await t.login("agent1", "agent-pass");
    const sessions = (await t.call("GET", "/api/office/me/sessions", undefined, agent)).json.sessions;
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((s: any) => s.current).length, 1);
    assert.ok(!JSON.stringify(sessions).includes(second), "tokens are never listed");

    const pw = (body: unknown) => t.call("POST", "/api/office/me/password", body, agent);
    assert.equal((await pw({ currentPassword: "nope", newPassword: "Strong-pass-1" })).status, 403);
    assert.equal((await pw({ currentPassword: "agent-pass", newPassword: "weakpass" })).json.error.code, "WEAK_PASSWORD");
    assert.equal((await pw({ currentPassword: "agent-pass", newPassword: "Strong-pass-1" })).status, 200);
    assert.equal((await t.call("GET", "/api/office/me", undefined, second)).status, 401, "other sessions are logged out");
    assert.equal((await t.call("GET", "/api/office/me", undefined, agent)).status, 200, "this session stays");
    assert.equal((await t.call("POST", "/api/office/login", { username: "agent1", password: "agent-pass" })).status, 401);
    await t.login("agent1", "Strong-pass-1");

    assert.equal((await t.call("POST", "/api/office/me/prefs", { timeZone: "Mars/Olympus" }, agent)).status, 400);
    assert.equal((await t.call("POST", "/api/office/me/prefs", { timeZone: "America/New_York" }, agent)).status, 200);
    assert.equal((await t.call("GET", "/api/office/me", undefined, agent)).json.timeZone, "America/New_York");

    assert.equal((await t.call("POST", "/api/office/me/sessions/logout-others", {}, agent)).json.loggedOut, 1);
    assert.equal((await t.call("GET", "/api/office/me/sessions", undefined, agent)).json.sessions.length, 1);

    // Five wrong passwords lock the username, and the parent sees it.
    for (let i = 0; i < 5; i++) await t.call("POST", "/api/office/login", { username: "agent1", password: "wrong" });
    const dist = (await t.call("GET", "/api/office/accounts", undefined, await t.login("dist1", "dist-pass"))).json.accounts;
    assert.equal(dist[0].locked, true);
  } finally {
    await t.close();
  }
});

test("period summary, daily series and scoped game records", async () => {
  const t = await start();
  try {
    const { dist, agent, agentId, playerId, op } = await chain(t);
    await t.call("POST", `/api/office/accounts/${playerId}/redeem`, { requestId: rid(), amountCents: 2_500 }, agent);
    const tok = (await t.call("POST", "/api/player/login", { username: "player1", password: "player-pass" })).json.token;
    for (let i = 0; i < 3; i++) {
      const r = await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      while (r.json.nextAction !== "spin") {
        r.json = (await t.call("POST", r.json.nextAction === "wheel" ? "/api/wheel" : "/api/free-spin", { requestId: rid() }, tok)).json;
      }
    }

    const a = (await t.call("GET", "/api/office/summary", undefined, agent)).json;
    assert.equal(a.me.loadedCents, 10_000);
    assert.equal(a.me.redeemedCents, 2_500);
    assert.equal(a.me.receivedCents, 500_000);
    assert.equal(a.children.length, 1);
    assert.equal(a.children[0].receivedCents, 10_000);
    assert.equal(a.children[0].returnedCents, 2_500);
    assert.equal(a.children[0].play.rounds, 3);
    assert.equal(a.children[0].play.betCents, 75);
    assert.ok(a.children[0].play.expectedWinCents > 60 && a.children[0].play.expectedWinCents < 75);

    const d = (await t.call("GET", "/api/office/summary", undefined, dist)).json;
    assert.equal(d.children[0].username, "agent1");
    assert.equal(d.children[0].loadedCents, 10_000);
    assert.equal(d.children[0].play.activePlayers, 1);
    assert.equal(d.me.grandchildrenBalanceCents, d.children[0].childrenBalanceCents);
    const drill = (await t.call("GET", `/api/office/summary?parent=${agentId}`, undefined, dist)).json;
    assert.equal(drill.children[0].username, "player1");

    const daily = (await t.call("GET", "/api/office/daily?tz=America/New_York", undefined, agent)).json;
    assert.equal(daily.days.length, 1);
    assert.deepEqual([daily.days[0].loadedCents, daily.days[0].redeemedCents], [10_000, 2_500]);
    const distDaily = (await t.call("GET", `/api/office/daily?account=${agentId}`, undefined, dist)).json;
    assert.equal(distDaily.days[0].loadedCents, 10_000);

    // Game records: the agent and the levels above can read them, nobody else.
    const rounds = (await t.call("GET", `/api/office/accounts/${playerId}/rounds`, undefined, agent)).json;
    assert.equal(rounds.rounds.length, 3);
    assert.equal(rounds.totals.rounds, 3);
    assert.equal(rounds.rounds[0].profileId, "rtp95");
    const page = (await t.call("GET", `/api/office/accounts/player1/rounds?limit=2`, undefined, dist)).json;
    assert.equal(page.rounds.length, 2);
    const older = (await t.call("GET", `/api/office/accounts/${playerId}/rounds?before=${page.rounds[1].roundId}`, undefined, op)).json;
    assert.deepEqual(older.rounds.map((r: any) => r.roundId), [rounds.rounds[2].roundId]);
    const detail = (await t.call("GET", `/api/office/rounds/${rounds.rounds[0].roundId}`, undefined, agent)).json;
    assert.equal(detail.verified, true);
    assert.equal(detail.player.username, "player1");
    assert.ok(detail.round.steps[0].grid);

    const otherAgent = (await t.call("POST", "/api/office/accounts", { username: "agent2", password: "agent-pass" }, dist)).json;
    assert.ok(otherAgent.id);
    const a2 = await t.login("agent2", "agent-pass");
    assert.equal((await t.call("GET", `/api/office/accounts/${playerId}/rounds`, undefined, a2)).status, 404);
    assert.equal((await t.call("GET", `/api/office/rounds/${rounds.rounds[0].roundId}`, undefined, a2)).status, 404);
    assert.equal((await t.call("GET", `/api/office/summary?parent=${agentId}`, undefined, a2)).status, 404);
    assert.equal((await t.call("GET", `/api/office/accounts/${agentId}/rounds`, undefined, dist)).status, 400, "agents have no rounds");
  } finally {
    await t.close();
  }
});

test("win ratio per distributor: allowed profiles, next round uses it, open rounds finish on the old one", async () => {
  const p95 = loadProfile("rtp95");
  const rng = new ScriptedRng();
  const t = await start(rng);
  try {
    const { op, dist, distId } = await chain(t);
    const tok = (await t.call("POST", "/api/player/login", { username: "player1", password: "player-pass" })).json.token;

    const wr = (await t.call("GET", "/api/office/win-ratio", undefined, dist)).json;
    assert.equal(wr.current.profileId, "rtp95");
    assert.equal(wr.current.followsDefault, true);
    assert.deepEqual(wr.profiles.map((p: any) => p.id), ["rtp94", "rtp95", "rtp96"]);
    assert.ok(wr.profiles.every((p: any) => p.allowed && p.hitFrequency > 0.3 && p.freeSpinsEvery > 1));
    assert.ok(wr.profiles[0].rtpMax < wr.profiles[2].rtpMax);

    // Start a round that stops at the wheel, on rtp95.
    rng.queue = wheelStops(p95);
    const open = await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok);
    assert.equal(open.json.nextAction, "wheel");
    assert.equal(open.json.round.profileId, "rtp95");

    // The operator allows only 94 and 95; the distributor can't pick 96.
    const g = await t.call("POST", "/api/office/games", { allowedProfileIds: ["rtp94", "rtp95"] }, op);
    assert.deepEqual(g.json.settings.allowedProfileIds, ["rtp94", "rtp95"]);
    assert.equal((await t.call("POST", "/api/office/win-ratio", { profileId: "rtp96" }, dist)).status, 403);
    assert.equal((await t.call("POST", "/api/office/win-ratio", { profileId: "rtp94" }, dist)).json.changed, true);
    assert.equal((await t.call("POST", "/api/office/games", {}, dist)).status, 403);

    // The open round finishes on rtp95, the next one is on rtp94.
    const wheel = await t.call("POST", "/api/wheel", { requestId: rid() }, tok);
    assert.equal(wheel.json.round.profileId, "rtp95");
    let r = wheel.json;
    while (r.nextAction !== "spin") r = (await t.call("POST", "/api/free-spin", { requestId: rid() }, tok)).json;
    const next = await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok);
    assert.equal(next.json.round.profileId, "rtp94");
    assert.equal((await t.call("GET", "/api/config", undefined, tok)).json.profileId, "rtp94", "config follows the player's profile");
    assert.equal((await t.call("GET", "/api/config")).json.profileId, "rtp95", "anonymous config shows the default");

    // The operator can set any loaded profile and every change is logged.
    assert.equal((await t.call("POST", `/api/office/accounts/${distId}/profile`, { profileId: "rtp96" }, op)).status, 200);
    const after = (await t.call("GET", `/api/office/win-ratio?distributor=${distId}`, undefined, op)).json;
    assert.equal(after.current.profileId, "rtp96");
    assert.equal(after.current.by, "op1");
    assert.deepEqual(after.history.map((h: any) => [h.from, h.to, h.by]), [["rtp94", "rtp96", "op1"], ["rtp95", "rtp94", "dist1"]]);
    assert.equal(after.actual.rounds, 2);
    const games = (await t.call("GET", "/api/office/games", undefined, op)).json;
    assert.equal(games.assignments[0].profileId, "rtp96");
    assert.equal(games.history.length, 3);
    assert.equal(games.game.jackpotContributionBps.GRAND, 50);
    assert.equal((await t.call("POST", "/api/office/games", { defaultProfileId: "nope" }, op)).status, 404);
  } finally {
    await t.close();
  }
});

test("maintenance mode stops new spins but lets open rounds finish", async () => {
  const rng = new ScriptedRng();
  const t = await start(rng);
  try {
    const { op } = await chain(t);
    const tok = (await t.call("POST", "/api/player/login", { username: "player1", password: "player-pass" })).json.token;
    rng.queue = wheelStops(loadProfile("rtp95"));
    assert.equal((await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok)).json.nextAction, "wheel");
    await t.call("POST", "/api/office/games", { maintenance: { on: true, message: "Back at 6" } }, op);
    assert.equal((await t.call("GET", "/api/state", undefined, tok)).json.maintenance, "Back at 6");
    const w = await t.call("POST", "/api/wheel", { requestId: rid() }, tok);
    assert.equal(w.status, 200, "the open round can finish");
    let r = w.json;
    while (r.nextAction !== "spin") r = (await t.call("POST", "/api/free-spin", { requestId: rid() }, tok)).json;
    const blocked = await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.json.error.message, "Back at 6");
    await t.call("POST", "/api/office/games", { maintenance: { on: false } }, op);
    assert.equal((await t.call("POST", "/api/spin", { requestId: rid(), betCents: 25 }, tok)).status, 200);
  } finally {
    await t.close();
  }
});

test("admin key creates operator logins", async () => {
  const t = await start();
  try {
    assert.equal((await t.call("POST", "/api/admin/operators", { username: "op2", password: "op-pass-2" })).status, 403, "needs the admin key");
    const res = await fetch(`${t.base}/api/admin/operators`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "secret" },
      body: JSON.stringify({ username: "op2", password: "op-pass-2" }),
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as any).role, "OPERATOR");
    await t.login("op2", "op-pass-2", "operator");
  } finally {
    await t.close();
  }
});
