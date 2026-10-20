import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  assertBet,
  baseSpin,
  freeSpin,
  GameError,
  isComplete,
  nextAction,
  NextAction,
  PendingFeatures,
  spinWheel,
  Step,
  stepWin,
} from "../engine/engine.js";
import { initialJackpots, JackpotPools, reconcileJackpots } from "../engine/jackpots.js";
import { canonicalJson, profileHash } from "../math/profile.js";
import { theoreticalRtp } from "../math/theoretical.js";
import { JackpotTier, MathProfile, REELS, ROWS } from "../math/types.js";
import { CryptoRng, ReplayRng, Rng } from "../rng/rng.js";
import { Commit, Player, Round, Store, Tx } from "../store/store.js";
import { WalletTxBuilder } from "../wallet/wallet.js";

export interface GameServiceOptions {
  profile: MathProfile;
  store: Store;
  /** Other profiles that old rounds may reference, for replay. */
  profiles?: MathProfile[];
  rng?: Rng;
  /** Balance given to a new player when sessions may create players (dev / demo). */
  startingBalanceCents?: number;
  now?: () => Date;
}

export interface PlayResponse {
  requestId: string;
  action: NextAction;
  roundId: string;
  step: Step;
  round: RoundView;
  balanceCents: number;
  nextAction: NextAction;
  jackpots: Record<JackpotTier, number>;
}

export type RoundView = Omit<Round, "steps"> & { steps: Round["steps"]; nextAction: NextAction };

export class GameService {
  readonly events = new EventEmitter();
  private readonly profile: MathProfile;
  private readonly hash: string;
  private readonly store: Store;
  private readonly rng: Rng;
  private readonly profiles = new Map<string, MathProfile>();
  private readonly startingBalanceCents: number;
  private readonly now: () => Date;

  constructor(o: GameServiceOptions) {
    this.profile = o.profile;
    this.hash = profileHash(o.profile);
    this.store = o.store;
    this.rng = o.rng ?? new CryptoRng();
    this.startingBalanceCents = o.startingBalanceCents ?? 0;
    this.now = o.now ?? (() => new Date());
    for (const p of [...(o.profiles ?? []), o.profile]) this.profiles.set(p.id, p);
    if (!this.store.jackpots) this.store.commit({ at: this.iso(), jackpots: initialJackpots(this.profile) });
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---------------------------------------------------------------- config

  config() {
    const p = this.profile;
    const rtpByBet = Object.fromEntries(p.betLevelsCents.map((b) => [b, theoreticalRtp(p, b).rtp]));
    return {
      game: "Jack Vault",
      profileId: p.id,
      profileHash: this.hash,
      grid: { reels: REELS, rows: ROWS },
      betLevelsCents: p.betLevelsCents,
      lines: p.paylines.length,
      paylines: p.paylines,
      paytable: p.paytable,
      scatterPays: p.scatterPays,
      freeSpins: p.freeSpins,
      wheel: { triggerCount: p.wheel.triggerCount, segments: p.wheel.segments.map(({ weight, ...s }) => s) },
      jackpots: { tiers: Object.keys(p.jackpots), seedsCents: Object.fromEntries(Object.entries(p.jackpots).map(([t, j]) => [t, j.seedCents])) },
      rtp: { min: Math.min(...Object.values(rtpByBet)), max: Math.max(...Object.values(rtpByBet)), byBetCents: rtpByBet },
    };
  }

  jackpots(): Record<JackpotTier, number> {
    return new JackpotPools(this.store.jackpots!, this.profile).display();
  }

  // ---------------------------------------------------------------- players & sessions

  createSession(playerId: string, opts: { allowCreate: boolean }): { token: string; player: Player } {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(playerId)) throw new GameError("BAD_PLAYER_ID", "playerId must be 1-64 chars [A-Za-z0-9_.:-]");
    const at = this.iso();
    const commit: Commit = { at };
    // Accounts made by an agent log in with a password (AccountService.playerLogin), never by id.
    if (this.store.accounts.has(playerId)) throw new GameError("LOGIN_REQUIRED", "This player logs in with a username and password", 403);
    let player = this.store.players.get(playerId);
    if (!player) {
      if (!opts.allowCreate) throw new GameError("UNKNOWN_PLAYER", "Player not found", 404);
      player = { id: playerId, balanceCents: 0, createdAt: at };
      const w = new WalletTxBuilder(player, (id) => this.store.txs.get(id), at);
      if (this.startingBalanceCents > 0) w.apply(`signup:${playerId}`, "DEPOSIT", this.startingBalanceCents, null);
      player = w.player;
      commit.players = [player];
      commit.txs = w.txs;
    }
    const token = randomBytes(24).toString("base64url");
    commit.sessions = [{ token, playerId, createdAt: at }];
    this.store.commit(commit);
    return { token, player };
  }

  playerForToken(token: string | undefined): string {
    const s = token ? this.store.sessions.get(token) : undefined;
    if (!s) throw new GameError("UNAUTHORIZED", "Missing or unknown session token", 401);
    return s.playerId;
  }

