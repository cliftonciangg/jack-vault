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
 * Fits the design frame to the phone: 390 px wide in portrait (height follows the
 * phone, 740-1000) and 390 px tall in landscape (width 740-1100), scaled to fill.
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
    if (W < 740) {
      s = vw / 740;
      W = 740;
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
  return new LocalApi();
}

async function main() {
  startClock();
  setOverlayHost(root);
  let orientation = fitRoot();
  const loading = new Loading(root);
  loading.progress(0.05);

  await Promise.race([
    Promise.all(["700 12px Orbitron", "900 12px Orbitron", "700 12px Rajdhani", "900 12px Cinzel"].map((f) => document.fonts.load(f))),
    timeout(3500),
  ]);
  loading.progress(0.3);

  const api = await pickApi();
  let config!: GameConfig;
  let state: GameState | null = null;
  for (;;) {
    try {
      config = await api.config();
      state = await api.connect();
      break;
    } catch (e) {
      if (e instanceof ApiError && e.code === "LOGIN_REQUIRED") break;
      loading.error("Can't reach the game server. Retrying…");
      await timeout(2500);
    }
  }
  // Players log in with the username and password their agent gave them.
  if (!state && api instanceof RemoteApi) state = await loading.login((u, p) => api.login(u, p));
  if (!state) throw new Error("No game state");
  const st: GameState = state;
  if (api instanceof RemoteApi) {
    api.onAuthLost = () => {
      void showDialog("Signed out", "Your session ended. Please log in again.").then(() => location.reload());
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

  let pending = 0;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      const o = fitRoot();
      if (o !== orientation) {
        orientation = o;
        screen.build(o);
        game.bindScreen();
      }
      game.relayout();
      relayout();
    }, 80);
  });

  loading.progress(1);
  await loading.ready();
  unlockAudio();
  await loading.close();
  await game.start(st);
}

void main();
