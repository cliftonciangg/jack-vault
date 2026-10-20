import type { Jackpots, PlayResponse, WheelSegment, WheelStep } from "../api/types";
import { every, wait } from "../anim";
import { JP_STYLE } from "../theme";
import { $, h, haptic, money } from "./dom";
import { sfx } from "./sound";

interface Seg {
  label: string;
  fill: string;
  ink: string;
  w: number;
  a0: number;
  a1: number;
}

function segStyle(s: WheelSegment, i: number): Omit<Seg, "a0" | "a1"> {
  if (s.kind === "JACKPOT") return { label: s.tier, fill: JP_STYLE[s.tier].accent, ink: "#FFFFFF", w: s.tier === "GRAND" ? 0.5 : 1 };
  if (s.kind === "FREE_SPINS") return { label: "FREE SPINS", fill: "#0E7490", ink: "#FFFFFF", w: 1 };
  if (s.multiplier >= 50) return { label: `${s.multiplier}×`, fill: "#FF7A1A", ink: "#0B0820", w: 1 };
  return i % 2 ? { label: `${s.multiplier}×`, fill: "#5B21B6", ink: "#FFFFFF", w: 1 } : { label: `${s.multiplier}×`, fill: "#F5B301", ink: "#0B0820", w: 1 };
}

const R = 156;
const RI = 60;
const xy = (r: number, a: number) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180)];

function wheelSvg(segs: Seg[]) {
  const paths = segs.map((s, i) => {
    const [x0, y0] = xy(R, s.a0), [x1, y1] = xy(R, s.a1), [xi0, yi0] = xy(RI, s.a0), [xi1, yi1] = xy(RI, s.a1);
    const large = s.a1 - s.a0 > 180 ? 1 : 0;
    const mid = (s.a0 + s.a1) / 2;
    const [tx, ty] = xy(112, mid);
    const narrow = s.w < 1;
    const fs = narrow ? 9 : s.label.length > 5 ? 10 : 15;
    const lines = s.label === "FREE SPINS" ? `<tspan x="0" dy="-0.2em">FREE</tspan><tspan x="0" dy="1.1em">SPINS</tspan>` : s.label;
    return `<g class="seg" data-i="${i}">
      <path d="M${xi0} ${yi0} L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${RI} ${RI} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${s.fill}" stroke="#1A1203" stroke-width="2"/>
      <text transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${(narrow ? mid + 180 : mid + 90).toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-family="Orbitron, sans-serif" font-weight="900" font-size="${fs}" fill="${s.ink}">${lines}</text>
    </g>`;
  });
  const bulbs = Array.from({ length: 24 }, (_, i) => {
    const [x, y] = xy(168, i * 15);
    return `<circle class="bulb" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${i % 2 ? "#FFE27A" : "#FF7A1A"}"/>`;
  });
  return `<svg viewBox="-180 -180 360 360" width="100%" height="100%" aria-hidden="true">
    <circle r="178" fill="#1A1203" stroke="#F5B301" stroke-width="4"/>
    <circle r="160" fill="none" stroke="#B87400" stroke-width="3"/>
    ${paths.join("")}
    <circle r="${RI}" fill="#1A1203" stroke="#F5B301" stroke-width="3"/>
    <g class="bulbs">${bulbs.join("")}</g>
  </svg>`;
}

/**
 * SUPER WHEEL (Wheel.dc.html, WheelL.dc.html). The wheel spins the moment the
 * player taps SPIN or swipes it, the server is asked at the same time, and the
 * wheel then brakes on a constant-deceleration curve onto the segment the server
 * picked. Returns the server's response.
 */
