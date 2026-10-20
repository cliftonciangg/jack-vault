import { Container, Graphics, Sprite } from "pixi.js";
import type { LineWin, Pos } from "../api/types";
import { ease, every, lerp, Skippable, tween, wait } from "../anim";
import { lineColor } from "../theme";
import type { ReelSet } from "./reels";
import type { SymbolTextures } from "./symbols";

function hex(c: string) {
  return parseInt(c.slice(1), 16);
}

/**
 * Win presentation on the reels (design: WinLine, WinMulti, WinScatter, WinTiming):
 * dim the rest to 35%, trace paylines left to right, pop winning symbols to 1.08
 * with a ring, then cycle the lines one by one until the next spin.
 */
export class WinFx extends Container {
  private lines = new Graphics();
  private rings = new Container();
  private tex: SymbolTextures | null = null;
  private token = 0;
  private popped = new Set<string>();
  private pulseOff: (() => void) | null = null;

  constructor(private readonly reels: ReelSet) {
    super();
    this.addChild(this.rings, this.lines);
  }

  setTextures(t: SymbolTextures) {
    this.tex = t;
  }

  private linePoints(rows: number[]) {
    const g = this.reels.geom;
    const pts = rows.map((row, reel) => this.reels.cellCenter(reel, row));
    // Extend slightly past the first and last reel, like a real payline.
    const ext = g.cellW * 0.45;
    return [{ x: pts[0].x - ext, y: pts[0].y }, ...pts, { x: pts[4].x + ext, y: pts[4].y }];
  }

  private drawLine(rows: number[], color: string, k: number) {
    const pts = this.linePoints(rows);
    const seg: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      seg.push(d);
      total += d;
    }
    let left = total * k;
    const path: { x: number; y: number }[] = [pts[0]];
    for (let i = 1; i < pts.length && left > 0; i++) {
      const f = Math.min(1, left / seg[i - 1]);
      path.push({ x: lerp(pts[i - 1].x, pts[i].x, f), y: lerp(pts[i - 1].y, pts[i].y, f) });
      left -= seg[i - 1];
    }
    if (path.length < 2) return;
    const w = Math.max(4, this.reels.geom.cellH * 0.1);
    const g = this.lines;
    const poly = () => {
      g.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    };
    poly();
    g.stroke({ width: w * 2.6, color: hex(color), alpha: 0.22, join: "round", cap: "round" });
    poly();
    g.stroke({ width: w, color: hex(color), alpha: 0.95, join: "round", cap: "round" });
    poly();
    g.stroke({ width: w * 0.3, color: 0xffffff, alpha: 0.7, join: "round", cap: "round" });
  }

  private setDim(win: Set<string>, alpha: number) {
    this.reels.reels.forEach((r, i) => {
      for (let row = 0; row < 4; row++) r.cellAt(row).alpha = win.has(`${i},${row}`) ? 1 : alpha;
    });
  }

  private ring(pos: Pos, cyan: boolean) {
    if (!this.tex) return;
    const s = new Sprite(cyan ? this.tex.ringCyan : this.tex.ringGold);
    s.anchor.set(0.5);
    const c = this.reels.cellCenter(pos[0], pos[1]);
    s.position.set(c.x, c.y);
    s.alpha = 0;
    this.rings.addChild(s);
    return s;
  }

  private pop(positions: Pos[], cyan: boolean, skip?: Skippable) {
    const fresh = positions.filter(([r, row]) => !this.popped.has(`${r},${row}`));
    fresh.forEach(([r, row]) => this.popped.add(`${r},${row}`));
    const rings = fresh.map((p) => this.ring(p, cyan)).filter(Boolean) as Sprite[];
    const cells = fresh.map(([r, row]) => this.reels.reels[r].cellAt(row));
    return tween(250, (v) => {
      cells.forEach((c) => c.scale.set(lerp(1, 1.08, v)));
      rings.forEach((s) => {
        s.alpha = Math.min(1, v * 1.5);
        s.scale.set(lerp(0.9, 1.08, v));
      });
    }, ease.outBack(1.6), skip);
  }

  /** Line wins and the scatter, first all at once, then (cycle) one line at a time until clear(). */
  async present(lineWins: LineWin[], scatter: Pos[], paylines: number[][], onLine: (w: LineWin | null) => void, skip?: Skippable) {
    const my = ++this.token;
    this.clear(false);
    const all = new Set<string>();
    lineWins.forEach((w) => w.positions.forEach(([r, row]) => all.add(`${r},${row}`)));
    scatter.forEach(([r, row]) => all.add(`${r},${row}`));
    if (!all.size) return;

    // 0-200 dim, 0-350 trace, 150-400 pop.
    tween(200, (v) => this.setDim(all, lerp(1, 0.35, v)), ease.outCubic, skip);
    const trace = tween(350, (v) => {
      if (my !== this.token) return;
      this.lines.clear();
      lineWins.forEach((w) => this.drawLine(paylines[w.line - 1], lineColor(w.line), v));
    }, ease.inOutCubic, skip);
    await wait(150, skip);
    this.pop(lineWins.flatMap((w) => w.positions), false, skip);
    if (scatter.length) this.pop(scatter, true, skip);
    await trace;
    this.startPulse();
    await wait(600, skip);
    if (my !== this.token) return;
    if (lineWins.length > 1) this.cycle(my, lineWins, scatter, paylines, onLine);
  }

  private async cycle(my: number, lineWins: LineWin[], scatter: Pos[], paylines: number[][], onLine: (w: LineWin | null) => void) {
    await wait(600);
    for (let i = 0; my === this.token; i = (i + 1) % lineWins.length) {
      const w = lineWins[i];
      const on = new Set(w.positions.map(([r, row]) => `${r},${row}`));
      this.setDim(on, 0.35);
      this.reels.reels.forEach((r, ri) => {
        for (let row = 0; row < 4; row++) r.cellAt(row).scale.set(on.has(`${ri},${row}`) ? 1.08 : 1);
      });
      this.rings.children.forEach((s) => {
        const p = (s as Sprite).position;
        s.visible = w.positions.some(([r, row]) => {
          const c = this.reels.cellCenter(r, row);
          return Math.abs(c.x - p.x) < 1 && Math.abs(c.y - p.y) < 1;
        });
      });
      this.lines.clear();
      this.drawLine(paylines[w.line - 1], lineColor(w.line), 1);
      onLine(w);
      await wait(1200, undefined, false);
    }
  }

  /** Scatter or bonus symbols landing: a quick pulse without dimming. */
  async flash(positions: Pos[], cyan: boolean) {
    const cells = positions.map(([r, row]) => this.reels.reels[r].cellAt(row));
    await tween(380, (v, k) => {
      const s = 1 + 0.15 * Math.sin(k * Math.PI);
      cells.forEach((c) => c.scale.set(s));
    }, ease.linear);
    void cyan;
  }

  private startPulse() {
    this.pulseOff?.();
    let t = 0;
    this.pulseOff = every((dt) => {
      t += dt;
      const a = 0.75 + 0.25 * Math.sin(t / 180);
      this.rings.children.forEach((s) => (s.alpha = a));
      this.lines.alpha = 0.85 + 0.15 * Math.sin(t / 180);
    });
  }

  clear(bumpToken = true) {
    if (bumpToken) this.token++;
    this.pulseOff?.();
    this.pulseOff = null;
    this.lines.clear();
    this.lines.alpha = 1;
    this.rings.removeChildren().forEach((c) => c.destroy());
    this.popped.clear();
    this.reels.reels.forEach((r) => r.cells.forEach((c) => {
      c.alpha = 1;
      c.scale.set(1);
    }));
  }
}
