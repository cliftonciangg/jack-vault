import type { Jackpots, JackpotTier } from "../api/types";
import { JACKPOT_TIERS } from "../api/types";
import { ease, every, Skippable, tween } from "../anim";
import { JP_STYLE, LINE_COLORS } from "../theme";
import { $, h, ICON, money, settings } from "./dom";
import { sfx } from "./sound";

export type Orientation = "portrait" | "landscape";

const logo = `<div class="logo"><span class="big gold">CROWN</span><span class="small">OF THE</span><span class="big gold">COSMOS</span></div>`;
const jps = () => `<div class="jps">${JACKPOT_TIERS.map((t) => `<div class="jp" data-tier="${t}" style="background:${JP_STYLE[t].bg}"><b>${t}</b><span>0.00</span></div>`).join("")}</div>`;
const markers = (from: number, to: number, side: string) =>
  `<div class="markers ${side}">${Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return `<i data-line="${n}" style="background:${LINE_COLORS[(n - 1) % LINE_COLORS.length]};color:#0B0820">${n}</i>`;
  }).join("")}</div>`;
const frame = `<div class="frame"><i class="fc tl"></i><i class="fc tr"></i><i class="fc bl"></i><i class="fc br"></i>${markers(1, 13, "l")}${markers(14, 25, "r")}<div class="grid" aria-label="Reels, swipe up to spin"></div><div class="wintag"></div></div>`;
const spin = `<div class="spinwrap">
  <button class="spin press" aria-label="Spin, hold for autoplay">${ICON.spin}<span class="sq"></span><span class="auto"></span>
    <span class="fs"><small>AUTO</small><strong>0</strong><em>SPINS LEFT</em></span>
    <svg class="ring" width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="52" fill="none" stroke="#22D3EE" stroke-width="3" stroke-dasharray="327" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 56 56)" opacity=".9"/></svg>
  </button>
  <span class="spincap">HOLD FOR AUTO</span></div>`;
const vbox = (cls: string, label: string, value: string) => `<div class="vbox ${cls}"><label>${label}</label><output>${value}</output></div>`;

function portraitHtml() {
  return `<div class="screen game portrait">
    <div class="hdr">${logo}${jps()}</div>
    <div class="ribbon">${ICON.wheel()}<span>3 BONUS = SUPER WHEEL</span></div>
    ${frame}
    <div class="msg">GOOD LUCK!</div>
    <div class="ctrl">
      <div class="boxes">${vbox("bal", "BALANCE", "0.00")}${vbox("bet", "TOTAL BET", "0.00")}${vbox("lines dim", "LINES", "25")}${vbox("win", "WIN", "0.00")}</div>
      <div class="buttons">
        <div class="col2"><button class="ibtn press menu" aria-label="Menu">${ICON.menu()}</button><button class="ibtn press turbo" aria-label="Turbo" aria-pressed="false">${ICON.turbo()}</button></div>
        <button class="stepper minus press" aria-label="Decrease bet">−</button>
        ${spin}
        <button class="stepper plus press" aria-label="Increase bet">+</button>
        <div class="col2"><button class="ibtn press info" aria-label="Paytable">${ICON.info()}</button><button class="ibtn press autobtn" aria-label="Autoplay" aria-pressed="false">${ICON.auto()}</button></div>
      </div>
    </div>
  </div>`;
}

function landscapeHtml() {
  return `<div class="screen game landscape">
    <div class="side">${logo}${jps()}<div class="ribbon"><span>3 BONUS =</span><span>SUPER WHEEL</span></div></div>
    <div class="center">
      ${frame}
      <div class="msg">GOOD LUCK!</div>
      <div class="ctrl">
        <button class="ibtn press menu" aria-label="Menu">${ICON.menu(20)}</button>
        <button class="ibtn press info" aria-label="Paytable">${ICON.info(20)}</button>
        ${vbox("bal", "BALANCE", "0.00")}
        <button class="stepper minus press" aria-label="Decrease bet">−</button>
        ${vbox("bet", "TOTAL BET", "0.00")}
        <button class="stepper plus press" aria-label="Increase bet">+</button>
        ${vbox("win", "WIN", "0.00")}
        <button class="ibtn press turbo" aria-label="Turbo" aria-pressed="false">${ICON.turbo(20)}</button>
        <button class="ibtn press autobtn" aria-label="Autoplay" aria-pressed="false">${ICON.auto(20)}</button>
      </div>
    </div>
    <div class="right">${spin}</div>
  </div>`;
}