export async function runWheel(host: HTMLElement, o: {
  segments: WheelSegment[];
  betCents: number;
  jackpots: Jackpots;
  landscape: boolean;
  autoSpin: boolean;
  spin: () => Promise<PlayResponse>;
}): Promise<{ res: PlayResponse; close: (autoCollect: boolean) => Promise<void> }> {
  const total = o.segments.reduce((a, s, i) => a + segStyle(s, i).w, 0);
  let a = -90;
  const segs: Seg[] = o.segments.map((s, i) => {
    const st = segStyle(s, i);
    const sweep = (360 * st.w) / total;
    const seg = { ...st, a0: a, a1: a + sweep };
    a += sweep;
    return seg;
  });
  const credits = [...new Set(o.segments.filter((s) => s.kind === "CREDIT").map((s) => (s as { multiplier: number }).multiplier))].sort((x, y) => x - y);
  const prizes = [
    ...credits.map((m) => `<div style="background:${m >= 50 ? "#5A2606" : "#3B2A05"}"><b style="color:${m >= 50 ? "#FFB066" : "#FFE27A"}">${m}×</b><span>${money(m * o.betCents)}</span></div>`),
    `<div style="background:#0A2A33"><b style="color:#A5F3FC">FREE</b><span>10 spins</span></div>`,
    ...(["MINI", "MINOR", "MAJOR", "GRAND"] as const).map((t) => `<div style="background:${JP_STYLE[t].bg}"><b>${t}</b><span>${money(o.jackpots[t])}</span></div>`),
  ];
  const el = h(`<div class="ov wheel-ov" style="justify-content:${o.landscape ? "center" : "flex-start"};padding-top:${o.landscape ? 0 : 70}px">
    <div class="backdrop" style="background: radial-gradient(ellipse 120% 60% at 50% 40%, #3B2A05 0%, #1E1450 45%, #06040F 100%)"></div>
    <div style="position:relative;display:flex;flex-direction:${o.landscape ? "row" : "column"};align-items:center;gap:${o.landscape ? 28 : 14}px;width:100%;justify-content:center;padding:0 12px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        ${o.landscape ? "" : `<div class="gold" style="font-family:var(--display);font-weight:900;font-size:30px;letter-spacing:3px">SUPER WHEEL</div>`}
        <div class="wheelwrap" style="${o.landscape ? "width:296px;height:296px;margin-top:22px" : ""}">
          <svg class="pointer" width="40" height="46" viewBox="0 0 40 46"><path d="M20 44L4 8a16 16 0 1 1 32 0z" fill="#F5B301" stroke="#FFF3E0" stroke-width="2"/><circle cx="20" cy="14" r="5" fill="#E11D2E"/></svg>
          <div class="wheel">${wheelSvg(segs)}</div>
          <button class="hub press" aria-label="Spin the wheel">SPIN</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;${o.landscape ? "width:330px" : "width:100%"}">
        ${o.landscape ? `<div class="gold" style="font-family:var(--display);font-weight:900;font-size:26px;letter-spacing:3px">SUPER WHEEL</div>` : ""}
        <div class="hint2" style="font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:2px;color:#B9B3D9;height:20px">TAP SPIN OR SWIPE THE WHEEL</div>
        <div class="prizes">${prizes.join("")}</div>
        <div class="result" style="min-height:64px;display:flex;align-items:center"></div>
        <button class="btn-gold press collect" style="visibility:hidden">COLLECT</button>
      </div>
    </div>
  </div>`);
  host.appendChild(el);
  const wheel = $(el, ".wheel");
  const hub = $(el, ".hub") as HTMLButtonElement;
  const hint = $(el, ".hint2");
  const bulbs = [...el.querySelectorAll<SVGCircleElement>(".bulb")];
  sfx.whoosh();

  let angle = 0;
  let omega = 0;
  let phase: "ready" | "accel" | "spin" | "brake" | "done" = "ready";
  let t = 0;
  let plan = { from: 0, d: 0, T: 1 };
  let lastTickSeg = -1;
  let bulbT = 0;
  const OMEGA = 0.9;

  const segAtPointer = () => {
    // Wheel-local angle under the pointer (screen angle -90), in the segments' range [-90, 270).
    const r = (((-angle % 360) + 360) % 360) - 90;
    return segs.findIndex((s) => r >= s.a0 && r < s.a1);
  };

  const stopLoop = every((dt) => {
    bulbT += dt;
    const chase = phase === "accel" || phase === "spin" || phase === "brake";
    bulbs.forEach((b, i) => b.setAttribute("fill", chase ? ((i + Math.floor(bulbT / 70)) % 3 === 0 ? "#FFF3E0" : "#B87400") : (i + Math.floor(bulbT / 500)) % 2 ? "#FFE27A" : "#FF7A1A"));
    if (phase === "accel") {
      t += dt;
      omega = Math.min(OMEGA, (OMEGA * t) / 350);
      angle += omega * dt;
      if (t >= 350) phase = "spin";
    } else if (phase === "spin") {
      angle += omega * dt;
    } else if (phase === "brake") {
      t += dt;
      const s = Math.min(1, t / plan.T);
      angle = plan.from + plan.d * s * (2 - s);
      if (s >= 1) phase = "done";
    }
    wheel.style.transform = `rotate(${angle}deg)`;
    const si = segAtPointer();
    if (chase && si !== lastTickSeg) {
      lastTickSeg = si;
      sfx.wheelTick();
    }
    return false;
  });

  const go = async (): Promise<PlayResponse> => {
    hub.disabled = true;
    hint.textContent = "SPINNING…";
    hint.style.color = "#FFB066";
    haptic(15);
    phase = "accel";
    t = 0;
    const started = performance.now();
    let res: PlayResponse;
    try {
      res = await o.spin();
    } catch (e) {
      phase = "ready";
      omega = 0;
      hub.disabled = false;
      hint.textContent = "CONNECTION LOST · TAP SPIN TO RETRY";
      hint.style.color = "#F87171";
      throw e;
    }
    await wait(Math.max(0, 900 - (performance.now() - started)), undefined, false);
    while ((phase as string) === "accel") await wait(16, undefined, false);
    const step = res.step as WheelStep;
    const s = segs[step.segmentIndex];
    const width = s.a1 - s.a0;
    const c = (s.a0 + s.a1) / 2 + (Math.random() - 0.5) * width * 0.6;
    const target = -90 - c;
    const cur = angle;
    const d = ((((target - cur) % 360) + 360) % 360) + 360 * 4;
    plan = { from: cur, d, T: (2 * d) / omega };
    t = 0;
    phase = "brake";
    while ((phase as string) !== "done") await wait(16, undefined, false);
    return res;
  };

  // Swipe to spin.
  let swipe: { x: number; y: number; at: number } | null = null;
  wheel.addEventListener("pointerdown", (e) => (swipe = { x: e.clientX, y: e.clientY, at: performance.now() }));
  const ready = new Promise<void>((resolve) => {
    hub.addEventListener("click", () => phase === "ready" && resolve());
    wheel.addEventListener("pointerup", (e) => {
      if (!swipe || phase !== "ready") return;
      const dist = Math.hypot(e.clientX - swipe.x, e.clientY - swipe.y);
      if (dist > 30) resolve();
      swipe = null;
    });
    if (o.autoSpin) setTimeout(resolve, 1200);
  });

  let res: PlayResponse | null = null;
  await ready;
  while (!res) {
    try {
      res = await go();
    } catch {
      await new Promise<void>((r) => hub.addEventListener("click", () => r(), { once: true }));
    }
  }
  const step = res.step as WheelStep;
  el.querySelectorAll<SVGGElement>(".seg").forEach((g) => (g.style.opacity = Number(g.dataset.i) === step.segmentIndex ? "1" : ".45"));
  hint.textContent = "";
  const result = $(el, ".result");
  const seg = step.segment;
  const label = seg.kind === "CREDIT" ? `${seg.multiplier}× BET = ${money(step.winCents)}` : seg.kind === "FREE_SPINS" ? `${seg.spins} FREE SPINS!` : `${seg.tier} JACKPOT!`;
  result.innerHTML = `<div class="wheel-result"><span class="gold">${label}</span></div>`;
  if (seg.kind === "JACKPOT") result.querySelector(".wheel-result")!.setAttribute("style", `background:${JP_STYLE[seg.tier].bg};border-color:#fff`);
  sfx.win(true);
  haptic([30, 30, 30]);
  return {
    res,
    close: async (autoCollect: boolean) => {
      const btn = $(el, ".collect");
      btn.style.visibility = "visible";
      btn.style.animation = "popin 240ms both";
      await Promise.race([
        new Promise<void>((r) => btn.addEventListener("click", () => {
          sfx.click();
          r();
        })),
        autoCollect ? wait(2500, undefined, false) : new Promise<void>(() => {}),
      ]);
      stopLoop();
      el.style.transition = "opacity 260ms";
      el.style.opacity = "0";
      await wait(260, undefined, false);
      el.remove();
    },
  };
}
