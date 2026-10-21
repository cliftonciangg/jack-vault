import type { Jackpots } from "../api/types";
import { JACKPOT_TIERS } from "../api/types";
import { JP_STYLE } from "../theme";
import { $, h, ICON, money } from "./dom";

const GAMES: { name: string; bg: string; badge?: [string, string]; live?: boolean }[] = [
  { name: "Crown of the Cosmos", bg: "radial-gradient(circle at 50% 35%, #5B3FBF, #130E36 70%)", badge: ["NEW", "#22D3EE"], live: true },
  { name: "Afterburner 777", bg: "radial-gradient(circle at 50% 35%, #FF7A1A, #3B1203 70%)", badge: ["HOT", "#FF7A1A"] },
  { name: "Abyss Pearls", bg: "radial-gradient(circle at 50% 35%, #0E7490, #06241C 70%)" },
  { name: "Dragon Ember", bg: "radial-gradient(circle at 50% 35%, #E11D2E, #2A0508 70%)", badge: ["JACKPOT", "#F5B301"] },
  { name: "Gold Rush Canyon", bg: "radial-gradient(circle at 50% 35%, #F5B301, #3B2A05 70%)" },
  { name: "Candy Comet", bg: "radial-gradient(circle at 50% 35%, #F0ABFC, #4A0F50 70%)" },
  { name: "Neon Outlaw", bg: "radial-gradient(circle at 50% 35%, #22D3EE, #0A2A33 70%)" },
  { name: "Reef Raiders", bg: "radial-gradient(circle at 50% 35%, #4ADE80, #0A2A1A 70%)", badge: ["FISH", "#4ADE80"] },
  { name: "Pharaoh's Orbit", bg: "radial-gradient(circle at 50% 35%, #FBBF24, #2A2005 70%)" },
];

/** Jack Vault lobby (Lobby.dc.html; landscape and desktop: LobbyL.dc.html, in CSS), with one playable game. */
export class Lobby {
  el: HTMLElement;
  private jpEls = new Map<string, HTMLElement>();
  constructor(host: HTMLElement, balance: number, jackpots: Jackpots, onPlay: () => void) {
    this.el = h(`<div class="screen lobby" style="z-index:15">
      <div class="lb-top">
        <div class="brand"><b>JACK</b><i>VAULT</i></div>
        <div class="lb-jp">${JACKPOT_TIERS.map((t) => `<div class="jp ${t === "GRAND" ? "grand" : ""}" style="background:${JP_STYLE[t].bg}"><b>${t}</b><span data-t="${t}">${money(jackpots[t])}</span></div>`).join("")}</div>
        <div class="lb-bal">${ICON.coin()}<span class="num bal">${money(balance)}</span><button class="press" aria-label="Get coins">+</button></div>
      </div>
      <div class="lb-hero"><div class="k">FEATURED</div><div class="t gold">CROWN OF<br>THE COSMOS</div><div class="s">Free Spins ×2, the Super Wheel and four jackpots.</div><button class="btn-gold press play">PLAY NOW</button>
        <div class="art">${ICON.crown(130, "cgh")}</div></div>
      <div class="lb-tabs tabs">${["All", "Slots", "Fish", "Arcade", "Favorites"].map((t, i) => `<button class="${i === 0 ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="lb-games">${GAMES.map((g, i) => `<button class="tile-game press ${g.live ? "" : "locked"}" data-i="${i}" style="background:${g.bg}">
          ${g.badge ? `<span class="bd" style="background:${g.badge[1]};color:#0B0820">${g.badge[0]}</span>` : ""}
          <span class="nm">${g.name}</span></button>`).join("")}</div>
      <nav class="lb-nav"><button class="on">${ICON.home()}Home</button><button>${ICON.grid()}Games</button><button>${ICON.gift()}Rewards</button><button>${ICON.history()}History</button><button>${ICON.user()}Profile</button></nav>
    </div>`);
    host.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>("[data-t]").forEach((e) => this.jpEls.set(e.dataset.t!, e));
    $(this.el, ".play").addEventListener("click", onPlay);
    $(this.el, '[data-i="0"]').addEventListener("click", onPlay);
    // In landscape the games row scrolls sideways: let a mouse wheel scroll it too.
    const games = $(this.el, ".lb-games");
    games.addEventListener("wheel", (e) => {
      if (games.scrollWidth <= games.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      games.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    this.el.querySelectorAll<HTMLElement>(".lb-tabs button").forEach((b) => b.addEventListener("click", () => {
      this.el.querySelectorAll(".lb-tabs button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    }));
  }
  setJackpots(j: Jackpots) {
    for (const t of JACKPOT_TIERS) {
      const e = this.jpEls.get(t);
      if (e) e.textContent = money(j[t]);
    }
  }
  remove() {
    this.el.remove();
  }
}
