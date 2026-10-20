import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { AddressInfo } from "node:net";
import { AccountService } from "../src/accounts/accounts.js";
import { createApp } from "../src/api/app.js";
import { listProfiles, loadProfile } from "../src/math/profile.js";
import { GameService } from "../src/service/gameService.js";
import { Store } from "../src/store/store.js";

/** Back-office hosts: owner.* logs in operators only, agent.* distributors and agents only. */

async function start() {
  const store = new Store();
  const service = new GameService({ profile: loadProfile("rtp95"), profiles: listProfiles().map(loadProfile), store });
  const accounts = new AccountService({ store, profileFor: (id) => service.distributorProfileId(id) });
  accounts.createOperator("op1", "op-pass-1");
  accounts.seed("dist1", "dist-pass", 100_000);
  const { server, wss } = createApp({
    service,
    accounts,
    allowPlayerCreate: false,
    staffHosts: { operator: "owner.example.com", staff: "agent.example.com" },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  // fetch() won't set Host, so use http.request.
  const call = (method: string, path: string, host: string, body?: unknown) =>
    new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
      const req = request({ port, method, path, headers: { host, "content-type": "application/json" } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const close = () => {
    wss.close();
    return new Promise<void>((r) => server.close(() => r()));
  };
  return { call, close };
}

test("each back-office host logs in only its own roles", async () => {
  const t = await start();
  try {
    const login = (host: string, username: string, password: string, portal?: string) =>
      t.call("POST", "/api/office/login", host, { username, password, portal });

    assert.equal((await login("owner.example.com:443", "op1", "op-pass-1")).status, 201);
    assert.equal((await login("agent.example.com", "dist1", "dist-pass")).status, 201);

    // The host decides the portal, whatever the client asks for.
    assert.equal((await login("agent.example.com", "op1", "op-pass-1", "operator")).status, 401);
    assert.equal((await login("owner.example.com", "dist1", "dist-pass", "staff")).status, 401);

    const main = await login("example.com", "dist1", "dist-pass");
    assert.equal(main.status, 403);
    assert.equal(JSON.parse(main.text).error.code, "WRONG_HOST");
  } finally {
    await t.close();
  }
});

test("/office shows one login per host and redirects elsewhere", async () => {
  const t = await start();
  try {
    const owner = await t.call("GET", "/office", "OWNER.example.com");
    assert.equal(owner.status, 200);
    assert.match(owner.text, /<html lang="en" data-portal="operator">/);
    const agent = await t.call("GET", "/office", "agent.example.com");
    assert.match(agent.text, /<html lang="en" data-portal="staff">/);
    const main = await t.call("GET", "/office", "example.com");
    assert.equal(main.status, 302);
    assert.equal(main.headers.location, "https://agent.example.com/");
  } finally {
    await t.close();
  }
});
