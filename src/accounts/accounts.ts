import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { GameError } from "../engine/engine.js";
import { canonicalJson } from "../math/profile.js";
import type { Account, Commit, LedgerEntry, LedgerType, Role, Store } from "../store/store.js";
import { WalletTxBuilder } from "../wallet/wallet.js";

/**
 * Operator -> distributor -> agent -> player coin system.
 *
 * The operator (an OPERATOR account, or the ADMIN_KEY) creates distributors
 * and issues points to them.
 * A distributor creates agents and loads / redeems their points. An agent
 * creates players and loads / redeems their coins, out of and back into the
 * agent's own points. Every move is one LedgerEntry, committed in the same
 * journal line as the balances it changes, so points are never created or
 * lost between accounts: only ISSUE and REVOKE cross the system boundary.
 *
 * A player's coins are its game wallet (Player.balanceCents), credited with a
 * DEPOSIT / WITHDRAW Tx per load / redeem, so the game service and its audit
 * work exactly as before.
 */

export interface AccountServiceOptions {
  store: Store;
  now?: () => Date;
  /** Back-office session lifetime. Default 12 hours. */
  staffSessionMs?: number;
  /** The math profile a distributor's players play on (from GameService), shown on distributor views. */
  profileFor?: (distributorId: string) => string;
}

/** Who is logging in and from where, for the session list and last-login column. */
export interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Which tab of the back-office login page: operators log in separately from distributors and agents. */
export type Portal = "staff" | "operator";

export interface AccountView {
  id: string;
  username: string;
  role: Role;
  parentId: string | null;
  status: Account["status"];
  balanceCents: number;
  createdAt: string;
  lastLoginAt: string | null;
  /** Locked for a minute after five wrong passwords. */
  locked: boolean;
  /** Distributor's agents / agent's players. */
  children?: number;
  /** Sum of the children's balances. */
  childrenBalanceCents?: number;
  /** Distributor: the math profile its players play on. */
  profileId?: string;
}

const CHILD_ROLE: Record<Role, Role | null> = { OPERATOR: "DISTRIBUTOR", DISTRIBUTOR: "AGENT", AGENT: "PLAYER", PLAYER: null };
const ID_PREFIX: Record<Role, string> = { OPERATOR: "o_", DISTRIBUTOR: "d_", AGENT: "a_", PLAYER: "p_" };
const STAFF_ROLES: Record<Portal, Role[]> = { staff: ["DISTRIBUTOR", "AGENT"], operator: ["OPERATOR"] };
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
/** A session's last-active time is written at most this often. */
const SEEN_EVERY_MS = 5 * 60_000;
/** One move at most 10,000,000.00, so sums stay far inside safe integers. */
const MAX_AMOUNT = 1_000_000_000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(want, got);
}

