# Jack Vault 777 — Splash & login design files

Source files for the Claude Design canvas "Jack Vault 777 — Splash & Login". They replace the
`Load1`, `Load2` and `LoadL` boards in `../project/` for the player client's first screens.

| File | Board |
|---|---|
| `Main.dc.html` | Platform logo: Jack the safe mascot, JACK / 777 / VAULT wordmark (`wordmark`: `777` or `plain`, `backdrop` on/off) |
| `Mark.dc.html` | The same logo without the 777 ribbon |
| `Loading.dc.html` | Portrait splash, base component with `state`: `loading`, `ready`, `login` |
| `Ready.dc.html` | Portrait, TAP TO PLAY with the sound choice (`Loading` with `state="ready"`) |
| `Login.dc.html` | Portrait player login (`Loading` with `state="login"`) |
| `LoadingL.dc.html` | Landscape loading: logo left, progress and tip right |
| `canvas.json` | Canvas index: board positions, sizes and titles |

In the client: the logo is `client/src/ui/logo.ts`, and the screens are `client/src/ui/loading.ts`
with their styles under "loading / splash / player login" in `client/src/styles.css`.