  private player(playerId: string): Player {
    const p = this.store.players.get(playerId);
    if (!p) throw new GameError("UNKNOWN_PLAYER", "Player not found", 404);
    return p;
  }

  /** Operator wallet adjustment (deposit / withdraw), idempotent on requestId. */
  adjustBalance(playerId: string, requestId: string, amountCents: number): { tx: Tx; balanceCents: number } {
    requireRequestId(requestId);
    if (!Number.isInteger(amountCents) || amountCents === 0) throw new GameError("BAD_AMOUNT", "amountCents must be a non-zero integer");
    const at = this.iso();
    const w = new WalletTxBuilder(this.player(playerId), (id) => this.store.txs.get(id), at);
    const tx = w.apply(`adjust:${playerId}:${requestId}`, amountCents > 0 ? "DEPOSIT" : "WITHDRAW", amountCents, null);
    if (w.txs.length) this.store.commit({ at, players: [w.player], txs: w.txs });
    return { tx, balanceCents: this.player(playerId).balanceCents };
  }

  // ---------------------------------------------------------------- state

  private openRound(playerId: string): Round | null {
    const ids = this.store.roundsByPlayer.get(playerId);
    const last = ids?.length ? this.store.rounds.get(ids[ids.length - 1]) : undefined;
    return last && last.status === "OPEN" ? last : null;
  }

  state(playerId: string) {
    const player = this.player(playerId);
    const open = this.openRound(playerId);
    return {
      playerId,
      username: this.store.accounts.get(playerId)?.username ?? null,
      balanceCents: player.balanceCents,
      nextAction: open ? nextAction(open.pending) : ("spin" as NextAction),
      openRound: open ? view(open) : null,
      jackpots: this.jackpots(),
      betLevelsCents: this.profile.betLevelsCents,
    };
  }

  // ---------------------------------------------------------------- play