/** The reels screen (design: Reels.dc.html, ReelsL.dc.html). The Pixi reels draw inside .grid. */
export class GameScreen {
  el!: HTMLElement;
  grid!: HTMLElement;
  frame!: HTMLElement;
  spinBtn!: HTMLButtonElement;
  minus!: HTMLButtonElement;
  plus!: HTMLButtonElement;
  menuBtn!: HTMLButtonElement;
  infoBtn!: HTMLButtonElement;
  turboBtn!: HTMLButtonElement;
  autoBtn!: HTMLButtonElement;
  private balOut!: HTMLElement;
  private betBox!: HTMLElement;
  private box3!: HTMLElement | null;
  private winBox!: HTMLElement;
  private msgEl!: HTMLElement;
  private tagEl!: HTMLElement;
  private capEl!: HTMLElement;
  private jpEls = new Map<JackpotTier, HTMLElement>();

  orientation: Orientation = "portrait";
  private v = {
    balance: 0, bet: 0, win: 0, msg: "GOOD LUCK!", msgColor: "#B9B3D9",
    jackpots: { GRAND: 0, MAJOR: 0, MINOR: 0, MINI: 0 } as Jackpots,
    fs: null as null | { left: number; total: number; played: number; win: number; mult: number },
    spinState: "spin" as "spin" | "stop" | "fs", autoLeft: 0, turbo: false, auto: false, demo: false,
  };
  private jpShown: Jackpots = { GRAND: 0, MAJOR: 0, MINOR: 0, MINI: 0 };
  private jpAnim: (() => void) | null = null;
  private winSkip: Skippable | null = null;
  private idleTimer = 0;
  private idleOff: () => void;

  constructor(private readonly host: HTMLElement) {
    this.idleOff = every((dt) => {
      if (this.v.spinState === "spin" && !this.v.fs) {
        this.idleTimer += dt;
        this.spinBtn?.classList.toggle("idle-pulse", this.idleTimer > 3000);
      }
      return false;
    });
    void this.idleOff;
  }

  build(o: Orientation) {
    this.orientation = o;
    this.el?.remove();
    this.el = h(o === "portrait" ? portraitHtml() : landscapeHtml());
    this.el.classList.toggle("lefty", settings.lefty);
    this.host.prepend(this.el);
    const q = (s: string) => $(this.el, s);
    this.grid = q(".grid");
    this.frame = q(".frame");
    this.spinBtn = q(".spin") as HTMLButtonElement;
    this.minus = q(".minus") as HTMLButtonElement;
    this.plus = q(".plus") as HTMLButtonElement;
    this.menuBtn = q(".menu") as HTMLButtonElement;
    this.infoBtn = q(".info") as HTMLButtonElement;
    this.turboBtn = q(".turbo") as HTMLButtonElement;
    this.autoBtn = q(".autobtn") as HTMLButtonElement;
    this.balOut = q(".vbox.bal output");
    this.betBox = q(".vbox.bet");
    this.box3 = this.el.querySelector(".vbox.lines");
    this.winBox = q(".vbox.win");
    this.msgEl = q(".msg");
    this.tagEl = q(".wintag");
    this.capEl = q(".spincap");
    this.jpEls.clear();
    this.el.querySelectorAll<HTMLElement>(".jp").forEach((e) => this.jpEls.set(e.dataset.tier as JackpotTier, e.querySelector("span")!));
    this.render();
  }

