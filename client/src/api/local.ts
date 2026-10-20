import profileJson from "../../../profiles/rtp95.json";
import {
  baseSpin, freeSpin, isComplete, nextAction, PendingFeatures, spinWheel, Step as EngineStep, stepWin,
} from "../../../src/engine/engine";
import { initialJackpots, JackpotPools, JackpotState } from "../../../src/engine/jackpots";
import { theoreticalRtp } from "../../../src/math/theoretical";
import type { MathProfile } from "../../../src/math/types";
import type { Rng } from "../../../src/rng/rng";
import {
  ApiError, newRequestId, GameApi, GameConfig, GameState, HistoryRound, JackpotTier, Jackpots, PlayResponse, RoundView, Step,
} from "./types";

const profile = profileJson as unknown as MathProfile;
const SAVE_KEY = "jackvault.demo.v1";
const FORCE = import.meta.env.DEV ? new URLSearchParams(location.search).get("force") : null;
const START_BALANCE = 100_000;

/** crypto.getRandomValues with rejection sampling, the browser twin of the server's CryptoRng. */
class BrowserRng implements Rng {
  private buf = new Uint32Array(1024);
  private i = this.buf.length;
  int(max: number): number {
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % max);
    for (;;) {
      if (this.i >= this.buf.length) {
        crypto.getRandomValues(this.buf);
        this.i = 0;
      }
      const v = this.buf[this.i++];
      if (v < limit) return v % max;
    }
  }
}

interface OpenRound {
  roundId: string;
  betCents: number;
  totalWinCents: number;
  pending: PendingFeatures;
  steps: EngineStep[];
}

interface Save {
  balanceCents: number;
  jackpots: JackpotState;
  open: OpenRound | null;
  history: HistoryRound[];
}

/**
 * Demo backend: the same engine, math profile and jackpot pools as the Node
 * server, running in the browser with the balance saved in localStorage. Used
 * when no server answers, so the game can be tried from a single HTML file.
 */
export class LocalApi implements GameApi {
  readonly mode = "demo" as const;
  private rng = new BrowserRng();
  private s: Save;
  private jackpotSubs = new Set<(j: Jackpots) => void>();
  private wonSubs = new Set<(t: JackpotTier, a: number) => void>();
  private idem = new Map<string, PlayResponse>();

  constructor() {
    this.s = this.load();
    // Other players' bets feed the shared pools on the real server; imitate that so the ticker moves.
    setInterval(() => {
      const pools = new JackpotPools(this.s.jackpots, profile);
      const bets = profile.betLevelsCents;
      for (let k = 0; k < 3; k++) pools.contribute(bets[this.rng.int(bets.length)]);
      this.save();
      this.emitJackpots();
    }, 2500);
  }

