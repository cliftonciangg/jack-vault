import { GameError } from "../engine/engine.js";
import { reconcileJackpots } from "../engine/jackpots.js";
import { JACKPOT_TIERS } from "../math/types.js";
import type { GameService, PlayTotals } from "../service/gameService.js";
import type { Account, Role, Store } from "../store/store.js";
import type { AccountService } from "./accounts.js";

/**
 * Read-only reports for the back office: period totals per account, daily
 * series for the charts, and the operator's audit checks. Everything is
 * computed from the in-memory store, so it costs no database round trip.
 */

export interface Period {
  /** ISO time, inclusive. */
  from?: string;
  /** ISO time, exclusive. */
  to?: string;
}

/** One account's coin flows over a period, plus its players' play. */
export interface Flows {
  id: string;
  username: string;
  role: Role;
  status: Account["status"];
  balanceCents: number;
  lastLoginAt: string | null;
  /** Direct children and what they hold now. */
  children: number;
  childrenBalanceCents: number;
  /** Distributor: what its agents' players hold now. */
  grandchildrenBalanceCents: number;
  /** Loaded or issued in from the level above. */
  receivedCents: number;
  /** Redeemed or taken back by the level above. */
  returnedCents: number;
  /** Loaded out to its own children. */
  loadedCents: number;
  /** Redeemed back from its own children. */
  redeemedCents: number;
  /** Play by every player at or below this account. */
  play: PlayTotals & { activePlayers: number };
}

interface Sums {
  receivedCents: number;
  returnedCents: number;
  loadedCents: number;
  redeemedCents: number;
}

export class OfficeReports {
  constructor(
    private readonly acc: AccountService,
    private readonly svc: GameService,
    private readonly store: Store,
  ) {}

  /** Ledger sums per account over a period. */
  private sums(p: Period): Map<string, Sums> {
    const m = new Map<string, Sums>();
    const get = (id: string) => {
      let s = m.get(id);
      if (!s) m.set(id, (s = { receivedCents: 0, returnedCents: 0, loadedCents: 0, redeemedCents: 0 }));
      return s;
    };
    for (const e of this.store.ledger.values()) {
      if ((p.from && e.at < p.from) || (p.to && e.at >= p.to)) continue;
      if (e.type === "ISSUE") get(e.toId!).receivedCents += e.amountCents;
      else if (e.type === "REVOKE") get(e.fromId!).returnedCents += e.amountCents;
      else if (e.type === "LOAD") {
        get(e.fromId!).loadedCents += e.amountCents;
        get(e.toId!).receivedCents += e.amountCents;
      } else {
        get(e.fromId!).returnedCents += e.amountCents;
        get(e.toId!).redeemedCents += e.amountCents;
      }
    }
    return m;
  }

  private players(a: Account): string[] {
    return a.role === "PLAYER" ? [a.id] : this.acc.descendants(a).filter((d) => d.role === "PLAYER").map((d) => d.id);
  }

  private flows(a: Account, sums: Map<string, Sums>, p: Period): Flows {
    const v = this.acc.view(a);
    const kids = a.role === "PLAYER" ? [] : this.acc.children(a);
    const s = sums.get(a.id) ?? { receivedCents: 0, returnedCents: 0, loadedCents: 0, redeemedCents: 0 };
    return {
      id: a.id,
      username: a.username,
      role: a.role,
      status: a.status,
      balanceCents: v.balanceCents,
      lastLoginAt: v.lastLoginAt,
      children: kids.length,
      childrenBalanceCents: v.childrenBalanceCents ?? 0,
      grandchildrenBalanceCents: kids.reduce((t, k) => t + (k.role === "PLAYER" ? 0 : (this.acc.view(k).childrenBalanceCents ?? 0)), 0),
      ...s,
      play: this.svc.totals(this.players(a), p.from, p.to),
    };
  }

  /**
   * The caller's flows and one row per child over a period. With `parentId`,
   * the rows are that (visible) account's children instead, read only.
   */
  summary(actor: Account, p: Period & { parentId?: string }) {
    checkPeriod(p);
    const parent = p.parentId ? this.acc.visible(actor, p.parentId) : actor;
    if (parent.role === "PLAYER") throw new GameError("NOT_A_PARENT", "Players have no accounts below them");
    const sums = this.sums(p);
    const out: { from: string | null; to: string | null; me: Flows; children: Flows[]; platform?: ReturnType<OfficeReports["platform"]> } = {
      from: p.from ?? null,
      to: p.to ?? null,
      me: this.flows(parent, sums, p),
      children: this.acc.children(parent).map((k) => this.flows(k, sums, p)),
    };
    if (actor.role === "OPERATOR" && parent.id === actor.id) out.platform = this.platform(p);
    return out;
  }

