import { Application } from "pixi.js";
import { onFrameEnd } from "../anim";
import { ReelSet } from "./reels";
import { ArtImages, buildSymbolTextures, destroyTextures, SymbolTextures, texturesOk } from "./symbols";
import { WinFx } from "./winfx";

/**
 * The Pixi canvas lives inside the scaled design frame (#root), above the game
 * DOM and below overlays, and draws only the reel window and win lines. It works
 * in design pixels and renders at devicePixelRatio x frame scale, so it is as
 * sharp as the DOM around it.
 */
export class Stage {
  app = new Application();
  reels = new ReelSet();
  winfx = new WinFx(this.reels);
  private tex: SymbolTextures | null = null;
  private texKey = "";
  art: ArtImages = {};
  private size = { w: 390, h: 844, res: 2 };
  private last: Parameters<Stage["layout"]> | null = null;
  private retries = 0;

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      width: this.size.w,
      height: this.size.h,
      resolution: this.size.res,
      autoStart: false,
      sharedTicker: false,
      preference: "webgl",
    });
    this.app.ticker.stop();
    // After the GPU drops and restores the WebGL context, draw the symbols again from scratch.
    canvas.addEventListener("webglcontextrestored", () => this.rebuild());
    this.app.stage.addChild(this.reels);
    this.reels.addChild(this.winfx);
    onFrameEnd(() => this.app.render());
  }

  /** frame: design size and CSS scale of #root; gridEl: the DOM area the reels fill. */
  layout(frame: { w: number; h: number; scale: number }, gridEl: HTMLElement, rowGap: number) {
    this.last = [frame, gridEl, rowGap];
    const res = Math.min(4, (window.devicePixelRatio || 1) * frame.scale);
    if (frame.w !== this.size.w || frame.h !== this.size.h || res !== this.size.res) {
      this.size = { w: frame.w, h: frame.h, res };
      this.app.renderer.resolution = res;
      this.app.renderer.resize(frame.w, frame.h, res);
    }
    // Grid position in design px, relative to the frame.
    const root = this.app.canvas.parentElement!.getBoundingClientRect();
    const r = gridEl.getBoundingClientRect();
    const k = frame.scale;
    this.reels.layout({ x: (r.left - root.left) / k, y: (r.top - root.top) / k, w: r.width / k, h: r.height / k }, 1, rowGap);
    const { cellW, cellH } = this.reels.geom;
    const key = `${cellW.toFixed(1)}x${cellH.toFixed(1)}@${res.toFixed(2)}`;
    if (key !== this.texKey) {
      const old = this.tex;
      this.tex = buildSymbolTextures(cellW, cellH, res, this.art);
      this.texKey = key;
      this.reels.setTextures(this.tex);
      this.winfx.setTextures(this.tex);
      destroyTextures(old);
      // A blank build (the phone dropped the canvas pixels mid-resize): try again shortly.
      if (!texturesOk(this.tex) && this.retries < 3) {
        this.retries++;
        setTimeout(() => this.rebuild(), 250);
      } else this.retries = 0;
    }
  }

  /** Redraws the symbol textures at the current layout. */
  rebuild() {
    this.texKey = "";
    if (this.last) this.layout(...this.last);
  }
}
