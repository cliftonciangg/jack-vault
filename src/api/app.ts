import { existsSync, readFileSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { AccountService } from "../accounts/accounts.js";
import { WebSocketServer, WebSocket } from "ws";
import { GameError, NextAction } from "../engine/engine.js";
import { GameService } from "../service/gameService.js";
import type { Store } from "../store/store.js";

export interface AppOptions {
  service: GameService;
  /** Let POST /api/sessions create unknown players (dev / demo only). */
  allowPlayerCreate: boolean;
  /** Required in the x-admin-key header for /api/admin routes. Admin routes are off when unset. */
  adminKey?: string;
  /** Allowed CORS origin for browser clients, e.g. http://localhost:5173. */
  corsOrigin?: string;
  /** Distributor / agent / player accounts. The /api/office, /api/player and account admin routes need it. */
  accounts?: AccountService;
  /** When set, every response waits until the store has made all commits durable. */
  store?: Store;
}

/** The back-office page (office/index.html), found from src/api or dist/src/api. */
function officePage(): string | null {
  for (const rel of ["../../office/index.html", "../../../office/index.html"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

const MAX_BODY = 16 * 1024;

/**
 * JSON over HTTP plus a WebSocket at /ws. Both call the same GameService.
 *
 * REST
 *   GET  /api/health
 *   GET  /api/config                    paytable, lines, bet levels, wheel, RTP
 *   GET  /api/jackpots
 *   POST /api/sessions                  { playerId }            -> { token, ... }
 *   GET  /api/state                     (auth) balance, open round, next action
 *   POST /api/spin                      (auth) { requestId, betCents }
 *   POST /api/wheel                     (auth) { requestId }
 *   POST /api/free-spin                 (auth) { requestId }
 *   GET  /api/history?limit=&before=    (auth)
 *   GET  /api/rounds/:id                (auth)
 *   GET  /api/rounds/:id/replay         (auth)
 *   POST /api/admin/players/:id/balance (x-admin-key) { requestId, amountCents }
 *   GET  /api/admin/audit               (x-admin-key)
 *
 * Accounts (when `accounts` is set; see src/accounts/accounts.ts)
 *   GET  /office                          back-office web page for distributors and agents
 *   POST /api/player/login                { username, password }   -> { token, playerId, state }
 *   POST /api/player/logout               (auth)
 *   POST /api/office/login                { username, password }   -> { token, account }
 *   POST /api/office/logout               (office auth)
 *   GET  /api/office/me                   (office auth)
 *   GET  /api/office/accounts?parent=     (office auth) my agents / players, or an agent's players
 *   POST /api/office/accounts             (office auth) { username, password } create agent / player
 *   POST /api/office/accounts/:id/load    (office auth) { requestId, amountCents }
 *   POST /api/office/accounts/:id/redeem  (office auth) { requestId, amountCents }
 *   POST /api/office/accounts/:id/password (office auth) { password }
 *   POST /api/office/accounts/:id/status  (office auth) { status: ACTIVE | DISABLED }
 *   GET  /api/office/ledger?account=&limit=&before= (office auth)
 *   GET  /api/admin/accounts              (x-admin-key)
 *   POST /api/admin/distributors          (x-admin-key) { username, password }
 *   POST /api/admin/accounts/:id/issue    (x-admin-key) { requestId, amountCents } (negative takes back)
 *   POST /api/admin/accounts/:id/password (x-admin-key) { password }
 *   POST /api/admin/accounts/:id/status   (x-admin-key) { status }
 *
 * WebSocket /ws?token=...  send { id, type, ...params }, receive { id, ok, result | error }.
 *   types: state, spin {requestId, betCents}, wheel {requestId}, freeSpin {requestId}, history {limit, before},
 *          round {roundId}, replay {roundId}, config, jackpots
 *   pushes: { type: "jackpots", jackpots }, { type: "jackpotWon", tier, amountCents },
 *           { type: "balance", balanceCents } (to that player, after an agent load / redeem)
 */
export function createApp(o: AppOptions): { server: Server; wss: WebSocketServer } {
  const svc = o.service;
  const office = o.accounts ? officePage() : null;

  const server = createServer(async (req, res) => {
    if (o.store) holdUntilDurable(res, o.store);
    try {
      if (o.corsOrigin) {
        res.setHeader("access-control-allow-origin", o.corsOrigin);
        res.setHeader("access-control-allow-headers", "authorization, content-type, x-admin-key");
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      }
      if (req.method === "OPTIONS") return send(res, 204, null);
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const auth = () => svc.playerForToken(bearer(req));
      const admin = () => {
        if (!o.adminKey || req.headers["x-admin-key"] !== o.adminKey) throw new GameError("FORBIDDEN", "Admin key required", 403);
      };
      const accounts = () => {
        if (!o.accounts) throw new GameError("NOT_FOUND", "Accounts are not enabled", 404);
        return o.accounts;
      };

      if (req.method === "GET" && (path === "/office" || path === "/office/")) {
        if (!office) throw new GameError("NOT_FOUND", "No such route", 404);
        res.setHeader("content-security-policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.statusCode = 200;
        return res.end(office);
      }
      if (path.startsWith("/api/office/") || path.startsWith("/api/player/") || path.startsWith("/api/admin/accounts") || path === "/api/admin/distributors") {
        const body = req.method === "POST" ? await readJson(req) : {};
        const r = accountRoute(accounts(), svc, req.method ?? "GET", path, url.searchParams, body, bearer(req), admin);
        return send(res, r.status ?? 200, r.body);
      }

      if (req.method === "GET") {
        if (path === "/api/health") return send(res, 200, { ok: true });
        if (path === "/api/config") return send(res, 200, svc.config());
        if (path === "/api/jackpots") return send(res, 200, { jackpots: svc.jackpots() });
        if (path === "/api/state") return send(res, 200, svc.state(auth()));
        if (path === "/api/history") {
          const limit = Number(url.searchParams.get("limit") ?? 20);
          return send(res, 200, { rounds: svc.history(auth(), limit, url.searchParams.get("before") ?? undefined) });
        }
        let m = path.match(/^\/api\/rounds\/([\w-]+)$/);
        if (m) return send(res, 200, svc.round(auth(), m[1]));
        m = path.match(/^\/api\/rounds\/([\w-]+)\/replay$/);
        if (m) return send(res, 200, svc.replay(auth(), m[1]));
        if (path === "/api/admin/audit") {
          admin();
          return send(res, 200, o.accounts ? { ...svc.audit(), accounts: o.accounts.audit() } : svc.audit());
        }
      }

      if (req.method === "POST") {
        const body = await readJson(req);
        if (path === "/api/sessions") {
          const r = svc.createSession(String(body.playerId ?? ""), { allowCreate: o.allowPlayerCreate });
          return send(res, 201, { token: r.token, playerId: r.player.id, state: svc.state(r.player.id) });
        }
        const actions: Record<string, NextAction> = { "/api/spin": "spin", "/api/wheel": "wheel", "/api/free-spin": "freeSpin" };
        if (actions[path]) {
          const betCents = body.betCents === undefined ? undefined : Number(body.betCents);
          return send(res, 200, svc.play(auth(), String(body.requestId ?? ""), actions[path], betCents));
        }
        const m = path.match(/^\/api\/admin\/players\/([\w.:-]+)\/balance$/);
        if (m) {
          admin();
          return send(res, 200, svc.adjustBalance(m[1], String(body.requestId ?? ""), Number(body.amountCents)));
        }
      }
      throw new GameError("NOT_FOUND", "No such route", 404);
    } catch (e) {
      sendError(res, e);
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_BODY });
  const socketPlayer = new WeakMap<WebSocket, string>();
  wss.on("connection", (ws, req) => {
    let playerId: string;
    try {
      playerId = svc.playerForToken(new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? undefined);
    } catch {
      ws.close(4401, "unauthorized");
      return;
    }
    socketPlayer.set(ws, playerId);
    // Like HTTP responses, WebSocket replies go out only once the result is durable.
    const reply = (data: string) =>
      o.store ? o.store.flushed().then(() => ws.send(data), () => ws.terminate()) : ws.send(data);
    ws.on("message", (raw) => {
      let msg: Record<string, unknown> = {};
      try {
        msg = JSON.parse(raw.toString());
        const result = handleWs(svc, playerId, msg);
        reply(JSON.stringify({ id: msg.id ?? null, ok: true, result }));
      } catch (e) {
        reply(JSON.stringify({ id: msg.id ?? null, ok: false, error: errorBody(e) }));
      }
    });
  });

  // Live jackpot ticker for every connected client, at most once a second.
  let pending: unknown = null;
  let timer: NodeJS.Timeout | null = null;
  const broadcast = (payload: unknown) => {
    const data = JSON.stringify(payload);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
  };
  svc.events.on("jackpots", (j) => {
    pending = j;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        broadcast({ type: "jackpots", jackpots: pending });
      }, 1000);
      timer.unref();
    }
  });
  svc.events.on("jackpotWon", (w: { tier: string; amountCents: number }) =>
    broadcast({ type: "jackpotWon", tier: w.tier, amountCents: w.amountCents }),
  );
  // An agent's load / redeem shows up in the player's open game right away.
  o.accounts?.events.on("playerBalance", (b: { playerId: string; balanceCents: number }) => {
    const data = JSON.stringify({ type: "balance", balanceCents: b.balanceCents });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN && socketPlayer.get(c) === b.playerId) c.send(data);
  });
  server.on("close", () => timer && clearTimeout(timer));

  return { server, wss };
}

function accountRoute(
  acc: AccountService,
  svc: GameService,
  method: string,
  path: string,
  q: URLSearchParams,
  body: Record<string, unknown>,
  token: string | undefined,
  admin: () => void,
): { status?: number; body: unknown } {
  const str = (k: string) => String(body[k] ?? "");
  const amount = () => Number(body.amountCents);

  if (method === "POST" && path === "/api/player/login") {
    const r = acc.playerLogin(str("username"), str("password"));
    return { status: 201, body: { token: r.token, playerId: r.playerId, state: svc.state(r.playerId) } };
  }
  if (method === "POST" && (path === "/api/player/logout" || path === "/api/office/logout")) {
    acc.logout(token);
    return { body: { ok: true } };
  }
  if (method === "POST" && path === "/api/office/login") {
    return { status: 201, body: acc.staffLogin(str("username"), str("password")) };
  }

  if (path.startsWith("/api/admin/")) {
    admin();
    if (method === "GET" && path === "/api/admin/accounts") return { body: { accounts: acc.all(), audit: acc.audit() } };
    if (method === "POST" && path === "/api/admin/distributors") return { status: 201, body: acc.createDistributor(str("username"), str("password")) };
    const m = path.match(/^\/api\/admin\/accounts\/([\w-]+)\/(issue|password|status)$/);
    if (method === "POST" && m) {
      const a = acc.account(m[1]);
      if (m[2] === "issue") return { body: acc.issue(a.id, str("requestId"), amount()) };
      if (m[2] === "password") return (acc.setPassword(a, str("password")), { body: { ok: true } });
      return { body: acc.setStatus(a, str("status")) };
    }
    throw new GameError("NOT_FOUND", "No such route", 404);
  }

  const me = acc.staffForToken(token);
  if (method === "GET" && path === "/api/office/me") return { body: acc.view(me) };
  if (method === "GET" && path === "/api/office/accounts") return { body: { accounts: acc.list(me, q.get("parent") ?? undefined) } };
  if (method === "GET" && path === "/api/office/ledger") {
    return { body: { entries: acc.ledger(me, { accountId: q.get("account") ?? undefined, limit: Number(q.get("limit") ?? 100), before: q.get("before") ?? undefined }) } };
  }
  if (method === "POST" && path === "/api/office/accounts") return { status: 201, body: acc.createChild(me, str("username"), str("password")) };
  const m = path.match(/^\/api\/office\/accounts\/([\w-]+)\/(load|redeem|password|status)$/);
  if (method === "POST" && m) {
    const child = acc.childOf(me, m[1]);
    if (m[2] === "load") return { body: acc.load(me, child.id, str("requestId"), amount()) };
    if (m[2] === "redeem") return { body: acc.redeem(me, child.id, str("requestId"), amount()) };
    if (m[2] === "password") return (acc.setPassword(child, str("password")), { body: { ok: true } });
    return { body: acc.setStatus(child, str("status")) };
  }
  throw new GameError("NOT_FOUND", "No such route", 404);
}

function handleWs(svc: GameService, playerId: string, m: Record<string, unknown>): unknown {
  switch (m.type) {
    case "state":
      return svc.state(playerId);
    case "config":
      return svc.config();
    case "jackpots":
      return { jackpots: svc.jackpots() };
    case "spin":
      return svc.play(playerId, String(m.requestId ?? ""), "spin", Number(m.betCents));
    case "wheel":
      return svc.play(playerId, String(m.requestId ?? ""), "wheel");
    case "freeSpin":
      return svc.play(playerId, String(m.requestId ?? ""), "freeSpin");
    case "history":
      return { rounds: svc.history(playerId, Number(m.limit ?? 20), m.before ? String(m.before) : undefined) };
    case "round":
      return svc.round(playerId, String(m.roundId));
    case "replay":
      return svc.replay(playerId, String(m.roundId));
    default:
      throw new GameError("UNKNOWN_TYPE", `Unknown message type ${String(m.type)}`);
  }
}

/** Delays res.end until the store's pending commits are durable (or drops the connection if they can't be). */
function holdUntilDurable(res: ServerResponse, store: Store): void {
  const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
  (res as unknown as { end: (...args: unknown[]) => ServerResponse }).end = (...args: unknown[]) => {
    store.flushed().then(
      () => end(...args),
      () => res.destroy(),
    );
    return res;
  };
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new GameError("BODY_TOO_LARGE", "Request body too large", 413);
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new GameError("BAD_JSON", "Body must be a JSON object");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  if (body === null) return res.end();
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function errorBody(e: unknown) {
  if (e instanceof GameError) return { code: e.code, message: e.message };
  return { code: "INTERNAL", message: "Internal error" };
}

function sendError(res: ServerResponse, e: unknown) {
  if (!(e instanceof GameError)) console.error(e);
  send(res, e instanceof GameError ? e.status : 500, { error: errorBody(e) });
}
