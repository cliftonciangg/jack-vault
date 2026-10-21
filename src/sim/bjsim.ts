import { RULE_SETS, getRules } from "../blackjack/rules.js";
import { sideBetEdges } from "../blackjack/sidebets.js";
import { simulateBlackjack } from "../blackjack/simulate.js";
import { CryptoRng, SeededRng } from "../rng/rng.js";

/**
 * Blackjack house edge by Monte Carlo, five basic-strategy seats per round,
 * plus the exact side-bet edges.
 *
 *   npm run bj:sim                                   every rule set, 2M rounds each, crypto RNG
 *   npm run bj:sim -- --rules standard --rounds 20000000 --seed 42
 */
const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ids = args.includes("--rules") ? [arg("--rules", "standard")] : Object.keys(RULE_SETS);
const rounds = Number(arg("--rounds", "2000000"));
const seed = args.includes("--seed") ? Number(arg("--seed", "1")) : null;
const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)}%`;

console.log(`Blackjack  rounds=${rounds.toLocaleString()} x 5 seats  rng=${seed === null ? "crypto" : `seeded(${seed})`}`);
console.log("");
for (const id of ids) {
  const rules = getRules(id);
  const rng = seed === null ? new CryptoRng() : new SeededRng(seed);
  const t0 = Date.now();
  const r = simulateBlackjack(rules, rounds, rng);
  const secs = (Date.now() - t0) / 1000;
  console.log(`${rules.name}  (${id}, ${secs.toFixed(1)}s)`);
  console.log(`  house edge  ${pct(r.houseEdge)} ± ${pct(r.ci95)} (95% CI)   RTP ${pct(1 - r.houseEdge)}`);
  console.log(`  SD per hand ${r.stdDev.toFixed(3)}x bet   blackjacks ${pct(r.blackjacks, 2)}   seat wins ${pct(r.playerWins, 2)}   pushes ${pct(r.pushes, 2)}   shuffles ${r.shuffles.toLocaleString()}`);
}
const decks = [...new Set(ids.map((id) => getRules(id).decks))];
console.log("");
for (const d of decks) {
  const e = sideBetEdges(d);
  console.log(`Side bets, ${d} decks (exact)   Perfect Pairs ${pct(e.perfectPairs)}   21+3 ${pct(e.twentyOnePlus3)}`);
}
