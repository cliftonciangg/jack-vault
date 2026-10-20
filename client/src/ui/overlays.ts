import type { JackpotTier } from "../api/types";
import { ease, Skippable, tween, wait } from "../anim";
import { JP_STYLE, WIN_TIERS } from "../theme";
import { $, h, haptic, ICON, money } from "./dom";
import { Particles } from "./fx";
import { sfx } from "./sound";

let host: HTMLElement;
export function setOverlayHost(el: HTMLElement) {
  host = el;
}

function overlay(inner: string, dim = "rgba(6,4,15,.72)"): HTMLElement {
  const el = h(`<div class="ov"><div class="backdrop" style="background:${dim}"></div>${inner}</div>`);
  host.appendChild(el);
  return el;
}

async function close(el: HTMLElement, ms = 220) {
  el.style.transition = `opacity ${ms}ms`;
  el.style.opacity = "0";
  await wait(ms, undefined, false);
  el.remove();
}

export function winTier(winCents: number, betCents: number) {
  const x = winCents / betCents;
  return WIN_TIERS.find((t) => x >= t.min) ?? null;
}

/** BIG / MEGA / EPIC WIN (WinBig, WinMega, WinEpic, WinTiming): 3.0 / 4.5 / 6.0 s, tap skips to the end frame. */
export async function bigWin(winCents: number, betCents: number): Promise<void> {
  const tier = winTier(winCents, betCents)!;
  const kind = tier.name === "EPIC WIN" ? "epic" : tier.name === "MEGA WIN" ? "mega" : "big";
  const dim = kind === "epic" ? "radial-gradient(circle at 50% 45%, rgba(109,40,217,.55), rgba(6,4,15,.9) 70%)" : kind === "mega" ? "rgba(6,4,15,.8)" : "rgba(6,4,15,.72)";
  const el = overlay(
    `${kind !== "big" ? `<div class="rays" style="${kind === "epic" ? "background: repeating-conic-gradient(from 0deg, rgba(245,179,1,.35) 0deg 8deg, transparent 8deg 22.5deg, rgba(139,92,246,.35) 22.5deg 30.5deg, transparent 30.5deg 45deg)" : ""}"></div>` : ""}
     <div class="content">
       ${kind === "epic" ? ICON.crown(72, "cge") : ""}
       <div class="bigbanner ${kind}"><span class="t gold">${tier.name}</span></div>
       <div class="bigamt gold">0.00</div>
       <div class="bigmult">${Math.floor(winCents / betCents)} × BET</div>
     </div>
     <div class="hint">TAP TO SKIP</div>`,
    dim,
  );
  const fx = new Particles(el);
  el.insertBefore(fx.canvas, el.querySelector(".content"));
  fx.rain(kind === "epic" ? 60 : kind === "mega" ? 40 : 24);
  const skip = new Skippable();
  el.addEventListener("pointerdown", () => skip.skip());
  const amt = $(el, ".bigamt");
  haptic([30, 40, 30]);
  sfx.fanfare();
  let fireworks: Promise<void> = Promise.resolve();
  if (kind === "epic") {
    host.querySelector(".game")?.classList.add("shake");
    setTimeout(() => host.querySelector(".game")?.classList.remove("shake"), 600);
    fireworks = (async () => {
      const colors = ["#22D3EE", "#F0ABFC", "#FFE27A", "#FF7A1A"];
      for (let i = 0; i < 9 && !skip.skipped; i++) {
        fx.firework(60 + Math.random() * 270, 120 + Math.random() * 300, colors[i % 4]);
        sfx.boom();
        await wait(600, skip, false);
      }
    })();
  }
  let last = 0;
  await tween(tier.ms - 640, (v, k) => {
    amt.textContent = money(Math.round(winCents * v));
    if (k - last > 0.05) {
      last = k;
      sfx.coin();
    }
  }, ease.outCubic, skip, false);
  amt.textContent = money(winCents);
  await Promise.race([fireworks, wait(400, undefined, false)]);
  fx.rain(0);
  // End frame: banner shrinks toward the WIN box and fades (400 ms).
  const content = $(el, ".content");
  await tween(400, (v) => {
    content.style.transform = `translateY(${v * 260}px) scale(${1 - v * 0.6})`;
    el.style.opacity = String(1 - v);
  }, ease.inCubic, undefined, false);
  fx.destroy();
  el.remove();
}