  private load(): Save {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* private mode: start fresh */
    }
    return { balanceCents: START_BALANCE, jackpots: initialJackpots(profile), open: null, history: [] };
  }
  private save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.s));
    } catch {
      /* not persisted */
    }
  }
  private display(): Jackpots {
    return new JackpotPools(this.s.jackpots, profile).display();
  }
  private emitJackpots() {
    const j = this.display();
    this.jackpotSubs.forEach((f) => f(j));
  }
  private latency<T>(v: T): Promise<T> {
    return new Promise((r) => setTimeout(() => r(v), 90 + Math.random() * 160));
  }
  private view(r: OpenRound, complete: boolean): RoundView & { roundId: string } {
    return {
      roundId: r.roundId,
      status: complete ? "COMPLETE" : "OPEN",
      betCents: r.betCents,
      totalWinCents: r.totalWinCents,
      pending: r.pending,
      steps: r.steps as unknown as Step[],
    };
  }

  async connect(): Promise<GameState> {
    return this.state();
  }

  async config(): Promise<GameConfig> {
    const rtps = profile.betLevelsCents.map((b) => theoreticalRtp(profile, b).rtp);
    return {
      betLevelsCents: profile.betLevelsCents,
      lines: profile.paylines.length,
      paylines: profile.paylines,
      paytable: profile.paytable as GameConfig["paytable"],
      scatterPays: profile.scatterPays as GameConfig["scatterPays"],
      freeSpins: profile.freeSpins,
      wheel: { triggerCount: profile.wheel.triggerCount, segments: profile.wheel.segments.map(({ weight, ...s }) => s) as GameConfig["wheel"]["segments"] },
      jackpots: {
        tiers: ["GRAND", "MAJOR", "MINOR", "MINI"],
        seedsCents: Object.fromEntries(Object.entries(profile.jackpots).map(([t, j]) => [t, j.seedCents])) as Jackpots,
      },
      rtp: { min: Math.min(...rtps), max: Math.max(...rtps) },
      reels: profile.reels,
    };
  }

  async state(): Promise<GameState> {
    const o = this.s.open;
    return {
      playerId: "demo",
      balanceCents: this.s.balanceCents,
      nextAction: o ? nextAction(o.pending) : "spin",
      openRound: o ? this.view(o, false) : null,
      jackpots: this.display(),
    };
  }

  private play(requestId: string, action: "spin" | "wheel" | "freeSpin", betCents?: number): Promise<PlayResponse> {
    const prior = this.idem.get(requestId);
    if (prior) return this.latency(prior);
    const expected = this.s.open ? nextAction(this.s.open.pending) : "spin";
    if (action !== expected) return Promise.reject(new ApiError("WRONG_ACTION", `Waiting for '${expected}'`, 409));
    const pools = new JackpotPools(this.s.jackpots, profile);
    let round: OpenRound;
    let step: EngineStep;
    let jackpotHit: [JackpotTier, number] | null = null;

    if (action === "spin") {
      if (!betCents || !profile.betLevelsCents.includes(betCents)) return Promise.reject(new ApiError("INVALID_BET", "Invalid bet", 400));
      if (this.s.balanceCents < betCents) return Promise.reject(new ApiError("INSUFFICIENT_FUNDS", "Not enough balance for this bet", 402));
      this.s.balanceCents -= betCents;
      let r = baseSpin(profile, betCents, this.rng);
      // Dev-only test hook (?force=fs|wheel|big|jackpot), stripped from production builds.
      if (import.meta.env.DEV && FORCE) {
        const ok = (x: typeof r) => FORCE === "fs" ? x.step.freeSpinsAwarded > 0 : FORCE === "big" ? x.step.winCents >= betCents * 20 : x.step.wheelTriggered;
        for (let i = 0; i < 200000 && !ok(r); i++) r = baseSpin(profile, betCents, this.rng);
      }
      pools.contribute(betCents);
      step = r.step;
      round = { roundId: newRequestId(), betCents, totalWinCents: 0, pending: r.pending, steps: [] };
    } else {
      round = this.s.open!;
      if (action === "wheel") {
        let r = spinWheel(profile, round.betCents, round.pending, this.rng);
        if (import.meta.env.DEV && FORCE === "jackpot") for (let i = 0; i < 200000 && !r.step.jackpotTier; i++) r = spinWheel(profile, round.betCents, round.pending, this.rng);
        if (r.step.jackpotTier) {
          r.step.jackpotWinCents = pools.award(r.step.jackpotTier);
          jackpotHit = [r.step.jackpotTier, r.step.jackpotWinCents];
        }
        step = r.step;
        round.pending = r.pending;
      } else {
        const r = freeSpin(profile, round.betCents, round.pending, this.rng);
        step = r.step;
        round.pending = r.pending;
      }
    }
    const { draws, ...wire } = step as EngineStep & { draws: unknown };
    round.steps.push(wire as EngineStep);
    round.totalWinCents += stepWin(step);
    this.s.balanceCents += stepWin(step);
    const complete = isComplete(round.pending);
    this.s.open = complete ? null : round;
    if (complete) {
      this.s.history.unshift({
        roundId: round.roundId,
        betCents: round.betCents,
        totalWinCents: round.totalWinCents,
        status: "COMPLETE",
        completedAt: new Date().toISOString(),
        steps: round.steps as unknown as Step[],
      });
      this.s.history.length = Math.min(this.s.history.length, 50);
    }
    this.save();
    const res: PlayResponse = {
      roundId: round.roundId,
      action,
      balanceCents: this.s.balanceCents,
      nextAction: nextAction(round.pending),
      step: wire as unknown as Step,
      round: this.view(round, complete),
      jackpots: this.display(),
    };
    this.idem.set(requestId, res);
    this.emitJackpots();
    if (jackpotHit) {
      const [t, a] = jackpotHit;
      setTimeout(() => this.wonSubs.forEach((f) => f(t, a)), 50);
    }
    return this.latency(res);
  }

  spin(requestId: string, betCents: number) {
    return this.play(requestId, "spin", betCents);
  }
  wheel(requestId: string) {
    return this.play(requestId, "wheel");
  }
  freeSpin(requestId: string) {
    return this.play(requestId, "freeSpin");
  }
  async history(limit = 20): Promise<HistoryRound[]> {
    return this.s.history.slice(0, limit);
  }
  onJackpots(cb: (j: Jackpots) => void) {
    this.jackpotSubs.add(cb);
    return () => this.jackpotSubs.delete(cb);
  }
  onJackpotWon(cb: (t: JackpotTier, a: number) => void) {
    this.wonSubs.add(cb);
    return () => this.wonSubs.delete(cb);
  }
  async addCoins(amountCents: number): Promise<number> {
    this.s.balanceCents += amountCents;
    this.save();
    return this.s.balanceCents;
  }
}
