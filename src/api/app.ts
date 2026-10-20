import { existsSync, readFileSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { AccountService, Portal } from "../accounts/accounts.js";
import { OfficeReports } from "../accounts/reports.js";
import type { Account, LedgerType } from "../store/store.js";
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
  /**
   * Back-office hostnames, e.g. owner.example.com and agent.example.com. When set, operators log in
   * only on `operator`, distributors and agents only on `staff`, and /office on any other host
   * redirects to the staff host.
   */
  staffHosts?: { operator: string; staff: string };
}

/** The back-office portal a request's Host header belongs to, or null for any other host. */
function portalForHost(req: IncomingMessage, hosts: { operator: string; staff: string }): Portal | null {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return host === hosts.operator ? "operator" : host === hosts.staff ? "staff" : null;
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
 *   GET  /api/config                    paytable, lines, bet levels, wheel, RTP (with a player token: that player's profile)
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
 * Accounts (when `accounts` is set; see src/accounts/accounts.ts). "office auth" is a
 * back-office token for an operator, distributor or agent; each sees only its own subtree.
 *   GET  /office                          back-office web page for operators, distributors and agents
 *   POST /api/player/login                { username, password }   -> { token, playerId, state }
 *   POST /api/player/logout               (auth)
 *   POST /api/office/login                { username, password, portal: staff | operator } -> { token, account }
 *   POST /api/office/logout               (office auth)
 *   GET  /api/office/me                   (office auth) my account, parent and time zone
 *   POST /api/office/me/password          (office auth) { currentPassword, newPassword } logs out my other sessions
 *   POST /api/office/me/prefs             (office auth) { timeZone }
 *   GET  /api/office/me/sessions          (office auth)
 *   POST /api/office/me/sessions/logout-others (office auth)
 *   GET  /api/office/accounts?parent=     (office auth) my children, or (read only) any visible account's children
 *   POST /api/office/accounts             (office auth) { username, password, startingCents?, profileId? }
 *   POST /api/office/accounts/:id/load    (office auth) { requestId, amountCents, note? }  distributor / agent
 *   POST /api/office/accounts/:id/redeem  (office auth) { requestId, amountCents, note? }  distributor / agent
 *   POST /api/office/accounts/:id/issue   (office auth) { requestId, amountCents, note? }  operator
 *   POST /api/office/accounts/:id/revoke  (office auth) { requestId, amountCents, note? }  operator (take back)
 *   POST /api/office/accounts/:id/password (office auth) { password }
 *   POST /api/office/accounts/:id/status  (office auth) { status: ACTIVE | DISABLED }
 *   POST /api/office/accounts/:id/profile (office auth) { profileId }  operator sets a distributor's win ratio
 *   GET  /api/office/accounts/:id/rounds?from=&to=&limit=&before= (office auth) a visible player's rounds and totals
 *   GET  /api/office/rounds/:id           (office auth) one round with its replay check
 *   GET  /api/office/ledger?account=&actor=&type=&from=&to=&limit=&before= (office auth) type: comma list
 *   GET  /api/office/summary?from=&to=&parent= (office auth) period flows for me and each child
 *   GET  /api/office/daily?from=&to=&tz=&account= (office auth) loads / redeems per day
 *   GET  /api/office/win-ratio?distributor=&from=&to= (office auth) distributor (own) or operator
 *   POST /api/office/win-ratio            (office auth) { profileId } distributor, operator-allowed profiles only
 *   GET  /api/office/games                (office auth) operator: profiles, assignments, settings, history
 *   POST /api/office/games                (office auth) operator { defaultProfileId?, allowedProfileIds?, maintenance? }
 *   GET  /api/office/audit                (office auth) operator: audit checks with failing accounts
 *   GET  /api/admin/accounts              (x-admin-key)
 *   POST /api/admin/operators             (x-admin-key) { username, password }
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
  const reports = o.accounts ? new OfficeReports(o.accounts, svc, o.accounts.store) : null;

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
        const portal = o.staffHosts ? portalForHost(req, o.staffHosts) : null;
        if (o.staffHosts && !portal) {
          res.writeHead(302, { location: `https://${o.staffHosts.staff}/` });
          return res.end();
        }
        res.setHeader("content-security-policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.statusCode = 200;
        // On a back-office host the page shows only that portal's login.
        return res.end(portal ? office.replace("<html lang=\"en\">", `<html lang="en" data-portal="${portal}">`) : office);
      }
      if (path.startsWith("/api/office/") || path.startsWith("/api/player/") || path.startsWith("/api/admin/accounts") || path === "/api/admin/distributors" || path === "/api/admin/operators") {
        const body = req.method === "POST" ? await readJson(req) : {};
        if (o.staffHosts && path === "/api/office/login") {
          const portal = portalForHost(req, o.staffHosts);
          if (!portal) throw new GameError("WRONG_HOST", `Log in at https://${o.staffHosts.staff}`, 403);
          body.portal = portal;
        }
        const meta = { ip: req.socket.remoteAddress ?? null, userAgent: req.headers["user-agent"] ?? null };
        const r = accountRoute(accounts(), reports!, svc, req.method ?? "GET", path, url.searchParams, body, bearer(req), admin, meta);
        return send(res, r.status ?? 200, r.body);
      }

      if (req.method === "GET") {
        if (path === "/api/health") return send(res, 200, { ok: true });
        if (path === "/api/config") {
          // With a player token, the RTP shown is the one that player's distributor plays on.
          let playerId: string | undefined;
          try {
            playerId = bearer(req) ? svc.playerForToken(bearer(req)) : undefined;
          } catch {
            playerId = undefined;
          }
          return send(res, 200, svc.config(playerId));
        }
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
  reports: OfficeReports,
  svc: GameService,
  method: string,
  path: string,
  q: URLSearchParams,
  body: Record<string, unknown>,
  token: string | undefined,
  admin: () => void,
  meta: { ip: string | null; userAgent: string | null },
): { status?: number; body: unknown } {
  const str = (k: string) => String(body[k] ?? "");
  const amount = () => Number(body.amountCents);
  const note = () => (typeof body.note === "string" ? body.note : undefined);

  if (method === "POST" && path === "/api/player/login") {
    const r = acc.playerLogin(str("username"), str("password"), meta);
    return { status: 201, body: { token: r.token, playerId: r.playerId, state: svc.state(r.playerId) } };
  }
  if (method === "POST" && (path === "/api/player/logout" || path === "/api/office/logout")) {
    acc.logout(token);
    return { body: { ok: true } };
  }
  if (method === "POST" && path === "/api/office/login") {
    const portal: Portal = body.portal === "operator" ? "operator" : "staff";
    return { status: 201, body: acc.staffLogin(str("username"), str("password"), portal, meta) };
  }

  if (path.startsWith("/api/admin/")) {
    admin();
    if (method === "GET" && path === "/api/admin/accounts") return { body: { accounts: acc.all(), audit: acc.audit() } };
    if (method === "POST" && path === "/api/admin/distributors") return { status: 201, body: acc.createDistributor(str("username"), str("password")) };
    if (method === "POST" && path === "/api/admin/operators") return { status: 201, body: acc.createOperator(str("username"), str("password")) };
    const m = path.match(/^\/api\/admin\/accounts\/([\w-]+)\/(issue|password|status)$/);
    if (method === "POST" && m) {
      const a = acc.account(m[1]);
      if (m[2] === "issue") return { body: acc.issue(a.id, str("requestId"), amount(), "operator", note()) };
      if (m[2] === "password") return (acc.setPassword(a, str("password")), { body: { ok: true } });
      return { body: acc.setStatus(a, str("status")) };
    }
    throw new GameError("NOT_FOUND", "No such route", 404);
  }

  const me = acc.staffForToken(token);
  const need = (...roles: Account["role"][]) => {
    if (!roles.includes(me.role)) throw new GameError("FORBIDDEN", "Not allowed for your account type", 403);
  };
  const period = () => ({ from: isoParam(q.get("from")), to: isoParam(q.get("to")) });
  const limit = () => (q.get("limit") ? Number(q.get("limit")) : undefined);

  if (path === "/api/office/me" && method === "GET") {
    const parent = me.parentId ? acc.account(me.parentId) : null;
    return { body: { ...acc.view(me), timeZone: me.timeZone ?? "UTC", parent: parent ? { id: parent.id, username: parent.username, role: parent.role } : null } };
  }
  if (path === "/api/office/me/password" && method === "POST") {
    acc.changeOwnPassword(me, str("currentPassword"), str("newPassword"), token);
    return { body: { ok: true } };
  }
  if (path === "/api/office/me/prefs" && method === "POST") return { body: acc.setTimeZone(me, str("timeZone")) };
  if (path === "/api/office/me/sessions" && method === "GET") return { body: { sessions: acc.sessions(me, token) } };
  if (path === "/api/office/me/sessions/logout-others" && method === "POST") return { body: { loggedOut: acc.logoutOthers(me, token) } };

  if (method === "GET" && path === "/api/office/accounts") return { body: { accounts: acc.list(me, q.get("parent") ?? undefined) } };
  if (method === "POST" && path === "/api/office/accounts") {
    const profileId = body.profileId ? str("profileId") : undefined;
    if (profileId) {
      need("OPERATOR");
      svc.profileHashOf(profileId);
    }
    const starting = body.startingCents === undefined || body.startingCents === null || body.startingCents === "" ? 0 : Number(body.startingCents);
    if (!Number.isInteger(starting) || starting < 0) throw new GameError("BAD_AMOUNT", "Starting balance must be a whole number of cents");
    if (starting > 0 && me.role !== "OPERATOR" && starting > me.balanceCents) {
      throw new GameError("INSUFFICIENT_FUNDS", `You only have ${(me.balanceCents / 100).toFixed(2)}`, 402);
    }
    const created = acc.createChild(me, str("username"), str("password"), profileId);
    if (starting > 0) {
      if (me.role === "OPERATOR") acc.issue(created.id, `create-${created.id}`, starting, me.id);
      else acc.load(me, created.id, `create-${created.id}`, starting);
    }
    return { status: 201, body: acc.view(acc.account(created.id)) };
  }
  let m = path.match(/^\/api\/office\/accounts\/([\w-]+)\/(load|redeem|issue|revoke|password|status|profile)$/);
  if (method === "POST" && m) {
    const child = acc.childOf(me, m[1]);
    switch (m[2]) {
      case "load":
      case "redeem":
        need("DISTRIBUTOR", "AGENT");
        return { body: acc[m[2]](me, child.id, str("requestId"), amount(), note()) };
      case "issue":
      case "revoke": {
        need("OPERATOR");
        const a = amount();
        if (!Number.isInteger(a) || a <= 0) throw new GameError("BAD_AMOUNT", "Amount must be a positive whole number of cents");
        return { body: acc.issue(child.id, str("requestId"), m[2] === "issue" ? a : -a, me.id, note()) };
      }
      case "profile":
        need("OPERATOR");
        return { body: svc.setDistributorProfile(child.id, str("profileId"), me.id, { allowedOnly: false }) };
      case "password":
        acc.setPassword(child, str("password"));
        return { body: { ok: true } };
      default:
        return { body: acc.setStatus(child, str("status")) };
    }
  }
  m = path.match(/^\/api\/office\/accounts\/([\w.-]+)\/rounds$/);
  if (method === "GET" && m) {
    const player = acc.visible(me, m[1]);
    if (player.role !== "PLAYER") throw new GameError("NOT_PLAYER", "Game records are kept for players");
    return { body: { player: acc.view(player), ...svc.rounds(player.id, { ...period(), limit: limit(), before: q.get("before") ?? undefined }) } };
  }
  m = path.match(/^\/api\/office\/rounds\/([\w-]+)$/);
  if (method === "GET" && m) {
    const r = acc.store.rounds.get(m[1]);
    const player = r ? acc.store.accounts.get(r.playerId) : undefined;
    if (!r || !player || !acc.canSee(me, player)) throw new GameError("ROUND_NOT_FOUND", "Round not found", 404);
    const replay = svc.replay(r.playerId, r.roundId);
    return { body: { round: svc.round(r.playerId, r.roundId), player: { id: player.id, username: player.username }, verified: replay.verified } };
  }
  if (method === "GET" && path === "/api/office/ledger") {
    const types = (q.get("type") ?? "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean) as LedgerType[];
    for (const t of types) if (!["ISSUE", "REVOKE", "LOAD", "REDEEM"].includes(t)) throw new GameError("BAD_TYPE", `Unknown ledger type ${t}`);
    return {
      body: { entries: acc.ledger(me, { accountId: q.get("account") || undefined, actorId: q.get("actor") || undefined, types, ...period(), limit: limit(), before: q.get("before") ?? undefined }) },
    };
  }
  if (method === "GET" && path === "/api/office/summary") return { body: reports.summary(me, { ...period(), parentId: q.get("parent") || undefined }) };
  if (method === "GET" && path === "/api/office/daily") {
    return { body: reports.daily(me, { ...period(), timeZone: q.get("tz") || me.timeZone, accountId: q.get("account") || undefined }) };
  }

  if (path === "/api/office/win-ratio") {
    if (method === "POST") {
      need("DISTRIBUTOR");
      return { body: svc.setDistributorProfile(me.id, str("profileId"), me.id, { allowedOnly: true }) };
    }
    need("DISTRIBUTOR", "OPERATOR");
    const d = me.role === "DISTRIBUTOR" ? me : acc.childOf(me, q.get("distributor") ?? "");
    return { body: winRatio(acc, svc, d, period()) };
  }
  if (path === "/api/office/games") {
    need("OPERATOR");
    if (method === "POST") {
      const patch: Parameters<GameService["updateSettings"]>[0] = {};
      if (body.defaultProfileId !== undefined) patch.defaultProfileId = str("defaultProfileId");
      if (body.allowedProfileIds !== undefined) patch.allowedProfileIds = body.allowedProfileIds as string[];
      if (body.maintenance !== undefined) patch.maintenance = body.maintenance as { on: boolean; message?: string };
      svc.updateSettings(patch, me.id);
    }
    return { body: games(acc, svc) };
  }
  if (method === "GET" && path === "/api/office/audit") {
    need("OPERATOR");
    return { body: { ...reports.audit(), game: svc.audit() } };
  }
  throw new GameError("NOT_FOUND", "No such route", 404);
}

/** Who made a settings change, by name. */
function actorName(acc: AccountService, id: string): string {
  return id === "operator" ? "operator" : (acc.store.accounts.get(id)?.username ?? id);
}

function winRatio(acc: AccountService, svc: GameService, d: Account, p: { from?: string; to?: string }) {
  const current = svc.distributorProfileId(d.id);
  const history = svc.changes({ targetId: d.id, kinds: ["DISTRIBUTOR_PROFILE"] });
  const players = acc.descendants(d).filter((a) => a.role === "PLAYER").map((a) => a.id);
  const allowed = svc.settings().allowedProfileIds;
  return {
    distributor: { id: d.id, username: d.username },
    current: {
      profileId: current,
      hash: svc.profileHashOf(current),
      followsDefault: !d.profileId,
      since: history[0]?.at ?? d.createdAt,
      by: history[0] ? actorName(acc, history[0].actorId) : null,
    },
    profiles: svc.profileIds().map((id) => ({ ...svc.profileInfo(id), allowed: allowed.includes(id) })),
    actual: svc.totals(players, p.from, p.to),
    history: history.map((c) => ({ ...c, by: actorName(acc, c.actorId) })),
  };
}

function games(acc: AccountService, svc: GameService) {
  const settings = svc.settings();
  const cfg = svc.config();
  const distributors = [...acc.store.accounts.values()].filter((a) => a.role === "DISTRIBUTOR");
  return {
    settings,
    profiles: svc.profileIds().map((id) => ({
      ...svc.profileInfo(id),
      allowed: settings.allowedProfileIds.includes(id),
      isDefault: id === svc.defaultProfileId(),
      distributors: distributors.filter((d) => svc.distributorProfileId(d.id) === id).length,
    })),
    assignments: distributors.map((d) => {
      const last = svc.changes({ targetId: d.id, kinds: ["DISTRIBUTOR_PROFILE"], limit: 1 })[0];
      return {
        id: d.id,
        username: d.username,
        status: d.status,
        profileId: svc.distributorProfileId(d.id),
        followsDefault: !d.profileId,
        since: last?.at ?? d.createdAt,
        by: last ? actorName(acc, last.actorId) : null,
      };
    }),
    game: {
      name: cfg.game,
      betLevelsCents: cfg.betLevelsCents,
      lines: cfg.lines,
      jackpotSeedsCents: cfg.jackpots.seedsCents,
      jackpotContributionBps: svc.jackpotContributionBps(),
    },
    history: svc.changes().map((c) => ({
      ...c,
      target: c.targetId ? (acc.store.accounts.get(c.targetId)?.username ?? c.targetId) : null,
      by: actorName(acc, c.actorId),
    })),
  };
}

/** A from / to query value as a normalized ISO time, or undefined. */
function isoParam(v: string | null): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new GameError("BAD_DATE", "from / to must be ISO date-times");
  return new Date(t).toISOString();
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
