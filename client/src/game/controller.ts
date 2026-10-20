import {
  ApiError, GameApi, GameConfig, GameState, JackpotTier, Jackpots, LineWin, newRequestId, PlayResponse, ReelStep, Sym, WheelStep,
} from "../api/types";
import { Skippable, speed, wait } from "../anim";
import type { Stage } from "../pixi/stage";
import { haptic, ICON, money, saveSettings, settings } from "../ui/dom";
import { AutoplayOptions, openMenu, Tab } from "../ui/menu";
import { bigWin, dialog, freeSpinsIntro, freeSpinsSummary, jackpotWin, toast, winTier } from "../ui/overlays";
import type { GameScreen } from "../ui/screen";
import { sfx } from "../ui/sound";
import { runWheel } from "../ui/wheel";

type Phase = "idle" | "spinning" | "presenting" | "feature" | "blocked";

/**
 * Game flow. A plain async state machine over the server's nextAction:
 * spin → (wheel) → (free spins…) → spin. Every money-moving call carries a
 * requestId and is retried with the same id after a connection drop, so a
 * round is never played twice and never lost.
 */
export class Game {
  phase: Phase = "idle";
  balance = 0;
  betIndex = Math.min(settings.betIndex, 7);
  private lastGrid: Sym[][] = [
    ["A", "CROWN", "K", "GEM"], ["PLANET", "Q", "WILD", "TEN"], ["J", "COMET", "A", "BONUS"], ["GEM", "K", "PLANET", "Q"], ["TEN", "SCATTER", "J", "CROWN"],
  ];
  private jackpots: Jackpots = { GRAND: 0, MAJOR: 0, MINOR: 0, MINI: 0 };
  private presentSkip: Skippable | null = null;
  private auto: (AutoplayOptions & { left: number; startBalance: number }) | null = null;
  private ownJackpotAt = 0;
  private menuOpen = false;
  onLobby: () => void = () => {};
  private username: string | null = null;

  constructor(
    private readonly api: GameApi,
    private readonly config: GameConfig,
    private readonly stage: Stage,
    private readonly screen: GameScreen,
    private readonly root: HTMLElement,
    private readonly onSpinningFx: (on: boolean) => void = () => {},
  ) {
    speed.factor = settings.turbo ? 0.5 : 1;
    document.addEventListener("keydown", this.onKey);
    api.onJackpots((j) => this.setJackpots(j));
    // The agent loaded or redeemed coins. Mid-round, the next server response carries the new balance anyway.
    api.onBalance?.((c) => {
      if (this.phase !== "idle" || this.auto || c === this.balance) return;
      const added = c > this.balance;
      this.balance = c;
      this.screen.setBalance(c);
      this.refreshSpinButton();
      toast(`${ICON.coin(22)} ${added ? "Coins added" : "Coins redeemed"}: balance <span class="num" style="color:#FFE27A">${money(c)}</span>`);
    });
    api.onJackpotWon((tier, amount) => {
      if (Date.now() - this.ownJackpotAt < 20000) return;
      toast(`${ICON.crown(22, "ct")} A player just won the <b style="color:#FFE27A">${tier}</b>: <span class="num" style="color:#FFE27A">${money(amount)}</span>`);
    });
  }

  get bet() {
    return this.config.betLevelsCents[this.betIndex];
  }
  private strips(free: boolean) {
    return this.config.reels ? (free ? this.config.reels.free : this.config.reels.base) : null;
  }

  // ------------------------------------------------------------ screen wiring

