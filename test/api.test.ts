import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../src/api/app.js";
import { loadProfile } from "../src/math/profile.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";

async function start() {
  const service = new GameService({ profile: loadProfile("rtp95"), store: new Store(), startingBalanceCents: 100_000 });
  const { server, wss } = createApp({ service, allowPlayerCreate: true, adminKey: "secret" });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
    return new Promise<void>((r) => server.close(() => r()));
  };
  return { base, close };
}

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("REST: session, config, spin, retry, history, replay, admin", async () => {
  const { base, close } = await start();
  try {
    assert.equal((await call(base, "GET", "/api/health")).json.ok, true);
    const cfg = (await call(base, "GET", "/api/config")).json;
    assert.equal(cfg.lines, 25);
    assert.deepEqual(cfg.grid, { reels: 5, rows: 4 });
    assert.ok(cfg.rtp.min >= 0.94 && cfg.rtp.max <= 0.965);
    assert.equal(cfg.wheel.segments.length, 12);
    assert.equal(cfg.wheel.segments[0].weight, undefined, "wheel weights are not exposed");

    assert.equal((await call(base, "GET", "/api/state")).status, 401);
    const s = await call(base, "POST", "/api/sessions", { playerId: "alice" });
    assert.equal(s.status, 201);
    const auth = { authorization: `Bearer ${s.json.token}` };
    assert.equal(s.json.state.balanceCents, 100_000);

    const requestId = randomUUID();
    const spin = await call(base, "POST", "/api/spin", { requestId, betCents: 250 }, auth);
    assert.equal(spin.status, 200);
    assert.equal(spin.json.step.grid.length, 5);
    assert.equal(spin.json.step.grid[0].length, 4);
    const retry = await call(base, "POST", "/api/spin", { requestId, betCents: 250 }, auth);
    assert.deepEqual(retry.json, spin.json);

    assert.equal((await call(base, "POST", "/api/spin", { requestId: randomUUID(), betCents: 7 }, auth)).json.error.code, "INVALID_BET");
    assert.equal((await call(base, "POST", "/api/spin", { requestId: "x", betCents: 25 }, auth)).json.error.code, "BAD_REQUEST_ID");

    // Finish any feature the spin triggered.
    let next = spin.json.nextAction;
    while (next !== "spin") {
      const r = await call(base, "POST", next === "wheel" ? "/api/wheel" : "/api/free-spin", { requestId: randomUUID() }, auth);
      next = r.json.nextAction;
    }

    const hist = await call(base, "GET", "/api/history?limit=5", undefined, auth);
    assert.equal(hist.json.rounds[0].roundId, spin.json.roundId);
    const rep = await call(base, "GET", `/api/rounds/${spin.json.roundId}/replay`, undefined, auth);
    assert.equal(rep.json.verified, true);

    assert.equal((await call(base, "POST", "/api/admin/players/alice/balance", { requestId: randomUUID(), amountCents: 500 })).status, 403);
    const adj = await call(base, "POST", "/api/admin/players/alice/balance", { requestId: randomUUID(), amountCents: 500 }, { "x-admin-key": "secret" });
    assert.equal(adj.status, 200);
    const audit = await call(base, "GET", "/api/admin/audit", undefined, { "x-admin-key": "secret" });
    assert.equal(audit.json.ledgerBalancesMatch, true);
    assert.equal((await call(base, "GET", "/api/nope")).status, 404);
  } finally {
    await close();
  }
});

test("WebSocket: request/response and jackpot ticker push", async () => {
  const { base, close } = await start();
  try {
    const { token } = (await call(base, "POST", "/api/sessions", { playerId: "bob" })).json;
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=${token}`);
    await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
    const messages: any[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
    const waitFor = (pred: (m: any) => boolean) =>
      new Promise<any>((resolve) => {
        const t = setInterval(() => {
          const m = messages.find(pred);
          if (m) (clearInterval(t), resolve(m));
        }, 10);
      });

    ws.send(JSON.stringify({ id: 1, type: "state" }));
    assert.equal((await waitFor((m) => m.id === 1)).result.balanceCents, 100_000);
    ws.send(JSON.stringify({ id: 2, type: "spin", requestId: randomUUID(), betCents: 100 }));
    const spin = await waitFor((m) => m.id === 2);
    assert.equal(spin.ok, true);
    assert.equal(spin.result.step.stops.length, 5);
    ws.send(JSON.stringify({ id: 3, type: "bogus" }));
    assert.equal((await waitFor((m) => m.id === 3)).error.code, "UNKNOWN_TYPE");
    const tick = await waitFor((m) => m.type === "jackpots");
    assert.ok(tick.jackpots.GRAND > 0);
    ws.close();

    const bad = new WebSocket(`${base.replace("http", "ws")}/ws?token=wrong`);
    const code = await new Promise((r) => bad.on("close", (c) => r(c)));
    assert.equal(code, 4401);
  } finally {
    await close();
  }
});
