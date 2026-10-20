import { Container, Graphics, Sprite } from "pixi.js";
import type { Sym } from "../api/types";
import { every, Skippable, speed, wait } from "../anim";
import type { SymbolTextures } from "./symbols";

/**
 * Reels, built for smoothness:
 *
 * - Each reel is a "tape": symbol n sits at y = (n + p) * pitch, and p (in cells)
 *   only ever grows, so motion is continuous. Six recycled cells show whatever tape
 *   slots are in view; nothing is ever moved or swapped while on screen.
 * - When the server result arrives, the result window (and, in demo mode, its real
 *   strip neighbours) is written into tape slots that are still above the window,
 *   and the reel brakes on a curve that ends exactly on that window. No snap.
 * - Start: a small wind-up (nudge up, then accelerate). Stop: Hermite braking that
 *   matches the spin speed, a short overshoot in the spin direction, then a settle.
 * - Speed-linked vertical blur from pre-rendered textures (no filters per frame).
 * - Everything runs on the shared animation clock, including stop scheduling.
 */

const ROWS = 4;
const SLOTS = ROWS + 2; // one partly visible above, one buffer below
const FILLER: Sym[] = ["A", "K", "Q", "J", "TEN", "A", "K", "Q", "J", "TEN", "A", "K", "Q", "J", "TEN", "CROWN", "GEM", "PLANET", "COMET", "WILD", "GEM", "COMET"];

interface Source {
  strip: Sym[] | null;
  anchor: number;
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}
function hash(n: number) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
function sourceAt(src: Source, n: number): Sym {
  return src.strip ? src.strip[mod(src.anchor + n, src.strip.length)] : FILLER[hash(src.anchor + n) % FILLER.length];
}

type Phase = "idle" | "windup" | "accel" | "spin" | "brake" | "overshoot" | "settle";

class Cell extends Container {
  sharp = new Sprite();
  blur = new Sprite();
  sym: Sym | null = null;
  constructor() {
    super();
    this.sharp.anchor.set(0.5);
    this.blur.anchor.set(0.5);
    this.addChild(this.sharp, this.blur);
  }
}

export interface LandOptions {
  quick?: boolean;
}

export class Reel extends Container {
  readonly cells: Cell[] = [];
  private maskG = new Graphics();
  private glow = new Graphics();
  private tex: SymbolTextures | null = null;

  private cellW = 60;
  private cellH = 62;
  private gap = 4;
  private get pitch() {
    return this.cellH + this.gap;
  }

  /** Position in cells. */
  p = 0;
  /** Velocity in cells per ms. */
  private v = 0;
  private v0 = 0.022;
  private targetV = 0.022;
  private phase: Phase = "idle";
  private t = 0;

  private layers: { maxN: number; src: Source }[] = [{ maxN: Infinity, src: { strip: null, anchor: 0 } }];
  private overrides = new Map<number, Sym>();

  private pendingLand: { col: Sym[]; stop?: number; strip: Sym[] | null; quick: boolean; resolve: () => void } | null = null;
  private plan = { p0: 0, pEnd: 0, d: 0, T: 0, m0: 0, m1: 0, vLand: 0, ov: 0.16, a2: 0 };
  private landResolve: (() => void) | null = null;
  blurK = 0;
  anticipating = false;
  private glowT = 0;
  onLanded: (() => void) | null = null;

  constructor(public readonly index: number) {
    super();
    for (let i = 0; i < SLOTS; i++) {
      const c = new Cell();
      this.cells.push(c);
      this.addChild(c);
    }
    this.addChild(this.maskG);
    this.mask = this.maskG;
    every((dt) => {
      this.step(dt);
      return false;
    });
  }

  get spinning() {
    return this.phase !== "idle";
  }

  layout(cellW: number, cellH: number, gap: number, glowLayer: Container) {
    this.cellW = cellW;
    this.cellH = cellH;
    this.gap = gap;
    this.maskG.clear().rect(-3, -3, cellW + 6, ROWS * cellH + (ROWS - 1) * gap + 6).fill(0xffffff);
    if (!this.glow.parent) glowLayer.addChild(this.glow);
    this.glow.position.set(this.x, this.y);
    this.render();
  }

  setTextures(t: SymbolTextures) {
    this.tex = t;
    for (const c of this.cells) c.sym = null;
    this.render();
  }