  /** (Re)attaches handlers after the screen is rebuilt for a new orientation. */
  bindScreen() {
    const s = this.screen;
    s.setDemo(this.api.mode === "demo");
    s.setBalance(this.balance);
    s.setBet(this.bet);
    s.setTurbo(settings.turbo);
    s.setAuto(!!this.auto);
    s.setJackpots(this.jackpots, false);
    this.refreshSpinButton();

    let holdTimer = 0;
    let held = false;
    s.spinBtn.addEventListener("pointerdown", () => {
      held = false;
      if (this.phase !== "idle" || this.auto) return;
      holdTimer = window.setTimeout(() => {
        held = true;
        haptic(20);
        this.openMenu("autoplay");
      }, 600);
    });
    const cancelHold = () => clearTimeout(holdTimer);
    s.spinBtn.addEventListener("pointerup", cancelHold);
    s.spinBtn.addEventListener("pointerleave", cancelHold);
    s.spinBtn.addEventListener("click", () => {
      if (held) return;
      this.onSpinButton();
    });
    s.minus.addEventListener("click", () => this.changeBet(-1));
    s.plus.addEventListener("click", () => this.changeBet(1));
    s.menuBtn.addEventListener("click", () => this.openMenu("menu"));
    s.infoBtn.addEventListener("click", () => this.openMenu("paytable"));
    s.turboBtn.addEventListener("click", () => {
      settings.turbo = !settings.turbo;
      saveSettings();
      this.applySettings();
      sfx.click();
    });
    s.autoBtn.addEventListener("click", () => {
      if (this.auto) this.stopAuto();
      else this.openMenu("autoplay");
    });
    // Swipe up on the reels spins; a tap skips the win count-up.
    let y0: number | null = null;
    s.grid.addEventListener("pointerdown", (e) => (y0 = e.clientY));
    s.grid.addEventListener("pointerup", (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (dy < -40 && this.phase === "idle") this.spin();
      else if (Math.abs(dy) < 10) this.presentSkip?.skip();
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "Space" && !this.menuOpen && !this.root.querySelector(".ov")) {
      e.preventDefault();
      this.onSpinButton();
    }
  };

  applySettings() {
    speed.factor = settings.turbo ? 0.5 : 1;
    this.screen.setTurbo(settings.turbo);
    this.screen.el.classList.toggle("lefty", settings.lefty);
  }

  private refreshSpinButton() {
    const fs = this.phase !== "idle" && document.body.classList.contains("fs");
    if (fs) this.screen.setSpinState("fs");
    else this.screen.setSpinState(this.phase === "spinning" || this.auto ? "stop" : "spin", this.auto?.left ?? 0);
    const lock = this.phase !== "idle" || !!this.auto;
    this.screen.minus.disabled = lock || this.betIndex === 0;
    this.screen.plus.disabled = lock || this.betIndex === this.config.betLevelsCents.length - 1;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.onSpinningFx(p === "spinning");
    this.refreshSpinButton();
  }

  private setJackpots(j: Jackpots) {
    this.jackpots = j;
    this.screen.setJackpots(j);
  }

  private changeBet(d: number) {
    if (this.phase !== "idle" || this.auto) return;
    const n = Math.max(0, Math.min(this.config.betLevelsCents.length - 1, this.betIndex + d));
    if (n === this.betIndex) return;
    this.betIndex = n;
    settings.betIndex = n;
    saveSettings();
    this.screen.setBet(this.bet);
    this.screen.touch();
    this.refreshSpinButton();
    sfx.click();
    haptic(8);
  }

  private onSpinButton() {
    this.screen.touch();
    if (this.auto) {
      this.stopAuto();
      return;
    }
    if (this.phase === "idle") void this.spin();
    else if (this.phase === "spinning") this.stage.reels.slam.skip();
    else if (this.phase === "presenting") this.presentSkip?.skip();
  }

  private openMenu(tab: Tab) {
    if (this.menuOpen) return;
    sfx.click();
    this.menuOpen = true;
    const close = openMenu(this.root, {
      config: this.config,
      betCents: this.bet,
      jackpots: this.jackpots,
      demo: this.api.mode === "demo",
      history: () => this.api.history(30),
      onSettings: () => this.applySettings(),
      onAutoplay: (o) => this.startAuto(o),
      onLobby: () => this.onLobby(),
      onAddCoins: this.api.addCoins ? () => void this.addCoins() : undefined,
      username: this.username,
      onLogout: this.api.logout ? () => void this.logout() : undefined,
    }, tab);
    const obs = new MutationObserver(() => {
      if (!this.root.querySelector(".sheet")) {
        this.menuOpen = false;
        obs.disconnect();
      }
    });
    obs.observe(this.root, { childList: true });
    void close;
  }

  private async logout() {
    // An unfinished feature stays on the server and resumes at the next login.
    if (this.auto) this.stopAuto();
    await this.api.logout?.();
    location.reload();
  }

  private async addCoins() {
    if (!this.api.addCoins) return;
    this.balance = await this.api.addCoins(100_000);
    this.screen.setBalance(this.balance);
    sfx.win();
  }

  // ------------------------------------------------------------ autoplay

  private startAuto(o: AutoplayOptions) {
    if (this.phase !== "idle") return;
    this.auto = { ...o, left: o.spins, startBalance: this.balance };
    this.screen.setAuto(true);
    void this.spin();
  }
  private stopAuto() {
    if (!this.auto) return;
    this.auto = null;
    this.screen.setAuto(false);
    this.refreshSpinButton();
    sfx.click();
  }
  private async continueAuto(roundWin: number, hadFeature: boolean) {
    const a = this.auto;
    if (!a) return;
    a.left--;
    let stop = a.left <= 0;
    if (a.stopOnFeature && hadFeature) stop = true;
    if (a.singleWinOverCents && roundWin >= a.singleWinOverCents) stop = true;
    if (a.lossLimitCents && a.startBalance - this.balance >= a.lossLimitCents) stop = true;
    if (this.balance < this.bet) stop = true;
    if (stop) {
      this.stopAuto();
      return;
    }
    this.refreshSpinButton();
    await wait(roundWin > 0 ? 900 : 350);
    if (this.auto && this.phase === "idle") void this.spin();
  }

  // ------------------------------------------------------------ server calls

  /** Retries a money-moving call with the same requestId until it succeeds or fails for a non-network reason. */
  private async call(fn: () => Promise<PlayResponse>): Promise<PlayResponse> {
    let dlg: ReturnType<typeof dialog> | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fn();
        dlg?.el.remove();
        return r;
      } catch (e) {
        if (!(e instanceof ApiError) || !e.retryable) {
          dlg?.el.remove();
          throw e;
        }
        if (attempt < 4) {
          if (!dlg) dlg = dialog({ spinner: true, title: "Reconnecting…", body: "Your round is safe on the server. We'll pick it up right where it was.", buttons: [] });
          await wait(600 * 2 ** attempt, undefined, false);
          continue;
        }
        dlg?.el.remove();
        dlg = null;
        const d = dialog({ icon: ICON.plug(), iconBg: "rgba(34,211,238,.15)", title: "Connection lost", body: "Check your connection. Your bet and any feature in progress are saved.", buttons: [{ id: "retry", label: "RETRY", kind: "primary" }] });
        await d.result;
        attempt = -1;
      }
    }
  }

  private async showError(e: unknown) {
    const err = e instanceof ApiError ? e : new ApiError("INTERNAL", "Something went wrong");
    const d = dialog({ icon: ICON.alert(26, "#EF4444"), iconBg: "rgba(239,68,68,.15)", title: "Something went wrong", body: `${err.message}<br><span class="num" style="font-size:12px;color:#8A83AD">CODE ${err.code}</span>`, buttons: [{ id: "ok", label: "OK", kind: "primary" }] });
    await d.result;
  }

  // ------------------------------------------------------------ start / resume

  /** Shows the balance, jackpots and last reel window (behind the loading screen). */
  prepare(state: GameState) {
    this.username = state.username ?? null;
    this.balance = state.balanceCents;
    this.setJackpots(state.jackpots);
    this.screen.setJackpots(state.jackpots, false);
    this.screen.setBalance(this.balance);
    const open = state.openRound;
    const lastReel = open ? ([...open.steps].reverse().find((s) => s.type !== "WHEEL") as ReelStep | undefined) : undefined;
    if (lastReel) this.lastGrid = lastReel.grid;
    this.stage.reels.show(this.lastGrid, this.strips(lastReel?.type === "FREE"), lastReel?.stops);
  }

  /** After TAP TO PLAY: resume an unfinished feature, or wait for the first spin. */
  async start(state: GameState) {
    const open = state.openRound;
    if (open && state.nextAction !== "spin") {
      const i = this.config.betLevelsCents.indexOf(open.betCents);
      if (i >= 0) this.betIndex = i;
      this.screen.setBet(this.bet);
      const what = state.nextAction === "wheel" ? "Super Wheel spin" : "Free Spins";
      const d = dialog({ icon: ICON.star(26, "#22D3EE"), iconBg: "rgba(34,211,238,.15)", title: "Welcome back!", body: `We restored your unfinished ${what}.`, buttons: [{ id: "go", label: "CONTINUE", kind: "gold" }] });
      await d.result;
      this.setPhase("feature");
      const fake = { nextAction: state.nextAction, round: open, balanceCents: state.balanceCents, jackpots: state.jackpots } as unknown as PlayResponse;
      await this.playFeatures(fake, open.betCents, true);
      this.setPhase("idle");
      this.screen.setMessage("GOOD LUCK!");
    } else {
      this.screen.setMessage(this.api.mode === "demo" ? "DEMO MODE · GOOD LUCK!" : "GOOD LUCK!");
    }
  }

  // ------------------------------------------------------------ base spin

  async spin() {
    if (this.phase !== "idle") return;
    const bet = this.bet;
    if (this.balance < bet) {
      this.stopAuto();
      await this.insufficient();
      return;
    }
    this.clearPresentation();
    this.setPhase("spinning");
    this.screen.setWin(0);
    this.screen.setMessage("GOOD LUCK!");
    const before = this.balance;
    this.balance -= bet;
    this.screen.setBalance(this.balance);
    sfx.spin();
    haptic(10);
    const requestId = newRequestId();
    void this.stage.reels.start(this.strips(false), settings.turbo);
    const minSpin = wait(settings.turbo ? 260 : 520, this.stage.reels.slam, false);
    let res: PlayResponse;
    try {
      res = await this.call(() => this.api.spin(requestId, bet));
    } catch (e) {
      // No outcome: land back on the previous window and refund the display.
      await this.stage.reels.stop({ grid: this.lastGrid, strip: null, bonusAllowed: false }, true);
      this.balance = before;
      this.screen.setBalance(before);
      this.setPhase("idle");
      this.stopAuto();
      if (e instanceof ApiError && e.code === "INSUFFICIENT_FUNDS") await this.insufficient();
      else await this.showError(e);
      return;
    }
    await minSpin;
    const step = res.step as ReelStep;
    this.setJackpots(res.jackpots);
    await this.landReels(step, true);
    this.setPhase("presenting");
    const hadFeature = res.nextAction !== "spin";
    await this.presentReelStep(step, bet, false, hadFeature);
    let roundWin = step.winCents;
    if (hadFeature) {
      if (this.auto?.stopOnFeature) this.auto.left = 1;
      this.setPhase("feature");
      const end = await this.playFeatures(res, bet, false);
      roundWin = end.round.totalWinCents;
      res = end;
    }
    this.balance = res.balanceCents;
    this.screen.setBalance(this.balance);
    this.setPhase("idle");
    void this.continueAuto(roundWin, hadFeature);
  }

  private async landReels(step: ReelStep, base: boolean) {
    const reels = this.stage.reels;
    reels.onReelLanded = (i) => {
      sfx.reelStop(i);
      haptic(5);
      const col = step.grid[i];
      const sc = step.grid.slice(0, i + 1).flat().filter((s) => s === "SCATTER").length;
      if (col.includes("SCATTER")) {
        sfx.scatter(sc);
        void this.stage.winfx.flash(col.flatMap((s, r) => (s === "SCATTER" ? [[i, r] as [number, number]] : [])), true);
      }
      if (base && col.includes("BONUS")) {
        sfx.bonus();
        void this.stage.winfx.flash(col.flatMap((s, r) => (s === "BONUS" ? [[i, r] as [number, number]] : [])), false);
      }
    };
    reels.onAnticipate = () => {
      sfx.anticipation();
      const sc = this.countSoFar(step, "SCATTER");
      this.screen.setMessage(sc >= 2 ? "ONE MORE SCATTER!" : "ONE MORE BONUS!", "#22D3EE");
    };
    await reels.stop({ grid: step.grid, stops: step.stops, strip: this.strips(!base), bonusAllowed: base }, settings.turbo);
    this.lastGrid = step.grid;
    this.onSpinningFx(false);
  }

  private countSoFar(step: ReelStep, s: Sym) {
    let n = 0;
    for (const reel of this.stage.reels.reels) if (!reel.spinning) n += step.grid[reel.index].filter((x) => x === s).length;
    return n;
  }

  private clearPresentation() {
    this.presentSkip?.skip();
    this.presentSkip = null;
    this.stage.winfx.clear();
    this.screen.hideWinTag();
    this.screen.lightMarkers([]);
  }

  // ------------------------------------------------------------ win presentation

  private lineText(w: LineWin, mult: number) {
    return `LINE ${w.line} · ×${w.count} · ${money(w.winCents)}${mult > 1 ? ` (×${mult})` : ""}`;
  }

  private async presentReelStep(step: ReelStep, bet: number, free: boolean, featureNext: boolean, fsIndex = 0) {
    const skip = new Skippable();
    this.presentSkip = skip;
    const prefix = free ? `FREE SPIN ${fsIndex} · ` : "";
    const scatterPos = step.scatter.count >= 3 ? step.scatter.positions : [];
    const bonusTrig = !free && step.bonus.count >= 3;
    const win = step.winCents;

    if (win > 0 || scatterPos.length) {
      const lines = step.lineWins;
      const msg = lines.length === 0 ? "" : lines.length === 1
        ? `LINE ${lines[0].line} PAYS ${money(lines[0].winCents)}`
        : lines.length <= 4 ? `LINES ${lines.map((l) => l.line).join(", ")} PAY ${money(lines.reduce((a, l) => a + l.winCents, 0))}`
        : `${lines.length} LINES PAY ${money(lines.reduce((a, l) => a + l.winCents, 0))}`;
      if (msg) this.screen.setMessage(prefix + msg, free ? "#A5F3FC" : "#FFE27A");
      this.screen.lightMarkers(lines.map((l) => l.line));
      if (lines.length === 1) this.screen.showWinTag(this.lineText(lines[0], step.multiplier));
      else if (lines.length > 1) this.screen.showWinTag(`${lines.length} LINES · ${money(lines.reduce((a, l) => a + l.winCents, 0))}`);
      void this.stage.winfx.present(lines, scatterPos, this.config.paylines, (w) => {
        if (!w || this.presentSkip !== skip) return;
        this.screen.showWinTag(this.lineText(w, step.multiplier));
        this.screen.lightMarkers([w.line]);
        this.screen.setMessage(`${prefix}LINE ${w.line} PAYS ${money(w.winCents)}`, free ? "#A5F3FC" : "#FFE27A");
      }, skip);
      if (scatterPos.length) {
        this.screen.showWinTag(`${step.scatter.count} SCATTERS!`, true);
        void this.screen.typeMessage(free ? `${prefix}+${step.freeSpinsAwarded} FREE SPINS!` : `${step.scatter.count} SCATTERS! FREE SPINS`, "#22D3EE");
      }
      if (win > 0) {
        haptic(20);
        const tier = winTier(win, bet);
        const from = this.screen.win;
        if (tier) {
          sfx.win(true);
          await wait(400, skip);
          await bigWin(win, bet);
          this.screen.setWin(from + win);
        } else {
          sfx.win(win >= bet * 5);
          await this.screen.countWin(from, from + win, win < bet * 5 ? 600 : 1500, skip);
        }
      }
      if (!free) {
        this.screen.setBalance(this.balance + (featureNext ? 0 : win));
      }
      if (scatterPos.length) await wait(1200, skip);
    }
    if (bonusTrig) {
      void this.stage.winfx.present([], step.bonus.positions, this.config.paylines, () => {}, skip);
      await this.screen.typeMessage("3 BONUS! SUPER WHEEL", "#FFE27A", 700);
      await wait(900);
    }
    if (win === 0 && !scatterPos.length && !bonusTrig && !free) this.screen.setMessage("PLACE YOUR BET");
  }

  // ------------------------------------------------------------ features

  private async playFeatures(res: PlayResponse, bet: number, resumed: boolean): Promise<PlayResponse> {
    let fsActive = false;
    let roundWin = res.round.totalWinCents;
    this.screen.setWin(roundWin);
    while (res.nextAction !== "spin") {
      if (res.nextAction === "wheel") {
        this.clearPresentation();
        const id = newRequestId();
        const { res: wr, close } = await runWheel(this.root, {
          segments: this.config.wheel.segments,
          betCents: bet,
          jackpots: this.jackpots,
          landscape: this.screen.orientation === "landscape",
          autoSpin: !!this.auto,
          spin: () => this.call(() => this.api.wheel(id)),
        });
        res = wr;
        this.setJackpots(res.jackpots);
        const step = res.step as WheelStep;
        if (step.jackpotTier) {
          this.ownJackpotAt = Date.now();
          await wait(900, undefined, false);
          await jackpotWin(step.jackpotTier, step.jackpotWinCents);
          this.screen.flashJackpot(step.jackpotTier as JackpotTier);
        }
        await close(!!this.auto);
        const total = res.round.totalWinCents;
        await this.screen.countWin(roundWin, total, 900);
        roundWin = total;
        this.balance = res.balanceCents;
        this.screen.setBalance(this.balance);
        if (step.freeSpinsAwarded) this.screen.setMessage(`${step.freeSpinsAwarded} FREE SPINS!`, "#22D3EE");
      } else {
        const fs0 = res.round.pending.freeSpins!;
        if (!fsActive) {
          this.clearPresentation();
          if (!resumed || fs0.played === 0) await freeSpinsIntro(fs0.remaining, fs0.multiplier, this.auto ? 3 : 5);
          fsActive = true;
          this.screen.setFreeSpins({ left: fs0.remaining, total: fs0.awarded, played: fs0.played, win: fs0.winCents, mult: fs0.multiplier });
          this.screen.setSpinState("fs");
          await wait(500);
        }
        // One free spin.
        this.clearPresentation();
        const id = newRequestId();
        this.onSpinningFx(true);
        sfx.spin();
        void this.stage.reels.start(this.strips(true), settings.turbo);
        const minSpin = wait(settings.turbo ? 260 : 520, undefined, false);
        res = await this.call(() => this.api.freeSpin(id));
        await minSpin;
        const step = res.step as ReelStep;
        const fs = res.round.pending.freeSpins!;
        this.screen.setFreeSpins({ left: fs.remaining, total: fs.awarded, played: fs.played, win: fs.winCents - step.winCents, mult: fs.multiplier });
        await this.landReels(step, false);
        if (step.freeSpinsAwarded) {
          this.screen.retrigger(`+${step.freeSpinsAwarded} FREE SPINS`);
          sfx.fanfare();
        }
        await this.presentReelStep(step, bet, true, false, fs.played);
        this.screen.setFreeSpins({ left: fs.remaining, total: fs.awarded, played: fs.played, win: fs.winCents, mult: fs.multiplier });
        roundWin = res.round.totalWinCents;
        this.balance = res.balanceCents;
        this.screen.setBalance(this.balance);
        await wait(step.winCents > 0 ? 700 : 350);
        if (res.nextAction !== "freeSpin") {
          await freeSpinsSummary(fs.winCents, fs.played, this.auto ? 3000 : 0);
          this.clearPresentation();
          this.screen.setFreeSpins(null);
          fsActive = false;
          this.screen.setWin(roundWin);
        }
      }
    }
    this.setJackpots(res.jackpots);
    if (roundWin > 0) this.screen.setMessage(`ROUND WIN ${money(roundWin)}`, "#FFE27A");
    return res;
  }

  private async insufficient() {
    const canAdd = !!this.api.addCoins;
    const d = dialog({
      icon: ICON.coin(28),
      iconBg: "rgba(245,179,1,.15)",
      title: "Not enough coins",
      body: `Your balance of ${money(this.balance)} is below this bet of ${money(this.bet)}.${canAdd ? "" : " Ask your agent to load more coins."}`,
      buttons: [{ id: "lower", label: "LOWER BET", kind: "secondary" }, ...(canAdd ? [{ id: "add", label: "GET COINS", kind: "gold" as const }] : [])],
    });
    const r = await d.result;
    if (r === "lower") {
      let i = this.betIndex;
      while (i > 0 && this.config.betLevelsCents[i] > this.balance) i--;
      this.betIndex = i;
      this.screen.setBet(this.bet);
      this.refreshSpinButton();
    } else if (r === "add") await this.addCoins();
  }

  /** Layout changed (rotation/resize): keep the reels showing the same window. */
  relayout() {
    if (this.phase === "idle" || this.phase === "presenting") {
      this.stage.winfx.clear();
      this.screen.hideWinTag();
    }
  }
}
