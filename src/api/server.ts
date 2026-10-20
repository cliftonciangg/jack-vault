import { join } from "node:path";
import { AccountService } from "../accounts/accounts.js";
import { createApp } from "./app.js";
import { listProfiles, loadProfile } from "../math/profile.js";
import { GameService } from "../service/gameService.js";
import { PgStore } from "../store/pgStore.js";
import { Store } from "../store/store.js";

/**
 * Environment:
 *   PORT                 default 8080
 *   MATH_PROFILE         rtp94 | rtp95 | rtp96 (default rtp95): the default win ratio on first start. After
 *                        that the operator sets the default and each distributor's profile in the back office.
 *   DATABASE_URL         PostgreSQL connection string (postgres://user:pass@host:5432/db). When set,
 *                        PostgreSQL is the database and DATA_DIR is ignored.
 *   DATA_DIR             journal location without a database (default ./data); DATA_DIR=memory keeps nothing
 *   ALLOW_PLAYER_CREATE  "1" lets /api/sessions create players with STARTING_BALANCE_CENTS (default off: players log in with agent-made accounts)
 *   STARTING_BALANCE_CENTS default 100000 (1,000.00)
 *   ADMIN_KEY            enables /api/admin routes (including POST /api/admin/operators)
 *   SEED_OPERATOR        "username:password" of an operator login created at start if missing
 *                        (default demo-operator:demo1234 outside production, unset in production)
 *   CORS_ORIGIN          allowed browser origin
 *   SEED_DISTRIBUTOR     "username:password" of a distributor created at start if missing
 *                        (default demo-distributor:demo1234 outside production, unset in production)
 *   SEED_POINTS_CENTS    points issued to that new distributor (default 10000000 = 100,000.00)
 */
const env = process.env;
const profile = loadProfile(env.MATH_PROFILE ?? "rtp95");
const dataDir = env.DATA_DIR ?? "data";
const store = env.DATABASE_URL
  ? await PgStore.open({ connectionString: env.DATABASE_URL })
  : new Store(dataDir === "memory" ? undefined : join(dataDir, "journal.jsonl"));
const service = new GameService({
  profile,
  profiles: listProfiles().map(loadProfile),
  store,
  startingBalanceCents: Number(env.STARTING_BALANCE_CENTS ?? 100_000),
});
service.warmProfileStats();
const accounts = new AccountService({ store, profileFor: (id) => service.distributorProfileId(id) });
const seedOp = env.SEED_OPERATOR ?? (env.NODE_ENV === "production" ? "" : "demo-operator:demo1234");
if (seedOp.includes(":")) {
  const [user, ...pw] = seedOp.split(":");
  const op = accounts.seedOperator(user, pw.join(":"));
  if (op) console.log(`Created operator login '${op.username}'. Change its password before going live.`);
}
const seed = env.SEED_DISTRIBUTOR ?? (env.NODE_ENV === "production" ? "" : "demo-distributor:demo1234");
if (seed.includes(":")) {
  const [user, ...pw] = seed.split(":");
  const d = accounts.seed(user, pw.join(":"), Number(env.SEED_POINTS_CENTS ?? 10_000_000));
  if (d) console.log(`Created distributor '${d.username}' with ${(d.balanceCents / 100).toFixed(2)} points. Change its password before going live.`);
}
const { server } = createApp({
  accounts,
  service,
  // Guest players are off by default: players log in with the account their agent made.
  allowPlayerCreate: (env.ALLOW_PLAYER_CREATE ?? "0") === "1",
  adminKey: env.ADMIN_KEY,
  corsOrigin: env.CORS_ORIGIN,
  store,
});
const port = Number(env.PORT ?? 8080);
server.listen(port, () => {
  const c = service.config();
  console.log(`Storage: ${env.DATABASE_URL ? "PostgreSQL" : dataDir === "memory" ? "memory only" : join(dataDir, "journal.jsonl")}`);
  console.log(`Back office: http://localhost:${port}/office`);
  console.log(`Jack Vault server on :${port}  profile=${c.profileId}  RTP ${(c.rtp.min * 100).toFixed(2)}-${(c.rtp.max * 100).toFixed(2)}%  hash=${c.profileHash.slice(0, 12)}`);
});

// Finish in-flight writes before exiting on Ctrl+C or a container stop.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    server.close();
    const done = store instanceof PgStore ? store.close() : store.flushed();
    done.finally(() => process.exit(0));
  });
}