  private render() {
    this.balOut.textContent = money(this.v.balance);
    this.renderJackpots();
    this.msgEl.textContent = this.v.msg;
    this.msgEl.style.color = this.v.msgColor;
    this.winBox.querySelector("output")!.textContent = money(this.v.win);
    this.renderMode();
    this.renderSpin();
    this.turboBtn.classList.toggle("on-burn", this.v.turbo);
    this.turboBtn.setAttribute("aria-pressed", String(this.v.turbo));
    this.autoBtn.classList.toggle("on-cyan", this.v.auto);
    this.autoBtn.setAttribute("aria-pressed", String(this.v.auto));
  }

  private renderJackpots() {
    for (const t of JACKPOT_TIERS) {
      const e = this.jpEls.get(t);
      if (e) e.textContent = money(this.jpShown[t]);
    }
  }

  private renderMode() {
    const fs = this.v.fs;
    const lbl = this.betBox.querySelector("label")!;
    const out = this.betBox.querySelector("output")!;
    if (fs) {
      lbl.textContent = "FREE SPINS";
      out.textContent = `${fs.played} / ${fs.total}`;
      out.style.color = "#A5F3FC";
      this.betBox.style.borderColor = "#22D3EE";
    } else {
      lbl.textContent = "TOTAL BET";
      out.textContent = money(this.v.bet);
      out.style.color = "";
      this.betBox.style.borderColor = "";
    }
    if (this.box3) {
      this.box3.querySelector("label")!.textContent = fs ? "TOTAL WIN" : "LINES";
      const o = this.box3.querySelector("output")!;
      o.textContent = fs ? money(fs.win) : "25";
      o.style.color = fs ? "#F5B301" : "#B9B3D9";
      this.box3.style.borderColor = fs ? "#F5B301" : "";
    } else if (fs) {
      this.winBox.querySelector("label")!.textContent = "TOTAL WIN";
    } else {
      this.winBox.querySelector("label")!.textContent = "WIN";
    }
    this.minus.disabled = !!fs;
    this.plus.disabled = !!fs;
  }

  private renderSpin() {
    const b = this.spinBtn;
    const s = this.v.spinState;
    b.classList.toggle("stop", s === "stop");
    b.classList.toggle("fsring", s === "fs");
    b.classList.toggle("autoing", this.v.autoLeft > 0);
    b.classList.remove("idle-pulse");
    (b.querySelector(".auto") as HTMLElement).textContent = this.v.autoLeft > 0 ? `AUTO ${this.v.autoLeft}` : "";
    const fs = this.v.fs;
    if (fs) {
      (b.querySelector(".fs strong") as HTMLElement).textContent = String(fs.left);
      const ring = b.querySelector(".ring circle") as SVGCircleElement;
      ring.setAttribute("stroke-dashoffset", String(Math.round(327 * (1 - fs.left / Math.max(1, fs.total)))));
    }
    b.setAttribute("aria-label", s === "stop" ? "Stop" : s === "fs" ? "Free spins playing" : "Spin, hold for autoplay");
    const cap = s === "fs" ? `ALL WINS ×${fs?.mult ?? 2}` : s === "stop" ? (this.v.autoLeft > 0 ? "TAP TO STOP AUTO" : "TAP TO STOP") : "HOLD FOR AUTO";
    this.capEl.textContent = cap;
    this.capEl.style.color = s === "fs" ? "#A5F3FC" : s === "stop" ? "#F87171" : "#FFB066";
  }

  // ------------------------------------------------------------ setters

