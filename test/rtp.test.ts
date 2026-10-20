import { test } from "node:test";
import assert from "node:assert/strict";
import { listProfiles, loadProfile } from "../src/math/profile.js";
import { nonJackpotRtp, theoreticalRtp } from "../src/math/theoretical.js";
import { SeededRng, CryptoRng } from "../src/rng/rng.js";
import { simulate } from "../src/sim/stats.js";

const SPINS = Number(process.env.RTP_TEST_SPINS ?? 1_000_000);

for (const id of listProfiles()) {
  const profile = loadProfile(id);
  const target = Number(id.replace("rtp", "")) / 100;

  test(`${id}: exact RTP is on target at every bet and inside 94-96.5%`, () => {
    for (const bet of profile.betLevelsCents) {
      const r = theoreticalRtp(profile, bet).rtp;
      assert.ok(r >= target - 0.0005 && r <= target + 0.0035, `${id} bet ${bet}: ${r}`);
      assert.ok(r >= 0.9395 && r <= 0.965);
    }
  });

  test(`${id}: ${SPINS.toLocaleString()} simulated spins match the exact RTP`, () => {
    const bet = Math.max(...profile.betLevelsCents);
    const exact = theoreticalRtp(profile, bet);
    const sim = simulate(profile, bet, SPINS, new SeededRng(20261019));
    const sigma = sim.ci95 / 1.96;
    const z = (sim.rtpNoJackpot - nonJackpotRtp(exact)) / sigma;
    assert.ok(Math.abs(z) < 4, `measured ${sim.rtpNoJackpot} vs exact ${nonJackpotRtp(exact)} (z=${z.toFixed(2)})`);
    // Feature frequencies within 4 sigma of their exact values.
    const pW = exact.wheel.triggerProbability;
    assert.ok(Math.abs(sim.wheelFrequency - pW) < 4 * Math.sqrt((pW * (1 - pW)) / SPINS));
    const pF = exact.freeSpins.triggerProbability;
    assert.ok(sim.freeSpinsFrequency >= pF - 4 * Math.sqrt((pF * (1 - pF)) / SPINS));
  });
}

test("simulation with the production crypto RNG also matches (rtp95)", () => {
  const profile = loadProfile("rtp95");
  const bet = 100;
  const exact = nonJackpotRtp(theoreticalRtp(profile, bet));
  const sim = simulate(profile, bet, SPINS / 2, new CryptoRng());
  const z = (sim.rtpNoJackpot - exact) / (sim.ci95 / 1.96);
  assert.ok(Math.abs(z) < 4, `z=${z}`);
});
