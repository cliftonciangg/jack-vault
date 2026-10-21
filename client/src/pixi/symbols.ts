import { CanvasSource, Texture } from "pixi.js";
import type { Sym } from "../api/types";
import { SYMBOL_ART, SYMBOL_ORDER } from "../theme";
import { RIBBON, RIBBON_LABEL, SYMBOL_SVG, svgUrl } from "../art/symbols";

export interface SymbolTextures {
  sharp: Record<Sym, Texture>;
  /** Vertical motion-blur version, cross-faded in while the reel moves fast. */
  blur: Record<Sym, Texture>;
  ringGold: Texture;
  ringCyan: Texture;
  /** Extra pixels on each side of a ring texture, in CSS px. */
  ringPad: number;
}

/** Final art dropped into public/art (see client/README.md). Missing entries use the vector placeholders. */
export type ArtImages = Partial<Record<Sym, HTMLImageElement>>;

/**
 * 2D context kept in main memory (willReadFrequently): GPU-backed canvases can lose their pixels on
 * phones when the GPU is reset (going full screen, switching apps), which left the reels blank.
 */
function ctx2d(c: HTMLCanvasElement) {
  return c.getContext("2d", { willReadFrequently: true })!;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Copies the drawn canvas into a canvas Pixi sizes itself. Handing Pixi the drawn canvas directly
 * is unsafe: at some sizes its width / resolution * resolution rounds 1 px off, Pixi then resizes
 * the canvas to match, and resizing a canvas erases it (blank reel symbols after a resize).
 */
function tex(c: HTMLCanvasElement, resolution: number): Texture {
  const source = new CanvasSource({ width: c.width / resolution, height: c.height / resolution, resolution, antialias: true });
  ctx2d(source.resource as HTMLCanvasElement).drawImage(c, 0, 0);
  return new Texture({ source });
}

/** Draws one reel tile exactly like the design's symbol cell: tile gradient, icon, label. */
function drawSymbol(sym: Sym, w: number, h: number, res: number, art?: HTMLImageElement): HTMLCanvasElement {
  const a = SYMBOL_ART[sym];
  const c = canvas(w * res, h * res);
  const ctx = ctx2d(c);
  ctx.scale(res, res);
  const k = h / 62;
  roundRect(ctx, 0, 0, w, h, 7 * k);
  if (typeof a.bg === "string") ctx.fillStyle = a.bg;
  else {
    const g = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, Math.max(w, h) * 0.8);
    g.addColorStop(0, a.bg[0]);
    g.addColorStop(1, a.bg[1]);
    ctx.fillStyle = g;
  }
  ctx.fill();
  if (a.tier === "SPECIAL") {
    ctx.strokeStyle = a.ink + "66";
    ctx.lineWidth = 1.2 * k;
    roundRect(ctx, 0.6 * k, 0.6 * k, w - 1.2 * k, h - 1.2 * k, 6.5 * k);
    ctx.stroke();
  }

  if (art) {
    const s = Math.min(w, h) * 0.96;
    const x = (w - s) / 2, y = (h - s) / 2;
    ctx.drawImage(art, x, y, s, s);
    const word = RIBBON_LABEL[sym];
    if (word && !art.dataset.custom) {
      const k2 = s / 256;
      ctx.font = `900 ${Math.max(6, (word.length > 6 ? 21 : 25) * k2)}px Orbitron, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.7)";
      ctx.shadowOffsetY = 1.5 * k2 * res;
      ctx.shadowBlur = 2 * res;
      ctx.fillStyle = "#fff";
      ctx.fillText(word, w / 2, y + (RIBBON.y - 1) * k2, (RIBBON.w - 34) * k2);
    }
    return c;
  }

  const label = a.label;
  const fontPx = Math.max(7, (label.length > 6 ? 7.5 : 8.5) * k * 1.15);
  const icon = Math.min(w * 0.62, h * 0.52);
  const gap = 2 * k;
  const total = icon + gap + fontPx;
  const top = (h - total) / 2;

  ctx.save();
  ctx.translate((w - icon) / 2, top);
  ctx.scale(icon / 24, icon / 24);
  const p = new Path2D(a.d);
  ctx.shadowColor = a.ink;
  ctx.shadowBlur = (a.tier === "LOW" ? 3 : 6) * res;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  if (a.fill) {
    ctx.fillStyle = a.fill;
    ctx.fill(p);
  }
  ctx.strokeStyle = a.ink;
  ctx.lineWidth = a.tier === "LOW" ? 2.2 : 1.6;
  ctx.stroke(p);
  ctx.restore();

  ctx.fillStyle = a.ink;
  ctx.font = `700 ${fontPx}px Orbitron, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0.5px";
  ctx.fillText(label, w / 2, top + icon + gap, w - 4);
  return c;
}

/** Averages copies of the tile shifted along Y: a cheap, exact vertical motion blur. */
function motionBlur(src: HTMLCanvasElement, spreadPx: number): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const ctx = ctx2d(c);
  const n = 13;
  for (let i = 0; i < n; i++) {
    const off = -spreadPx + (2 * spreadPx * i) / (n - 1);
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(src, 0, off);
  }
  return c;
}

function drawRing(w: number, h: number, res: number, color: string, glow: string, pad: number): HTMLCanvasElement {
  const c = canvas((w + pad * 2) * res, (h + pad * 2) * res);
  const ctx = ctx2d(c);
  ctx.scale(res, res);
  const k = h / 62;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14 * res;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * k;
  for (let i = 0; i < 2; i++) {
    roundRect(ctx, pad, pad, w, h, 7 * k);
    ctx.stroke();
  }
  return c;
}

export function buildSymbolTextures(w: number, h: number, res: number, art: ArtImages = {}): SymbolTextures {
  const sharp = {} as Record<Sym, Texture>;
  const blur = {} as Record<Sym, Texture>;
  for (const s of SYMBOL_ORDER) {
    const c = drawSymbol(s, w, h, res, art[s]);
    sharp[s] = tex(c, res);
    blur[s] = tex(motionBlur(c, h * 0.22 * res), res);
  }
  const ringPad = 12;
  return {
    sharp,
    blur,
    ringGold: tex(drawRing(w, h, res, "#FFE27A", "rgba(245,179,1,.95)", ringPad), res),
    ringCyan: tex(drawRing(w, h, res, "#A5F3FC", "rgba(34,211,238,1)", ringPad), res),
    ringPad,
  };
}

/** False when a symbol texture came out blank (its canvas lost its pixels): build again. */
export function texturesOk(t: SymbolTextures): boolean {
  const c = t.sharp.A.source.resource as HTMLCanvasElement;
  return ctx2d(c).getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0;
}

export function destroyTextures(t: SymbolTextures | null) {
  if (!t) return;
  for (const s of SYMBOL_ORDER) {
    t.sharp[s].destroy(true);
    t.blur[s].destroy(true);
  }
  t.ringGold.destroy(true);
  t.ringCyan.destroy(true);
}

/** Vector icon as an inline SVG string, for DOM screens (paytable, history). */
export function symbolSvg(sym: Sym, size = 30): string {
  if (SYMBOL_SVG[sym]) {
    const img = `<img src="${svgUrl(SYMBOL_SVG[sym])}" width="${size}" height="${size}" alt="" draggable="false" style="display:block">`;
    const word = RIBBON_LABEL[sym];
    if (!word || size < 30) return img;
    const fs = (size * (word.length > 6 ? 21 : 25)) / 256;
    return `<span style="position:relative;display:block;width:${size}px;height:${size}px">${img}<b style="position:absolute;left:0;right:0;top:${(size * (RIBBON.y - 1)) / 256 - fs * 0.6}px;text-align:center;font:900 ${fs}px/1.2 var(--display);color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.7);white-space:nowrap">${word}</b></span>`;
  }
  const a = SYMBOL_ART[sym];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${a.fill ?? "none"}" stroke="${a.ink}" stroke-width="${a.tier === "LOW" ? 2.2 : 1.6}" stroke-linejoin="miter" aria-hidden="true"><path d="${a.d}"/></svg>`;
}

export function symbolTileCss(sym: Sym): string {
  const a = SYMBOL_ART[sym];
  return typeof a.bg === "string" ? a.bg : `radial-gradient(circle at 50% 30%, ${a.bg[0]}, ${a.bg[1]})`;
}