  setDemo(on: boolean) {
    this.v.demo = on;
  }
  setBalance(c: number) {
    this.v.balance = c;
    this.balOut.textContent = money(c);
  }
  setBet(c: number) {
    this.v.bet = c;
    this.renderMode();
  }
  setFreeSpins(fs: GameScreen["v"]["fs"]) {
    this.v.fs = fs;
    document.body.classList.toggle("fs", !!fs);
    this.renderMode();
    this.renderSpin();
  }
  setSpinState(s: "spin" | "stop" | "fs", autoLeft = 0) {
    this.v.spinState = s;
    this.v.autoLeft = autoLeft;
    this.idleTimer = 0;
    this.renderSpin();
  }
  setTurbo(on: boolean) {
    this.v.turbo = on;
    this.render();
  }
  setAuto(on: boolean) {
    this.v.auto = on;
    this.autoBtn.classList.toggle("on-cyan", on);
    this.autoBtn.setAttribute("aria-pressed", String(on));
  }
  touch() {
    this.idleTimer = 0;
    this.spinBtn.classList.remove("idle-pulse");
  }
  setMessage(text: string, color = "#B9B3D9") {
    this.v.msg = text;
    this.v.msgColor = color;
    this.msgEl.textContent = text;
    this.msgEl.style.color = color;
  }
  /** Types the message in, for scatter/feature lines (WinTiming: 400-1200 ms). */
  async typeMessage(text: string, color: string, ms = 800) {
    this.setMessage("", color);
    await tween(ms, (_, k) => (this.msgEl.textContent = text.slice(0, Math.round(text.length * k))), ease.linear);
    this.v.msg = text;
  }

  /** WIN box: ease-out cubic count-up (600 ms under 5x bet, longer for bigger wins). Tap skips. */
  async countWin(from: number, to: number, ms: number, skip?: Skippable) {
    this.winSkip = skip ?? new Skippable();
    this.winBox.classList.toggle("lit", to > 0);
    const out = this.winBox.querySelector("output")!;
    let lastTick = 0;
    await tween(ms, (v, k) => {
      const val = Math.round(from + (to - from) * v);
      out.textContent = money(val);
      if (k - lastTick > 0.06 && k < 1) {
        lastTick = k;
        sfx.tick();
      }
    }, ease.outCubic, this.winSkip);
    this.v.win = to;
  }
  setWin(c: number) {
    this.v.win = c;
    this.winBox.querySelector("output")!.textContent = money(c);
    this.winBox.classList.toggle("lit", c > 0);
  }
  get win() {
    return this.v.win;
  }

  setJackpots(j: Jackpots, animate = true) {
    const from = { ...this.jpShown };
    this.v.jackpots = j;
    this.jpAnim?.();
    if (!animate) {
      this.jpShown = { ...j };
      this.renderJackpots();
      return;
    }
    let t = 0;
    this.jpAnim = every((dt) => {
      t += dt;
      const k = Math.min(1, t / 900);
      const e = 1 - Math.pow(1 - k, 3);
      for (const tier of JACKPOT_TIERS) this.jpShown[tier] = Math.round(from[tier] + (j[tier] - from[tier]) * e);
      this.renderJackpots();
      return k >= 1;
    });
  }
  flashJackpot(t: JackpotTier) {
    const e = this.jpEls.get(t)?.parentElement;
    if (!e) return;
    e.classList.remove("flash");
    void e.offsetWidth;
    e.classList.add("flash");
  }

  showWinTag(text: string, cyan = false) {
    this.tagEl.textContent = text;
    this.tagEl.classList.toggle("cyan-tag", cyan);
    this.tagEl.classList.add("show");
  }
  hideWinTag() {
    this.tagEl.classList.remove("show");
  }
  lightMarkers(lines: number[]) {
    this.el.querySelectorAll<HTMLElement>(".markers i").forEach((m) => m.classList.toggle("on", lines.includes(Number(m.dataset.line))));
  }
  retrigger(text: string) {
    const b = h(`<div class="banner-retrigger">${text}</div>`);
    this.frame.appendChild(b);
    setTimeout(() => b.remove(), 1900);
  }
  shake() {
    this.el.classList.remove("shake");
    void this.el.offsetWidth;
    this.el.classList.add("shake");
  }
}
