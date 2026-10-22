import "./bj.css";
import { ApiError, newRequestId, type BjAction, type BjFrame, type BjResponse, type BjView, type GameApi } from "../api/types";
import { $, esc, h, ICON, money } from "../ui/dom";
import { toast } from "../ui/overlays";
import { sfx } from "../ui/sound";

type Mode = "betting" | "insurance" | "play" | "wait";
type Seat = BjView["seats"][number];

const ME = 2;
const CHIPS = [100, 200, 500, 1_000];
const SIDE_STEPS = [0, 100, 200, 500];
const BET_SECONDS = 15;
const DECIDE_SECONDS = 15;
const INSURANCE_SECONDS = 10;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const AVATAR_BG = ["#E8618C", "#3BA3E0", "#E0973B", "#6BC46B", "#A06BE0", "#E05A4A", "#3BC4B4", "#C4A43B"];
/** Seat points (x %, y %) on the felt, seat 0 on the dealer's left. */
const SEAT_POS = {
  portrait: [[13, 47], [27, 63], [50, 77], [73, 63], [87, 47]],
  landscape: [[9, 47], [28, 63], [50, 75], [72, 63], [91, 47]],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chipClass = (c: number) => (c >= 1_000 ? "c10" : c >= 500 ? "c5" : c >= 200 ? "c2" : "c1");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function cardHtml(c: number | null, cls = ""): string {
  if (c === null) return `<div class="bj-card back ${cls}"></div>`;
  const rank = RANKS[c % 13];
  const suit = Math.floor(c / 13);
  const red = suit === 1 || suit === 2;
  return `<div class="bj-card ${red ? "red" : ""} ${cls}"><span class="r">${rank}</span><span class="s">${SUITS[suit]}</span><span class="c">${SUITS[suit]}</span></div>`;
}

const SIDE_LABEL: Record<string, string> = {
  perfect: "PERFECT PAIR", colored: "COLORED PAIR", mixed: "MIXED PAIR",
  suitedTrips: "SUITED TRIPS", straightFlush: "STRAIGHT FLUSH", trips: "THREE OF A KIND", straight: "STRAIGHT", flush: "FLUSH",
};
const OUTCOME_LABEL: Record<string, string> = { blackjack: "BLACKJACK", win: "WIN", push: "PUSH", lose: "LOSE", bust: "BUST", surrender: "SURRENDER" };

/**
 * The blackjack table screen: five seats, the player in the middle and bots
 * around them. The server deals and plays the bots; this screen animates the
 * frames it sends back one step at a time and runs the betting and decision
 * timers.
 */
export class BlackjackScreen {
  el: HTMLElement;
  private felt: HTMLElement;
  private seatsEl: HTMLElement;
  private dealerEl: HTMLElement;
  private msgEl: HTMLElement;
  private clockEl: HTMLElement;
  private balEl: HTMLElement;
  private shoeEl: HTMLElement;
  private bar: HTMLElement;
  private view: BjView | null = null;
  private mode: Mode = "wait";
  private bet = { main: 0, pp: 0, p3: 0 };
  /** Card keys on the table, so only new cards fly in and only the hole card flips. */
  private shown = new Map<string, number | null>();
  private timer = 0;
  private deadline = 0;
  private closed = false;
  private unsubBalance: (() => void) | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: GameApi,
    private balance: number,
    private readonly onExit: (balanceCents: number) => void,
  ) {
    this.el = h(`<div class="screen bj" style="z-index:16">
      <div class="bj-top">
        <button class="bj-back press" aria-label="Back to lobby">${ICON.back()}</button>
        <div class="bj-title gold">BLACKJACK</div>
        <div class="bj-shoe"><span class="num">0</span> left</div>
        <div class="bj-bal">${ICON.coin()}<span class="num">${money(balance)}</span></div>
      </div>
      <div class="bj-felt">
        <div class="bj-shoebox"></div>
        <div class="bj-rules"><b>BLACKJACK PAYS 3 TO 2</b><span>INSURANCE PAYS 2 TO 1</span><i>Dealer must hit soft 17</i></div>
        <div class="bj-dealer"></div>
        <div class="bj-seats"></div>
        <div class="bj-msg"></div>
      </div>
      <div class="bj-bar"></div>
    </div>`);
    host.appendChild(this.el);
    this.felt = $(this.el, ".bj-felt");
    this.seatsEl = $(this.el, ".bj-seats");
    this.dealerEl = $(this.el, ".bj-dealer");
    this.msgEl = $(this.el, ".bj-msg");
    this.clockEl = h(`<div class="bj-clock"></div>`);
    this.felt.appendChild(this.clockEl);
    this.balEl = $(this.el, ".bj-bal .num");
    this.shoeEl = $(this.el, ".bj-shoe .num");
    this.bar = $(this.el, ".bj-bar");
    $(this.el, ".bj-back").addEventListener("click", () => this.exit());
    this.unsubBalance = this.api.onBalance?.((c) => {
      if (this.mode !== "betting" || c === this.balance) return;
      const added = c > this.balance;
      this.balance = c;
      this.showBalance();
      toast(`${ICON.coin(22)} ${added ? "Coins added" : "Coins redeemed"}: balance <span class="num" style="color:#FFE27A">${money(c)}</span>`);
    });
    void this.load();
  }

  private landscape(): boolean {
    return !!this.el.closest(".landscape-root");
  }

  /** Redraws for a new screen size or orientation. */
  relayout(): void {
    if (this.view) this.render(this.view, null, true);
  }

  private async load(): Promise<void> {
    try {
      const t = await this.api.bjTable();
      this.balance = t.balanceCents;
      this.render(t.view, null, true);
      this.enterMode(t.view);
    } catch (e) {
      toast(e instanceof ApiError ? esc(e.message) : "Can't open the table right now.");
      this.exit(true);
    }
  }

  private exit(force = false): void {
    if (!force && this.mode !== "betting") {
      toast("Finish this hand first.");
      return;
    }
    this.closed = true;
    clearInterval(this.timer);
    this.unsubBalance?.();
    this.el.remove();
    this.onExit(this.balance);
  }

  // ---------------------------------------------------------------- rendering

  private showBalance(pending = 0): void {
    this.balEl.textContent = money(this.balance - pending);
  }

  private message(text: string, cls = ""): void {
    this.msgEl.className = `bj-msg ${cls} ${text ? "on" : ""}`;
    this.msgEl.innerHTML = text;
    if (text) {
      void this.msgEl.offsetWidth;
      this.msgEl.classList.add("pop");
    }
  }

  private seatHtml(s: Seat, v: BjView, pos: number[], anim: Map<string, string>): string {
    const me = s.seat === ME;
    const settled = v.phase === "settled";
    const hands = s.hands.map((hd, hi) => {
      const turn = v.turn?.seat === s.seat && v.turn.hand === hi;
      const cards = hd.cards.map((c, ci) => cardHtml(c, anim.get(`s${s.seat}h${hi}c${ci}`) ?? "")).join("");
      const bj = hd.cards.length === 2 && hd.total === 21 && s.hands.length === 1;
      const totalCls = hd.total > 21 ? "bust" : bj ? "bj21" : "";
      const total = hd.cards.length ? `<div class="bj-total ${totalCls}">${hd.total > 21 ? "BUST" : bj ? "BJ" : hd.soft && hd.total < 21 ? `${hd.total - 10}/${hd.total}` : hd.total}</div>` : "";
      const out = settled && hd.outcome && hd.outcome !== "bust" ? `<div class="bj-out ${hd.outcome}">${OUTCOME_LABEL[hd.outcome]}</div>` : "";
      return `<div class="bj-hand ${turn ? "turn" : ""}">${total}<div class="bj-cards">${cards}</div>${out}</div>`;
    }).join("");
    let stake = s.hands.reduce((a, hd) => a + hd.betCents, 0);
    let pp = s.perfectPairs?.betCents ?? 0;
    let p3 = s.plus3?.betCents ?? 0;
    if (me && !s.playing) {
      stake = this.bet.main;
      pp = this.bet.pp;
      p3 = this.bet.p3;
    }
    const chip = stake > 0 ? `<div class="bj-chip ${chipClass(stake)}"></div><span class="bj-amt">${money(stake)}</span>` : `<div class="bj-ring"></div>`;
    const sides = [pp ? `PP ${money(pp)}` : "", p3 ? `21+3 ${money(p3)}` : ""].filter(Boolean).join(" · ");
    const net = settled && s.playing ? s.returnCents - s.stakeCents : 0;
    const delta = settled && s.playing && net !== 0 ? `<div class="bj-delta ${net > 0 ? "up" : "down"}">${net > 0 ? "+" : "−"}${money(Math.abs(net))}</div>` : "";
    const av = me
      ? `<div class="bj-av">YOU</div>`
      : `<div class="bj-av" style="background:${AVATAR_BG[s.avatar % AVATAR_BG.length]}">${esc(initials(s.name))}</div>`;
    const pending = me && !s.playing && this.mode === "betting" ? this.bet.main + this.bet.pp + this.bet.p3 : 0;
    const cash = me ? money(this.balance - pending) : money(s.balanceCents ?? 0);
    return `<div class="bj-seat ${me ? "me" : ""} ${!s.playing && v.phase !== "betting" && !me ? "out" : ""}" style="left:${pos[0]}%;top:${pos[1]}%">
      <div class="bj-hands ${s.hands.length > (me ? 2 : 1) ? "many" : ""}">${hands}</div>
      <div class="bj-spot">${chip}${sides ? `<span class="bj-side">${sides}</span>` : ""}</div>
      <div class="bj-who">${delta}${av}<div class="bj-id"><div class="bj-name">${esc(me ? "You" : s.name)}</div><div class="bj-cash num">${cash}</div></div></div>
    </div>`;
  }

  /**
   * Draws a table view. New cards fly in from the shoe (dealt in table order
   * on a deal), the hole card flips. Returns how long the animations run.
   */
  private render(v: BjView, frame: BjFrame | null, instant = false): number {
    this.view = v;
    const pos = SEAT_POS[this.landscape() ? "landscape" : "portrait"];
    // Which cards are new since the last frame, and in what order they should arrive.
    const order: string[] = [];
    const keysNow = new Map<string, number | null>();
    v.seats.forEach((s) => s.hands.forEach((hd, hi) => hd.cards.forEach((c, ci) => keysNow.set(`s${s.seat}h${hi}c${ci}`, c))));
    v.dealer.cards.forEach((c, i) => keysNow.set(`d${i}`, c));
    if (frame?.event.type === "deal") {
      for (let ci = 0; ci < 2; ci++) {
        for (const s of v.seats) if (s.playing) order.push(`s${s.seat}h0c${ci}`);
        order.push(`d${ci}`);
      }
    }
    for (const k of keysNow.keys()) if (!order.includes(k)) order.push(k);
    const anim = new Map<string, string>();
    const delays = new Map<string, number>();
    let t = 0;
    let longest = 0;
    const split = frame?.event.type === "action" && frame.event.action === "split" ? frame.event : null;
    for (const k of order) {
      if (instant || !keysNow.has(k)) continue;
      const before = this.shown.get(k);
      const now = keysNow.get(k)!;
      if (!this.shown.has(k)) {
        // The second card of a split hand slides over from the first hand rather than from the shoe.
        const moved = split && k === `s${split.seat}h${split.hand + 1}c0`;
        anim.set(k, moved ? "fade" : "deal");
        delays.set(k, moved ? 0 : t);
        if (!moved) t += frame?.event.type === "deal" ? 170 : k.startsWith("d") ? 480 : 260;
      } else if (before === null && now !== null) {
        anim.set(k, "flip");
        delays.set(k, 0);
        t += 380;
      }
    }
    longest = t + (anim.size ? 380 : 0);
    this.shown = keysNow;

    const dealerCards = v.dealer.cards.map((c, i) => cardHtml(c, anim.get(`d${i}`) ?? "")).join("");
    const dealerTotal = v.dealer.cards.length ? `<div class="bj-total ${(v.dealer.total ?? 0) > 21 ? "bust" : ""}">${v.dealer.total ?? ""}</div>` : "";
    this.dealerEl.innerHTML = `<div class="bj-cards">${dealerCards}</div>${dealerTotal}`;
    this.seatsEl.innerHTML = v.seats.map((s) => this.seatHtml(s, v, pos[s.seat], anim)).join("");
    this.shoeEl.textContent = String(v.shoeLeft);
    const rules = $(this.el, ".bj-rules");
    const [n, d] = v.blackjackPays;
    rules.innerHTML = `<b>BLACKJACK PAYS ${n} TO ${d}</b><span>INSURANCE PAYS 2 TO 1</span><i>${v.dealerHitsSoft17 ? "Dealer must hit soft 17" : "Dealer stands on all 17s"}</i>`;

    // Point each flying card at the shoe and give it its turn in the order.
    if (anim.size) {
      const scale = this.el.getBoundingClientRect().width / this.el.offsetWidth || 1;
      const shoe = $(this.el, ".bj-shoebox").getBoundingClientRect();
      const cards = [...this.felt.querySelectorAll<HTMLElement>(".bj-card.deal, .bj-card.flip, .bj-card.fade")];
      // Match DOM cards to keys: dealer cards first in the DOM, then seats in order, hands in order.
      const domKeys: string[] = [];
      v.dealer.cards.forEach((_, i) => anim.has(`d${i}`) && domKeys.push(`d${i}`));
      v.seats.forEach((s) => s.hands.forEach((hd, hi) => hd.cards.forEach((_, ci) => anim.has(`s${s.seat}h${hi}c${ci}`) && domKeys.push(`s${s.seat}h${hi}c${ci}`))));
      cards.forEach((el, i) => {
        const k = domKeys[i];
        el.style.animationDelay = `${delays.get(k) ?? 0}ms`;
        if (anim.get(k) === "deal") {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--dx", `${(shoe.left - r.left) / scale}px`);
          el.style.setProperty("--dy", `${(shoe.top - r.top) / scale}px`);
          setTimeout(() => !this.closed && sfx.tick(), delays.get(k) ?? 0);
        }
      });
    }
    return longest;
  }

  // ---------------------------------------------------------------- modes and controls

  private enterMode(v: BjView): void {
    clearInterval(this.timer);
    this.clockEl.textContent = "";
    if (v.phase === "insurance" && v.insuranceOffered) this.setMode("insurance");
    else if (v.phase === "players" && v.turn?.seat === ME) this.setMode("play");
    else if (v.phase === "betting" || v.phase === "settled") this.setMode("betting");
    else this.setMode("wait");
  }

  private setMode(m: Mode): void {
    this.mode = m;
    const v = this.view!;
    if (m === "betting") {
      this.bar.innerHTML = `<div class="bj-row">
          ${CHIPS.map((c) => `<button class="bj-chipbtn press ${chipClass(c)}" data-chip="${c}">${c / 100}</button>`).join("")}
          <button class="bj-sidebtn press" data-side="pp">PAIRS<b>0</b></button>
          <button class="bj-sidebtn press" data-side="p3">21+3<b>0</b></button>
        </div>
        <div class="bj-row">
          <button class="bj-btn dim press" data-b="clear">CLEAR</button>
          <button class="bj-btn green press" data-b="rebet">REBET</button>
          <button class="bj-btn blue press" data-b="deal">BET</button>
        </div>`;
      this.bar.querySelectorAll<HTMLElement>("[data-chip]").forEach((b) => b.addEventListener("click", () => this.addChip(Number(b.dataset.chip))));
      this.bar.querySelectorAll<HTMLElement>("[data-side]").forEach((b) => b.addEventListener("click", () => this.cycleSide(b.dataset.side as "pp" | "p3")));
      $(this.bar, '[data-b="clear"]').addEventListener("click", () => this.setBet({ main: 0, pp: 0, p3: 0 }));
      $(this.bar, '[data-b="rebet"]').addEventListener("click", () => {
        const l = this.view?.lastBet;
        if (l) this.setBet({ main: l.betCents, pp: l.perfectPairsCents ?? 0, p3: l.plus3Cents ?? 0 });
      });
      $(this.bar, '[data-b="deal"]').addEventListener("click", () => void this.deal());
      this.setBet(this.bet);
      if (v.phase === "betting" || !this.msgEl.textContent) this.message("PLEASE BET NOW");
      this.startClock(BET_SECONDS, () => {
        if (this.bet.main >= v.minBetCents && this.bet.main + this.bet.pp + this.bet.p3 <= this.balance) void this.deal();
        else {
          this.message("PLEASE BET NOW");
          this.setMode("betting");
        }
      });
    } else if (m === "insurance") {
      this.message(`INSURANCE? <span class="num" style="font-size:14px">${money(v.insuranceCostCents)}</span>`);
      this.bar.innerHTML = `<div class="bj-row">
          <button class="bj-btn dim press" data-b="no">NO THANKS</button>
          <button class="bj-btn gold press" data-b="yes">INSURE</button>
        </div>`;
      $(this.bar, '[data-b="no"]').addEventListener("click", () => void this.send((id) => this.api.bjInsurance(id, false)));
      $(this.bar, '[data-b="yes"]').addEventListener("click", () => void this.send((id) => this.api.bjInsurance(id, true)));
      this.startClock(INSURANCE_SECONDS, () => void this.send((id) => this.api.bjInsurance(id, false)));
    } else if (m === "play") {
      this.message("");
      const can = (a: BjAction) => v.legal.includes(a);
      this.bar.innerHTML = `<div class="bj-row">
          <button class="bj-btn green press" data-a="double" ${can("double") ? "" : "disabled"}>DOUBLE</button>
          <button class="bj-btn teal press" data-a="split" ${can("split") ? "" : "disabled"}>SPLIT</button>
          <button class="bj-btn gold press" data-a="stand">STAND</button>
          <button class="bj-btn gold press" data-a="hit" ${can("hit") ? "" : "disabled"}>HIT</button>
        </div>`;
      this.bar.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.a as BjAction;
        void this.send((id) => this.api.bjAction(id, a));
      }));
      this.startClock(DECIDE_SECONDS, () => void this.send((id) => this.api.bjAction(id, "stand")));
    } else {
      this.bar.innerHTML = `<div class="bj-row"><span class="bj-wait">…</span></div>`;
    }
  }

  private startClock(seconds: number, onEnd: () => void): void {
    clearInterval(this.timer);
    this.deadline = Date.now() + seconds * 1000;
    const tick = () => {
      if (this.closed) return clearInterval(this.timer);
      const left = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
      this.clockEl.innerHTML = `<span class="num" style="color:${left <= 3 ? "#FF9C9C" : "#FFE27A"}">${left}</span>`;
      if (left === 0) {
        clearInterval(this.timer);
        this.clockEl.textContent = "";
        onEnd();
      }
    };
    tick();
    this.timer = window.setInterval(tick, 250);
  }

  private setBet(b: { main: number; pp: number; p3: number }): void {
    const v = this.view!;
    const main = Math.min(b.main, v.maxBetCents);
    this.bet = { main, pp: Math.min(b.pp, v.maxSideBetCents), p3: Math.min(b.p3, v.maxSideBetCents) };
    const total = this.bet.main + this.bet.pp + this.bet.p3;
    this.showBalance(total);
    this.bar.querySelectorAll<HTMLElement>("[data-side]").forEach((e) => {
      const val = this.bet[e.dataset.side as "pp" | "p3"];
      e.classList.toggle("on", val > 0);
      e.querySelector("b")!.textContent = val ? money(val) : "0";
    });
    const deal = this.bar.querySelector<HTMLButtonElement>('[data-b="deal"]');
    if (deal) deal.disabled = main < v.minBetCents || total > this.balance;
    // Show the pending bet on the player's spot.
    const me = { ...v.seats[ME], playing: false, hands: [] };
    const seatEl = this.seatsEl.querySelectorAll(".bj-seat")[ME];
    if (seatEl) {
      const fresh = h(this.seatHtml(me, { ...v, phase: "betting" }, SEAT_POS[this.landscape() ? "landscape" : "portrait"][ME], new Map()));
      // Keep last hand's cards on show until the next deal.
      if (v.phase === "settled") fresh.querySelector(".bj-hands")!.replaceWith(seatEl.querySelector(".bj-hands")!.cloneNode(true));
      seatEl.replaceWith(fresh);
    }
  }

  private addChip(c: number): void {
    sfx.coin();
    const v = this.view!;
    if (this.bet.main + c > v.maxBetCents) {
      toast(`Table limit: ${money(v.minBetCents)} to ${money(v.maxBetCents)}`);
      this.setBet({ ...this.bet, main: v.maxBetCents });
      return;
    }
    this.setBet({ ...this.bet, main: this.bet.main + c });
  }

  private cycleSide(k: "pp" | "p3"): void {
    sfx.click();
    const i = SIDE_STEPS.indexOf(this.bet[k]);
    this.setBet({ ...this.bet, [k]: SIDE_STEPS[(i + 1) % SIDE_STEPS.length] });
  }

  private async deal(): Promise<void> {
    const v = this.view!;
    if (this.bet.main < v.minBetCents) return;
    if (this.bet.main + this.bet.pp + this.bet.p3 > this.balance) {
      toast("Not enough coins for this bet.");
      return;
    }
    sfx.click();
    const bet = { betCents: this.bet.main, perfectPairsCents: this.bet.pp, plus3Cents: this.bet.p3 };
    // Chips come off the spot once the hand is dealt; REBET puts the same bet back.
    if (await this.send((id) => this.api.bjBet(id, bet))) this.bet = { main: 0, pp: 0, p3: 0 };
  }

  /** Sends one move (retrying the same requestId after a dropped connection) and plays its frames. */
  private async send(call: (requestId: string) => Promise<BjResponse>): Promise<boolean> {
    if (this.mode === "wait") return false;
    clearInterval(this.timer);
    this.clockEl.textContent = "";
    this.setMode("wait");
    const id = newRequestId();
    let res: BjResponse | null = null;
    for (let attempt = 0; attempt < 4 && !res; attempt++) {
      try {
        res = await call(id);
      } catch (e) {
        if (e instanceof ApiError && e.retryable && attempt < 3) {
          await wait(1500);
          continue;
        }
        toast(e instanceof ApiError ? esc(e.message) : "Something went wrong.");
        await this.load();
        return false;
      }
    }
    if (!res || this.closed) return false;
    await this.play(res);
    return true;
  }

  private async play(res: BjResponse): Promise<void> {
    const settled = res.view.phase === "settled";
    const me = res.view.seats[ME];
    const finalReturn = settled ? me.returnCents : 0;
    // During the animation the balance shows the stake gone; winnings land when the hand is settled.
    this.balance = res.balanceCents - finalReturn;
    this.showBalance();
    for (const f of res.frames) {
      if (this.closed) return;
      const e = f.event;
      if (e.type === "shuffle") {
        this.message("SHUFFLING…");
        this.shown.clear();
        this.render({ ...f.view, seats: f.view.seats.map((s) => ({ ...s, hands: [] })), dealer: { cards: [], total: null } }, null, true);
        await wait(900);
        continue;
      }
      if (e.type === "deal") this.message("");
      if (e.type === "settle") {
        this.balance = res.balanceCents;
      }
      const ms = this.render(f.view, f);
      if (e.type === "deal") {
        await wait(ms + 250);
        const sides = [me.perfectPairs, me.plus3].filter((x) => x && x.returnCents > 0);
        if (sides.length) {
          sfx.win();
          this.message(sides.map((x) => `${SIDE_LABEL[x!.kind!] ?? x!.kind} +${money(x!.returnCents - x!.betCents)}`).join("<br>"), "win");
          await wait(1200);
        }
      } else if (e.type === "action") {
        await wait(ms + (e.seat === ME ? 120 : 520));
      } else if (e.type === "settle") {
        await wait(ms + 150);
        this.showResult(f.view);
      } else {
        await wait(ms + 100);
      }
    }
    if (this.closed) return;
    this.balance = res.balanceCents;
    this.showBalance();
    this.render(res.view, null);
    if (res.view.phase === "settled") await wait(1600);
    if (!this.closed) this.enterMode(res.view);
  }

  private showResult(v: BjView): void {
    const me = v.seats[ME];
    if (!me.playing) return;
    const net = me.returnCents - me.stakeCents;
    const natural = me.hands.length === 1 && me.hands[0].outcome === "blackjack";
    if (natural) {
      sfx.fanfare();
      this.message(`BLACKJACK! +${money(net)}`, "win");
    } else if (net > 0) {
      sfx.win();
      this.message(`YOU WIN +${money(net)}`, "win");
    } else if (net === 0) this.message("PUSH");
    else this.message("DEALER WINS");
  }
}
