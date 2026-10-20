import { readFileSync } from "node:fs";
import pg from "pg";
import type { JackpotState } from "../engine/jackpots.js";
import { Commit, Store } from "./store.js";

/** Advisory lock key held for the life of the process: one game server per database. */
const SERVER_LOCK = 777_000_777;

type Writer = (c: pg.PoolClient, rows: unknown[]) => Promise<unknown>;

/**
 * Upserts rows from a JSON array in one statement. `cols` maps column names to
 * SQL expressions over the element `x` (the record), in array order so `seq`
 * follows commit order.
 */
function upsert(table: string, key: string, cols: Record<string, string>, onConflict: "update" | "nothing" = "update"): Writer {
  const names = [...Object.keys(cols), "data"];
  const exprs = [...Object.values(cols), "x"];
  const conflict =
    onConflict === "nothing"
      ? "DO NOTHING"
      : `DO UPDATE SET ${names.filter((n) => n !== key).map((n) => `${n} = EXCLUDED.${n}`).join(", ")}`;
  const sql =
    `INSERT INTO ${table} (${names.join(", ")}) ` +
    `SELECT ${exprs.join(", ")} FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(x, n) ORDER BY n ` +
    `ON CONFLICT (${key}) ${conflict}`;
  return (c, rows) => c.query(sql, [JSON.stringify(rows)]);
}

const ts = (f: string) => `(x->>'${f}')::timestamptz`;
const big = (f: string) => `(x->>'${f}')::bigint`;
const txt = (f: string) => `x->>'${f}'`;

const WRITERS = {
  players: upsert("players", "id", { id: txt("id"), balance_cents: big("balanceCents") }),
  txs: upsert(
    "txs",
    "tx_id",
    {
      tx_id: txt("txId"),
      player_id: txt("playerId"),
      type: txt("type"),
      amount_cents: big("amountCents"),
      balance_after_cents: big("balanceAfterCents"),
      round_id: txt("roundId"),
      at: ts("at"),
    },
    "nothing",
  ),
  rounds: upsert("rounds", "round_id", {
    round_id: txt("roundId"),
    player_id: txt("playerId"),
    status: txt("status"),
    bet_cents: big("betCents"),
    total_win_cents: big("totalWinCents"),
    profile_id: txt("profileId"),
    started_at: ts("startedAt"),
    completed_at: ts("completedAt"),
  }),
  sessions: upsert("sessions", "token", { token: txt("token"), player_id: txt("playerId") }),
  staffSessions: upsert("staff_sessions", "token", { token: txt("token"), account_id: txt("accountId") }),
  idempotency: upsert("idempotency", "key", { key: txt("key") }),
  accounts: upsert("accounts", "id", {
    id: txt("id"),
    username: txt("username"),
    role: txt("role"),
    parent_id: txt("parentId"),
    status: txt("status"),
    balance_cents: big("balanceCents"),
  }),
  ledger: upsert(
    "ledger",
    "entry_id",
    {
      entry_id: txt("entryId"),
      type: txt("type"),
      from_id: txt("fromId"),
      to_id: txt("toId"),
      amount_cents: big("amountCents"),
      actor_id: txt("actorId"),
      at: ts("at"),
    },
    "nothing",
  ),
} satisfies Partial<Record<keyof Commit, Writer>>;

/** Keys that identify a record, to drop earlier duplicates inside one batch. */
const KEY: Record<keyof typeof WRITERS, string> = {
  players: "id",
  txs: "txId",
  rounds: "roundId",
  sessions: "token",
  staffSessions: "token",
  idempotency: "key",
  accounts: "id",
  ledger: "entryId",
};

function lastByKey<T>(rows: T[], key: string): T[] {
  const m = new Map<unknown, T>();
  for (const r of rows) {
    const k = (r as Record<string, unknown>)[key];
    m.delete(k);
    m.set(k, r);
  }
  return [...m.values()];
}

export interface PgStoreOptions {
  connectionString: string;
  /** Called if a write fails. Memory is then ahead of the database, so the default stops the process. */
  onFatal?: (err: unknown) => void;
}

