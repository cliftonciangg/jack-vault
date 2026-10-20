import { loadProfile } from "../math/profile.js";
import { nonJackpotRtp, theoreticalRtp } from "../math/theoretical.js";
import { CryptoRng, SeededRng } from "../rng/rng.js";
import { simulate } from "./stats.js";

/**
 * Monte Carlo RTP check against the exact figure.
 *
 *   npm run sim                                   rtp95, 5M spins, max bet, crypto RNG
 *   npm run sim -- --profile rtp94 --spins 10000000 --bet 25 --seed 42
 */
const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const profile = loadProfile(arg("--profile", "rtp95"));
const spins = Number(arg("--spins", "5000000"));
const bet = Number(arg("--bet", String(Math.max(...profile.betLevelsCents))));
const seed = args.includes("--seed") ? Number(arg("--seed", "1")) : null;
const rng = seed === null ? new CryptoRng() : new SeededRng(seed);

const th = theoreticalRtp(profile, bet);
const t0 = Date.now();
const r = simulate(profile, bet, spins, rng);
const secs = (Date.now() - t0) / 1000;
const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)}%`;
const exact = nonJackpotRtp(th);
const z = (r.rtpNoJackpot - exact) / (r.ci95 / 1.96);

console.log(`Jack Vault  profile=${profile.id}  bet=${bet}c  spins=${spins.toLocaleString()}  rng=${seed === null ? "crypto" : `seeded(${seed})`}  ${secs.toFixed(1)}s`);
console.log("");
console.log(`RTP excl. progressive   measured ${pct(r.rtpNoJackpot)} ± ${pct(r.ci95)} (95% CI)   exact ${pct(exact)}   z=${z.toFixed(2)}  ${Math.abs(z) < 3 ? "PASS" : "CHECK"}`);
console.log(`  base game             measured ${pct(r.components.base)}   exact ${pct(th.components.baseLines + th.components.baseScatterPays)}`);
console.log(`  free spins            measured ${pct(r.components.freeSpins)}   exact ${pct(th.components.freeSpins + th.components.wheelFreeSpins)}`);
console.log(`  wheel credits         measured ${pct(r.components.wheelCredits)}   exact ${pct(th.components.wheelCredits)}`);
console.log(`Progressive jackpots    contributions ${pct(th.components.jackpotContributions)} + seed funding ${pct(th.components.jackpotSeeds)}  (paid this run: ${pct(r.jackpotPaidRtp)})`);
console.log(`TOTAL RTP (exact)       ${pct(th.rtp)}    measured game + jackpot share: ${pct(r.rtpNoJackpot + th.components.jackpotContributions + th.components.jackpotSeeds)}`);
console.log("");
console.log(`Hit frequency           ${pct(r.hitFrequency, 2)}`);
console.log(`Free spins              1 in ${(1 / r.freeSpinsFrequency).toFixed(0)} (exact 1 in ${(1 / (th.freeSpins.triggerProbability)).toFixed(0)} by scatter, plus wheel)`);
console.log(`Super Wheel             1 in ${(1 / r.wheelFrequency).toFixed(0)} (exact 1 in ${(1 / th.wheel.triggerProbability).toFixed(0)})`);
console.log(`Volatility (SD / spin)  ${r.stdDev.toFixed(2)}x bet     max win seen ${r.maxWinX.toFixed(1)}x bet`);
console.log(
  `Jackpot hits            ${Object.entries(r.jackpotHits)
    .map(([t, n]) => `${t} ${n} (exp ${(th.jackpotHitProbabilityPerSpin[t as keyof typeof r.jackpotHits] * spins).toFixed(1)})`)
    .join(", ")}`,
);
console.log(`Win distribution        ${Object.entries(r.distribution).map(([k, v]) => `${k}: ${pct(v, 2)}`).join("  ")}`);