/** A hash to compare against when the username doesn't exist, so timing doesn't reveal it. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

export class AccountService {
  /**
   * "playerBalance" { playerId, balanceCents } after a load or redeem, for the live game.
   * "sessionsEnded" { tokens, reason } when game sessions are ended from the server side.
   */
  readonly events = new EventEmitter();
  readonly store: Store;
  private readonly now: () => Date;
  private readonly staffSessionMs: number;
  private readonly profileFor?: (distributorId: string) => string;
  /** Failed logins per lower-case username (in memory; resets on restart). */
  private readonly fails = new Map<string, { count: number; until: number }>();
  /** Game tokens ended by a newer login of the same player, so their next request can say why (in memory). */
  private readonly replaced = new Map<string, number>();

  constructor(o: AccountServiceOptions) {
    this.store = o.store;
    this.now = o.now ?? (() => new Date());
    this.staffSessionMs = o.staffSessionMs ?? 12 * 3600_000;
    this.profileFor = o.profileFor;
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---------------------------------------------------------------- lookups

  account(id: string): Account {
    const a = this.store.accounts.get(id);
    if (!a) throw new GameError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    return a;
  }

  byUsername(username: string): Account | undefined {
    const id = this.store.usernames.get(username.trim().toLowerCase());
    return id ? this.store.accounts.get(id) : undefined;
  }

  balanceOf(a: Account): number {
    return a.role === "PLAYER" ? (this.store.players.get(a.id)?.balanceCents ?? 0) : a.balanceCents;
  }

  /** Direct children: an operator's are all distributors (they have no parent account). */
  children(parent: Account | string): Account[] {
    const p = typeof parent === "string" ? this.store.accounts.get(parent) : parent;
    if (!p) return [];
    return [...this.store.accounts.values()].filter((a) => isChild(p, a));
  }

  /** Every account below `a`, at any depth. */
  descendants(a: Account): Account[] {
    if (a.role === "OPERATOR") return [...this.store.accounts.values()].filter((x) => x.role !== "OPERATOR");
    const out: Account[] = [];
    for (let level = this.children(a); level.length; level = level.flatMap((k) => this.children(k))) out.push(...level);
    return out;
  }

  /** True if `actor` is `a` or above it in the tree. */
  canSee(actor: Account, a: Account): boolean {
    if (actor.id === a.id) return true;
    if (actor.role === "OPERATOR") return a.role !== "OPERATOR";
    for (let p = a.parentId ? this.store.accounts.get(a.parentId) : undefined; p; p = p.parentId ? this.store.accounts.get(p.parentId) : undefined) {
      if (p.id === actor.id) return true;
    }
    return false;
  }

  /** The account `id` if `actor` may look at it (itself or anything below it). */
  visible(actor: Account, id: string): Account {
    const a = this.store.accounts.get(id) ?? this.byUsername(id);
    if (!a || !this.canSee(actor, a)) throw new GameError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    return a;
  }

  isLocked(username: string): boolean {
    const f = this.fails.get(username.toLowerCase());
    return !!f && f.until > this.now().getTime();
  }

  view(a: Account): AccountView {
    const v: AccountView = {
      id: a.id,
      username: a.username,
      role: a.role,
      parentId: a.parentId,
      status: a.status,
      balanceCents: this.balanceOf(a),
      createdAt: a.createdAt,
      lastLoginAt: a.lastLoginAt ?? null,
      locked: this.isLocked(a.username),
    };
    if (a.role !== "PLAYER") {
      const kids = this.children(a);
      v.children = kids.length;
      v.childrenBalanceCents = kids.reduce((s, k) => s + this.balanceOf(k), 0);
    }
    if (a.role === "DISTRIBUTOR" && this.profileFor) v.profileId = this.profileFor(a.id);
    return v;
  }

  // ---------------------------------------------------------------- login

  /**
   * Checks a username and password. Five wrong passwords lock the username for
   * a minute. `roles` limits who may log in here (back office vs. game).
   */
  login(username: string, password: string, roles: Role[]): Account {
    const key = String(username ?? "").trim().toLowerCase();
    const t = this.now().getTime();
    const f = this.fails.get(key);
    if (f && f.until > t) throw new GameError("LOCKED", "Too many failed logins. Try again in a minute.", 429);
    const a = this.byUsername(key);
    const ok = verifyPassword(String(password ?? ""), a?.passwordHash ?? DUMMY_HASH) && !!a && roles.includes(a.role);
    if (!ok) {
      const count = (f?.count ?? 0) + 1;
      this.fails.set(key, count >= MAX_FAILS ? { count: 0, until: t + LOCK_MS } : { count, until: 0 });
      throw new GameError("BAD_LOGIN", "Wrong username or password", 401);
    }
    this.fails.delete(key);
    if (a!.status !== "ACTIVE") throw new GameError("ACCOUNT_DISABLED", "This account is disabled", 403);
    return a!;
  }

  /** Back-office login: distributors and agents on the staff tab, operators on the operator tab. */
  staffLogin(username: string, password: string, portal: Portal = "staff", meta: LoginMeta = {}): { token: string; account: AccountView } {
    const a = this.login(username, password, STAFF_ROLES[portal] ?? STAFF_ROLES.staff);
    const at = this.now();
    const iso = at.toISOString();
    const token = randomBytes(24).toString("base64url");
    const ip = meta.ip ?? null;
    const next = { ...a, lastLoginAt: iso, lastLoginIp: ip };
    this.store.commit({
      at: iso,
      accounts: [next],
      staffSessions: [
        {
          token,
          accountId: a.id,
          createdAt: iso,
          expiresAt: new Date(at.getTime() + this.staffSessionMs).toISOString(),
          ip,
          userAgent: meta.userAgent?.slice(0, 200) ?? null,
          lastSeenAt: iso,
        },
      ],
    });
    return { token, account: this.view(next) };
  }

  /** Game login for players: opens a normal game session, so every game route works unchanged. */
  playerLogin(username: string, password: string, meta: LoginMeta = {}): { token: string; playerId: string } {
    const a = this.login(username, password, ["PLAYER"]);
    const token = randomBytes(24).toString("base64url");
    const at = this.iso();
    // One device at a time: a new login ends the player's other game sessions.
    const ended = [...this.store.sessions.values()].filter((s) => s.playerId === a.id).map((s) => s.token);
    this.store.commit({
      at,
      accounts: [{ ...a, lastLoginAt: at, lastLoginIp: meta.ip ?? null }],
      sessions: [{ token, playerId: a.id, createdAt: at }],
      revokeSessions: ended,
    });
    if (ended.length) {
      const t = this.now().getTime();
      for (const [k, when] of this.replaced) if (t - when > 7 * 86400_000) this.replaced.delete(k);
      for (const k of ended) this.replaced.set(k, t);
      this.events.emit("sessionsEnded", { tokens: ended, reason: "LOGGED_IN_ELSEWHERE" });
    }
    return { token, playerId: a.id };
  }

  /** True if this game token was ended because the player logged in on another device. */
  replacedByNewerLogin(token: string | undefined): boolean {
    return !!token && this.replaced.has(token);
  }

  logout(token: string | undefined): void {
    if (token && (this.store.sessions.has(token) || this.store.staffSessions.has(token))) {
      this.store.commit({ at: this.iso(), revokeSessions: [token] });
    }
  }

  /** The active operator, distributor or agent behind a back-office token. */
  staffForToken(token: string | undefined): Account {
    const s = token ? this.store.staffSessions.get(token) : undefined;
    const t = this.now().getTime();
    if (!s || Date.parse(s.expiresAt) <= t) throw new GameError("UNAUTHORIZED", "Please log in again", 401);
    const a = this.account(s.accountId);
    if (a.status !== "ACTIVE") throw new GameError("ACCOUNT_DISABLED", "This account is disabled", 403);
    if (!s.lastSeenAt || t - Date.parse(s.lastSeenAt) >= SEEN_EVERY_MS) {
      this.store.commit({ at: this.iso(), staffSessions: [{ ...s, lastSeenAt: this.iso() }] });
    }
    return a;
  }

  // ---------------------------------------------------------------- own account

  /** Changes the caller's own password; every other session of theirs is logged out. */
  changeOwnPassword(actor: Account, current: string, next: string, keepToken?: string): void {
    if (!verifyPassword(String(current ?? ""), actor.passwordHash)) throw new GameError("BAD_PASSWORD", "Current password is wrong", 403);
    checkStrongPassword(next);
    if (verifyPassword(next, actor.passwordHash)) throw new GameError("BAD_PASSWORD", "The new password must be different");
    this.store.commit({
      at: this.iso(),
      accounts: [{ ...actor, passwordHash: hashPassword(next) }],
      revokeSessions: this.tokensOf(actor.id).filter((t) => t !== keepToken),
    });
  }

  setTimeZone(actor: Account, timeZone: string): AccountView {
    timeZone = String(timeZone ?? "");
    try {
      if (!timeZone) throw new Error();
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      throw new GameError("BAD_TIME_ZONE", "Unknown time zone");
    }
    const next = { ...actor, timeZone };
    this.store.commit({ at: this.iso(), accounts: [next] });
    return this.view(next);
  }

  /** The caller's live back-office sessions, newest first. */
  sessions(actor: Account, currentToken?: string) {
    const t = this.now().getTime();
    return [...this.store.staffSessions.values()]
      .filter((s) => s.accountId === actor.id && Date.parse(s.expiresAt) > t)
      .reverse()
      .map((s) => ({
        // A short handle derived from the token, never any part of the token itself.
        id: createHash("sha256").update(s.token).digest("hex").slice(0, 12),
        current: s.token === currentToken,
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt ?? s.createdAt,
      }));
  }

  /** Logs the caller out everywhere except this session. Returns how many were ended. */
  logoutOthers(actor: Account, keepToken: string | undefined): number {
    const tokens = [...this.store.staffSessions.values()].filter((s) => s.accountId === actor.id && s.token !== keepToken).map((s) => s.token);
    if (tokens.length) this.store.commit({ at: this.iso(), revokeSessions: tokens });
    return tokens.length;
  }

  // ---------------------------------------------------------------- accounts

  private newAccount(role: Role, parentId: string | null, username: string, password: string): Account {
    username = String(username ?? "").trim();
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new GameError("BAD_USERNAME", "Username must be 3-32 letters, digits, _ . or -");
    checkPassword(password);
    if (this.byUsername(username)) throw new GameError("USERNAME_TAKEN", "That username is already taken", 409);
    let id: string;
    do id = ID_PREFIX[role] + randomBytes(8).toString("hex");
    while (this.store.accounts.has(id) || this.store.players.has(id));
    return { id, username, role, parentId, passwordHash: hashPassword(password), status: "ACTIVE", balanceCents: 0, createdAt: this.iso() };
  }

  /** Operator: a new distributor, optionally on a chosen math profile (checked by the caller). */
  createDistributor(username: string, password: string, profileId?: string): AccountView {
    const a = this.newAccount("DISTRIBUTOR", null, username, password);
    if (profileId) a.profileId = profileId;
    this.store.commit({ at: a.createdAt, accounts: [a] });
    return this.view(a);
  }

  /** A back-office login for the operator. Created with the admin key or SEED_OPERATOR. */
  createOperator(username: string, password: string): AccountView {
    const a = this.newAccount("OPERATOR", null, username, password);
    this.store.commit({ at: a.createdAt, accounts: [a] });
    return this.view(a);
  }

  /** An operator creates a distributor, a distributor an agent, an agent a player. */
  createChild(actor: Account, username: string, password: string, profileId?: string): AccountView {
    const role = CHILD_ROLE[actor.role];
    if (!role) throw new GameError("FORBIDDEN", "Players can't create accounts", 403);
    if (role === "DISTRIBUTOR") return this.createDistributor(username, password, profileId);
    const a = this.newAccount(role, actor.id, username, password);
    const commit: Commit = { at: a.createdAt, accounts: [a] };
    if (role === "PLAYER") commit.players = [{ id: a.id, balanceCents: 0, createdAt: a.createdAt }];
    this.store.commit(commit);
    return this.view(a);
  }

  /** The account `id`, if `actor` is its direct parent. */
  childOf(actor: Account, id: string): Account {
    const a = this.store.accounts.get(id);
    if (!a || !isChild(actor, a)) throw new GameError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    return a;
  }

  /** Children of `actor`, or (read only) of any account below it. */
  list(actor: Account, parentId?: string): AccountView[] {
    const parent = parentId && parentId !== actor.id ? this.visible(actor, parentId) : actor;
    return this.children(parent).map((a) => this.view(a));
  }

  setPassword(target: Account, password: string): void {
    checkPassword(password);
    const at = this.iso();
    const tokens = this.tokensOf(target.id);
    this.store.commit({ at, accounts: [{ ...target, passwordHash: hashPassword(password) }], revokeSessions: tokens });
    if (tokens.length) this.events.emit("sessionsEnded", { tokens, reason: "SIGNED_OUT" });
  }

  setStatus(target: Account, status: string): AccountView {
    if (status !== "ACTIVE" && status !== "DISABLED") throw new GameError("BAD_STATUS", "status must be ACTIVE or DISABLED");
    const at = this.iso();
    const next = { ...target, status } as Account;
    const tokens = status === "DISABLED" ? this.tokensOf(target.id) : [];
    this.store.commit({ at, accounts: [next], revokeSessions: tokens });
    if (tokens.length) this.events.emit("sessionsEnded", { tokens, reason: "SIGNED_OUT" });
    return this.view(next);
  }

  private tokensOf(accountId: string): string[] {
    return [
      ...[...this.store.sessions.values()].filter((s) => s.playerId === accountId).map((s) => s.token),
      ...[...this.store.staffSessions.values()].filter((s) => s.accountId === accountId).map((s) => s.token),
    ];
  }

  // ---------------------------------------------------------------- coin movements

  /**
   * Operator: issue points to a distributor (positive) or take them back
   * (negative). `actorId` is the operator account, or "operator" for the admin key.
   */
  issue(distributorId: string, requestId: string, amountCents: number, actorId = "operator", note?: string): { entry: LedgerEntry; balanceCents: number } {
    const d = this.account(distributorId);
    if (d.role !== "DISTRIBUTOR") throw new GameError("NOT_DISTRIBUTOR", "Points are issued to distributors only");
    if (!Number.isInteger(amountCents) || amountCents === 0) throw new GameError("BAD_AMOUNT", "amountCents must be a non-zero integer");
    const type: LedgerType = amountCents > 0 ? "ISSUE" : "REVOKE";
    return this.move(actorId, type, type === "ISSUE" ? null : d, type === "ISSUE" ? d : null, Math.abs(amountCents), requestId, note);
  }

  /** Parent gives coins to a child (distributor -> agent, agent -> player). */
  load(actor: Account, childId: string, requestId: string, amountCents: number, note?: string) {
    return this.move(actor.id, "LOAD", actor, this.childOf(actor, childId), amountCents, requestId, note);
  }

  /** Parent takes coins back from a child into its own balance. */
  redeem(actor: Account, childId: string, requestId: string, amountCents: number, note?: string) {
    return this.move(actor.id, "REDEEM", this.childOf(actor, childId), actor, amountCents, requestId, note);
  }

  /**
   * Moves `amountCents` from one account to another in one commit, with its
   * ledger entry. Idempotent on (actor, requestId): a retry returns the
   * original result and moves nothing.
   */
  private move(actorId: string, type: LedgerType, from: Account | null, to: Account | null, amountCents: number, requestId: string, note?: string) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
      throw new GameError("BAD_REQUEST_ID", "requestId must be 8-64 chars [A-Za-z0-9_-] (a UUID works)");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT) {
      throw new GameError("BAD_AMOUNT", "Amount must be a positive whole number of cents, at most 10,000,000.00");
    }
    note = typeof note === "string" ? note.trim().slice(0, 200) : "";
    const key = `ledger:${actorId}:${requestId}`;
    const fingerprint = canonicalJson({ type, from: from?.id ?? null, to: to?.id ?? null, amountCents });
    const prior = this.store.idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new GameError("IDEMPOTENCY_CONFLICT", "requestId was already used for a different request", 409);
      return prior.response as { entry: LedgerEntry; balanceCents: number };
    }
    // Coins can always come back out of a disabled account, but none go in.
    if (to && to.status !== "ACTIVE") throw new GameError("ACCOUNT_DISABLED", `${to.username} is disabled`, 409);

    const at = this.iso();
    const entryId = randomBytes(10).toString("hex");
    const commit: Commit = { at, accounts: [], players: [], txs: [] };
    const after = (a: Account | null, delta: number): number | null => {
      if (!a) return null;
      if (a.role === "PLAYER") {
        const w = new WalletTxBuilder(this.store.players.get(a.id)!, (id) => this.store.txs.get(id), at);
        if (w.player.balanceCents + delta < 0) throw new GameError("INSUFFICIENT_FUNDS", `${a.username} has only ${fmt(w.player.balanceCents)}`, 402);
        w.apply(`ledger:${entryId}`, delta > 0 ? "DEPOSIT" : "WITHDRAW", delta, null);
        commit.players!.push(w.player);
        commit.txs!.push(...w.txs);
        return w.player.balanceCents;
      }
      const bal = a.balanceCents + delta;
      if (bal < 0) throw new GameError("INSUFFICIENT_FUNDS", `${a.username} has only ${fmt(a.balanceCents)}`, 402);
      commit.accounts!.push({ ...a, balanceCents: bal });
      return bal;
    };
    const fromAfter = after(from, -amountCents);
    const toAfter = after(to, amountCents);
    const entry: LedgerEntry = {
      entryId,
      type,
      fromId: from?.id ?? null,
      toId: to?.id ?? null,
      amountCents,
      fromBalanceAfterCents: fromAfter,
      toBalanceAfterCents: toAfter,
      actorId,
      requestId,
      at,
    };
    if (note) entry.note = note;
    const actorAccount = this.store.accounts.get(actorId);
    // The operator holds no balance, so it sees the distributor's.
    const own = actorAccount && actorAccount.role !== "OPERATOR" ? (actorAccount.id === from?.id ? fromAfter : toAfter) : to ? toAfter : fromAfter;
    const response = { entry, balanceCents: own ?? 0 };
    commit.ledger = [entry];
    commit.idempotency = [{ key, fingerprint, response, at }];
    this.store.commit(commit);
    for (const a of [from, to]) {
      if (a?.role === "PLAYER") this.events.emit("playerBalance", { playerId: a.id, balanceCents: this.balanceOf(a) });
    }
    return response;
  }

  /**
   * Ledger entries an account may see (its own moves and those of every account
   * below it), newest first. Filters: `accountId` (id or username) keeps entries
   * touching that account, `types`, and a time range [from, to).
   */
  ledger(actor: Account, opts: LedgerQuery = {}) {
    const n = Math.max(1, Math.min(500, opts.limit ?? 100));
    const out: LedgerEntry[] = [];
    for (const e of this.ledgerEntries(actor, opts, opts.before)) {
      out.push(e);
      if (out.length >= n) break;
    }
    return out.map((e) => this.describe(e));
  }

  /** Every entry `ledger` would page through, newest first, without the page limit. */
  *ledgerEntries(actor: Account, opts: LedgerQuery = {}, before?: string): Generator<LedgerEntry> {
    const target = opts.accountId ? this.visible(actor, opts.accountId).id : null;
    const mine = actor.role === "OPERATOR" ? null : new Set([actor.id, ...this.descendants(actor).map((c) => c.id)]);
    const types = opts.types?.length ? new Set(opts.types) : null;
    const actorId = opts.actorId ? this.visible(actor, opts.actorId).id : null;
    const all = [...this.store.ledger.values()];
    let i = all.length - 1;
    if (before) {
      const j = all.findIndex((e) => e.entryId === before);
      if (j >= 0) i = j - 1;
    }
    for (; i >= 0; i--) {
      const e = all[i];
      if (opts.to && e.at >= opts.to) continue;
      if (opts.from && e.at < opts.from) break;
      if (types && !types.has(e.type)) continue;
      if (actorId && e.actorId !== actorId) continue;
      const touches = target
        ? e.fromId === target || e.toId === target
        : !mine || (e.fromId !== null && mine.has(e.fromId)) || (e.toId !== null && mine.has(e.toId));
      if (touches) yield e;
    }
  }

  /** A ledger entry with names and roles, for display. */
  describe(e: LedgerEntry) {
    const role = (id: string | null) => (id ? (this.store.accounts.get(id)?.role ?? null) : "OPERATOR");
    return {
      ...e,
      from: this.nameOf(e.fromId),
      to: this.nameOf(e.toId),
      fromRole: role(e.fromId),
      toRole: role(e.toId),
      actor: this.nameOf(e.actorId === "operator" ? null : e.actorId),
    };
  }

  private nameOf(id: string | null): string {
    return id ? (this.store.accounts.get(id)?.username ?? id) : "operator";
  }

  /** Operator view: every account. */
  all(): AccountView[] {
    return [...this.store.accounts.values()].map((a) => this.view(a));
  }

  /**
   * Checks that every distributor / agent balance equals its ledger flows, and
   * that points are conserved: issued minus revoked equals what distributors,
   * agents and players received net through the ledger.
   */
  audit() {
    const net = new Map<string, number>();
    let issued = 0;
    for (const e of this.store.ledger.values()) {
      if (e.fromId) net.set(e.fromId, (net.get(e.fromId) ?? 0) - e.amountCents);
      if (e.toId) net.set(e.toId, (net.get(e.toId) ?? 0) + e.amountCents);
      if (e.type === "ISSUE") issued += e.amountCents;
      if (e.type === "REVOKE") issued -= e.amountCents;
    }
    let staffOk = true;
    let held = 0;
    for (const a of this.store.accounts.values()) {
      const n = net.get(a.id) ?? 0;
      held += n;
      if (a.role !== "PLAYER" && n !== a.balanceCents) staffOk = false;
    }
    return { staffBalancesMatchLedger: staffOk, pointsConserved: held === issued, issuedCents: issued, ledgerEntries: this.store.ledger.size };
  }

  /** Creates the first operator login at startup (SEED_OPERATOR) if the username is free. */
  seedOperator(username: string, password: string): AccountView | null {
    return this.byUsername(username) ? null : this.createOperator(username, password);
  }

  /** Creates the first distributor at startup (dev, or from SEED_DISTRIBUTOR) if the username is free. */
  seed(username: string, password: string, pointsCents: number): AccountView | null {
    if (this.byUsername(username)) return null;
    const d = this.createDistributor(username, password);
    if (pointsCents > 0) this.issue(d.id, `seed-${d.id}`, pointsCents);
    return this.view(this.account(d.id));
  }
}

export interface LedgerQuery {
  accountId?: string;
  /** Only moves made by this account (id or username). */
  actorId?: string;
  types?: LedgerType[];
  /** ISO time, inclusive. */
  from?: string;
  /** ISO time, exclusive. */
  to?: string;
  limit?: number;
  before?: string;
}

/** Operators have no parent account: every distributor is theirs. */
function isChild(parent: Account, a: Account): boolean {
  return parent.role === "OPERATOR" ? a.role === "DISTRIBUTOR" : a.parentId === parent.id;
}

function checkPassword(p: unknown): void {
  if (typeof p !== "string" || p.length < 6 || p.length > 64) throw new GameError("BAD_PASSWORD", "Password must be 6-64 characters");
}

/** The rule for staff changing their own password. */
export function checkStrongPassword(p: unknown): void {
  if (typeof p !== "string" || p.length < 10 || p.length > 64 || !/[A-Z]/.test(p) || !/[0-9]/.test(p)) {
    throw new GameError("WEAK_PASSWORD", "At least 10 characters with an upper-case letter and a number");
  }
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
