import "./styles.css";
import { startClock } from "./anim";
import { LocalApi } from "./api/local";
import { RemoteApi, serverReachable } from "./api/remote";
import { ApiError, type GameApi, type GameConfig, type GameState } from "./api/types";
import { dialog } from "./ui/overlays";
import { ICON } from "./ui/dom";
import { Game } from "./game/controller";
import { Stage } from "./pixi/stage";
import type { ArtImages } from "./pixi/symbols";
import { Loading } from "./ui/loading";
import { Lobby } from "./ui/lobby";
import { setOverlayHost } from "./ui/overlays";
import { GameScreen, Orientation } from "./ui/screen";
import { unlockAudio } from "./ui/sound";
import { fullscreenOnTap } from "./ui/fullscreen";
import { Starfield } from "./ui/stars";
import { loadSymbolArt } from "./art/symbols";
import { backgroundUrl } from "./art/background";

declare const __FORCE_DEMO__: boolean;

const root = document.getElementById("root")!;
const canvas = document.getElementById("stage") as HTMLCanvasElement;

/** Reads env(safe-area-inset-*) in CSS px. */
function safeAreas() {
  const p = document.createElement("div");
  p.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  p.remove();
  return r;
}

/**
 * Fits the design frame to the screen: 390 px wide in portrait (height follows the
 * phone, 740-1000) and in landscape 390 px tall with width 844-1100, or 844 px wide
 * and up to 560 tall on squarer screens, scaled to fill.
 */
const frame = { w: 390, h: 844, scale: 1 };

function fitRoot(): Orientation {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const o: Orientation = vw > vh ? "landscape" : "portrait";
  let W: number, H: number, s: number;
  if (o === "portrait") {
    W = 390;
    s = vw / W;
    H = vh / s;
    if (H < 740) {
      s = vh / 740;
      H = 740;
    }
    H = Math.min(H, 1000);
  } else {
    H = 390;
    s = vh / H;
    W = vw / s;
    // Screens squarer than the 844x390 design (desktops, tablets, short phones) keep the
    // 844 px width and grow taller instead (16:9 is 844x475, 16:10 is 844x527), so the
    // control bar and lobby keep their designed widths and the reels take the extra height.
    if (W < 844) {
      s = vw / 844;
      W = 844;
      H = Math.min(vh / s, 560);
    }
    W = Math.min(W, 1100);
  }
  const left = (vw - W * s) / 2;
  const top = (vh - H * s) / 2;
  frame.w = Math.round(W);
  frame.h = Math.round(H);
  frame.scale = s;
  W = frame.w;
  H = frame.h;
  // Portrait: give extra height to the reels (symbols 64-78 px tall), the rest to the control bar.
  if (o === "portrait") root.style.setProperty("--grid-h", `${Math.round(Math.max(260, Math.min(360, 300 + (H - 844) * 0.5)))}px`);
  root.style.width = `${W}px`;
  root.style.height = `${H}px`;
  root.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
  root.classList.toggle("landscape-root", o === "landscape");
  if (!customBg) document.getElementById("bg")!.style.backgroundImage = backgroundUrl(o === "landscape");
  const sa = safeAreas();
  root.style.setProperty("--sat-d", `${Math.max(0, sa.t - top) / s}px`);
  root.style.setProperty("--sab-d", `${Math.max(0, sa.b - top) / s}px`);
  root.style.setProperty("--sal-d", `${Math.max(0, sa.l - left) / s}px`);
  root.style.setProperty("--sar-d", `${Math.max(0, sa.r - left) / s}px`);
  return o;
}

/** True once public/art/manifest.json supplied its own background. */
let customBg = false;

async function loadArt(stage: Stage) {
  stage.art = await loadSymbolArt();
  if (__FORCE_DEMO__) return;
  try {
    const r = await fetch("art/manifest.json");
    if (!r.ok) return;
    const m = (await r.json()) as { symbols?: Record<string, string>; background?: string };
    const art: ArtImages = {};
    await Promise.all(Object.entries(m.symbols ?? {}).map(([k, src]) => new Promise<void>((res) => {
      const img = new Image();
      img.onload = () => {
        img.dataset.custom = "1";
        art[k as keyof ArtImages] = img;
        res();
      };
      img.onerror = () => res();
      img.src = src;
    })));
    stage.art = { ...stage.art, ...art };
    if (m.background) customBg = true;
    if (m.background) document.getElementById("bg")!.style.backgroundImage = `linear-gradient(rgba(6,4,15,.45), rgba(6,4,15,.45)), url("${m.background}")`;
  } catch {
    /* no custom art: vector placeholders */
  }
}

function showDialog(title: string, body: string): Promise<unknown> {
  return dialog({ icon: ICON.coin(28), iconBg: "rgba(245,179,1,.15)", title, body, buttons: [{ id: "ok", label: "LOG IN", kind: "gold" }] }).result;
}

const timeout = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickApi(): Promise<GameApi> {
  const q = new URLSearchParams(location.search);
  const base = q.get("server") ?? "";
  const mode = __FORCE_DEMO__ ? "demo" : q.get("mode");
  if (mode === "demo") return new LocalApi();
  if (mode === "server" || (await serverReachable(base))) return new RemoteApi(base);
  // Demo fallback only on a dev machine. On a real site a slow health check must not drop a
  // player into a browser-side wallet: stay on the server and let the retry loop wait for it.
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  return local ? new LocalApi() : new RemoteApi(base);
}

