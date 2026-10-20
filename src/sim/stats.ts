import { playFullRound, Step } from "../engine/engine.js";
import { initialJackpots, JackpotPools } from "../engine/jackpots.js";
import { JACKPOT_TIERS, JackpotTier, MathProfile } from "../math/types.js";
import { Rng } from "../rng/rng.js";

export interface SimResult {
  spins: number;
  betCents: number;
  /** Returned / staked, excluding progressive jackpot payouts. */
  rtpNoJackpot: number;
  /** 95% confidence half-width of rtpNoJackpot. */
  ci95: number;
  /** Standard deviation of win per spin, in multiples of bet (volatility). */
  stdDev: number;
  hitFrequency: number;
  freeSpinsFrequency: number;
  wheelFrequency: number;
  maxWinX: number;
  components: { base: number; freeSpins: number; wheelCredits: number };
  jackpotHits: Record<JackpotTier, number>;
  jackpotPaidRtp: number;
  /** Bucketed win/bet distribution: label -> share of spins. */
  distribution: Record<string, number>;
}

const BUCKETS: [string, number][] = [
  ["0x", 0], ["<1x", 1], ["1-2x", 2], ["2-5x", 5], ["5-15x", 15], ["15-30x", 30], ["30-50x", 50], ["50-100x", 100], ["100x+", Infinity],
];

/** Monte Carlo over full rounds through the same engine the server uses. */
export function simulate(profile: MathProfile, betCents: number, spins: number, rng: Rng): SimResult {
  const pools = new JackpotPools(initialJackpots(profile), profile, () => "");
  let sum = 0;
  let sumSq = 0;
  let hits = 0;
  let fs = 0;
  let wheel = 0;
  let maxWin = 0;
  let base = 0;
  let free = 0;
  let wheelCredits = 0;
  let jackpotPaid = 0;
  const jackpotHits = Object.fromEntries(JACKPOT_TIERS.map((t) => [t, 0])) as Record<JackpotTier, number>;
  const dist = new Array(BUCKETS.length).fill(0);

  for (let i = 0; i < spins; i++) {
    const { steps } = playFullRound(profile, betCents, rng, pools);
    let win = 0; // excluding jackpots
    let sawFs = false;
    for (const s of steps as Step[]) {
      win += s.winCents;
      if (s.type !== "WHEEL") {
        if (s.type === "BASE") base += s.winCents;
        else {
          free += s.winCents;
          sawFs = true;
        }
      } else {
        wheel++;
        wheelCredits += s.winCents;
        if (s.jackpotTier) {
          jackpotHits[s.jackpotTier]++;
          jackpotPaid += s.jackpotWinCents;
        }
      }
    }
    if (sawFs) fs++;
    const x = win / betCents;
    sum += x;
    sumSq += x * x;
    if (win > 0) hits++;
    if (x > maxWin) maxWin = x;
    let b = 0;
    while (!(x === 0 ? b === 0 : x < BUCKETS[b][1] && b > 0)) b++;
    dist[b]++;
  }
  const mean = sum / spins;
  const sd = Math.sqrt(Math.max(0, sumSq / spins - mean * mean));
  const staked = spins * betCents;
  return {
    spins,
    betCents,
    rtpNoJackpot: mean,
    ci95: (1.96 * sd) / Math.sqrt(spins),
    stdDev: sd,
    hitFrequency: hits / spins,
    freeSpinsFrequency: fs / spins,
    wheelFrequency: wheel / spins,
    maxWinX: maxWin,
    components: { base: base / staked, freeSpins: free / staked, wheelCredits: wheelCredits / staked },
    jackpotHits,
    jackpotPaidRtp: jackpotPaid / staked,
    distribution: Object.fromEntries(BUCKETS.map(([l], i) => [l, dist[i] / spins])),
  };
}
