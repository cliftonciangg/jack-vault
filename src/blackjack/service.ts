import { randomUUID } from "node:crypto";
import { GameError } from "../engine/engine.js";
import { canonicalJson } from "../math/profile.js";
import type { Rng } from "../rng/rng.js";
import type { BjRound, BjTable, Player, Store } from "../store/store.js";
import { WalletTxBuilder } from "../wallet/wallet.js";
import { type Card, Shoe } from "./cards.js";
import { type Action, RoundError } from "./engine.js";
import { DEFAULT_RULES, getRules } from "./rules.js";
import { type Frame, type PlayerBet, type TableView, Table, newTable, playerSeat, replayRound, roundOpen } from "./table.js";

export interface BjResponse {
  requestId: string;
  roundId: string | null;
  /** One frame per step (deal, each seat's move, the dealer's turn), to animate in order. */
  frames: Frame[];
  view: TableView;
  balanceCents: number;
}

/** A hand in the player's history or the back office's game records. */
export interface BjRoundSummary {
  roundId: string;
  startedAt: string;
  completedAt: string | null;
  status: BjRound["status"];
  rulesId: string;
  stakeCents: number;
  returnCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  /** The player's hands as card lists, plus the dealer's cards. */
  hands: { cards: Card[]; outcome: string | null; betCents: number }[];
  dealer: Card[];
}

export interface BjTotals {
  rounds: number;
  betCents: number;
  winCents: number;
}

/** How long a hand may wait on the player before the table stands for them. */
export const DECISION_TIMEOUT_MS = 60_000;

const ACTIONS: Action[] = ["hit", "stand", "double", "split", "surrender"];

/**
 * Blackjack on the shared wallet. Each player has one table (bots in the
 * other seats) kept in the store, so a hand survives a restart. Every request
 * is idempotent on its requestId and commits the table, the hand record, the
 * wallet transactions and the response together, like a slot spin.
 */
export class BlackjackService {
  constructor(
    private readonly store: Store,
    private readonly rng: Rng,
    private readonly now: () => Date,
    private readonly maintenance: () => string | null,
    private readonly rulesId = DEFAULT_RULES.id,
  ) {}

  private player(playerId: string): Player {
    const p = this.store.players.get(playerId);
    if (!p) throw new GameError("UNKNOWN_PLAYER", "Player not found", 404);
    return p;
  }

  /** The player's table as it stands (made on first visit). */
  table(playerId: string): { view: TableView; balanceCents: number } {
    const player = this.player(playerId);
    let t = this.store.bjTables.get(playerId);
    if (!t) {
      t = { playerId, ...newTable(this.rulesId, this.rng, this.now().toISOString()) };
      this.store.commit({ at: t.updatedAt, bjTables: [t] });
    }
    const table = new Table(structuredClone(t), this.rng, () => player.balanceCents);
    return { view: table.view(), balanceCents: player.balanceCents };
  }

  bet(playerId: string, requestId: string, b: PlayerBet): BjResponse {
    const bet: PlayerBet = {
      betCents: Number(b.betCents),
      perfectPairsCents: Number(b.perfectPairsCents ?? 0),
      plus3Cents: Number(b.plus3Cents ?? 0),
    };
    return this.run(playerId, requestId, { kind: "bet", ...bet }, (t, roundId) => {
      const m = this.maintenance();
      if (m) throw new GameError("MAINTENANCE", m, 503);
      return t.bet(bet, roundId);
    });
  }

  insurance(playerId: string, requestId: string, take: boolean): BjResponse {
    return this.run(playerId, requestId, { kind: "insurance", take: !!take }, (t) => t.insurance(!!take));
  }

  action(playerId: string, requestId: string, action: string): BjResponse {
    if (!ACTIONS.includes(action as Action)) throw new GameError("BAD_ACTION", `Unknown action ${action}`);
    return this.run(playerId, requestId, { kind: "action", action }, (t) => t.act(action as Action));
  }

  /** Finishes hands left waiting on a player for longer than `maxAgeMs` (declines insurance, stands). */
  expireStale(maxAgeMs = DECISION_TIMEOUT_MS): number {
    const cutoff = this.now().getTime() - maxAgeMs;
    let n = 0;
    for (const t of this.store.bjTables.values()) {
      if (!roundOpen(t) || Date.parse(t.updatedAt) > cutoff) continue;
      this.run(t.playerId, `timeout-${t.roundId}`, { kind: "timeout" }, (x) => x.autoFinish());
      n++;
    }
    return n;
  }

