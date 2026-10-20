# Jack Vault — Design canvas files

Source files for the Claude Design canvas "Jack Vault — Style Guide", built from `ui-design-prompts.md` (Prompts 0–10).

- `project/canvas.json` — the canvas index: every artboard's position, size and title, plus the row titles.
- `project/*.dc.html` — one file per artboard. Each is a self-contained Design Component (HTML + inline styles + a small logic block). Open the canvas on claude.ai to view and edit them visually; these files are the exact source behind it.

## Artboards by prompt

| Prompt | Files |
|---|---|
| 0 Style guide | `Main` (logo), `Colors`, `Type`, `Buttons`, `Panels`, `Icons`, `Motion`, `Layout`, `Tokens` |
| 1 Loading | `Load1`, `Load2` (tap to play), `LoadL` (landscape) |
| 2 Lobby | `Lobby`, `LobbyL`, `LobbyStates` |
| 3 Reels | `Reels` (base component with a `mode` switch), `ReelsSpin`, `ReelsAntic`, `ReelsAuto`, `ReelsThumb`, `ReelsL` |
| 4 Symbols | `Symbols` |
| 5 Wins | `WinLine`, `WinMulti`, `WinScatter`, `WinBig`, `WinMega`, `WinEpic`, `WinL`, `WinTiming` |
| 6 Free spins | `FSIntro`, `FSReels`, `FSRetrigger`, `FSSummary`, `FSReelsL` |
| 7 Super Wheel | `Wheel` (base with `state`), `WheelSpin`, `WheelResult`, `WheelL` |
| 8 Jackpots | `JPMini` (base with `tier`), `JPMinor`, `JPMajor`, `JPGrand`, `JPGrandL` |
| 9 Menu & info | `Menu`, `Paytable`, `Paylines`, `Rules`, `Settings`, `Autoplay`, `History`, `PaytableL` |
| 10 Dialogs | `Dialogs`, `DialogL` |

## Notes for the PixiJS build

- Tokens (colors, type, spacing, glow, motion) are tabulated on the `Tokens` artboard; copy them into a constants module.
- `Reels.dc.html` carries the reel-grid geometry and every HUD state; the other reel boards only pass it a `mode`.
- Payline definitions (row index per reel, lines 1–25) are in `Paylines.dc.html` and must match `rtp_sim.py`.
- Symbol art is vector placeholder only; final 256×256 PNG art should keep the same silhouettes and hue families.
