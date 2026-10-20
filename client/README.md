# Jack Vault: mobile client

The playable front end for Jack Vault ("Crown of the Cosmos"), built from the Claude Design files in `../design-source/`. PixiJS 8 draws the reels and win effects; the HUD, menus and overlays are plain DOM laid over it. Portrait (390x844) is the main layout, and landscape has its own.

All code here is original. Runtime dependency: [pixi.js](https://github.com/pixijs/pixijs) 8.22.0 (MIT). Dev tools: Vite (MIT), TypeScript (Apache-2.0).

## Run it

Needs Node 20+. Two terminals, from the `jack-vault` folder:

```bash
# 1. the game server (port 8080)
npm install
npm start

# 2. the client (port 5173), proxies /api and /ws to the server
cd client
npm install
npm run dev
```

Open http://localhost:5173 and log in with a player account. Players are created by an agent in the back office (http://localhost:5173/office): log in there as **demo-distributor** / **demo1234**, create an agent and load it, log in as that agent, then create a player and load it. The player's username and password go on the game's start screen. The menu has a Log out button, and when the agent loads or redeems coins the player's balance updates in the open game.

To play on a phone, use the "Network" URL Vite prints (same Wi-Fi), e.g. `http://192.168.1.20:5173`.

Without the server running on localhost, the client switches to **demo mode** on its own (on any other host it keeps retrying the server, so a player can never land on a browser-side wallet): the same game math runs in the browser with a saved demo balance and no login. Force a mode with `?mode=demo` or `?mode=server`, and point at another server with `?server=https://host`. With `npm run dev` you can also force features to test them: `?force=fs`, `?force=wheel`, `?force=big`, `?force=jackpot` (dev builds only).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload. `JACK_VAULT_SERVER=http://host:port npm run dev` proxies to another server. |
| `npm run build` | Type-check and build to `dist/` (serve it behind the same origin as the API, or set `CORS_ORIGIN` on the server). |
| `npm run build:demo` | Builds a single self-contained offline file: `dist-demo/jack-vault-demo.html`. |
| `npm run preview` | Serves the last build. |
| `npm run typecheck` | TypeScript check only. |

## Swapping in real art

The finished art is built in as SVG: the 12 symbols in `src/art/symbols.ts` and the space backdrop in `src/art/background.ts`. It is drawn in code, so it stays sharp on every screen and needs no image files. To replace any of it with painted art, add `public/art/manifest.json`:

```json
{
  "symbols": { "CROWN": "art/symbols/crown.png", "WILD": "art/symbols/wild.png" },
  "background": "art/bg.jpg"
}
```

Any symbol left out keeps the built-in art. A custom WILD, SCATTER or BONUS image should include its own word, since the game only writes the ribbon text on the built-in versions. Symbol ids: CROWN, GEM, PLANET, COMET, A, K, Q, J, TEN, WILD, SCATTER, BONUS. Square PNGs of 256px or more look best.

## How the reels stay smooth

- **One clock.** Pixi's own ticker is off. A single `requestAnimationFrame` loop (`src/anim.ts`) drives every tween, reel and effect and renders once per frame, so nothing fights for frames.
- **A tape, not a list.** Each reel is an endless strip where symbol *n* sits at `(n + p) * cellHeight`. Six recycled sprites show whatever part of the strip is in view, so nothing is created or destroyed while spinning.
- **The result is written ahead.** When the server answers, the outcome is placed on the strip a few cells above the window and the reel decelerates onto it with a Hermite curve that starts at the current speed, overshoots by 16% of a cell and settles back. No snapping, no jump.
- **Motion blur.** Each symbol has a pre-rendered blurred texture that fades in with speed.
- **Feel.** Small wind-up before the spin, staggered stops (faster in turbo), anticipation slow-down with a glow when two scatters (or bonus symbols) are already showing, and tap-to-stop that slams all reels to the result.

## How it fits together

| Path | Role |
|---|---|
| `src/main.ts` | Boot, scaling of the 390-wide design frame, mode pick, rotation |
| `src/api/` | `RemoteApi` (REST with idempotent retries, WebSocket for jackpots) and `LocalApi` (demo, reuses the server's engine) |
| `src/game/controller.ts` | Spin flow, wins, free spins, Super Wheel, jackpots, autoplay, reconnects |
| `src/pixi/` | Reels, symbol textures, win lines and highlights |
| `src/ui/` | HUD, menus, paytable, settings, overlays, wheel, sound, particles, lobby |
| `src/art/` | Symbol art and backdrop |
| `src/theme.ts` | Colours, fonts and win tiers from the design tokens |

In server mode the server doesn't send its reel strips, so the symbols spinning past before the result are random filler drawn from the same symbol set. The stopped result is always exactly what the server returned.
