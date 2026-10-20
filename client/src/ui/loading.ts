import type { GameState } from "../api/types";
import { $, esc, h, saveSettings, settings } from "./dom";
import { logoSvg } from "./logo";

/** Loading tips; the first is the one in the splash-login design. */
const TIPS = [
  `Four progressive jackpots are shared across every Jack Vault game. <strong>GRAND</strong> keeps growing until someone hits it.`,
  `Land 3 <strong>FREE SPINS</strong> symbols to unlock 12 Free Spins. All Free Spins wins are doubled.`,
  `3 <strong>BONUS</strong> symbols on reels 1, 3 and 5 spin the Super Wheel, which can award the <strong>GRAND</strong>.`,
];

/** Night sky behind the splash (Loading.dc.html): seeded stars, ringed planet, moon and comet. */
function sky(): string {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 110 }, () => {
    const x = (rnd() * 1100).toFixed(1), y = (rnd() * 1000).toFixed(1);
    const r = (rnd() < 0.12 ? 1.6 : rnd() * 0.9 + 0.3).toFixed(2), o = (rnd() * 0.6 + 0.3).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" opacity="${o}"/>`;
  }).join("");
  return `<div class="ld-sky" aria-hidden="true">
    <svg class="ld-stars" viewBox="0 0 1100 1000" preserveAspectRatio="xMidYMid slice">${stars}</svg>
    <svg class="ld-planet" viewBox="0 0 200 120"><defs><radialGradient id="jl-far" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#9AF5FF"/><stop offset=".45" stop-color="#1FA6C9"/><stop offset="1" stop-color="#0A2A4A"/></radialGradient></defs>
      <circle cx="100" cy="60" r="52" fill="url(#jl-far)"/><ellipse cx="100" cy="64" rx="88" ry="15" fill="none" stroke="#9AF5FF" stroke-width="3" opacity=".5" transform="rotate(-16 100 64)"/></svg>
    <svg class="ld-moon" viewBox="0 0 124 124"><defs><radialGradient id="jl-moon" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#F9C6FF"/><stop offset=".5" stop-color="#B14DDB"/><stop offset="1" stop-color="#3A0F5E"/></radialGradient></defs><circle cx="62" cy="62" r="62" fill="url(#jl-moon)"/></svg>
    <svg class="ld-comet" viewBox="0 0 130 54"><defs><linearGradient id="jl-comet" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFF3C4" stop-opacity=".9"/></linearGradient></defs>
      <path d="M2 4 L122 46" stroke="url(#jl-comet)" stroke-width="3" stroke-linecap="round"/><circle cx="122" cy="46" r="3.5" fill="#FFF3C4" style="filter:drop-shadow(0 0 6px #FFF3C4)"/></svg>
    <div class="ld-vignette"></div>
  </div>`;
}

const COIN = `<svg class="ld-coin" viewBox="-20 -20 40 40" aria-hidden="true"><defs><radialGradient id="jl-coin" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF7C8"/><stop offset=".45" stop-color="#FFD53D"/><stop offset="1" stop-color="#B86A00"/></radialGradient></defs>
  <circle cx="1.5" cy="2" r="16" fill="#8A4A00"/><circle r="16" fill="url(#jl-coin)" stroke="#9A5200" stroke-width="2"/><circle r="11" fill="none" stroke="#C27800" stroke-width="2"/>
  <path d="M0 -6 L1.6 -2.2 L5.7 -1.9 L2.5 .8 L3.5 4.9 L0 2.7 L-3.5 4.9 L-2.5 .8 L-5.7 -1.9 L-1.6 -2.2 Z" fill="#FFF0A0" stroke="#B86A00" stroke-width="1"/></svg>`;

const WHEEL = `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" class="ld-tip-ico">
  <circle cx="20" cy="20" r="18" fill="#2A1580" stroke="#F5B301" stroke-width="2.5"/>
  <path d="M20 8 L20 32 M8 20 L32 20 M11.5 11.5 L28.5 28.5 M28.5 11.5 L11.5 28.5" stroke="#FFD23A" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="20" cy="20" r="6" fill="#E11D2E" stroke="#F5B301" stroke-width="2"/></svg>`;

const ico = (d: string, extra = "") => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C4B5FD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const EYE = ico(`<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`);
const EYE_OFF = ico(`<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>`);
const SPEAKER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M3 9h4l6-5v16l-6-5H3zM16 8l2 4-2 4"/></svg>`;

/**
 * Splash, loading and player login (splash-login design: Loading, Ready, Login, LoadingL):
 * Jack Vault 777 logo over a night sky, gold progress bar with a riding coin and rotating tips,
 * then the login form or TAP TO PLAY. Landscape puts the logo left and the panel right (CSS).
 */