/** FREE SPINS intro (FSIntro): START button and a 5 s auto-start countdown. */
export async function freeSpinsIntro(spins: number, mult: number, autoStart = 5): Promise<void> {
  const el = overlay(
    `<svg class="portal" viewBox="-150 -150 300 300" aria-hidden="true">
       <circle r="150" fill="none" stroke="#22D3EE" stroke-width="2" opacity=".25"/>
       <circle r="120" fill="none" stroke="#A5F3FC" stroke-width="3" opacity=".35" stroke-dasharray="20 14"/>
       <circle r="90" fill="none" stroke="#8B5CF6" stroke-width="10" opacity=".35"/>
       <circle r="60" fill="#0E7490" opacity=".45"/>
       <path d="M-140 0a140 140 0 0 1 140-140" fill="none" stroke="#22D3EE" stroke-width="4" opacity=".7" stroke-linecap="round"/>
       <path d="M140 0a140 140 0 0 1-140 140" fill="none" stroke="#22D3EE" stroke-width="4" opacity=".7" stroke-linecap="round"/>
     </svg>
     <div class="content" style="gap:22px;animation:popin 300ms both">
       <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
         <span style="font-family:var(--game);font-weight:700;font-size:16px;letter-spacing:6px;color:#C4B5FD">YOU UNLOCKED</span>
         <span class="cyan" style="font-family:var(--game);font-weight:900;font-size:56px;letter-spacing:2px;line-height:1">FREE</span>
         <span class="cyan" style="font-family:var(--game);font-weight:900;font-size:56px;letter-spacing:2px;line-height:1">SPINS</span>
       </div>
       <div style="display:flex;align-items:baseline;gap:10px"><span class="gold num" style="font-weight:900;font-size:72px;line-height:1">${spins}</span><span class="num" style="font-weight:700;font-size:18px;letter-spacing:2px;color:#FFE27A">FREE SPINS</span></div>
       <div class="pill-badge">${ICON.star()}ALL WINS ×${mult}</div>
       <div style="width:300px;max-width:100%;display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:20px">
         <button class="btn-gold press start">START</button>
         <span style="font-size:14px;color:#8A83AD;font-weight:600">Starts automatically in <strong class="num cd" style="color:#A5F3FC">${autoStart}</strong></span>
       </div>
     </div>`,
    "rgba(6,4,15,.82)",
  );
  sfx.fanfare();
  haptic([20, 30, 20]);
  const skip = new Skippable();
  $(el, ".start").addEventListener("click", () => {
    sfx.click();
    skip.skip();
  });
  const cd = $(el, ".cd");
  for (let s = autoStart; s > 0 && !skip.skipped; s--) {
    cd.textContent = String(s);
    await wait(1000, skip, false);
  }
  await close(el);
}

/** FREE SPINS COMPLETE (FSSummary): total won, spins played, COLLECT. */
export async function freeSpinsSummary(totalCents: number, spins: number, autoCollectMs = 0): Promise<void> {
  const el = overlay(
    `<div class="content" style="gap:16px;animation:popin 300ms both">
       <span style="font-family:var(--game);font-weight:700;font-size:16px;letter-spacing:6px;color:#C4B5FD">FREE SPINS</span>
       <span class="cyan" style="font-family:var(--game);font-weight:900;font-size:44px;letter-spacing:2px;line-height:1">COMPLETE</span>
       <span style="font-size:15px;letter-spacing:1.5px;font-weight:700;color:#B9B3D9;margin-top:10px">TOTAL WIN</span>
       <span class="gold num amt" style="font-weight:900;font-size:52px;line-height:1">0.00</span>
       <span style="font-size:15px;color:#B9B3D9;font-weight:600">${spins} spins played</span>
       <button class="btn-gold press collect" style="margin-top:24px;width:300px">COLLECT</button>
     </div>`,
    "rgba(6,4,15,.82)",
  );
  const fx = new Particles(el);
  el.insertBefore(fx.canvas, el.querySelector(".content"));
  if (totalCents > 0) fx.rain(20);
  const skip = new Skippable();
  const amt = $(el, ".amt");
  const done = new Promise<void>((res) => $(el, ".collect").addEventListener("click", () => {
    sfx.click();
    skip.skip();
    res();
  }));
  await tween(1800, (v) => (amt.textContent = money(Math.round(totalCents * v))), ease.outCubic, skip, false);
  if (autoCollectMs) await Promise.race([done, wait(autoCollectMs, undefined, false)]);
  else await done;
  fx.destroy();
  await close(el);
}

