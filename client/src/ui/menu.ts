import type { GameConfig, HistoryRound, Jackpots, ReelStep, Sym } from "../api/types";
import { JACKPOT_TIERS } from "../api/types";
import { JP_STYLE, LINE_COLORS, SYMBOL_ART, SYMBOL_ORDER } from "../theme";
import { symbolSvg, symbolTileCss } from "../pixi/symbols";
import { $, esc, h, ICON, money, saveSettings, settings } from "./dom";
import { applyVolume, sfx } from "./sound";

export type Tab = "menu" | "paytable" | "paylines" | "rules" | "settings" | "autoplay" | "history";

export interface AutoplayOptions {
  spins: number;
  stopOnFeature: boolean;
  singleWinOverCents: number | null;
  lossLimitCents: number | null;
}

export interface MenuContext {
  config: GameConfig;
  betCents: number;
  jackpots: Jackpots;
  demo: boolean;
  history: () => Promise<HistoryRound[]>;
  onSettings: () => void;
  onAutoplay: (o: AutoplayOptions) => void;
  onLobby: () => void;
  onAddCoins?: () => void;
  /** Logged-in player's username (server mode). */
  username?: string | null;
  onLogout?: () => void;
}

const TABS: [Tab, string][] = [["paytable", "Paytable"], ["paylines", "Paylines"], ["rules", "Rules"], ["settings", "Settings"], ["autoplay", "Autoplay"], ["history", "History"]];

function tile(sym: Sym, size = 52) {
  const a = SYMBOL_ART[sym];
  return `<div class="tile" style="width:${size}px;height:${size}px;background:${symbolTileCss(sym)}">${symbolSvg(sym, a.tier === "HIGH" ? size * 0.74 : size * 0.94)}${a.tier === "HIGH" ? `<small style="color:${a.ink}">${a.label}</small>` : ""}</div>`;
}

function paytable(c: MenuContext) {
  const lineBet = c.betCents / c.config.lines;
  const fsMult = c.config.freeSpins.multiplier;
  const pays = (sym: Sym) => {
    const row = c.config.paytable[sym] ?? {};
    return `<ul>${(["5", "4", "3"] as const).map((n) => `<li><b>${n}</b><span>${money((row[n] ?? 0) * lineBet)}</span></li>`).join("")}</ul>`;
  };
  const sc = c.config.scatterPays;
  const high = SYMBOL_ORDER.filter((s) => SYMBOL_ART[s].tier === "HIGH");
  const low = SYMBOL_ORDER.filter((s) => SYMBOL_ART[s].tier === "LOW");
  return `
    <div style="font-size:14px;color:var(--t3)">Pays shown for your current bet of <b style="color:var(--gold1)" class="num">${money(c.betCents)}</b>. Wins pay left to right on adjacent reels.</div>
    <div class="pt-grid">${[...high, ...low].map((s) => `<div class="pt">${tile(s)}${pays(s)}</div>`).join("")}</div>
    <div class="card special">${tile("WILD", 60)}<p><strong>WILD</strong> appears on reels 2 to 5 and substitutes for every symbol except FREE SPINS and BONUS.</p></div>
    <div class="card special">${tile("SCATTER", 60)}<p><strong>FREE SPINS</strong> pays anywhere: 3 = <b class="num">${money((sc["3"] ?? 0) * c.betCents)}</b>, 4 = <b class="num">${money((sc["4"] ?? 0) * c.betCents)}</b>, 5 = <b class="num">${money((sc["5"] ?? 0) * c.betCents)}</b>. 3 or more award <strong>${c.config.freeSpins.spinsAwarded} free spins</strong> with all wins ×${fsMult}. 3 more during free spins add ${c.config.freeSpins.retriggerSpins}.</p></div>
    <div class="card special">${tile("BONUS", 60)}<p><strong>BONUS</strong> lands on reels 1, 3 and 5. Three of them spin the <strong>Super Wheel</strong> for credits, free spins or a jackpot.</p></div>
    <div style="font-family:var(--display);font-weight:900;font-size:15px;margin-top:6px">JACKPOTS</div>
    ${JACKPOT_TIERS.map((t) => `<div class="card row" style="background:${JP_STYLE[t].bg};border:0"><b style="font-family:var(--display);flex:1">${t}</b><span class="num" style="font-weight:700;color:#FFE27A">${money(c.jackpots[t])}</span></div>`).join("")}
    <div style="font-size:14px;color:var(--t3);line-height:1.4">Every spin adds to all four pools. A jackpot segment on the Super Wheel pays that whole pool. Higher bets have proportionally higher jackpot chances.</div>`;
}