  private tape(n: number): Sym {
    const o = this.overrides.get(n);
    if (o) return o;
    for (const l of this.layers) if (n <= l.maxN) return sourceAt(l.src, n);
    return "A";
  }

  /** Shows a window without animation (initial state, reconnect). */
  show(col: Sym[], strip: Sym[] | null = null, stop?: number) {
    this.p = 0;
    this.phase = "idle";
    this.layers = [{ maxN: Infinity, src: { strip, anchor: stop ?? hash(this.index * 7919 + Date.now()) } }];
    this.overrides.clear();
    col.forEach((s, r) => this.overrides.set(r, s));
    this.render();
  }

  /** Visible symbol at row r while idle. */
  symbolAt(row: number): Sym {
    return this.tape(row - Math.floor(this.p));
  }

  /** The cell sprite holder currently showing row r (valid when idle). */
  cellAt(row: number): Cell {
    return this.cells[row + 1];
  }

  start(strip: Sym[] | null, turbo: boolean) {
    this.v0 = turbo ? 0.03 : 0.022;
    this.targetV = this.v0;
    // New symbols entering from the top come from this spin's strip (base or free reels).
    this.layers.unshift({ maxN: -2 - Math.floor(this.p), src: { strip, anchor: hash(Date.now() + this.index * 131) % 100000 } });
    if (this.layers.length > 4) this.layers.length = 4;
    this.phase = "windup";
    this.t = 0;
    this.v = 0;
    this.anticipating = false;
  }

  anticipate(on: boolean) {
    this.anticipating = on;
    this.targetV = on ? this.v0 * 0.5 : this.v0;
  }

