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
import { TheoreticalReport, theoreticalRtp } from "../math/theoretical.js";
import { JackpotTier, MathProfile, REELS, ROWS } from "../math/types.js";
import { CryptoRng, ReplayRng, Rng, SeededRng } from "../rng/rng.js";
import { ChangeKind, ChangeLogEntry, Commit, GameSettings, Player, Round, Store, Tx } from "../store/store.js";
import { WalletTxBuilder } from "../wallet/wallet.js";

export interface GameServiceOptions {
  /** Default profile on first start (later the operator's default in GameSettings wins). */
  profile: MathProfile;
  store: Store;
  /** Other profiles: for distributors to choose, and for replaying old rounds. */
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

/** A round in the back office's game records. */
export interface RoundSummary {
  roundId: string;
  startedAt: string;
  completedAt: string | null;
  status: Round["status"];
  profileId: string;
  betCents: number;
  totalWinCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  features: string[];
  jackpots: JackpotTier[];
}

/** Totals over a player's rounds, for the back office. */
export interface PlayTotals {
  rounds: number;
  betCents: number;
  winCents: number;
  biggestWinCents: number;
  freeSpins: number;
  wheels: number;
  jackpots: number;
  /** Win the theoretical RTP of each round's own profile and bet predicts. */
  expectedWinCents: number;
}

/** What the win-ratio pages show about one math profile. */
export interface ProfileInfo {
  id: string;
  hash: string;
  description: string;
  /** Theoretical RTP at the lowest and highest bet. */
  rtpMin: number;
  rtpMax: number;
  /** Share of base spins that pay something or trigger a feature (simulated once, seeded). */
  hitFrequency: number;
  /** Base spins per trigger, on average. */
  freeSpinsEvery: number;
  wheelEvery: number;
}

/** Spins simulated (seeded, so always the same figure) to estimate a profile's hit frequency. */
const HIT_FREQUENCY_SPINS = 100_000;

export class GameService {
  readonly events = new EventEmitter();
  /** Shared by every profile: jackpot pools and bet levels are the same across profiles. */
  private readonly profile: MathProfile;
  private readonly hashes = new Map<string, string>();
  private readonly reports = new Map<string, TheoreticalReport[]>();
  private readonly hitFrequency = new Map<string, number>();
  private readonly store: Store;
  private readonly rng: Rng;
  private readonly profiles = new Map<string, MathProfile>();
  private readonly startingBalanceCents: number;
  private readonly now: () => Date;