  /** Operator: points issued and taken back (in the period and all time), and who holds them now. */
  platform(p: Period = {}) {
    let issued = 0;
    let revoked = 0;
    let periodIssued = 0;
    let periodRevoked = 0;
    /** Period loads and redeems, by the role of the account doing the loading / redeeming. */
    const moves = { distributorLoadedCents: 0, agentLoadedCents: 0, distributorRedeemedCents: 0, agentRedeemedCents: 0 };
    const roleOf = (id: string | null) => (id ? this.store.accounts.get(id)?.role : undefined);
    for (const e of this.store.ledger.values()) {
      const inPeriod = (!p.from || e.at >= p.from) && (!p.to || e.at < p.to);
      if (inPeriod && e.type === "LOAD") moves[roleOf(e.fromId) === "DISTRIBUTOR" ? "distributorLoadedCents" : "agentLoadedCents"] += e.amountCents;
      if (inPeriod && e.type === "REDEEM") moves[roleOf(e.toId) === "DISTRIBUTOR" ? "distributorRedeemedCents" : "agentRedeemedCents"] += e.amountCents;
      if (e.type === "ISSUE") {
        issued += e.amountCents;
        if (inPeriod) periodIssued += e.amountCents;
      } else if (e.type === "REVOKE") {
        revoked += e.amountCents;
        if (inPeriod) periodRevoked += e.amountCents;
      }
    }
    const held: Record<"DISTRIBUTOR" | "AGENT" | "PLAYER", number> = { DISTRIBUTOR: 0, AGENT: 0, PLAYER: 0 };
    for (const a of this.store.accounts.values()) if (a.role !== "OPERATOR") held[a.role] += this.acc.balanceOf(a);
    return {
      issuedCents: issued,
      revokedCents: revoked,
      circulationCents: issued - revoked,
      periodIssuedCents: periodIssued,
      periodRevokedCents: periodRevoked,
      ...moves,
      heldByDistributorsCents: held.DISTRIBUTOR,
      heldByAgentsCents: held.AGENT,
      heldByPlayersCents: held.PLAYER,
    };
  }

  /**
   * Per-day loads and redeems made by `account` (default: the caller) to its
   * children, with days in the given IANA time zone.
   */
  daily(actor: Account, p: Period & { timeZone?: string; accountId?: string }) {
    checkPeriod(p);
    const a = p.accountId ? this.acc.visible(actor, p.accountId) : actor;
    const fmt = dayFormatter(p.timeZone);
    const days = new Map<string, { day: string; loadedCents: number; redeemedCents: number }>();
    for (const e of this.store.ledger.values()) {
      if ((p.from && e.at < p.from) || (p.to && e.at >= p.to)) continue;
      const out = e.type === "LOAD" && e.fromId === a.id;
      const back = e.type === "REDEEM" && e.toId === a.id;
      if (!out && !back) continue;
      const day = fmt.format(new Date(e.at));
      const d = days.get(day) ?? { day, loadedCents: 0, redeemedCents: 0 };
      if (out) d.loadedCents += e.amountCents;
      else d.redeemedCents += e.amountCents;
      days.set(day, d);
    }
    return { accountId: a.id, days: [...days.values()].sort((x, y) => x.day.localeCompare(y.day)) };
  }

  /** The operator's audit page: each check with the accounts that fail it. */
  audit() {
    const sums = new Map<string, number>();
    for (const t of this.store.txs.values()) sums.set(t.playerId, (sums.get(t.playerId) ?? 0) + t.amountCents);
    const playerMismatches = [...this.store.players.values()]
      .filter((pl) => (sums.get(pl.id) ?? 0) !== pl.balanceCents)
      .map((pl) => ({ id: pl.id, username: this.store.accounts.get(pl.id)?.username ?? pl.id, balanceCents: pl.balanceCents, expectedCents: sums.get(pl.id) ?? 0 }));

    const net = new Map<string, number>();
    for (const e of this.store.ledger.values()) {
      if (e.fromId) net.set(e.fromId, (net.get(e.fromId) ?? 0) - e.amountCents);
      if (e.toId) net.set(e.toId, (net.get(e.toId) ?? 0) + e.amountCents);
    }
    const staffMismatches = [...this.store.accounts.values()]
      .filter((a) => a.role !== "PLAYER" && (net.get(a.id) ?? 0) !== a.balanceCents)
      .map((a) => ({ id: a.id, username: a.username, balanceCents: a.balanceCents, expectedCents: net.get(a.id) ?? 0 }));

    const accounts = this.acc.audit();
    const held = [...net.values()].reduce((x, y) => x + y, 0);
    const jackpots = reconcileJackpots(this.store.jackpots!);
    const settings = this.svc.settings();
    return {
      checkedAt: new Date().toISOString(),
      checks: [
        {
          id: "players",
          ok: playerMismatches.length === 0,
          title: "Every player balance equals its transactions",
          detail: `${this.store.players.size} players, ${this.store.txs.size} transactions`,
          mismatches: playerMismatches,
        },
        {
          id: "staff",
          ok: staffMismatches.length === 0,
          title: "Every distributor and agent balance equals its ledger flows",
          detail: `${[...this.store.accounts.values()].filter((a) => a.role === "DISTRIBUTOR" || a.role === "AGENT").length} accounts, ${accounts.ledgerEntries} ledger entries`,
          mismatches: staffMismatches,
        },
        {
          id: "conservation",
          ok: accounts.pointsConserved,
          title: "Points conserved: issued minus taken back equals what accounts received",
          detail: `Issued minus taken back ${money(accounts.issuedCents)}, held by accounts ${money(held)}`,
          mismatches: accounts.pointsConserved ? [] : [{ id: "platform", username: "platform", balanceCents: held, expectedCents: accounts.issuedCents }],
        },
        {
          id: "jackpots",
          ok: JACKPOT_TIERS.every((t) => jackpots[t]),
          title: "Every jackpot pool equals its seed plus contributions minus payouts",
          detail: JACKPOT_TIERS.map((t) => `${t} ${jackpots[t] ? "ok" : "MISMATCH"}`).join(", "),
          mismatches: [],
        },
      ],
      profiles: this.svc.profileIds().map((id) => ({ id, hash: this.svc.profileHashOf(id), isDefault: id === settings.defaultProfileId })),
    };
  }
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function checkPeriod(p: Period): void {
  for (const k of ["from", "to"] as const) {
    if (p[k] !== undefined && Number.isNaN(Date.parse(p[k]!))) throw new GameError("BAD_DATE", `${k} must be an ISO date-time`);
  }
}

/** YYYY-MM-DD in a time zone (UTC when unknown). */
function dayFormatter(timeZone?: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw new GameError("BAD_TIME_ZONE", "Unknown time zone");
  }
}
