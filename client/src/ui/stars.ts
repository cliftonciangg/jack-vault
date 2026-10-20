import { every } from "../anim";
import { settings } from "./dom";

/** Parallax starfield behind everything; stars stretch into contrails while reels spin (the jet-age speed feel). */
export class Starfield {
  private ctx: CanvasRenderingContext2D;
  private stars = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), c: Math.random() < 0.15 ? "#A5F3FC" : Math.random() < 0.1 ? "#FFE27A" : "#FFFFFF" }));
  private boost = 0;
  private target = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    every((dt) => {
      this.step(dt);
      return false;
    });
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setSpinning(on: boolean) {
    this.target = on && !settings.saver ? 1 : 0;
  }

  private step(dt: number) {
    this.boost += (this.target - this.boost) * Math.min(1, dt / 250);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    for (const s of this.stars) {
      s.y += ((0.004 + s.z * 0.012 + this.boost * (0.2 + s.z * 0.9)) * dt) / H;
      if (s.y > 1.03) {
        s.y = -0.03;
        s.x = Math.random();
      }
      const r = 0.6 + s.z * 1.4;
      const len = r * (1 + this.boost * (4 + s.z * 14));
      c.globalAlpha = 0.25 + s.z * 0.65;
      c.fillStyle = s.c;
      c.beginPath();
      c.ellipse(s.x * W, s.y * H, r, len, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }
}
