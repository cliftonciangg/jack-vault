import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { GameError } from "../engine/engine.js";
import { canonicalJson } from "../math/profile.js";
import type { Account, Commit, LedgerEntry, LedgerType, Role, Store } from "../store/store.js";
import { WalletTxBuilder } from "../wallet/wallet.js";

/**
 * Distributor -> agent -> player coin system.
 *
 * The operator (ADMIN_KEY) creates distributors and issues points to them.
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
}

export interface AccountView {
  id: string;
  username: string;
  role: Role;
  parentId: string | null;
  status: Account["status"];
  balanceCents: number;
  createdAt: string;
  /** Distributor's agents / agent's players. */
  children?: number;
  /** Sum of the children's balances. */
  childrenBalanceCents?: number;
}

const CHILD_ROLE: Record<Role, Role | null> = { DISTRIBUTOR: "AGENT", AGENT: "PLAYER", PLAYER: null };
const ID_PREFIX: Record<Role, string> = { DISTRIBUTOR: "d_", AGENT: "a_", PLAYER: "p_" };
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
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
  /** "playerBalance" { playerId, balanceCents } after a load or redeem, for the live game. */
  readonly events = new EventEmitter();
  private readonly store: Store;
  private readonly now: () => Date;
  private readonly staffSessionMs: number;
  /** Failed logins per lower-case username (in memory; resets on restart). */
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(o: AccountServiceOptions) {
    this.store = o.store;
    this.now = o.now ?? (() => new Date());
    this.staffSessionMs = o.staffSessionMs ?? 12 * 3600_000;
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

  children(parentId: string): Account[] {
    return [...this.store.accounts.values()].filter((a) => a.parentId === parentId);
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
    };
    if (a.role !== "PLAYER") {
      const kids = this.children(a.id);
      v.children = kids.length;
      v.childrenBalanceCents = kids.reduce((s, k) => s + this.balanceOf(k), 0);
    }
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

  /** Back-office login for distributors and agents. */
  staffLogin(username: string, password: string): { token: string; account: AccountView } {
    const a = this.login(username, password, ["DISTRIBUTOR", "AGENT"]);
    const at = this.now();
    const token = randomBytes(24).toString("base64url");
    this.store.commit({
      at: at.toISOString(),
      staffSessions: [{ token, accountId: a.id, createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + this.staffSessionMs).toISOString() }],
    });
    return { token, account: this.view(a) };
  }

  /** Game login for players: opens a normal game session, so every game route works unchanged. */
  playerLogin(username: string, password: string): { token: string; playerId: string } {
    const a = this.login(username, password, ["PLAYER"]);
    const token = randomBytes(24).toString("base64url");
    const at = this.iso();
    this.store.commit({ at, sessions: [{ token, playerId: a.id, createdAt: at }] });
    return { token, playerId: a.id };
  }

  logout(token: string | undefined): void {
    if (token && (this.store.sessions.has(token) || this.store.staffSessions.has(token))) {
      this.store.commit({ at: this.iso(), revokeSessions: [token] });
    }
  }

  /** The active distributor or agent behind a back-office token. */
  staffForToken(token: string | undefined): Account {
    const s = token ? this.store.staffSessions.get(token) : undefined;
    if (!s || Date.parse(s.expiresAt) <= this.now().getTime()) throw new GameError("UNAUTHORIZED", "Please log in again", 401);
    const a = this.account(s.accountId);
    if (a.status !== "ACTIVE") throw new GameError("ACCOUNT_DISABLED", "This account is disabled", 403);
    return a;
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

  /** Operator: a new distributor. */
  createDistributor(username: string, password: string): AccountView {
    const a = this.newAccount("DISTRIBUTOR", null, username, password);
    this.store.commit({ at: a.createdAt, accounts: [a] });
    return this.view(a);
  }

  /** A distributor creates an agent; an agent creates a player. */
  createChild(actor: Account, username: string, password: string): AccountView {
    const role = CHILD_ROLE[actor.role];
    if (!role) throw new GameError("FORBIDDEN", "Players can't create accounts", 403);
    const a = this.newAccount(role, actor.id, username, password);
    const commit: Commit = { at: a.createdAt, accounts: [a] };
    if (role === "PLAYER") commit.players = [{ id: a.id, balanceCents: 0, createdAt: a.createdAt }];
    this.store.commit(commit);
    return this.view(a);
  }

  /** The account `id`, if `actor` is its direct parent. */
  childOf(actor: Account, id: string): Account {
    const a = this.store.accounts.get(id);
    if (!a || a.parentId !== actor.id) throw new GameError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    return a;
  }

  /** Children of `actor`, or of one of its agents (read-only view for a distributor). */
  list(actor: Account, parentId?: string): AccountView[] {
    const parent = parentId && parentId !== actor.id ? this.childOf(actor, parentId) : actor;
    return this.children(parent.id).map((a) => this.view(a));
  }

  setPassword(target: Account, password: string): void {
    checkPassword(password);
    const at = this.iso();
    this.store.commit({ at, accounts: [{ ...target, passwordHash: hashPassword(password) }], revokeSessions: this.tokensOf(target.id) });
  }

  setStatus(target: Account, status: string): AccountView {
    if (status !== "ACTIVE" && status !== "DISABLED") throw new GameError("BAD_STATUS", "status must be ACTIVE or DISABLED");
    const at = this.iso();
    const next = { ...target, status } as Account;
    this.store.commit({ at, accounts: [next], revokeSessions: status === "DISABLED" ? this.tokensOf(target.id) : [] });
    return this.view(next);
  }

  private tokensOf(accountId: string): string[] {
    return [
      ...[...this.store.sessions.values()].filter((s) => s.playerId === accountId).map((s) => s.token),
      ...[...this.store.staffSessions.values()].filter((s) => s.accountId === accountId).map((s) => s.token),
    ];
  }

  // ---------------------------------------------------------------- coin movements

  /** Operator: issue points to a distributor (positive) or take them back (negative). */
  issue(distributorId: string, requestId: string, amountCents: number): { entry: LedgerEntry; balanceCents: number } {
    const d = this.account(distributorId);
    if (d.role !== "DISTRIBUTOR") throw new GameError("NOT_DISTRIBUTOR", "Points are issued to distributors only");
    if (!Number.isInteger(amountCents) || amountCents === 0) throw new GameError("BAD_AMOUNT", "amountCents must be a non-zero integer");
    const type: LedgerType = amountCents > 0 ? "ISSUE" : "REVOKE";
    return this.move("operator", type, type === "ISSUE" ? null : d, type === "ISSUE" ? d : null, Math.abs(amountCents), requestId);
  }

  /** Parent gives coins to a child (distributor -> agent, agent -> player). */
  load(actor: Account, childId: string, requestId: string, amountCents: number) {
    return this.move(actor.id, "LOAD", actor, this.childOf(actor, childId), amountCents, requestId);
  }

  /** Parent takes coins back from a child into its own balance. */
  redeem(actor: Account, childId: string, requestId: string, amountCents: number) {
    return this.move(actor.id, "REDEEM", this.childOf(actor, childId), actor, amountCents, requestId);
  }

  /**
   * Moves `amountCents` from one account to another in one commit, with its
   * ledger entry. Idempotent on (actor, requestId): a retry returns the
   * original result and moves nothing.
   */
  private move(actorId: string, type: LedgerType, from: Account | null, to: Account | null, amountCents: number, requestId: string) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
      throw new GameError("BAD_REQUEST_ID", "requestId must be 8-64 chars [A-Za-z0-9_-] (a UUID works)");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT) {
      throw new GameError("BAD_AMOUNT", "Amount must be a positive whole number of cents, at most 10,000,000.00");
    }
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
    const actorAccount = actorId === "operator" ? null : this.store.accounts.get(actorId)!;
    const own = actorAccount ? (actorAccount.id === from?.id ? fromAfter : toAfter) : (to ? toAfter : fromAfter);
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
   * Ledger entries an account may see: its own moves and its children's, newest
   * first. With `accountId`, only entries touching that account (itself or a child).
   */
  ledger(actor: Account, opts: { accountId?: string; limit?: number; before?: string } = {}) {
    const mine = new Set([actor.id, ...this.children(actor.id).map((c) => c.id)]);
    if (actor.role === "DISTRIBUTOR") for (const agent of this.children(actor.id)) for (const p of this.children(agent.id)) mine.add(p.id);
    if (opts.accountId && !mine.has(opts.accountId)) throw new GameError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    const n = Math.max(1, Math.min(500, opts.limit ?? 100));
    const out: LedgerEntry[] = [];
    const all = [...this.store.ledger.values()];
    let i = all.length - 1;
    if (opts.before) {
      const j = all.findIndex((e) => e.entryId === opts.before);
      if (j >= 0) i = j - 1;
    }
    for (; i >= 0 && out.length < n; i--) {
      const e = all[i];
      const touches = opts.accountId ? e.fromId === opts.accountId || e.toId === opts.accountId : (e.fromId && mine.has(e.fromId)) || (e.toId && mine.has(e.toId));
      if (touches) out.push(e);
    }
    return out.map((e) => ({ ...e, from: this.nameOf(e.fromId), to: this.nameOf(e.toId), actor: this.nameOf(e.actorId === "operator" ? null : e.actorId) }));
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

  /** Creates the first distributor at startup (dev, or from SEED_DISTRIBUTOR) if the username is free. */
  seed(username: string, password: string, pointsCents: number): AccountView | null {
    if (this.byUsername(username)) return null;
    const d = this.createDistributor(username, password);
    if (pointsCents > 0) this.issue(d.id, `seed-${d.id}`, pointsCents);
    return this.view(this.account(d.id));
  }
}

function checkPassword(p: unknown): void {
  if (typeof p !== "string" || p.length < 6 || p.length > 64) throw new GameError("BAD_PASSWORD", "Password must be 6-64 characters");
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
