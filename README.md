# Jack Vault: game server

Server-authoritative backend for Jack Vault, a 5x4, 25-line reels game with free spins, the Super Wheel bonus and four progressive jackpots (Grand, Major, Minor, Mini). The mobile client lives in [`client/`](client/README.md) and only animates what this server tells it.

All code here is original. The runtime dependencies are [`ws`](https://github.com/websockets/ws) (MIT) and [`pg`](https://github.com/brianc/node-postgres) (MIT). Dev tools are TypeScript (Apache-2.0), tsx (MIT) and @types (MIT).

## Run it

Needs Node 20+.

```bash
npm install
npm test          # 38 tests: math, RNG, wallet, jackpots, replay, API, accounts and ledger, PostgreSQL, and 1M-spin RTP checks per profile
npm run sim       # 5M-spin Monte Carlo of rtp95 vs. the exact RTP (options below)
npm start         # API on http://localhost:8080 (journal file in ./data, no database needed)
```

To run on PostgreSQL instead, set `DATABASE_URL` (see [Database](#database)), or start the server and a database together with `docker compose up --build`.

Then, in a second terminal, `npm install --prefix client && npm run client` and open http://localhost:5173. See [client/README.md](client/README.md).

The back office for distributors and agents is at http://localhost:8080/office (or http://localhost:5173/office while the client dev server runs). Outside production the server creates a first distributor, **demo-distributor** / **demo1234**, with 100,000.00 points. See [Distributors, agents and players](#distributors-agents-and-players).

Other scripts:

| Command | What it does |
|---|---|
| `npm run sim -- --profile rtp94 --spins 20000000 --bet 25 --seed 42` | Simulate any profile, bet and spin count. Without `--seed` it uses the production crypto RNG. |
| `npm run par` | Writes the math sheet (strips, paytable, RTP by bet, feature odds) to `docs/par-sheet.md`. |
| `npm run tune` | Rebuilds `profiles/rtp94.json`, `rtp95.json`, `rtp96.json` from `src/math/design.ts`. |
| `npm run tune -- --target 0.955 --id rtp955` | Builds a profile for any RTP target. |
| `npm run typecheck` / `npm run build` | TypeScript check / compile to `dist/`. |

Server environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP and WebSocket port |
| `MATH_PROFILE` | rtp95 | Which RTP profile new rounds use (`rtp94`, `rtp95`, `rtp96`, or one you tuned) |
| `DATABASE_URL` | unset | PostgreSQL connection string, e.g. `postgres://jackvault:pw@localhost:5432/jackvault`. When set, PostgreSQL is the database and `DATA_DIR` is ignored. |
| `DATA_DIR` | ./data | Without a database: where the journal file lives. `memory` keeps nothing on disk. |
| `ALLOW_PLAYER_CREATE` | 0 | `1` lets `POST /api/sessions` create guest players with no password (old demo mode). Agent-made players can never log in this way. |
| `STARTING_BALANCE_CENTS` | 100000 | Balance for a guest player (only with `ALLOW_PLAYER_CREATE=1`) |
| `SEED_DISTRIBUTOR` | `demo-distributor:demo1234` (unset when `NODE_ENV=production`) | `username:password` of a distributor created at start if that username doesn't exist yet |
| `SEED_POINTS_CENTS` | 10000000 | Points issued to that new distributor (100,000.00) |
| `ADMIN_KEY` | unset | Enables `/api/admin/*`, sent as the `x-admin-key` header |
| `CORS_ORIGIN` | unset | Allowed browser origin for a web client |

## Distributors, agents and players

Coins come down a three-level chain. Nobody can create coins except the operator.

| Who | Logs in at | Can do |
|---|---|---|
| **Operator** | `/office`, "Operator" tab, with `ADMIN_KEY` | Create distributors, issue points to them or take points back, reset passwords, disable accounts, see every account and the ledger check |
| **Distributor** | `/office` | Create agents, **load** points to an agent (out of the distributor's own points) and **redeem** them back, reset an agent's password, disable an agent, view each agent's players (read only), see the ledger |
| **Agent** | `/office` | Create players, **load** coins to a player (out of the agent's own points) and **redeem** them back, reset a player's password, disable a player, see the ledger |
| **Player** | The game's start screen | Play with the balance the agent loaded. A load or redeem shows up in the open game right away. |

How it works (`src/accounts/accounts.ts`):

- **Passwords** are hashed with scrypt and a random salt. Five wrong passwords lock that username for a minute. Back-office sessions last 12 hours. Resetting a password or disabling an account logs it out everywhere.
- **Every coin movement is one ledger entry** (`ISSUE`, `REVOKE`, `LOAD`, `REDEEM`) with who moved it, from and to which account, the amount and both balances after. It is written in the same journal line as the balance changes, so the two can't disagree. A player's load or redeem also writes a `DEPOSIT` / `WITHDRAW` transaction to the player's game wallet, so the game's own audit keeps working.
- **No overdrafts.** A distributor can't load more than it holds, an agent can't load more than it holds, and nobody can redeem more than the account has. Coins can always be redeemed out of a disabled account, but not loaded into one.
- **Retry-safe.** Every load and redeem takes a `requestId`. Sending the same one again (after a dropped connection, say) returns the first result and moves nothing.
- **Scoped.** A distributor only sees and touches its own agents (and reads their players); an agent only its own players. Anything else is a 404.
- **Audit.** `GET /api/admin/audit` now also reports `accounts.staffBalancesMatchLedger` (every distributor and agent balance equals its ledger flows) and `accounts.pointsConserved` (points issued minus taken back equals what's held across distributors, agents and players through the ledger).

Account endpoints (money in integer cents; office calls use the token from `/api/office/login` as `Authorization: Bearer`):

| Method | Path | Auth | Body / query |
|---|---|---|---|
| POST | `/api/player/login` | | `{ username, password }` returns `{ token, playerId, state }`; the token works on every game route |
| POST | `/api/player/logout` | Bearer (game) | |
| POST | `/api/office/login` | | `{ username, password }` returns `{ token, account }` (distributors and agents) |
| POST | `/api/office/logout` | Bearer (office) | |
| GET | `/api/office/me` | Bearer (office) | Own account and points |
| GET | `/api/office/accounts` | Bearer (office) | `?parent=<agentId>` for a distributor to list one agent's players |
| POST | `/api/office/accounts` | Bearer (office) | `{ username, password }`: a distributor creates an agent, an agent creates a player |
| POST | `/api/office/accounts/:id/load` | Bearer (office) | `{ requestId, amountCents }` |
| POST | `/api/office/accounts/:id/redeem` | Bearer (office) | `{ requestId, amountCents }` |
| POST | `/api/office/accounts/:id/password` | Bearer (office) | `{ password }` |
| POST | `/api/office/accounts/:id/status` | Bearer (office) | `{ status: "ACTIVE" \| "DISABLED" }` |
| GET | `/api/office/ledger` | Bearer (office) | `?account=<id>&limit=100&before=<entryId>` |
| GET | `/api/admin/accounts` | x-admin-key | Every account plus the ledger audit |
| POST | `/api/admin/distributors` | x-admin-key | `{ username, password }` |
| POST | `/api/admin/accounts/:id/issue` | x-admin-key | `{ requestId, amountCents }`; negative takes points back |
| POST | `/api/admin/accounts/:id/password` | x-admin-key | `{ password }` |
| POST | `/api/admin/accounts/:id/status` | x-admin-key | `{ status }` |

Usernames are 3-32 letters, digits, `_`, `.` or `-`, unique across all roles and not case-sensitive. Passwords are 6-64 characters.

## The game

- 5 reels x 4 rows, 25 fixed lines (`src/math/paylines.ts`), pays left to right on 3, 4 or 5 of a kind. Line bet = total bet / 25.
- Symbols match the UI symbol set: CROWN, GEM, PLANET, COMET, A, K, Q, J, TEN, WILD, SCATTER, BONUS.
- WILD (reels 2-5) substitutes for everything except SCATTER and BONUS.
- SCATTER pays anywhere (2x, 10x, 50x total bet for 3, 4, 5). 3+ SCATTER award **12 free spins with all wins x2**, on richer free-spin reels. 3+ during free spins add 5 more.
- 3 BONUS (reels 1, 3, 5) in the base game spin the **Super Wheel**: 12 segments with 10x to 100x bet credits, 10 free spins, and MINI, MINOR, MAJOR and GRAND jackpots.
- Bet levels: 0.25, 0.50, 1.00, 2.50, 5.00, 10.00, 25.00, 50.00.
- **Jackpots:** every paid spin adds 1.5% of the bet to the pools (Grand 0.5%, Major 0.4%, Minor 0.3%, Mini 0.3%). Seeds are 10,000 / 1,000 / 250 / 50. A wheel jackpot pays the whole pool and resets it to its seed. To keep jackpots fair across bet sizes, jackpot segment weights scale with bet / max bet (so a 0.25 bet has 1/200 the jackpot odds of a 50.00 bet, matching its 1/200 contribution), and the weight they give up goes to the 10x segment.

Full numbers are in [`docs/par-sheet.md`](docs/par-sheet.md).

## RTP

Three profiles ship. The RTP is computed exactly (not simulated) by `src/math/theoretical.ts` and checked by Monte Carlo through the same engine the server runs. RTP is lowest at max bet, and the target is that minimum.

| Profile | Exact RTP (max bet to min bet) | Simulated, 20M spins, crypto RNG, max bet |
|---|---|---|
| rtp94 | 94.00% to 94.21% | 94.06% (game 92.42% ± 0.13%, exact 92.37%) |
| rtp95 | 95.01% to 95.23% | 95.02% (game 93.38% ± 0.14%, exact 93.37%) |
| rtp96 | 95.99% to 96.20% | 96.08% (game 94.44% ± 0.14%, exact 94.34%) |

The simulated column is the game return (lines, scatters, free spins, wheel credits) measured by `npm run sim`, plus the jackpot share (contributions + seed funding), which is a fixed, exact figure. The full output is in [`docs/simulation-20M.txt`](docs/simulation-20M.txt); all three land within 1.4 standard errors of the exact value. Each exact RTP split at max bet for rtp95: base lines ~74%, base scatter ~1%, free spins ~12%, wheel credits and wheel free spins ~6%, jackpots ~1.65%.

Other characteristics (rtp95, max bet): hit frequency about 46%, free spins about 1 in 225 spins, Super Wheel about 1 in 263, Grand jackpot about 1 in 273,000 spins at max bet, standard deviation about 3.2x bet per spin.

**How the exact figure works.** Every payline reads one row per reel, and every stop is equally likely, so the symbol a line sees on a reel has exactly the strip's symbol distribution, independently per reel. One line's expected pay is an enumeration over symbol counts, and all 25 lines share it. The strip builder guarantees no two SCATTERs (or BONUSes) fit in one 4-row window, so each reel shows one with probability count x 4 / length. Free spins and the wheel combine through linearity of expectation. A test enumerates every stop combination of a small set of strips and checks the formula against it exactly.

**Changing the RTP.** Edit counts or pays in `src/math/design.ts`, or run `npm run tune -- --target <rtp>`. The tuner adjusts filler symbols on reels 2-5 until the exact RTP hits the target, then writes a new profile JSON. Switch the server with `MATH_PROFILE`. Each profile has a SHA-256 hash (`GET /api/config`, `npm run par`), and every round records the hash it was played on.

## API

Money is always **integer cents**. Every call that moves money takes a client-generated `requestId` (8-64 chars, a UUID works). Retrying with the same `requestId` returns the original response and never plays or pays twice; reusing it for a different request returns `409 IDEMPOTENCY_CONFLICT`.

### Round flow

1. `POST /api/spin { requestId, betCents }` debits the bet, spins and returns the result.
2. The response's `nextAction` says what comes next: `"spin"` (round finished), `"wheel"` or `"freeSpin"`.
3. Send `POST /api/wheel { requestId }` or `POST /api/free-spin { requestId }` until `nextAction` is `"spin"` again. The wheel always comes before free spins when both trigger. Free spins are played one request each, so the client can animate each one, and a disconnect never loses a feature.
4. After a reconnect, `GET /api/state` returns the balance, the open round and `nextAction`, so the client can show "Welcome back" and continue.

A spin response looks like this (trimmed):

```json
{
  "roundId": "8c1c…",
  "action": "spin",
  "balanceCents": 99925,
  "nextAction": "freeSpin",
  "step": {
    "type": "BASE",
    "stops": [12, 40, 3, 55, 21],
    "grid": [["A","SCATTER","K","Q"], ["…"], ["…"], ["…"], ["…"]],
    "lineWins": [{ "line": 7, "symbol": "GEM", "count": 3, "multiplier": 40, "winCents": 400, "positions": [[0,1],[1,2],[2,3]] }],
    "scatter": { "count": 3, "positions": [[0,1],[2,0],[4,2]], "winCents": 500 },
    "bonus": { "count": 0, "positions": [] },
    "multiplier": 1,
    "winCents": 900,
    "freeSpinsAwarded": 12,
    "wheelTriggered": false
  },
  "round": { "status": "OPEN", "betCents": 250, "totalWinCents": 900, "pending": { "wheel": false, "freeSpins": { "remaining": 12, "played": 0, "awarded": 12, "multiplier": 2, "winCents": 0 } }, "steps": ["…"] },
  "jackpots": { "GRAND": 1000012, "MAJOR": 100010, "MINOR": 25007, "MINI": 5007 }
}
```

`grid[reel][row]`, row 0 is the top. `positions` are `[reel, row]`. Wheel steps carry `segmentIndex` (the segment order in `/api/config` is the order to draw on the wheel), `segment`, `winCents`, `freeSpinsAwarded`, `jackpotTier` and `jackpotWinCents`.

### Endpoints

| Method | Path | Auth | Body / query | Returns |
|---|---|---|---|---|
| GET | `/api/health` | | | `{ ok }` |
| GET | `/api/config` | | | Paylines, paytable, bet levels, wheel segments, jackpot seeds, RTP by bet, profile hash |
| GET | `/api/jackpots` | | | Live pool values |
| POST | `/api/sessions` | | `{ playerId }` | `{ token, playerId, state }` |
| GET | `/api/state` | Bearer | | Balance, open round, `nextAction`, jackpots |
| POST | `/api/spin` | Bearer | `{ requestId, betCents }` | Spin response |
| POST | `/api/wheel` | Bearer | `{ requestId }` | Wheel response |
| POST | `/api/free-spin` | Bearer | `{ requestId }` | Free-spin response |
| GET | `/api/history` | Bearer | `?limit=20&before=<roundId>` | Rounds, newest first |
| GET | `/api/rounds/:id` | Bearer | | Full round record |
| GET | `/api/rounds/:id/replay` | Bearer | | Steps to re-animate, plus `verified` |
| POST | `/api/admin/players/:id/balance` | x-admin-key | `{ requestId, amountCents }` | Deposit (positive) or withdrawal (negative) |
| GET | `/api/admin/audit` | x-admin-key | | Ledger and jackpot reconciliation |

Errors are `{ "error": { "code", "message" } }` with codes such as `INVALID_BET`, `INSUFFICIENT_FUNDS` (402), `WRONG_ACTION` (409), `UNAUTHORIZED` (401).

### WebSocket

Connect to `/ws?token=<session token>`. Send `{ "id": 1, "type": "spin", "requestId": "…", "betCents": 250 }` and receive `{ "id": 1, "ok": true, "result": … }`. Types: `state`, `config`, `jackpots`, `spin`, `wheel`, `freeSpin`, `history`, `round`, `replay`, with the same parameters as REST. The server also pushes `{ "type": "jackpots", "jackpots": … }` at most once a second for the live ticker, `{ "type": "jackpotWon", "tier", "amountCents" }` for the lobby toast, and `{ "type": "balance", "balanceCents" }` to a player when their agent loads or redeems.

## How it fits together

```
src/
  math/       types, paylines, design inputs, strip builder, grid evaluation, exact RTP, profile loading + hash
  rng/        CryptoRng (node:crypto, buffered, rejection sampling, no modulo bias), seeded RNG for tests, record/replay
  engine/     pure round engine (base spin, free spins, wheel, playFullRound) and progressive jackpot pools
  wallet/     transaction staging with idempotent transaction ids
  store/      in-memory state, persisted to a JSON-lines journal or to PostgreSQL (pgStore.ts, schema.sql)
  service/    GameService: sessions, play, history, replay, audit
  api/        HTTP + WebSocket server
  sim/        Monte Carlo simulator, tuner, PAR sheet
profiles/     rtp94.json, rtp95.json, rtp96.json (the reel strips and every number the math uses)
docs/         par-sheet.md
test/         node:test suites
```

- **Server decides everything.** The client sends a bet and receives stops, grid, wins and the new balance. The engine is pure (profile + RNG in, result out), and the simulator and the server call the same functions.
- **RNG.** All outcomes come from `CryptoRng`. Each round step stores the exact RNG draws that decided it, which is what makes replay and audit possible.
- **Wallet and rounds commit together.** Each request builds one commit (balance changes, transactions, the round record, jackpot pools, the idempotency record) and writes it as one journal line before applying it. Transaction ids are derived from the round (`<roundId>:bet`, `<roundId>:<step>:win`), so the same money can't move twice.
- **Replay.** `/api/rounds/:id/replay` re-runs every step from its recorded draws on the round's own math profile and compares the result to the stored record. Any tampering or math drift shows `verified: false`.
- **Recovery.** The journal (or the database) is loaded on start, so balances, jackpots, sessions and unfinished free spins or wheel spins survive a restart. If you change `MATH_PROFILE` while a round is open, the round finishes on the math it started with.
- **Audit.** `/api/admin/audit` checks that every balance equals the sum of its ledger transactions, and that every jackpot pool equals seeds plus contributions minus payouts.

## Database

With `DATABASE_URL` set, the server uses PostgreSQL (`src/store/pgStore.ts`). It creates its tables on start from [`src/store/schema.sql`](src/store/schema.sql): `players`, `txs` (game wallet), `rounds`, `jackpots`, `accounts`, `ledger` (coin movements), `sessions`, `staff_sessions` and `idempotency`. Each row keeps the full record as `jsonb` plus plain columns for reporting, so you can query it directly, for example `SELECT player_id, sum(amount_cents) FROM txs GROUP BY 1`.

How it stays safe:

- **Nothing is answered before it's saved.** The game logic runs in memory and every change is queued to PostgreSQL in order, several at a time in one transaction. An HTTP or WebSocket reply only goes out after its change is committed, so a crash can never undo something a player or agent has already seen.
- **A failed write stops the server.** If the database rejects a write, the server exits instead of carrying on with memory that's ahead of the database. On restart it reloads everything from the database. Run it under Docker, systemd or similar so it restarts on its own.
- **One server per database.** The server takes a PostgreSQL advisory lock on start, and a second server pointed at the same database refuses to start. One Node process serves every player. The game math itself runs over 200,000 spins a second, so each request's cost is mostly its database write; load-test with your expected player count before launch.
- **Restart-safe.** Balances, jackpots, accounts, the ledger, sessions, retried requests and unfinished free spins or wheel spins all come back after a restart. The PostgreSQL tests check this against a real database: run them with `TEST_DATABASE_URL=postgres://… npm test` (they drop and recreate the tables in that database, so point it at a test database).

Back up the database the usual way (`pg_dump`, or your host's automatic backups). The server loads all rounds into memory on start, which is fine for millions of rounds; archive old rounds into another table when that grows too large.

## Before production

To put it online at jackvault777.com, follow [docs/hosting.md](docs/hosting.md) (Railway, with HTTPS, PostgreSQL backups and production settings).

These are deliberate simplifications for a runnable first build:

- **Storage.** Use PostgreSQL (`DATABASE_URL`) in production. The journal file is for development and demos.
- **Single process.** One server process per database, enforced by the advisory lock. Put it behind a reverse proxy (nginx, Caddy or your host's load balancer) for HTTPS, with WebSocket upgrades allowed on `/ws`.
- **Accounts.** Change the seeded distributor's password (or set `SEED_DISTRIBUTOR` yourself and `NODE_ENV=production`), set a long random `ADMIN_KEY`, and serve everything over HTTPS. The login lockout counter lives in memory, so it resets on restart and isn't shared between instances.
- **Legal.** Running a game where coins are bought from and redeemed through agents is regulated as gambling or sweepstakes in most places. Check what licence or sweepstakes rules apply where you operate before taking real money.
- **Max win cap.** None is set. Add one in the engine if your rules need it, then re-tune.