  /** Brakes onto col (top to bottom). Resolves after the reel has settled. */
  land(col: Sym[], stop: number | undefined, strip: Sym[] | null, opts: LandOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      this.pendingLand = { col, stop, strip, quick: !!opts.quick, resolve };
      if (this.phase === "idle") this.planStop();
    });
  }

  private planStop() {
    const L = this.pendingLand!;
    this.pendingLand = null;
    this.landResolve = L.resolve;
    const base = Math.floor(this.p);
    const pEnd = base + (L.quick ? 5 : 6);
    // Tape slots above the partly visible top cell are free to rewrite.
    const cut = -base - 2;
    const anchor = L.stop !== undefined ? L.stop + pEnd : hash(pEnd + this.index) % 100000;
    this.layers.unshift({ maxN: cut, src: { strip: L.strip, anchor } });
    if (this.layers.length > 4) this.layers.length = 4;
    L.col.forEach((s, r) => this.overrides.set(r - pEnd, s));

    const v = Math.max(this.v, this.v0 * 0.35);
    const vLand = Math.min(v, this.v0 * 0.32);
    const d = pEnd - this.p;
    const T = ((2 * d) / (v + vLand)) * (L.quick ? 0.95 : 1.15);
    const ov = 0.16;
    this.plan = { p0: this.p, pEnd, d, T, m0: (v * T) / d, m1: (vLand * T) / d, vLand, ov, a2: (vLand * vLand) / (2 * ov) };
    this.phase = "brake";
    this.t = 0;
  }

  private finishLanding() {
    const pEnd = this.plan.pEnd;
    // Re-base the tape so the landed window is rows 0..3 at p = 0.
    const keep = new Map<number, Sym>();
    for (let n = -1; n <= ROWS; n++) keep.set(n, this.tape(n - pEnd));
    const newest = this.layers[0].src;
    this.layers = [{ maxN: Infinity, src: { strip: newest.strip, anchor: newest.anchor - pEnd } }];
    this.overrides = keep;
    this.p = 0;
    this.v = 0;
    this.phase = "idle";
    this.anticipating = false;
    this.targetV = this.v0;
    this.render();
    const r = this.landResolve;
    this.landResolve = null;
    this.onLanded?.();
    r?.();
  }

  private step(dtRaw: number) {
    this.glowT += dtRaw;
    this.drawGlow();
    if (this.phase === "idle") return;
    const dt = dtRaw;
    this.t += dt;
    switch (this.phase) {
      case "windup": {
        const W = 0.14;
        const Tw = 110 * Math.max(speed.factor, 0.6);
        const k = Math.min(1, this.t / Tw);
        this.p = -W * Math.sin((k * Math.PI) / 2);
        this.v = 0;
        if (k >= 1) {
          this.phase = "accel";
          this.t = 0;
          this.accelFrom = this.p;
        }
        break;
      }
      case "accel": {
        const Ta = 170 * Math.max(speed.factor, 0.6);
        const a = this.v0 / Ta;
        this.v = Math.min(this.v0, a * this.t);
        this.p = this.accelFrom + 0.5 * a * Math.min(this.t, Ta) ** 2 + (this.t > Ta ? this.v0 * (this.t - Ta) : 0);
        if (this.t >= Ta) this.phase = "spin";
        break;
      }
      case "spin": {
        this.v += (this.targetV - this.v) * Math.min(1, dt / 140);
        this.p += this.v * dt;
        if (this.pendingLand) this.planStop();
        break;
      }
      case "brake": {
        const P = this.plan;
        const s = Math.min(1, this.t / P.T);
        const h10 = s * s * s - 2 * s * s + s;
        const h01 = -2 * s * s * s + 3 * s * s;
        const h11 = s * s * s - s * s;
        this.p = P.p0 + P.d * (P.m0 * h10 + h01 + P.m1 * h11);
        const dds = P.m0 * (3 * s * s - 4 * s + 1) + (6 * s - 6 * s * s) + P.m1 * (3 * s * s - 2 * s);
        this.v = (P.d / P.T) * dds;
        if (s >= 1) {
          this.phase = "overshoot";
          this.t = 0;
          this.p = P.pEnd;
          this.v = P.vLand;
        }
        break;
      }
      case "overshoot": {
        const P = this.plan;
        const tEnd = P.vLand / P.a2;
        const t = Math.min(this.t, tEnd);
        this.p = P.pEnd + P.vLand * t - 0.5 * P.a2 * t * t;
        this.v = P.vLand - P.a2 * t;
        if (this.t >= tEnd) {
          this.phase = "settle";
          this.t = 0;
        }
        break;
      }
      case "settle": {
        const P = this.plan;
        const Ts = 150;
        const k = Math.min(1, this.t / Ts);
        const e = 1 - Math.pow(1 - k, 3);
        this.p = P.pEnd + P.ov * (1 - e);
        this.v = 0;
        if (k >= 1) {
          this.finishLanding();
          return;
        }
        break;
      }
    }
    this.render();
  }

  private accelFrom = 0;

  private render() {
    if (!this.tex) return;
    const base = Math.floor(this.p);
    const frac = this.p - base;
    const pitch = this.pitch;
    const target = Math.min(1, Math.abs(this.v) / (this.v0 * 0.85));
    this.blurK += (target - this.blurK) * 0.35;
    if (this.phase === "idle") this.blurK = 0;
    const b = this.blurK;
    for (let i = 0; i < SLOTS; i++) {
      const j = i - 1;
      const c = this.cells[i];
      const sym = this.tape(j - base);
      if (c.sym !== sym) {
        c.sym = sym;
        c.sharp.texture = this.tex.sharp[sym];
        c.blur.texture = this.tex.blur[sym];
      }
      c.position.set(this.cellW / 2, (j + frac) * pitch + this.cellH / 2);
      c.sharp.alpha = 1 - 0.92 * b;
      c.blur.alpha = b;
      c.blur.visible = b > 0.02;
    }
  }

  private drawGlow() {
    const g = this.glow;
    g.clear();
    if (!this.anticipating) return;
    const h = ROWS * this.cellH + (ROWS - 1) * this.gap;
    const pulse = 0.65 + 0.35 * Math.sin(this.glowT / 140);
    g.roundRect(-4, -4, this.cellW + 8, h + 8, 9).stroke({ width: 2.5, color: 0x22d3ee, alpha: pulse });
    g.roundRect(-8, -8, this.cellW + 16, h + 16, 12).stroke({ width: 6, color: 0x22d3ee, alpha: 0.25 * pulse });
  }
}

export interface ReelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StopPlan {
  grid: Sym[][];
  stops?: number[];
  strip: Sym[][] | null;
  /** Count SCATTERs (and BONUS for the base game) to decide anticipation. */
  bonusAllowed: boolean;
}