function paylines(c: MenuContext) {
  return `<div class="pl-grid">${c.config.paylines.map((rows, i) => {
    const color = LINE_COLORS[i % LINE_COLORS.length];
    const cells = [];
    for (let r = 0; r < 4; r++) for (let reel = 0; reel < 5; reel++) cells.push(`<i style="${rows[reel] === r ? `background:${color};box-shadow:0 0 6px ${color}` : ""}"></i>`);
    return `<div class="pl"><b style="color:${color}">${i + 1}</b><div class="mg">${cells.join("")}</div></div>`;
  }).join("")}</div>`;
}

function rules(c: MenuContext) {
  const rtp = (c.config.rtp.min * 100).toFixed(2);
  return `<div class="rules">
    <h3>HOW TO PLAY</h3><p>Choose your total bet with − and +, then tap SPIN or swipe up on the reels. Crown of the Cosmos has 5 reels, 4 rows and 25 fixed paylines. The line bet is the total bet divided by 25.</p>
    <p>Line wins pay for 3, 4 or 5 matching symbols on a payline, starting from the leftmost reel. Only the highest win per line is paid. Wins on different lines are added together.</p>
    <h3>FREE SPINS</h3><p>3 or more FREE SPINS symbols anywhere award ${c.config.freeSpins.spinsAwarded} free spins at the bet that triggered them. All free spin wins are multiplied by ${c.config.freeSpins.multiplier}. 3 or more during free spins add ${c.config.freeSpins.retriggerSpins} more.</p>
    <h3>SUPER WHEEL</h3><p>3 BONUS symbols in the base game spin the Super Wheel. Its segments award credits (multiples of your bet), 10 free spins, or the MINI, MINOR, MAJOR or GRAND jackpot. If both trigger, the wheel is played before the free spins.</p>
    <h3>JACKPOTS</h3><p>A share of every bet goes to the four progressive pools. A jackpot pays the full pool shown when it is won, then the pool restarts from its seed value.</p>
    <h3>GOOD TO KNOW</h3><p>Every result is decided by the game server before the reels stop. If you lose your connection, your round is saved and continues when you come back. Malfunction voids all pays and plays.</p>
    <p>The theoretical return to player (RTP) is <b style="color:#fff">${rtp}%</b> at the maximum bet and up to ${(c.config.rtp.max * 100).toFixed(2)}% at lower bets.</p>
    ${c.demo ? `<p style="color:var(--warn)">You are playing in demo mode with play coins. The same game engine runs in your browser.</p>` : ""}
  </div>`;
}

function settingsHtml() {
  const tg = (key: keyof typeof settings, label: string, sub: string) =>
    `<div class="set-row"><div class="lbl"><span>${label}</span><small>${sub}</small></div><button class="toggle" data-key="${key}" aria-label="${label}" aria-pressed="${settings[key]}"></button></div>`;
  return `
    <div class="slider"><div class="top2"><label for="vol">Sound effects</label><span class="volv">${settings.volume}%</span></div><input id="vol" type="range" min="0" max="100" value="${settings.volume}"></div>
    ${tg("sound", "Sound", "Spin, reel stop and win sounds")}
    ${tg("turbo", "Turbo spin", "Halves reel and win timings")}
    ${tg("haptics", "Vibration", "Light taps on spin, reel stop and wins")}
    ${tg("lefty", "Left-handed mode", "Mirrors the control bar")}
    ${tg("saver", "Battery saver", "Fewer particles in celebrations")}
    <div style="font-size:14px;color:var(--t3);margin-top:6px">Play responsibly. Set limits and take breaks.</div>`;
}