export class Loading {
  el = h(`<div class="load" data-state="loading">
    ${sky()}
    <div class="ld-body">
      <div class="ld-logo"><div class="ld-halo"></div>${logoSvg("777")}</div>
      <div class="ld-side">
        <div class="ld-main"></div>
        <div class="ld-foot">
          <div class="brand"><b>JACK</b><i>VAULT</i><em>777</em></div>
          <div class="foot"><span>v1.0.0</span><span class="u">Play responsibly</span></div>
        </div>
      </div>
    </div>
  </div>`);
  private main = $(this.el, ".ld-main");
  private tipTimer = 0;
  private pct = 0;

  constructor(host: HTMLElement) {
    host.appendChild(this.el);
    this.showProgress();
  }

  private setState(s: "loading" | "login" | "ready") {
    this.el.dataset.state = s;
  }

  private showProgress() {
    this.setState("loading");
    this.main.innerHTML = `<div class="ld-progress">
      <div class="ld-label"><span>OPENING THE VAULT…</span><span class="pct">${this.pct}%</span></div>
      <div class="ld-track"><div class="ld-fill"><i></i></div>${COIN}</div>
      <div class="ld-tip">${WHEEL}<div><b>TIP</b><span class="tip"></span></div></div>
      <div class="ld-dots">${TIPS.map(() => "<i></i>").join("")}</div>
    </div>`;
    let i = 0;
    const show = () => {
      $(this.main, ".tip").innerHTML = TIPS[i % TIPS.length];
      this.main.querySelectorAll(".ld-dots i").forEach((d, k) => d.classList.toggle("on", k === i % TIPS.length));
    };
    show();
    this.progress(this.pct / 100);
    clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(() => (i++, show()), 3200);
  }

  progress(k: number) {
    this.pct = Math.round(k * 100);
    const fill = this.main.querySelector<HTMLElement>(".ld-fill");
    if (!fill) return;
    fill.style.width = `calc(${this.pct}% - 4px)`;
    $(this.main, ".ld-coin").style.left = `calc(${this.pct}% - 16px)`;
    $(this.main, ".pct").textContent = `${this.pct}%`;
  }

  error(msg: string) {
    const tip = this.main.querySelector(".tip");
    if (tip) tip.innerHTML = `<span class="err">${esc(msg)}</span>`;
  }

  /**
   * Swaps the bar for the player login form and resolves once `submit` accepts
   * the username and password (wrong details show the server's message).
   * `notice` shows on the form first, e.g. why the last session ended.
   */
  login(submit: (username: string, password: string) => Promise<GameState>, notice = ""): Promise<GameState> {
    clearInterval(this.tipTimer);
    this.setState("login");
    this.main.innerHTML = `<form class="login-form" autocomplete="on">
      <div class="lf-title">PLAYER LOGIN</div>
      <label class="lf-field">${ico(`<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"/>`)}
        <input name="username" aria-label="Username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Username" required></label>
      <label class="lf-field">${ico(`<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>`)}
        <input name="password" type="password" aria-label="Password" autocomplete="current-password" placeholder="Password" required>
        <button type="button" class="lf-eye" aria-label="Show password" aria-pressed="false">${EYE}</button></label>
      <button class="ld-btn" type="submit">LOG IN</button>
      <div class="lf-err" role="alert"></div>
      <div class="lf-help">Get your login from your agent.</div>
    </form>`;
    const form = $(this.main, "form") as HTMLFormElement;
    const err = $(form, ".lf-err");
    const btn = $(form, "button[type=submit]") as HTMLButtonElement;
    const pw = $(form, 'input[name="password"]') as HTMLInputElement;
    const eye = $(form, ".lf-eye");
    eye.addEventListener("click", () => {
      const show = pw.type === "password";
      pw.type = show ? "text" : "password";
      eye.innerHTML = show ? EYE_OFF : EYE;
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
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
          this.showProgress(); // back to the progress bar for the rest of loading
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
    this.setState("ready");
    this.main.innerHTML = `<div class="ld-ready">
      <div class="ld-play"><span class="ring"></span><button class="ld-btn play">TAP TO PLAY</button></div>
      <div class="ld-sound"><span>Sound</span>
        <div class="seg"><button data-s="on" aria-pressed="${settings.sound}">${SPEAKER}ON</button><button data-s="off" aria-pressed="${!settings.sound}">OFF</button></div></div>
    </div>`;
    this.main.querySelectorAll<HTMLElement>("[data-s]").forEach((b) => b.addEventListener("click", () => {
      settings.sound = b.dataset.s === "on";
      saveSettings();
      this.main.querySelectorAll("[data-s]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    return new Promise((res) => $(this.main, ".play").addEventListener("click", () => res(), { once: true }));
  }

  async close() {
    clearInterval(this.tipTimer);
    this.el.style.opacity = "0";
    await new Promise((r) => setTimeout(r, 420));
    this.el.remove();
  }
}
