import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JackpotState } from "../engine/jackpots.js";
import type { PendingFeatures, Step } from "../engine/engine.js";

export interface Player {
  id: string;
  balanceCents: number;
  createdAt: string;
}

export type TxType = "DEPOSIT" | "WITHDRAW" | "BET" | "WIN" | "JACKPOT";

export interface Tx {
  /** Idempotency key: a retried transaction with the same id is applied once. */
  txId: string;
  playerId: string;
  type: TxType;
  /** Signed: negative for BET and WITHDRAW. */
  amountCents: number;
  balanceAfterCents: number;
  roundId: string | null;
  at: string;
}

export interface Round {
  roundId: string;
  playerId: string;
  betCents: number;
  profileId: string;
  profileHash: string;
  status: "OPEN" | "COMPLETE";
  startedAt: string;
  completedAt: string | null;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  totalWinCents: number;
  steps: (Step & { at: string })[];
  pending: PendingFeatures;
  /** Jackpot contributions taken from this round's bet, in 1/10,000 cent units. */
  jackpotContributionUnits: Record<string, number>;
}

export interface Session {
  token: string;
  playerId: string;
  createdAt: string;
}

export type Role = "DISTRIBUTOR" | "AGENT" | "PLAYER";

/**
 * A login. Distributors and agents hold points in `balanceCents`. A player's
 * coins live in its Player record (same id), so the game wallet is unchanged.
 */
export interface Account {
  id: string;
  username: string;
  role: Role;
  /** Distributor for an agent, agent for a player, null for a distributor (owned by the operator). */
  parentId: string | null;
  /** scrypt$<salt b64>$<hash b64> */
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
  balanceCents: number;
  createdAt: string;
}

/** Back-office (distributor / agent) login. */
export interface StaffSession {
  token: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
}

export type LedgerType = "ISSUE" | "REVOKE" | "LOAD" | "REDEEM";

/**
 * One coin movement between accounts. ISSUE / REVOKE: operator to / from a
 * distributor. LOAD: parent to child. REDEEM: child back to parent.
 */
export interface LedgerEntry {
  entryId: string;
  type: LedgerType;
  /** null is the operator (outside the system). */
  fromId: string | null;
  toId: string | null;
  /** Always positive. */
  amountCents: number;
  fromBalanceAfterCents: number | null;
  toBalanceAfterCents: number | null;
  /** Account id that made the move, or "operator". */
  actorId: string;
  requestId: string;
  at: string;
}

export interface IdempotencyEntry {
  key: string;
  fingerprint: string;
  response: unknown;
  at: string;
}

/** One atomic change set. Every mutation goes through a single commit. */
export interface Commit {
  at: string;
  players?: Player[];
  txs?: Tx[];
  rounds?: Round[];
  jackpots?: JackpotState;
  sessions?: Session[];
  idempotency?: IdempotencyEntry[];
  accounts?: Account[];
  staffSessions?: StaffSession[];
  ledger?: LedgerEntry[];
  /** Tokens to delete from both session maps (logout, password reset, disable). */
  revokeSessions?: string[];
}

/**
 * In-memory state plus an optional append-only journal. Each commit is written
 * as one JSON line before it is applied, and the journal is replayed on start,
 * so the journal is both the audit trail and the database. PgStore
 * (pgStore.ts) keeps the same in-memory state but makes PostgreSQL the
 * durable copy instead of the file.
 */
export class Store {
  readonly players = new Map<string, Player>();
  readonly txs = new Map<string, Tx>();
  readonly rounds = new Map<string, Round>();
  readonly roundsByPlayer = new Map<string, string[]>();
  readonly sessions = new Map<string, Session>();
  readonly idempotency = new Map<string, IdempotencyEntry>();
  readonly accounts = new Map<string, Account>();
  /** lower-case username -> account id */
  readonly usernames = new Map<string, string>();
  readonly staffSessions = new Map<string, StaffSession>();
  readonly ledger = new Map<string, LedgerEntry>();
  jackpots: JackpotState | null = null;

  constructor(private readonly journalPath?: string) {
    if (journalPath) {
      mkdirSync(dirname(journalPath), { recursive: true });
      if (existsSync(journalPath)) {
        for (const line of readFileSync(journalPath, "utf8").split("\n")) {
          if (line.trim()) this.apply(JSON.parse(line) as Commit);
        }
      }
    }
  }

  commit(c: Commit): void {
    this.persist(c);
    this.apply(c);
  }

  /** Makes a commit durable. The file journal writes synchronously. */
  protected persist(c: Commit): void {
    if (this.journalPath) appendFileSync(this.journalPath, JSON.stringify(c) + "\n");
  }

  /**
   * Resolves once every commit so far is durable. The API waits on this before
   * answering, so no client ever sees a result that a crash could undo.
   */
  flushed(): Promise<void> {
    return Promise.resolve();
  }

  protected apply(c: Commit): void {
    c.players?.forEach((p) => this.players.set(p.id, p));
    c.txs?.forEach((t) => this.txs.set(t.txId, t));
    c.rounds?.forEach((r) => {
      if (!this.rounds.has(r.roundId)) {
        const list = this.roundsByPlayer.get(r.playerId) ?? [];
        list.push(r.roundId);
        this.roundsByPlayer.set(r.playerId, list);
      }
      this.rounds.set(r.roundId, r);
    });
    if (c.jackpots) this.jackpots = c.jackpots;
    c.sessions?.forEach((s) => this.sessions.set(s.token, s));
    c.idempotency?.forEach((e) => this.idempotency.set(e.key, e));
    c.accounts?.forEach((a) => {
      this.accounts.set(a.id, a);
      this.usernames.set(a.username.toLowerCase(), a.id);
    });
    c.staffSessions?.forEach((s) => this.staffSessions.set(s.token, s));
    c.ledger?.forEach((e) => this.ledger.set(e.entryId, e));
    c.revokeSessions?.forEach((t) => {
      this.sessions.delete(t);
      this.staffSessions.delete(t);
    });
  }
}
