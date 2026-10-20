-- Jack Vault PostgreSQL schema. Applied automatically by PgStore on start.
-- Every table keeps the full record in `data` (the shape in store.ts) plus the
-- columns worth querying or reporting on. `seq` keeps insertion order.

CREATE TABLE IF NOT EXISTS players (
  id            text PRIMARY KEY,
  balance_cents bigint NOT NULL CHECK (balance_cents >= 0),
  data          jsonb NOT NULL,
  seq           bigserial
);

CREATE TABLE IF NOT EXISTS txs (
  tx_id               text PRIMARY KEY,
  player_id           text NOT NULL,
  type                text NOT NULL,
  amount_cents        bigint NOT NULL,
  balance_after_cents bigint NOT NULL,
  round_id            text,
  at                  timestamptz NOT NULL,
  data                jsonb NOT NULL,
  seq                 bigserial
);
CREATE INDEX IF NOT EXISTS txs_player_seq ON txs (player_id, seq);

CREATE TABLE IF NOT EXISTS rounds (
  round_id        text PRIMARY KEY,
  player_id       text NOT NULL,
  status          text NOT NULL,
  bet_cents       bigint NOT NULL,
  total_win_cents bigint NOT NULL,
  profile_id      text NOT NULL,
  started_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  data            jsonb NOT NULL,
  seq             bigserial
);
CREATE INDEX IF NOT EXISTS rounds_player_seq ON rounds (player_id, seq);
CREATE INDEX IF NOT EXISTS rounds_started ON rounds (started_at);

CREATE TABLE IF NOT EXISTS jackpots (
  id   int PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token     text PRIMARY KEY,
  player_id text NOT NULL,
  data      jsonb NOT NULL,
  seq       bigserial
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token      text PRIMARY KEY,
  account_id text NOT NULL,
  data       jsonb NOT NULL,
  seq        bigserial
);

CREATE TABLE IF NOT EXISTS idempotency (
  key  text PRIMARY KEY,
  data jsonb NOT NULL,
  seq  bigserial
);

CREATE TABLE IF NOT EXISTS accounts (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  role          text NOT NULL,
  parent_id     text,
  status        text NOT NULL,
  balance_cents bigint NOT NULL CHECK (balance_cents >= 0),
  data          jsonb NOT NULL,
  seq           bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username ON accounts (lower(username));
CREATE INDEX IF NOT EXISTS accounts_parent ON accounts (parent_id);

CREATE TABLE IF NOT EXISTS ledger (
  entry_id     text PRIMARY KEY,
  type         text NOT NULL,
  from_id      text,
  to_id        text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  actor_id     text NOT NULL,
  at           timestamptz NOT NULL,
  data         jsonb NOT NULL,
  seq          bigserial
);
CREATE INDEX IF NOT EXISTS ledger_from ON ledger (from_id, seq);
CREATE INDEX IF NOT EXISTS ledger_to ON ledger (to_id, seq);