async function main() {
  fullscreenOnTap();
  startClock();
  setOverlayHost(root);
  let orientation = fitRoot();
  // Refit on every size change from the start: the first tap (LOG IN or TAP TO PLAY) goes full screen
  // while the splash is still up, and the game must fill the new height. Some phones report the full
  // screen size a moment after the resize event, so check again shortly after.
  let onRefit: (orientationChanged: boolean) => void = () => {};
  let pending = 0;
  let late = 0;
  let fitted = `${window.innerWidth}x${window.innerHeight}`;
  const refit = (force = false) => {
    const size = `${window.innerWidth}x${window.innerHeight}`;
    if (size === fitted && !force) return;
    fitted = size;
    const o = fitRoot();
    const changed = o !== orientation;
    orientation = o;
    onRefit(changed);
  };
  const scheduleRefit = () => {
    clearTimeout(pending);
    clearTimeout(late);
    pending = window.setTimeout(() => refit(), 80);
    late = window.setTimeout(() => refit(), 600);
  };
  window.addEventListener("resize", scheduleRefit);
  document.addEventListener("fullscreenchange", scheduleRefit);
  const loading = new Loading(root);
  loading.progress(0.05);

  await Promise.race([
    Promise.all(["700 12px Orbitron", "900 12px Orbitron", "700 12px Rajdhani", "900 12px Cinzel", "400 12px \"Lilita One\""].map((f) => document.fonts.load(f))),
    timeout(3500),
  ]);
  loading.progress(0.3);

  const api = await pickApi();
  let config!: GameConfig;
  let state: GameState | null = null;
  let notice = "";
  for (;;) {
    try {
      config = await api.config();
      state = await api.connect();
      break;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // No saved session, or it ended: log in.
        if (e.code === "LOGGED_IN_ELSEWHERE") notice = "This account was logged in on another device.";
        break;
      }
      loading.error("Can't reach the game server. Retrying…");
      await timeout(2500);
    }
  }
  // Players log in with the username and password their agent gave them.
  if (!state && api instanceof RemoteApi) state = await loading.login((u, p) => api.login(u, p), notice);
  if (!state) throw new Error("No game state");
  const st: GameState = state;
  let liveGame: Game | null = null;
  if (api instanceof RemoteApi) {
    api.onAuthLost = (reason) => {
      liveGame?.stopForAuth();
      const [title, body] = reason === "LOGGED_IN_ELSEWHERE"
        ? ["Logged in on another device", "This account was just logged in on another device, so this one was logged out. Please log in again to play here."]
        : ["Signed out", "Your session ended. Please log in again."];
      void showDialog(title, body).then(() => location.reload());
    };
  }
  loading.progress(0.6);

  const stars = new Starfield(document.getElementById("stars") as HTMLCanvasElement);
  const stage = new Stage();
  await stage.init(canvas);
  await loadArt(stage);
  loading.progress(0.85);

  const screen = new GameScreen(root);
  screen.setDemo(api.mode === "demo");
  screen.build(orientation);
  const game = new Game(api, config, stage, screen, root, (on) => stars.setSpinning(on));
  liveGame = game;
  game.bindScreen();
  const relayout = () => stage.layout(frame, screen.grid, orientation === "portrait" ? 4 : 3);
  relayout();
  game.prepare(st);

  let lobby: Lobby | null = null;
  game.onLobby = () => {
    lobby = new Lobby(root, game.balance, st.jackpots, () => {
      lobby?.remove();
      lobby = null;
    });
  };
  api.onJackpots((j) => lobby?.setJackpots(j));

  onRefit = (changed) => {
    if (changed) {
      screen.build(orientation);
      game.bindScreen();
    }
    game.relayout();
    relayout();
  };
  // The size may have changed while loading (full screen from the LOG IN tap).
  refit(true);
  if (new URLSearchParams(location.search).has("debug")) showDebug(stage);
  // Phones can drop GPU images when going full screen or coming back to the tab: redraw the symbols.
  const redraw = () => setTimeout(() => stage.rebuild(), 700);
  document.addEventListener("fullscreenchange", redraw);
  document.addEventListener("visibilitychange", () => !document.hidden && redraw());

  loading.progress(1);
  await loading.ready();
  unlockAudio();
  await loading.close();
  await game.start(st);
}

/** ?debug: a small on-screen readout for checking rendering on a phone (send a screenshot of it). */
function showDebug(stage: Stage) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:4px;top:4px;z-index:9999;max-width:96vw;font:11px/1.3 monospace;color:#0f0;background:rgba(0,0,0,.75);padding:4px 6px;pointer-events:none;white-space:pre-wrap";
  document.body.appendChild(el);
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  const gl = (stage.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
  const tick = () => {
    const a = gl?.getContextAttributes();
    const c = stage.app.canvas;
    el.textContent = [
      `view ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} fs ${!!document.fullscreenElement}`,
      `canvas ${c.width}x${c.height} css ${c.style.width} ${c.style.height}`,
      `gl ${gl ? (gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1") : "none"} lost ${gl?.isContextLost()} stencil ${a?.stencil} aa ${a?.antialias} bits ${gl?.getParameter(gl.STENCIL_BITS)}`,
      `clip ${c.style.clipPath}`,
      errors.slice(-3).join(" | "),
    ].join("\n");
  };
  tick();
  setInterval(tick, 1000);
}

void main();
