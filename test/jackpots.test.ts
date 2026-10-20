import { test } from "node:test";
import assert from "node:assert/strict";
import { initialJackpots, JackpotPools, reconcileJackpots, UNITS_PER_CENT } from "../src/engine/jackpots.js";
import { loadProfile } from "../src/math/profile.js";

const p = loadProfile("rtp95");

test("contributions are exact and pools reset to seed after a hit", () => {
  const pools = new JackpotPools(initialJackpots(p), p, () => "t");
  for (let i = 0; i < 1000; i++) pools.contribute(25);
  // 25c * 50bps = 0.125c per spin to GRAND -> 125c after 1000 spins.
  assert.equal(pools.display().GRAND, p.jackpots.GRAND.seedCents + 125);
  pools.contribute(5000);
  const before = pools.state.MINI.units;
  const paid = pools.award("MINI");
  assert.equal(paid, Math.floor(before / UNITS_PER_CENT));
  assert.equal(pools.state.MINI.units, before - paid * UNITS_PER_CENT + p.jackpots.MINI.seedCents * UNITS_PER_CENT);
  assert.equal(pools.state.MINI.hits, 1);
  assert.deepEqual(reconcileJackpots(pools.state), { GRAND: true, MAJOR: true, MINOR: true, MINI: true });
});