/** Jackpot celebrations (JPMini..JPGrand): drama scales with the tier. */
export async function jackpotWin(tier: JackpotTier, amountCents: number): Promise<void> {
  const cfg = {
    MINI: { w: 240, name: 36, amt: 40, coins: 10, rays: false, fw: 0 },
    MINOR: { w: 290, name: 42, amt: 46, coins: 24, rays: false, fw: 0 },
    MAJOR: { w: 330, name: 50, amt: 50, coins: 34, rays: true, fw: 0 },
    GRAND: { w: 350, name: 58, amt: 44, coins: 48, rays: true, fw: 6 },
  }[tier];
  const st = JP_STYLE[tier];
  const dim = tier === "MAJOR" ? "radial-gradient(circle at 50% 45%, rgba(109,40,217,.5), rgba(6,4,15,.9) 70%)"
    : tier === "GRAND" ? "radial-gradient(circle at 50% 45%, rgba(225,29,46,.45), rgba(6,4,15,.92) 70%)" : "rgba(6,4,15,.75)";
  const el = overlay(
    `${cfg.rays ? `<div class="rays" style="background: repeating-conic-gradient(from 0deg, ${st.accent}66 0deg 8deg, transparent 8deg 22.5deg)"></div>` : ""}
     ${tier === "GRAND" ? `<div class="grand-frame"></div>` : ""}
     <div class="content" style="gap:16px">
       ${ICON.crown(tier === "GRAND" ? 96 : 64, "cgj")}
       <div class="jpplaque" style="width:${cfg.w}px;background:${st.bg};box-shadow:0 0 50px ${st.accent}cc">
         <span class="s">JACKPOT</span><span class="n" style="font-size:${cfg.name}px">${tier}</span>
       </div>
       ${tier === "GRAND" ? `<span class="gold" style="font-family:var(--display);font-weight:900;font-size:26px;letter-spacing:2px">GRAND JACKPOT!</span>` : ""}
       <div class="gold num amt" style="font-weight:900;font-size:${cfg.amt}px;line-height:1">0.00</div>
       <button class="btn-gold press collect" style="visibility:hidden;margin-top:18px;width:300px">COLLECT</button>
     </div>`,
    dim,
  );
  const fx = new Particles(el);
  el.insertBefore(fx.canvas, el.querySelector(".content"));
  fx.rain(cfg.coins);
  haptic([60, 40, 60, 40, 120]);
  sfx.fanfare();
  const skip = new Skippable();
  el.addEventListener("pointerdown", () => skip.skip());
  const fw = (async () => {
    for (let i = 0; i < cfg.fw; i++) {
      fx.firework([60, 330, 40, 340, 195, 120][i], [160, 140, 700, 720, 120, 400][i], ["#F0ABFC", "#22D3EE", "#FFE27A", "#4ADE80", "#FF7A1A", "#FFF3E0"][i]);
      sfx.boom();
      await wait(500, undefined, false);
    }
  })();
  const amt = $(el, ".amt");
  await tween(tier === "GRAND" ? 5000 : tier === "MAJOR" ? 3500 : 2200, (v) => (amt.textContent = money(Math.round(amountCents * v))), ease.outCubic, skip, false);
  const btn = $(el, ".collect");
  btn.style.visibility = "visible";
  btn.style.animation = "popin 240ms both";
  await new Promise<void>((res) => btn.addEventListener("click", () => {
    sfx.click();
    res();
  }));
  await fw;
  fx.destroy();
  await close(el);
}

export interface DialogButton {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "gold";
}

/** Compact modal (Dialogs.dc.html): icon, title, body, full-width buttons, primary last. */
export function dialog(o: { icon?: string; iconBg?: string; title: string; body: string; buttons: DialogButton[]; spinner?: boolean }): { el: HTMLElement; result: Promise<string> } {
  const el = overlay(
    `<div class="dialog">
      ${o.spinner ? `<div class="spinner"></div>` : o.icon ? `<div class="icon" style="background:${o.iconBg ?? "rgba(139,92,246,.2)"}">${o.icon}</div>` : ""}
      <h2>${o.title}</h2><p>${o.body}</p>
      <div class="actions">${o.buttons.map((b) => `<button class="press ${b.kind === "secondary" ? "btn-outline" : b.kind === "gold" ? "btn-gold" : "btn-violet"}" data-id="${b.id}" style="max-width:none">${b.label}</button>`).join("")}</div>
    </div>`,
    "rgba(6,4,15,.7)",
  );
  const result = new Promise<string>((res) => {
    el.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((b) => b.addEventListener("click", () => {
      sfx.click();
      void close(el, 160);
      res(b.dataset.id!);
    }));
  });
  return { el, result };
}

export function toast(html: string) {
  const t = h(`<div class="toast">${html}</div>`);
  host.appendChild(t);
  setTimeout(() => t.remove(), 4300);
}