function autoplayHtml() {
  return `
    <div class="card"><div style="font-weight:700;margin-bottom:8px">Number of spins</div><div class="chips" data-g="spins">${[10, 25, 50, 100, 500].map((n, i) => `<button data-v="${n}" class="${i === 1 ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="card"><div style="font-weight:700;margin-bottom:8px">Stop if a single win exceeds</div><div class="chips" data-g="win">${[["0", "OFF"], ["5000", "50"], ["25000", "250"], ["100000", "1,000"]].map(([v, l], i) => `<button data-v="${v}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card"><div style="font-weight:700;margin-bottom:8px">Stop if balance drops by</div><div class="chips" data-g="loss">${[["0", "OFF"], ["2500", "25"], ["10000", "100"], ["50000", "500"]].map(([v, l], i) => `<button data-v="${v}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="set-row"><div class="lbl"><span>Stop on any feature</span><small>Free spins or Super Wheel</small></div><button class="toggle stopfeat" aria-label="Stop on any feature" aria-pressed="true"></button></div>
    <button class="btn-gold press go" style="max-width:none;margin-top:6px">START AUTOPLAY</button>`;
}

function gridHtml(step: ReelStep) {
  const cells: string[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    const s = step.grid[c][r];
    cells.push(`<div style="background:${symbolTileCss(s)}">${symbolSvg(s, 18)}</div>`);
  }
  return `<div class="mini-grid" style="width:100%;margin-top:8px">${cells.join("")}</div>`;
}

/** Full-height sheet over the game (Menu, Paytable, Paylines, Rules, Settings, Autoplay, History). */
export function openMenu(host: HTMLElement, ctx: MenuContext, start: Tab = "menu"): () => void {
  const el = h(`<div class="ov" style="justify-content:flex-end"><div class="backdrop" style="background:rgba(6,4,15,.6)"></div>
    <div class="sheet"><div class="grab"></div><div class="top"><button class="close press back hidden" aria-label="Back">${ICON.back()}</button><h2>Menu</h2><button class="close press x" aria-label="Close">${ICON.close()}</button></div>
    <div class="tabs hidden"></div><div class="body"></div></div></div>`);
  host.appendChild(el);
  const sheet = $(el, ".sheet");
  const body = $(el, ".body");
  const title = $(el, "h2");
  const tabs = $(el, ".tabs");
  const back = $(el, ".back");
  const doClose = () => {
    sheet.style.transition = "transform 220ms ease-in";
    sheet.style.transform = "translateY(100%)";
    el.style.transition = "opacity 220ms";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 230);
  };
  $(el, ".x").addEventListener("click", () => {
    sfx.click();
    doClose();
  });
  $(el, ".backdrop").addEventListener("click", doClose);
  // Swipe down on the grab handle or title row closes.
  let y0: number | null = null;
  const topArea = [$(el, ".grab"), $(el, ".top")];
  topArea.forEach((a) => a.addEventListener("pointerdown", (e) => (y0 = e.clientY)));
  el.addEventListener("pointerup", (e) => {
    if (y0 !== null && e.clientY - y0 > 60) doClose();
    y0 = null;
  });

  const show = (tab: Tab) => {
    back.classList.toggle("hidden", tab === "menu");
    tabs.classList.toggle("hidden", tab === "menu");
    tabs.innerHTML = TABS.map(([t, l]) => `<button data-t="${t}" class="${t === tab ? "on" : ""}">${l}</button>`).join("");
    tabs.querySelectorAll<HTMLElement>("button").forEach((b) => b.addEventListener("click", () => show(b.dataset.t as Tab)));
    title.textContent = tab === "menu" ? "Menu" : TABS.find(([t]) => t === tab)![1];
    body.scrollTop = 0;
    if (tab === "menu") {
      body.innerHTML = `${TABS.map(([t, l]) => `<button class="menu-item press" data-t="${t}">${l}</button>`).join("")}
        ${ctx.onAddCoins ? `<button class="menu-item press accent coins">Get 1,000.00 play coins</button>` : ""}
        <button class="menu-item press accent go-lobby">Back to Lobby</button>
        ${ctx.onLogout ? `<button class="menu-item press logout">Log out${ctx.username ? ` <span style="color:var(--t3);font-weight:600">(${esc(ctx.username)})</span>` : ""}</button>` : ""}
        <div style="flex:1"></div><div style="font-size:13px;color:#8A83AD;line-height:1.4;margin-top:8px">Crown of the Cosmos v1.0.0 · RTP ${(ctx.config.rtp.min * 100).toFixed(2)}%${ctx.demo ? " · Demo mode" : ""}<br>Play responsibly</div>`;
      body.querySelectorAll<HTMLElement>("[data-t]").forEach((b) => b.addEventListener("click", () => {
        sfx.click();
        show(b.dataset.t as Tab);
      }));
      body.querySelector(".go-lobby")!.addEventListener("click", () => {
        doClose();
        ctx.onLobby();
      });
      body.querySelector(".logout")?.addEventListener("click", () => {
        doClose();
        ctx.onLogout?.();
      });
      body.querySelector(".coins")?.addEventListener("click", () => {
        ctx.onAddCoins?.();
        doClose();
      });
    } else if (tab === "paytable") body.innerHTML = paytable(ctx);
    else if (tab === "paylines") body.innerHTML = paylines(ctx);
    else if (tab === "rules") body.innerHTML = rules(ctx);
    else if (tab === "settings") {
      body.innerHTML = settingsHtml();
      const vol = $(body, "#vol") as HTMLInputElement;
      vol.addEventListener("input", () => {
        settings.volume = Number(vol.value);
        $(body, ".volv").textContent = `${vol.value}%`;
        applyVolume();
        saveSettings();
      });
      vol.addEventListener("change", () => sfx.click());
      body.querySelectorAll<HTMLElement>(".toggle[data-key]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.key as "sound" | "turbo" | "haptics" | "lefty" | "saver";
        settings[k] = !settings[k];
        b.setAttribute("aria-pressed", String(settings[k]));
        saveSettings();
        applyVolume();
        sfx.click();
        ctx.onSettings();
      }));
    } else if (tab === "autoplay") {
      body.innerHTML = autoplayHtml();
      body.querySelectorAll<HTMLElement>(".chips").forEach((g) => g.querySelectorAll<HTMLElement>("button").forEach((b) => b.addEventListener("click", () => {
        g.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        sfx.click();
      })));
      const sf = $(body, ".stopfeat");
      sf.addEventListener("click", () => sf.setAttribute("aria-pressed", String(sf.getAttribute("aria-pressed") !== "true")));
      $(body, ".go").addEventListener("click", () => {
        const v = (g: string) => Number(body.querySelector<HTMLElement>(`.chips[data-g="${g}"] .on`)!.dataset.v);
        ctx.onAutoplay({
          spins: v("spins"),
          singleWinOverCents: v("win") || null,
          lossLimitCents: v("loss") || null,
          stopOnFeature: sf.getAttribute("aria-pressed") === "true",
        });
        doClose();
      });
    } else if (tab === "history") {
      body.innerHTML = `<div style="color:var(--t3)">Loading…</div>`;
      ctx.history().then((rounds) => {
        if (!rounds.length) {
          body.innerHTML = `<div style="color:var(--t3);text-align:center;margin-top:30px">No rounds yet. Spin to start your history.</div>`;
          return;
        }
        body.innerHTML = rounds.map((r, i) => {
          const at = r.completedAt ?? r.startedAt;
          const when = at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          return `<button class="hist" data-i="${i}" style="flex-direction:column;align-items:stretch">
            <div class="row"><div style="flex:1"><div class="when">${esc(when)} · #${esc(r.roundId.slice(0, 8))}</div><div style="font-size:14px;color:var(--t2)">Bet <span class="amt">${money(r.betCents)}</span></div></div>
            <div class="amt" style="color:${r.totalWinCents > 0 ? "var(--gold5)" : "var(--t3)"};font-size:16px">${r.totalWinCents > 0 ? "+" + money(r.totalWinCents) : "0.00"}</div></div>
            <div class="replay"></div></button>`;
        }).join("");
        body.querySelectorAll<HTMLElement>(".hist").forEach((b) => b.addEventListener("click", () => {
          const r = rounds[Number(b.dataset.i)];
          const rp = b.querySelector(".replay")!;
          if (rp.innerHTML) {
            rp.innerHTML = "";
            return;
          }
          const reelSteps = (r.steps ?? []).filter((s) => s.type !== "WHEEL") as ReelStep[];
          rp.innerHTML = reelSteps.length ? gridHtml(reelSteps[reelSteps.length - 1]) + (reelSteps.length > 1 ? `<div style="font-size:13px;color:var(--t3);margin-top:4px">Final reels of ${reelSteps.length} spins in this round</div>` : "") : `<div style="font-size:13px;color:var(--t3);margin-top:6px">Round ${esc(r.roundId)}</div>`;
        }));
      }).catch(() => (body.innerHTML = `<div style="color:var(--err)">Could not load history.</div>`));
    }
  };
  back.addEventListener("click", () => show("menu"));
  show(start);
  return doClose;
}