/**
 * PostgreSQL-backed store.
 *
 * The game logic stays synchronous: state lives in memory exactly as with the
 * file journal, and this class makes each commit durable in PostgreSQL. Commits
 * are queued in order and written in one database transaction per batch (group
 * commit). The API waits for `flushed()` before answering, so a client never
 * sees a result that isn't in the database yet.
 *
 * On start the store takes an advisory lock, so only one game server can use
 * a database at a time (two writers would each trust their own memory), applies
 * schema.sql, and loads every table back into memory.
 */
export class PgStore extends Store {
  private queue: Commit[] = [];
  private writing: Promise<void> = Promise.resolve();
  private failed: unknown = null;

  private constructor(
    private readonly pool: pg.Pool,
    private readonly lockClient: pg.PoolClient,
    private readonly onFatal: (err: unknown) => void,
  ) {
    super();
  }

  static async open(o: PgStoreOptions): Promise<PgStore> {
    const pool = new pg.Pool({ connectionString: o.connectionString, max: 4 });
    const lockClient = await pool.connect();
    const { rows } = await lockClient.query("SELECT pg_try_advisory_lock($1) AS ok", [SERVER_LOCK]);
    if (!rows[0].ok) {
      lockClient.release();
      await pool.end();
      throw new Error("Another Jack Vault server is already using this database");
    }
    const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    await lockClient.query(sql);
    const store = new PgStore(
      pool,
      lockClient,
      o.onFatal ??
        ((err) => {
          console.error("FATAL: database write failed; stopping so state reloads from the database.", err);
          process.exit(1);
        }),
    );
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    const q = async <T>(sql: string): Promise<T[]> => (await this.lockClient.query(sql)).rows.map((r) => r.data as T);
    const c: Commit = {
      at: new Date().toISOString(),
      accounts: await q("SELECT data FROM accounts ORDER BY seq"),
      players: await q("SELECT data FROM players ORDER BY seq"),
      txs: await q("SELECT data FROM txs ORDER BY seq"),
      rounds: await q("SELECT data FROM rounds ORDER BY seq"),
      sessions: await q("SELECT data FROM sessions ORDER BY seq"),
      staffSessions: await q("SELECT data FROM staff_sessions ORDER BY seq"),
      idempotency: await q("SELECT data FROM idempotency ORDER BY seq"),
      ledger: await q("SELECT data FROM ledger ORDER BY seq"),
    };
    const j = await q<JackpotState>("SELECT data FROM jackpots WHERE id = 1");
    if (j.length) c.jackpots = j[0];
    this.apply(c);
  }

  protected override persist(c: Commit): void {
    if (this.failed) throw new Error("Database unavailable");
    this.queue.push(c);
    if (this.queue.length === 1) {
      this.writing = this.writing.then(() => this.drain());
      // Failures are reported through onFatal and flushed(); don't also crash on an unhandled rejection.
      this.writing.catch(() => undefined);
    }
  }

  override flushed(): Promise<void> {
    return this.writing.then(() => (this.queue.length ? this.flushed() : undefined));
  }

  /** Writes everything queued so far in one transaction. */
  private async drain(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    if (!batch.length || this.failed) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Records of each kind, in commit order, last version of each key.
      for (const kind of Object.keys(WRITERS) as (keyof typeof WRITERS)[]) {
        const rows = lastByKey(batch.flatMap((c) => (c[kind] as unknown[] | undefined) ?? []), KEY[kind]);
        if (rows.length) await WRITERS[kind](client, rows);
      }
      const jackpots = [...batch].reverse().find((c) => c.jackpots)?.jackpots;
      if (jackpots) {
        await client.query(
          "INSERT INTO jackpots (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
          [JSON.stringify(jackpots)],
        );
      }
      const revoked = batch.flatMap((c) => c.revokeSessions ?? []);
      if (revoked.length) {
        await client.query("DELETE FROM sessions WHERE token = ANY($1)", [revoked]);
        await client.query("DELETE FROM staff_sessions WHERE token = ANY($1)", [revoked]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.failed = err;
      this.onFatal(err);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.flushed().catch(() => undefined);
    await this.lockClient.query("SELECT pg_advisory_unlock($1)", [SERVER_LOCK]).catch(() => undefined);
    this.lockClient.release();
    await this.pool.end();
  }
}