  private run(
    playerId: string,
    requestId: string,
    request: Record<string, unknown>,
    step: (t: Table, newRoundId: string) => Frame[],
  ): BjResponse {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
      throw new GameError("BAD_REQUEST_ID", "requestId must be 8-64 chars [A-Za-z0-9_-] (a UUID works)");
    }
    const key = `${playerId}:bj:${requestId}`;
    const fingerprint = canonicalJson(request);
    const prior = this.store.idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new GameError("IDEMPOTENCY_CONFLICT", "requestId was already used for a different request", 409);
      return prior.response as BjResponse;
    }

    const at = this.now().toISOString();
    const player = this.player(playerId);
    const stored = this.store.bjTables.get(playerId) ?? { playerId, ...newTable(this.rulesId, this.rng, at) };
    const data: BjTable = structuredClone(stored);
    const wasOpen = roundOpen(data);
    // What this hand has already taken from the wallet (nothing yet for a new bet).
    const debited = wasOpen ? playerSeat(data.round)!.stakeCents : 0;
    const startRoundId = data.roundId;
    const pendingStake = () => {
      const s = playerSeat(data.round);
      return !s ? 0 : data.roundId === startRoundId && wasOpen ? s.stakeCents - debited : data.roundId === startRoundId ? 0 : s.stakeCents;
    };
    const table = new Table(data, this.rng, () => player.balanceCents - pendingStake());

    let frames: Frame[];
    const newRoundId = randomUUID();
    try {
      frames = step(table, newRoundId);
    } catch (e) {
      if (e instanceof RoundError) throw new GameError(e.code, e.message, e.code === "INVALID_BET" ? 400 : 409);
      throw e;
    }

    const r = data.round!;
    const roundId = data.roundId!;
    const seat = playerSeat(r)!;
    const isNew = roundId !== startRoundId;
    const wallet = new WalletTxBuilder(player, (id) => this.store.txs.get(id), at);
    const extra = seat.stakeCents - (isNew ? 0 : debited);
    if (extra > 0) wallet.apply(isNew ? `${roundId}:bet` : `${roundId}:a${r.actions.length}`, "BET", -extra, roundId);
    const done = r.phase === "settled";
    if (done && seat.returnCents > 0) wallet.apply(`${roundId}:win`, "WIN", seat.returnCents, roundId);

    const prev = isNew ? undefined : this.store.bjRounds.get(roundId);
    const shoe = new Shoe(table.rules.decks, table.rules.penetration, this.rng, data.shoe);
    const record: BjRound = {
      roundId,
      playerId,
      rulesId: data.rulesId,
      status: done ? "COMPLETE" : "OPEN",
      startedAt: prev?.startedAt ?? at,
      completedAt: done ? at : null,
      stakeCents: seat.stakeCents,
      returnCents: done ? seat.returnCents : 0,
      balanceBeforeCents: prev?.balanceBeforeCents ?? player.balanceCents,
      balanceAfterCents: wallet.player.balanceCents,
      shoeShuffle: data.shoe.shuffles,
      shoeHash: prev && prev.shoeShuffle === data.shoe.shuffles ? prev.shoeHash : shoe.hash(),
      round: structuredClone(r),
    };
    data.updatedAt = at;

    const balanceCents = wallet.player.balanceCents;
    const final = new Table(structuredClone(data), this.rng, () => balanceCents).view();
    const response: BjResponse = { requestId, roundId, frames, view: final, balanceCents };
    this.store.commit({
      at,
      players: [wallet.player],
      txs: wallet.txs,
      bjTables: [data],
      bjRounds: [record],
      idempotency: [{ key, fingerprint, response, at }],
    });
    return response;
  }

  // ---------------------------------------------------------------- records

  history(playerId: string, limit = 20, before?: string): BjRoundSummary[] {
    return this.rounds(playerId, { limit, before }).rounds;
  }

  /** A player's hands started in [from, to), newest first, with totals over the whole period. */
  rounds(playerId: string, o: { from?: string; to?: string; limit?: number; before?: string } = {}) {
    const ids = this.store.bjRoundsByPlayer.get(playerId) ?? [];
    const totals: BjTotals = { rounds: 0, betCents: 0, winCents: 0 };
    const n = Math.max(1, Math.min(500, o.limit ?? 100));
    const out: BjRoundSummary[] = [];
    let collecting = !o.before;
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = this.store.bjRounds.get(ids[i])!;
      if ((o.from && r.startedAt < o.from) || (o.to && r.startedAt >= o.to)) continue;
      addTotals(totals, r);
      if (collecting && out.length < n) out.push(summary(r));
      if (ids[i] === o.before) collecting = true;
    }
    return { totals, rounds: out };
  }

  totals(playerIds: Iterable<string>, from?: string, to?: string): BjTotals {
    const t: BjTotals = { rounds: 0, betCents: 0, winCents: 0 };
    for (const id of playerIds) {
      for (const rid of this.store.bjRoundsByPlayer.get(id) ?? []) {
        const r = this.store.bjRounds.get(rid)!;
        if ((!from || r.startedAt >= from) && (!to || r.startedAt < to)) addTotals(t, r);
      }
    }
    return t;
  }

  /** One stored hand, with every seat, and whether replaying its cards and decisions gives the same result. */
  round(roundId: string): (BjRound & { verified: boolean | null }) | null {
    const r = this.store.bjRounds.get(roundId);
    if (!r) return null;
    return { ...r, verified: r.status === "COMPLETE" ? replayRound(r.round) : null };
  }

  rulesName(): string {
    return getRules(this.rulesId).name;
  }
}

function addTotals(t: BjTotals, r: BjRound) {
  if (r.status !== "COMPLETE") return;
  t.rounds++;
  t.betCents += r.stakeCents;
  t.winCents += r.returnCents;
}

function summary(r: BjRound): BjRoundSummary {
  const seat = playerSeat(r.round);
  return {
    roundId: r.roundId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    status: r.status,
    rulesId: r.rulesId,
    stakeCents: r.stakeCents,
    returnCents: r.returnCents,
    balanceBeforeCents: r.balanceBeforeCents,
    balanceAfterCents: r.balanceAfterCents,
    hands: (seat?.hands ?? []).map((h) => ({ cards: h.cards, outcome: h.outcome ?? null, betCents: h.betCents })),
    dealer: r.status === "COMPLETE" ? r.round.dealer : r.round.dealer.slice(0, 1),
  };
}
