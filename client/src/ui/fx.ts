import { every } from "../anim";
import { settings } from "./dom";

interface P {
  x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number;
  life: number; max: number; kind: "coin" | "spark" | "confetti"; color: string;
}

/**
 * Canvas particle layer for overlays: falling coins (gravity + spin), firework
 * sparks and confetti. Battery saver cuts the counts (Motion: 12 coins in saver).
 */
export class Particles {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private ps: P[] = [];
  private off: () => void;
  private rate = 0;
  private acc = 0;
  private w = 390;
  private h = 844;

  constructor(parent: HTMLElement) {
    this.canvas.className = "fx";
    parent.appendChild(this.canvas);
    this.resize();
    this.off = every((dt) => {
      this.step(dt);
      return false;
    });
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const parentW = this.canvas.parentElement!.clientWidth || 390;
    const parentH = this.canvas.parentElement!.clientHeight || 844;
    this.w = parentW;
    this.h = parentH;
    const scale = r.width ? r.width / parentW : 1;
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * scale);
    this.canvas.width = Math.round(parentW * dpr);
    this.canvas.height = Math.round(parentH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Coins per second falling from the top. */
  rain(perSecond: number) {
    this.rate = settings.saver ? Math.min(perSecond, 12) : perSecond;
  }

  burst(x: number, y: number, n: number, kind: P["kind"], colors: string[]) {
    const count = settings.saver ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === "spark" ? 0.25 : 0.4) * (0.4 + Math.random());
      this.ps.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === "coin" ? 0.35 : 0),
        r: kind === "spark" ? 2 + Math.random() * 2 : kind === "coin" ? 7 + Math.random() * 6 : 4 + Math.random() * 3,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.02, life: 0, max: kind === "spark" ? 900 + Math.random() * 500 : 2400,
        kind, color: colors[i % colors.length],
      });
    }
  }

  firework(x: number, y: number, color: string) {
    this.burst(x, y, 46, "spark", [color, "#FFF3E0", color]);
  }

  private spawnCoin() {
    this.ps.push({
      x: Math.random() * this.w, y: -20, vx: (Math.random() - 0.5) * 0.08, vy: 0.15 + Math.random() * 0.2,
      r: 7 + Math.random() * 7, rot: Math.random() * 6, vr: 0.004 + Math.random() * 0.01, life: 0, max: 4000, kind: "coin", color: "",
    });
  }

  private step(dt: number) {
    this.acc += (this.rate * dt) / 1000;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.spawnCoin();
    }
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    const g = 0.0009;
    this.ps = this.ps.filter((p) => {
      p.life += dt;
      p.vy += (p.kind === "spark" ? g * 0.35 : p.kind === "confetti" ? g * 0.4 : g) * dt;
      if (p.kind === "confetti") p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const fade = p.kind === "spark" ? 1 - p.life / p.max : Math.min(1, (p.max - p.life) / 400);
      if (fade <= 0 || p.y > this.h + 30) return false;
      c.globalAlpha = Math.max(0, fade);
      if (p.kind === "coin") {
        const sx = Math.abs(Math.cos(p.rot)) * 0.85 + 0.15;
        c.save();
        c.translate(p.x, p.y);
        c.scale(sx, 1);
        const gr = c.createLinearGradient(0, -p.r, 0, p.r);
        gr.addColorStop(0, "#FFE27A");
        gr.addColorStop(0.55, "#F5B301");
        gr.addColorStop(1, "#B87400");
        c.fillStyle = gr;
        c.beginPath();
        c.arc(0, 0, p.r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#FFF3E0";
        c.globalAlpha *= 0.6;
        c.lineWidth = 1;
        c.stroke();
        c.restore();
      } else if (p.kind === "spark") {
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.r * fade + 0.5, 0, Math.PI * 2);
        c.fill();
      } else {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot * 3);
        c.fillStyle = p.color;
        c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        c.restore();
      }
      return true;
    });
    c.globalAlpha = 1;
  }

  destroy() {
    this.off();
    this.canvas.remove();
  }
}