/** The 5x4 reel window: background panels, five reels, the anticipation glow. */
export class ReelSet extends Container {
  readonly reels: Reel[] = [];
  private bg = new Graphics();
  private reelLayer = new Container();
  private glowLayer = new Container();
  geom = { x: 0, y: 0, w: 0, h: 0, cellW: 60, cellH: 62, gap: 4, colPad: 2, pad: 4 };
  onReelLanded: ((i: number) => void) | null = null;
  onAnticipate: ((i: number) => void) | null = null;
  slam = new Skippable();

  constructor() {
    super();
    this.addChild(this.bg, this.reelLayer, this.glowLayer);
    for (let i = 0; i < 5; i++) {
      const r = new Reel(i);
      r.onLanded = () => this.onReelLanded?.(i);
      this.reels.push(r);
      this.reelLayer.addChild(r);
    }
  }

  /** rect: the grid area in CSS px (from the DOM layout); k: design px to CSS px; rowGap: 4 portrait, 3 landscape (design px). */
  layout(rect: ReelGeometry, k: number, rowGap: number) {
    const pad = 4 * k;
    const colGap = 4 * k;
    const colPad = 2 * k;
    const gap = rowGap * k;
    const colW = (rect.w - pad * 2 - colGap * 4) / 5;
    const cellW = colW - colPad * 2;
    const cellH = (rect.h - pad * 2 - colPad * 2 - gap * 3) / 4;
    this.geom = { ...rect, cellW, cellH, gap, colPad, pad };
    this.position.set(rect.x, rect.y);
    const g = this.bg.clear();
    g.roundRect(0, 0, rect.w, rect.h, 10 * k).fill(0x0b0820);
    for (let i = 0; i < 5; i++) {
      const cx = pad + i * (colW + colGap);
      g.roundRect(cx, pad, colW, rect.h - pad * 2, 7 * k).fill(0x151030);
      const r = this.reels[i];
      r.position.set(cx + colPad, pad + colPad);
      r.layout(cellW, cellH, gap, this.glowLayer);
    }
  }

  setTextures(t: SymbolTextures) {
    this.reels.forEach((r) => r.setTextures(t));
  }

  show(grid: Sym[][], strips: Sym[][] | null = null, stops?: number[]) {
    this.reels.forEach((r, i) => r.show(grid[i], strips?.[i] ?? null, stops?.[i]));
  }

  get spinning() {
    return this.reels.some((r) => r.spinning);
  }

  /** Centre of cell (reel, row) in this container's coordinates. */
  cellCenter(reel: number, row: number) {
    const r = this.reels[reel];
    const g = this.geom;
    return { x: r.x + g.cellW / 2, y: r.y + row * (g.cellH + g.gap) + g.cellH / 2 };
  }

  async start(strips: Sym[][] | null, turbo: boolean) {
    this.slam = new Skippable();
    for (let i = 0; i < 5; i++) {
      this.reels[i].start(strips?.[i] ?? null, turbo);
      if (i < 4) await wait(turbo ? 12 : 30, undefined, false);
    }
  }

  /** Lands every reel on the result, reel by reel, with anticipation on reels that can still complete a feature. */
  async stop(plan: StopPlan, turbo: boolean) {
    const stagger = turbo ? 90 : 190;
    const landings: Promise<void>[] = [];
    let scatters = 0;
    let bonusOn0and2 = false;
    for (let i = 0; i < 5; i++) {
      const col = plan.grid[i];
      const scatterAnt = scatters >= 2;
      const bonusAnt = plan.bonusAllowed && i === 4 && bonusOn0and2;
      const antic = (scatterAnt || bonusAnt) && !this.slam.skipped;
      if (i > 0) {
        if (antic) {
          // Wait for everything before it to land, then let this reel crawl with a glow.
          await Promise.all(landings);
          if (!this.slam.skipped) {
            this.reels[i].anticipate(true);
            for (let k = i + 1; k < 5; k++) this.reels[k].anticipate(false);
            this.onAnticipate?.(i);
            await wait(turbo ? 650 : 1150, this.slam, false);
          }
        } else {
          await wait(this.slam.skipped ? 40 : stagger, undefined, false);
        }
      }
      landings.push(this.reels[i].land(col, plan.stops?.[i], plan.strip?.[i] ?? null, { quick: this.slam.skipped || turbo }));
      scatters += col.filter((s) => s === "SCATTER").length;
      if (i === 2) bonusOn0and2 = plan.grid[0].includes("BONUS") && plan.grid[2].includes("BONUS");
    }
    await Promise.all(landings);
  }
}