  /**
   * Plays one step. `spin` starts a new paid round; `wheel` and `freeSpin`
   * continue the open round. Retrying with the same requestId returns the
   * original response without playing again.
   */
  play(playerId: string, requestId: string, action: NextAction, betCents?: number): PlayResponse {
    requireRequestId(requestId);
    const key = `${playerId}:${requestId}`;
    const fingerprint = canonicalJson({ action, betCents: action === "spin" ? betCents : null });
    const prior = this.store.idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new GameError("IDEMPOTENCY_CONFLICT", "requestId was already used for a different request", 409);
      }
      return prior.response as PlayResponse;
    }

    const at = this.iso();
    const player = this.player(playerId);
    const open = this.openRound(playerId);
    const expected = open ? nextAction(open.pending) : "spin";
    if (action !== expected) {
      throw new GameError(
        "WRONG_ACTION",
        open ? `Round ${open.roundId} is waiting for '${expected}'` : "No feature pending; send 'spin'",
        409,
      );
    }

    const wallet = new WalletTxBuilder(player, (id) => this.store.txs.get(id), at);
    const pools = new JackpotPools(structuredClone(this.store.jackpots!), this.profile, () => at);
    let round: Round;
    let step: Step;
    let jackpotHit: { tier: JackpotTier; amountCents: number } | null = null;

    if (action === "spin") {
      if (betCents === undefined) throw new GameError("INVALID_BET", "betCents is required");
      assertBet(this.profile, betCents);
      const roundId = randomUUID();
      const before = player.balanceCents;
      // Debit first (fails on insufficient funds before any RNG is drawn).
      wallet.apply(`${roundId}:bet`, "BET", -betCents, roundId);
      const r = baseSpin(this.profile, betCents, this.rng);
      const contributions = pools.contribute(betCents);
      step = r.step;
      round = {
        roundId,
        playerId,
        betCents,
        profileId: this.profile.id,
        profileHash: this.hash,
        status: "OPEN",
        startedAt: at,
        completedAt: null,
        balanceBeforeCents: before,
        balanceAfterCents: before,
        totalWinCents: 0,
        steps: [],
        pending: r.pending,
        jackpotContributionUnits: contributions,
      };
    } else {
      round = structuredClone(open!);
      if (round.profileHash !== this.hash) {
        // The math changed under an open round; finish it on the math it started with.
        const p = this.profiles.get(round.profileId);
        if (!p || profileHash(p) !== round.profileHash) throw new GameError("PROFILE_MISSING", "Round's math profile is unavailable", 500);
      }
      const profile = this.profiles.get(round.profileId)!;
      if (action === "wheel") {
        const r = spinWheel(profile, round.betCents, round.pending, this.rng);
        if (r.step.jackpotTier) {
          r.step.jackpotWinCents = pools.award(r.step.jackpotTier);
          jackpotHit = { tier: r.step.jackpotTier, amountCents: r.step.jackpotWinCents };
        }
        step = r.step;
        round.pending = r.pending;
      } else {
        const r = freeSpin(profile, round.betCents, round.pending, this.rng);
        step = r.step;
        round.pending = r.pending;
      }
    }

    const stepIndex = round.steps.length;
    if (step.winCents > 0) wallet.apply(`${round.roundId}:${stepIndex}:win`, "WIN", step.winCents, round.roundId);
    if (step.type === "WHEEL" && step.jackpotWinCents > 0) {
      wallet.apply(`${round.roundId}:${stepIndex}:jackpot`, "JACKPOT", step.jackpotWinCents, round.roundId);
    }
    round.steps.push({ ...step, at });
    round.totalWinCents += stepWin(step);
    round.balanceAfterCents = wallet.player.balanceCents;
    if (isComplete(round.pending)) {
      round.status = "COMPLETE";
      round.completedAt = at;
    }

    const response: PlayResponse = {
      requestId,
      action,
      roundId: round.roundId,
      step,
      round: view(round),
      balanceCents: wallet.player.balanceCents,
      nextAction: nextAction(round.pending),
      jackpots: pools.display(),
    };
    this.store.commit({
      at,
      players: [wallet.player],
      txs: wallet.txs,
      rounds: [round],
      jackpots: pools.state,
      idempotency: [{ key, fingerprint, response, at }],
    });

    this.events.emit("jackpots", response.jackpots);
    if (jackpotHit) this.events.emit("jackpotWon", { playerId, roundId: round.roundId, ...jackpotHit });
    return response;
  }

  // ---------------------------------------------------------------- history & replay

  history(playerId: string, limit = 20, before?: string) {
    const ids = this.store.roundsByPlayer.get(playerId) ?? [];
    let end = ids.length;
    if (before) {
      const i = ids.indexOf(before);
      if (i >= 0) end = i;
    }
    const n = Math.max(1, Math.min(100, limit));
    return ids
      .slice(Math.max(0, end - n), end)
      .reverse()
      .map((id) => {
        const r = this.store.rounds.get(id)!;
        return {
          roundId: r.roundId,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          status: r.status,
          betCents: r.betCents,
          totalWinCents: r.totalWinCents,
          balanceBeforeCents: r.balanceBeforeCents,
          balanceAfterCents: r.balanceAfterCents,
          features: [...new Set(r.steps.map((s) => s.type))].filter((t) => t !== "BASE"),
        };
      });
  }

  round(playerId: string, roundId: string): RoundView {
    const r = this.store.rounds.get(roundId);
    if (!r || r.playerId !== playerId) throw new GameError("ROUND_NOT_FOUND", "Round not found", 404);
    return view(r);
  }

  /**
   * Re-runs a stored round from its recorded RNG draws and checks every step
   * (stops, grid, wins, triggers, wheel segment) against what was recorded.
   * The client can animate the returned steps to show the round again.
   */
  replay(playerId: string, roundId: string) {
    const r = this.round(playerId, roundId);
    const profile = this.profiles.get(r.profileId);
    if (!profile || profileHash(profile) !== r.profileHash) {
      return { roundId, verified: false, reason: "Math profile for this round is not loaded", steps: r.steps };
    }
    const mismatches: number[] = [];
    let pending: PendingFeatures | null = null;
    r.steps.forEach((stored, i) => {
      const rng = new ReplayRng(stored.draws);
      let res: { step: Step; pending: PendingFeatures };
      try {
        if (i === 0) res = baseSpin(profile, r.betCents, rng);
        else if (stored.type === "WHEEL") res = spinWheel(profile, r.betCents, pending!, rng);
        else res = freeSpin(profile, r.betCents, pending!, rng);
      } catch {
        mismatches.push(i);
        return;
      }
      if (res.step.type === "WHEEL" && stored.type === "WHEEL") res.step.jackpotWinCents = stored.jackpotWinCents;
      const { at: _at, ...storedStep } = stored;
      if (canonicalJson(res.step) !== canonicalJson(storedStep)) mismatches.push(i);
      pending = res.pending;
    });
    return { roundId, verified: mismatches.length === 0, mismatchedSteps: mismatches, betCents: r.betCents, steps: r.steps };
  }

  /** Audit summary: ledger and jackpot reconciliation. */
  audit() {
    let ledgerOk = true;
    const sums = new Map<string, number>();
    for (const t of this.store.txs.values()) sums.set(t.playerId, (sums.get(t.playerId) ?? 0) + t.amountCents);
    for (const p of this.store.players.values()) if ((sums.get(p.id) ?? 0) !== p.balanceCents) ledgerOk = false;
    return { ledgerBalancesMatch: ledgerOk, jackpotsReconcile: reconcileJackpots(this.store.jackpots!), jackpots: this.store.jackpots };
  }
}

function view(r: Round): RoundView {
  return { ...r, nextAction: nextAction(r.pending) };
}

function requireRequestId(id: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new GameError("BAD_REQUEST_ID", "requestId must be 8-64 chars [A-Za-z0-9_-] (a UUID works)");
  }
}