  constructor(o: GameServiceOptions) {
    this.profile = o.profile;
    this.store = o.store;
    this.rng = o.rng ?? new CryptoRng();
    this.startingBalanceCents = o.startingBalanceCents ?? 0;
    this.now = o.now ?? (() => new Date());
    for (const p of [...(o.profiles ?? []), o.profile]) {
      this.profiles.set(p.id, p);
      this.hashes.set(p.id, profileHash(p));
    }
    if (!this.store.jackpots) this.store.commit({ at: this.iso(), jackpots: initialJackpots(this.profile) });
    if (!this.store.settings) {
      this.store.commit({
        at: this.iso(),
        settings: { defaultProfileId: o.profile.id, allowedProfileIds: [...this.profiles.keys()].sort(), maintenance: { on: false, message: "" } },
      });
    }
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---------------------------------------------------------------- profiles & settings

  settings(): GameSettings {
    return this.store.settings!;
  }

  profileIds(): string[] {
    return [...this.profiles.keys()].sort();
  }

  hasProfile(id: string): boolean {
    return this.profiles.has(id);
  }

  /** The operator's default, or the startup profile if that one isn't loaded any more. */
  defaultProfileId(): string {
    const id = this.settings().defaultProfileId;
    return this.profiles.has(id) ? id : this.profile.id;
  }

  /** The profile a distributor's players play on. */
  distributorProfileId(distributorId: string | null | undefined): string {
    const d = distributorId ? this.store.accounts.get(distributorId) : undefined;
    return d?.profileId && this.profiles.has(d.profileId) ? d.profileId : this.defaultProfileId();
  }

  /** A player's new rounds use its distributor's profile (player -> agent -> distributor). */
  profileForPlayer(playerId: string): MathProfile {
    const agent = this.store.accounts.get(this.store.accounts.get(playerId)?.parentId ?? "");
    return this.profiles.get(this.distributorProfileId(agent?.parentId))!;
  }

  profileHashOf(id: string): string {
    const h = this.hashes.get(id);
    if (!h) throw new GameError("UNKNOWN_PROFILE", `No math profile ${id}`, 404);
    return h;
  }

  /**
   * Puts a distributor's players on another profile. Their next round uses it;
   * rounds already open finish on the profile they started with. With
   * `allowedOnly` (a distributor choosing for itself) the profile must be one
   * the operator allows.
   */
  setDistributorProfile(distributorId: string, profileId: string, actorId: string, o: { allowedOnly: boolean }) {
    const d = this.store.accounts.get(distributorId);
    if (!d || d.role !== "DISTRIBUTOR") throw new GameError("NOT_DISTRIBUTOR", "Win ratio is set per distributor");
    this.profileHashOf(profileId);
    if (o.allowedOnly && !this.settings().allowedProfileIds.includes(profileId)) {
      throw new GameError("PROFILE_NOT_ALLOWED", "The operator hasn't enabled that profile", 403);
    }
    const from = this.distributorProfileId(d.id);
    if (from === profileId && d.profileId === profileId) return { profileId, changed: false };
    const at = this.iso();
    this.store.commit({ at, accounts: [{ ...d, profileId }], changes: [this.change("DISTRIBUTOR_PROFILE", d.id, from, profileId, actorId, at)] });
    return { profileId, changed: from !== profileId };
  }

  /** Operator: default profile, which profiles distributors may pick, maintenance mode. */
  updateSettings(patch: Partial<Pick<GameSettings, "defaultProfileId" | "allowedProfileIds">> & { maintenance?: { on: boolean; message?: string } }, actorId: string): GameSettings {
    const cur = this.settings();
    const next: GameSettings = structuredClone(cur);
    const at = this.iso();
    const changes: ChangeLogEntry[] = [];
    if (patch.defaultProfileId !== undefined && patch.defaultProfileId !== cur.defaultProfileId) {
      this.profileHashOf(String(patch.defaultProfileId));
      next.defaultProfileId = String(patch.defaultProfileId);
      changes.push(this.change("DEFAULT_PROFILE", null, cur.defaultProfileId, next.defaultProfileId, actorId, at));
    }
    if (patch.allowedProfileIds !== undefined) {
      if (!Array.isArray(patch.allowedProfileIds)) throw new GameError("BAD_PROFILES", "allowedProfileIds must be a list");
      const ids = [...new Set(patch.allowedProfileIds.map(String))].sort();
      ids.forEach((id) => this.profileHashOf(id));
      if (ids.join(",") !== cur.allowedProfileIds.join(",")) {
        next.allowedProfileIds = ids;
        changes.push(this.change("ALLOWED_PROFILES", null, cur.allowedProfileIds.join(", ") || "none", ids.join(", ") || "none", actorId, at));
      }
    }
    if (patch.maintenance !== undefined) {
      const on = patch.maintenance.on === true;
      const message = String(patch.maintenance.message ?? "").slice(0, 200);
      if (on !== cur.maintenance.on || message !== cur.maintenance.message) {
        next.maintenance = { on, message };
        changes.push(this.change("MAINTENANCE", null, cur.maintenance.on ? "On" : "Off", on ? `On${message ? `: ${message}` : ""}` : "Off", actorId, at));
      }
    }
    if (changes.length) this.store.commit({ at, settings: next, changes });
    return this.settings();
  }

  private change(kind: ChangeKind, targetId: string | null, from: string, to: string, actorId: string, at: string): ChangeLogEntry {
    return { id: randomBytes(8).toString("hex"), kind, targetId, from, to, actorId, at };
  }

  /** Settings changes, newest first; with `targetId`, only that distributor's profile changes. */
  changes(o: { targetId?: string; kinds?: ChangeKind[]; limit?: number } = {}): ChangeLogEntry[] {
    const n = Math.max(1, Math.min(500, o.limit ?? 100));
    return [...this.store.changes.values()]
      .filter((c) => (!o.targetId || c.targetId === o.targetId) && (!o.kinds || o.kinds.includes(c.kind)))
      .reverse()
      .slice(0, n);
  }

  private rtpReports(p: MathProfile): TheoreticalReport[] {
    let r = this.reports.get(p.id);
    if (!r) this.reports.set(p.id, (r = p.betLevelsCents.map((b) => theoreticalRtp(p, b))));
    return r;
  }

  /**
   * Works out every profile's hit frequency in small slices off the event loop,
   * so the first win-ratio page doesn't stall spins. Called once at server start.
   */
  warmProfileStats(): void {
    const ids = [...this.profiles.keys()].filter((id) => !this.hitFrequency.has(id));
    const next = () => {
      const id = ids.shift();
      if (!id) return;
      const p = this.profiles.get(id)!;
      this.rtpReports(p);
      const rng = new SeededRng(1);
      let done = 0;
      let hits = 0;
      const slice = () => {
        if (this.hitFrequency.has(id)) return next();
        for (const end = Math.min(HIT_FREQUENCY_SPINS, done + 5_000); done < end; done++) {
          const s = baseSpin(p, p.betLevelsCents[0], rng).step;
          if (s.winCents > 0 || s.freeSpinsAwarded > 0 || s.wheelTriggered) hits++;
        }
        if (done < HIT_FREQUENCY_SPINS) setTimeout(slice, 0).unref();
        else {
          this.hitFrequency.set(id, hits / HIT_FREQUENCY_SPINS);
          next();
        }
      };
      setTimeout(slice, 0).unref();
    };
    next();
  }

  profileInfo(id: string): ProfileInfo {
    const p = this.profiles.get(id);
    if (!p) throw new GameError("UNKNOWN_PROFILE", `No math profile ${id}`, 404);
    const reports = this.rtpReports(p);
    const top = reports[reports.length - 1];
    let hit = this.hitFrequency.get(id);
    if (hit === undefined) {
      const rng = new SeededRng(1);
      let hits = 0;
      for (let i = 0; i < HIT_FREQUENCY_SPINS; i++) {
        const s = baseSpin(p, p.betLevelsCents[0], rng).step;
        if (s.winCents > 0 || s.freeSpinsAwarded > 0 || s.wheelTriggered) hits++;
      }
      this.hitFrequency.set(id, (hit = hits / HIT_FREQUENCY_SPINS));
    }
    return {
      id,
      hash: this.hashes.get(id)!,
      description: p.description,
      rtpMin: Math.min(...reports.map((r) => r.rtp)),
      rtpMax: Math.max(...reports.map((r) => r.rtp)),
      hitFrequency: hit,
      freeSpinsEvery: 1 / top.freeSpins.triggerProbability,
      wheelEvery: 1 / top.wheel.triggerProbability,
    };
  }

  // ---------------------------------------------------------------- config

  /** Game config; with a player, the RTP figures are for that player's profile. */
  config(playerId?: string) {
    const p = playerId ? this.profileForPlayer(playerId) : this.profiles.get(this.defaultProfileId())!;
    const rtpByBet = Object.fromEntries(this.rtpReports(p).map((r) => [r.betCents, r.rtp]));
    return {
      game: "Jack Vault",
      profileId: p.id,
      profileHash: this.hashes.get(p.id)!,
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

  /** Share of each bet that goes to every jackpot pool, in basis points. */
  jackpotContributionBps(): Record<JackpotTier, number> {
    return Object.fromEntries(Object.entries(this.profile.jackpots).map(([t, j]) => [t, j.contributionBps])) as Record<JackpotTier, number>;
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
      maintenance: this.settings().maintenance.on ? this.settings().maintenance.message || "The game is under maintenance." : null,
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
      const m = this.settings().maintenance;
      if (m.on) throw new GameError("MAINTENANCE", m.message || "The game is under maintenance. Please try again later.", 503);
      if (betCents === undefined) throw new GameError("INVALID_BET", "betCents is required");
      const profile = this.profileForPlayer(playerId);
      assertBet(profile, betCents);
      const roundId = randomUUID();
      const before = player.balanceCents;
      // Debit first (fails on insufficient funds before any RNG is drawn).
      wallet.apply(`${roundId}:bet`, "BET", -betCents, roundId);
      const r = baseSpin(profile, betCents, this.rng);
      const contributions = pools.contribute(betCents);
      step = r.step;
      round = {
        roundId,
        playerId,
        betCents,
        profileId: profile.id,
        profileHash: this.hashes.get(profile.id)!,
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
      // A round always finishes on the math it started with, even if the distributor's profile changed since.
      if (this.hashes.get(round.profileId) !== round.profileHash) throw new GameError("PROFILE_MISSING", "Round's math profile is unavailable", 500);
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
        const { profileId: _p, jackpots: _j, ...rest } = summary(this.store.rounds.get(id)!);
        return rest;
      });
  }

  /**
   * Back office: a player's rounds started in [from, to), newest first, with
   * totals over the whole period. Callers check the staff member may see the player.
   */
  rounds(playerId: string, o: { from?: string; to?: string; limit?: number; before?: string } = {}) {
    const ids = this.store.roundsByPlayer.get(playerId) ?? [];
    const inRange = (r: Round) => (!o.from || r.startedAt >= o.from) && (!o.to || r.startedAt < o.to);
    const totals: PlayTotals = { rounds: 0, betCents: 0, winCents: 0, biggestWinCents: 0, freeSpins: 0, wheels: 0, jackpots: 0, expectedWinCents: 0 };
    const n = Math.max(1, Math.min(500, o.limit ?? 100));
    const out: RoundSummary[] = [];
    let collecting = !o.before;
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = this.store.rounds.get(ids[i])!;
      if (!inRange(r)) continue;
      this.addTotals(totals, r);
      if (collecting && out.length < n) out.push(summary(r));
      if (ids[i] === o.before) collecting = true;
    }
    totals.expectedWinCents = Math.round(totals.expectedWinCents);
    return { totals, rounds: out };
  }

  /** Totals over many players' rounds in [from, to), plus how many of them played. */
  totals(playerIds: Iterable<string>, from?: string, to?: string): PlayTotals & { activePlayers: number } {
    const t: PlayTotals & { activePlayers: number } = { rounds: 0, betCents: 0, winCents: 0, biggestWinCents: 0, freeSpins: 0, wheels: 0, jackpots: 0, expectedWinCents: 0, activePlayers: 0 };
    for (const id of playerIds) {
      const before = t.rounds;
      for (const rid of this.store.roundsByPlayer.get(id) ?? []) {
        const r = this.store.rounds.get(rid)!;
        if ((!from || r.startedAt >= from) && (!to || r.startedAt < to)) this.addTotals(t, r);
      }
      if (t.rounds > before) t.activePlayers++;
    }
    t.expectedWinCents = Math.round(t.expectedWinCents);
    return t;
  }

  private addTotals(t: PlayTotals, r: Round): void {
    t.rounds++;
    t.betCents += r.betCents;
    t.winCents += r.totalWinCents;
    t.biggestWinCents = Math.max(t.biggestWinCents, r.totalWinCents);
    if (r.steps.some((s) => s.type === "FREE")) t.freeSpins++;
    if (r.steps.some((s) => s.type === "WHEEL")) t.wheels++;
    if (r.steps.some((s) => s.type === "WHEEL" && s.jackpotTier)) t.jackpots++;
    const p = this.profiles.get(r.profileId);
    const rtp = p ? this.rtpReports(p).find((x) => x.betCents === r.betCents)?.rtp : undefined;
    t.expectedWinCents += r.betCents * (rtp ?? 0);
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

function summary(r: Round): RoundSummary {
  return {
    roundId: r.roundId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    status: r.status,
    profileId: r.profileId,
    betCents: r.betCents,
    totalWinCents: r.totalWinCents,
    balanceBeforeCents: r.balanceBeforeCents,
    balanceAfterCents: r.balanceAfterCents,
    features: [...new Set(r.steps.map((s) => s.type))].filter((t) => t !== "BASE"),
    jackpots: r.steps.flatMap((s) => (s.type === "WHEEL" && s.jackpotTier ? [s.jackpotTier] : [])),
  };
}

function view(r: Round): RoundView {
  return { ...r, nextAction: nextAction(r.pending) };
}

function requireRequestId(id: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new GameError("BAD_REQUEST_ID", "requestId must be 8-64 chars [A-Za-z0-9_-] (a UUID works)");
  }
}
