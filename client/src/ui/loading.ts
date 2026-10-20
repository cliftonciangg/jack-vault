import type { GameState } from "../api/types";
import { $, esc, h, ICON, saveSettings, settings } from "./dom";

const TIPS = [
  "Land 3 FREE SPINS symbols to unlock 12 Free Spins",
  "All Free Spins wins are doubled",
  "3 BONUS symbols on reels 1, 3 and 5 spin the Super Wheel",
  "The Super Wheel can award the GRAND jackpot",
  "Hold SPIN to set up autoplay",
  "Swipe up on the reels to spin",
];

/** Loading / splash (Load1, Load2, LoadL): logo shimmer, gold progress bar, tips, then TAP TO PLAY. */
export class Loading {
  el = h(`<div class="load">
    <div></div>
    <div class="lg">${ICON.crown(96, "cgl")}<div class="w shimmer">CROWN</div><div class="o">OF THE</div><div class="w shimmer">COSMOS</div></div>
    <div class="bar">
      <div class="track"><div class="fill"></div></div>
      <div class="num pct" style="font-size:13px;color:#FFE27A">0%</div>
      <div class="tip">${TIPS[0]}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <div class="brand"><b>JACK</b><i>VAULT</i></div>
      <div class="foot"><span>v1.0.0</span><span>Play responsibly</span></div>
    </div>
  </div>`);
  private tipTimer: number;

  constructor(host: HTMLElement) {
    host.appendChild(this.el);
    let i = 0;
    this.tipTimer = window.setInterval(() => ($(this.el, ".tip").textContent = TIPS[++i % TIPS.length]), 2600);
  }

  progress(k: number) {
    $(this.el, ".fill").style.width = `${Math.round(k * 100)}%`;
    $(this.el, ".pct").textContent = `${Math.round(k * 100)}%`;
  }

  error(msg: string) {
    $(this.el, ".tip").innerHTML = `<span style="color:#F87171">${msg}</span>`;
  }

  /**
   * Swaps the bar for the player login form and resolves once `submit` accepts
   * the username and password (wrong details show the server's message).
   */
  /** `notice` shows above the form first, e.g. why the last session ended. */
  login(submit: (username: string, password: string) => Promise<GameState>, notice = ""): Promise<GameState> {
    clearInterval(this.tipTimer);
    const bar = $(this.el, ".bar");
    const progressHtml = bar.innerHTML;
    bar.innerHTML = `<form class="login-form" autocomplete="on" style="animation:popin 300ms both">
      <div class="lf-title">PLAYER LOGIN</div>
      <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Username" required>
      <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
      <button class="btn-gold press" type="submit" style="height:56px;border-radius:28px;font-size:18px;max-width:none">LOG IN</button>
      <div class="lf-err"></div>
      <div class="lf-help">Get your login from your agent</div>
    </form>`;
    const form = $(bar, "form") as HTMLFormElement;
    const err = $(form, ".lf-err");
    const btn = $(form, "button") as HTMLButtonElement;
    err.textContent = notice;
    return new Promise((resolve) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        btn.disabled = true;
        err.textContent = "";
        try {
          const state = await submit(String(fd.get("username") ?? "").trim(), String(fd.get("password") ?? ""));
          (document.activeElement as HTMLElement | null)?.blur();
          bar.innerHTML = progressHtml; // back to the progress bar for the rest of loading
          resolve(state);
        } catch (e) {
          err.innerHTML = esc(e instanceof Error ? e.message : "Login failed");
          btn.disabled = false;
        }
      });
      setTimeout(() => ($(form, "input") as HTMLInputElement).focus(), 350);
    });
  }

  /** Swaps the bar for TAP TO PLAY and the sound choice. Resolves on tap (a user gesture, so audio can start). */
  ready(): Promise<void> {
    clearInterval(this.tipTimer);
    const bar = $(this.el, ".bar");
    bar.innerHTML = `<button class="btn-gold press play" style="height:60px;border-radius:30px;font-size:20px;animation:popin 300ms both">TAP TO PLAY</button>
      <div style="display:flex;gap:10px;align-items:center"><span style="font-size:15px;font-weight:700;color:#B9B3D9">Sound</span>
      <div class="seg"><button data-s="on" aria-pressed="${settings.sound}">${ICON.soundOn(18)} ON</button><button data-s="off" aria-pressed="${!settings.sound}">OFF</button></div></div>`;
    bar.querySelectorAll<HTMLElement>("[data-s]").forEach((b) => b.addEventListener("click", () => {
      settings.sound = b.dataset.s === "on";
      saveSettings();
      bar.querySelectorAll("[data-s]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    bar.querySelectorAll<HTMLElement>(".seg button").forEach((b) => (b.style.display = "flex", b.style.alignItems = "center", b.style.gap = "6px"));
    return new Promise((res) => $(bar, ".play").addEventListener("click", () => res(), { once: true }));
  }

  async close() {
    this.el.style.opacity = "0";
    await new Promise((r) => setTimeout(r, 420));
    this.el.remove();
  }
}
