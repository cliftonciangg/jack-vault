/**
 * Jack Vault 777 platform logo (splash-login design, Main.dc.html): Jack the safe mascot on a
 * vault-door medallion, JACK / 777 ribbon / VAULT wordmark, coins, chips, gems and sparkles.
 * Drawn on an 800 x 560 canvas; size it with CSS (width/height on the svg).
 */
export function logoSvg(wordmark: "777" | "plain" = "777"): string {
  const show777 = wordmark !== "plain";
  const rays = Array.from({ length: 18 }, (_, i) =>
    `<path d="M0 0 L-20 -330 L20 -330 Z" fill="${i % 2 ? "#FFD23A" : "#FF7AA2"}" opacity="${i % 2 ? 0.16 : 0.11}" transform="rotate(${i * 20})"/>`).join("");
  const rivets = Array.from({ length: 16 }, (_, i) => {
    const a = ((i * 22.5 + 11.25) * Math.PI) / 180;
    return `<circle cx="${(400 + 172 * Math.cos(a)).toFixed(1)}" cy="${(300 + 172 * Math.sin(a)).toFixed(1)}" r="6" fill="#FFE58A" stroke="#7A4200" stroke-width="2.5"/>`;
  }).join("");
  const ticks = Array.from({ length: 8 }, (_, i) =>
    `<path d="M0 -15 L0 -10" stroke="#7A4200" stroke-width="2.5" stroke-linecap="round" transform="rotate(${i * 45})"/>`).join("");
  const coinT = (x: number, y: number, s: number, r: number, sy: number) => `translate(${x} ${y}) rotate(${r}) scale(${s} ${s * sy})`;
  const coinBody = `<circle cx="2.5" cy="3.5" r="24" fill="#8A4A00"/><circle r="24" fill="url(#jvm-coin)" stroke="#9A5200" stroke-width="2"/><circle r="17" fill="none" stroke="#C27800" stroke-width="2.5"/><path d="M0 -8 L2.1 -2.9 L7.6 -2.5 L3.4 1.1 L4.7 6.5 L0 3.6 L-4.7 6.5 L-3.4 1.1 L-7.6 -2.5 L-2.1 -2.9 Z" fill="#FFE98A" stroke="#B86A00" stroke-width="1.2"/>`;
  const backCoins = ([[140, 170, 1.15, -20, 0.88, 2.5], [690, 196, 1.2, 25, 0.85, 2.5], [108, 430, 0.95, 10, 0.7, 1.8], [700, 436, 1.05, -15, 0.8, 1.8]] as const)
    .map(([x, y, s, r, sy, b]) => `<g transform="${coinT(x, y, s, r, sy)}" style="filter:blur(${b}px)">${coinBody}</g>`).join("");
  const frontCoins = ([[196, 262, 1.0, -30, 0.72], [618, 272, 0.92, 30, 0.7], [232, 486, 0.82, 15, 0.6], [584, 494, 0.86, -20, 0.66], [166, 346, 0.62, 0, 0.92], [652, 362, 0.7, 40, 0.8], [640, 64, 0.55, 20, 0.9], [196, 40, 0.5, -10, 0.85]] as const)
    .map(([x, y, s, r, sy]) => `<g transform="${coinT(x, y, s, r, sy)}" style="filter:drop-shadow(0 4px 4px rgba(10,2,40,.45))">${coinBody}<ellipse cx="-8" cy="-10" rx="8" ry="3.5" fill="#FFFFFF" opacity=".7" transform="rotate(-35 -8 -10)"/></g>`).join("");
  const chips = ([["translate(100 238) rotate(-18) scale(.95 .8)", "#E11D48", "#7A0A2A"], ["translate(716 314) rotate(16) scale(.9 .78)", "#2563EB", "#13306E"]] as const)
    .map(([t, c, dark]) => `<g transform="${t}" style="filter:drop-shadow(0 4px 5px rgba(10,2,40,.5))"><ellipse cy="6" rx="26" ry="26" fill="${dark}"/><circle r="26" fill="${c}" stroke="#1A0B3D" stroke-width="2.5"/><circle r="22" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-dasharray="8.6 8.6"/><circle r="14" fill="${c}" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="3 3"/><text y="5.5" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="15" fill="#FFFFFF">7</text></g>`).join("");
  const gems = ([["translate(126 312) rotate(-12) scale(1.1)", "#22D3EE", "rgba(34,211,238,.9)"], ["translate(700 250) rotate(14) scale(1.2)", "#FF4D8D", "rgba(255,77,141,.9)"], ["translate(708 522) rotate(8) scale(.9)", "#A78BFA", "rgba(167,139,250,.9)"]] as const)
    .map(([t, c, glow]) => `<g transform="${t}" style="filter:drop-shadow(0 0 8px ${glow})"><path d="M-12 -6 L-6 -14 L6 -14 L12 -6 L0 14 Z" fill="${c}" stroke="#1A0B3D" stroke-width="2.5" stroke-linejoin="round"/><path d="M-6 -14 L6 -14 L3 -6 L-3 -6 Z" fill="#FFFFFF" opacity=".55"/><path d="M-12 -6 L12 -6 M-3 -6 L0 14 L3 -6" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity=".6"/></g>`).join("");
  const sparks = ([[232, 168, 0.9], [612, 186, 0.85], [318, 30, 0.6], [522, 450, 0.6], [92, 508, 0.6], [740, 90, 0.7], [486, 22, 0.55], [196, 410, 0.5], [668, 534, 0.5]] as const)
    .map(([x, y, s], i) => `<path class="lg-spark" style="animation-delay:${(i * 0.37).toFixed(2)}s" d="M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z" fill="#FFFFFF" transform="translate(${x} ${y}) scale(${s})"/>`).join("");
  const word = (t: string, y: number, size: number, len: number, shadow: string, base: string, baseStroke: string, edge: string, fill: string) => {
    const a = `x="400" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="${size}" textLength="${len}" lengthAdjust="spacingAndGlyphs"`;
    return `<text ${a} y="${y + 10}" fill="${shadow}" stroke="${shadow}" stroke-width="26" stroke-linejoin="round">${t}</text>
      <text ${a} y="${y}" fill="${base}" stroke="${baseStroke}" stroke-width="22" stroke-linejoin="round">${t}</text>
      <text ${a} y="${y}" fill="url(#${edge})" stroke="url(#${edge})" stroke-width="9" stroke-linejoin="round">${t}</text>
      <text ${a} y="${y}" fill="url(#${fill})">${t}</text>
      <text ${a} y="${y}" fill="url(#jvm-gloss)">${t}</text>`;
  };
  const ribbon = show777
    ? `<g style="filter:drop-shadow(0 4px 6px rgba(10,2,40,.5))">
      <path d="M300 380 L246 384 L264 400 L246 418 L300 416 Z" fill="#7A0A2A" stroke="#1A0B3D" stroke-width="4" stroke-linejoin="round"/>
      <path d="M500 380 L554 384 L536 400 L554 418 L500 416 Z" fill="#7A0A2A" stroke="#1A0B3D" stroke-width="4" stroke-linejoin="round"/>
      <path d="M290 374 Q400 362 510 374 L510 414 Q400 402 290 414 Z" fill="url(#jvm-ribbon)" stroke="#1A0B3D" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="M296 380 Q400 368 504 380" fill="none" stroke="#FFD23A" stroke-width="2.5" opacity=".9"/>
      <path d="M296 408 Q400 396 504 408" fill="none" stroke="#FFD23A" stroke-width="2.5" opacity=".9"/>
      <path d="M336 384 L338.6 390 L345 390.5 L340 394.6 L341.6 401 L336 397.5 L330.4 401 L332 394.6 L327 390.5 L333.4 390 Z" fill="#FFE58A" stroke="#7A2E00" stroke-width="1.5"/>
      <path d="M464 384 L466.6 390 L473 390.5 L468 394.6 L469.6 401 L464 397.5 L458.4 401 L460 394.6 L455 390.5 L461.4 390 Z" fill="#FFE58A" stroke="#7A2E00" stroke-width="1.5"/>
      <text x="400" y="406" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="38" letter-spacing="6" fill="#3A0A00" stroke="#3A0A00" stroke-width="7" stroke-linejoin="round">777</text>
      <text x="400" y="406" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="38" letter-spacing="6" fill="url(#jvm-gold)">777</text>
    </g>`
    : "";

  return `<svg class="jv-logo" viewBox="0 0 800 560" role="img" aria-label="${show777 ? "Jack Vault 777" : "Jack Vault"}" style="overflow:visible">
  <defs>
    <radialGradient id="jvm-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFC24A" stop-opacity=".55"/><stop offset=".45" stop-color="#E0457B" stop-opacity=".26"/><stop offset="1" stop-color="#2A0F6E" stop-opacity="0"/></radialGradient>
    <radialGradient id="jvm-door" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="#D9C2FF"/><stop offset=".22" stop-color="#9D6BFF"/><stop offset=".55" stop-color="#6230DE"/><stop offset=".85" stop-color="#330F96"/><stop offset="1" stop-color="#1B0752"/></radialGradient>
    <linearGradient id="jvm-ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B86A00"/><stop offset=".2" stop-color="#FFE58A"/><stop offset=".5" stop-color="#F5B301"/><stop offset=".8" stop-color="#FFF3C4"/><stop offset="1" stop-color="#B86A00"/></linearGradient>
    <linearGradient id="jvm-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".35" stop-color="#FFC92E"/><stop offset=".7" stop-color="#D98200"/><stop offset="1" stop-color="#FFE07A"/></linearGradient>
    <linearGradient id="jvm-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFBD6"/><stop offset=".3" stop-color="#FFE15A"/><stop offset=".5" stop-color="#FFC21E"/><stop offset=".56" stop-color="#E07F00"/><stop offset=".78" stop-color="#FFB21E"/><stop offset="1" stop-color="#FFE47A"/></linearGradient>
    <linearGradient id="jvm-goldEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3B0"/><stop offset="1" stop-color="#A85A00"/></linearGradient>
    <linearGradient id="jvm-gem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0FFFF"/><stop offset=".3" stop-color="#7DF0FF"/><stop offset=".5" stop-color="#22C7F2"/><stop offset=".56" stop-color="#0A7FD0"/><stop offset=".8" stop-color="#2CB8FF"/><stop offset="1" stop-color="#A8EEFF"/></linearGradient>
    <linearGradient id="jvm-gemEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D8FBFF"/><stop offset="1" stop-color="#0B4FA0"/></linearGradient>
    <linearGradient id="jvm-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".85"/><stop offset=".42" stop-color="#FFFFFF" stop-opacity=".15"/><stop offset=".46" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <radialGradient id="jvm-safe" cx="36%" cy="26%" r="80%"><stop offset="0" stop-color="#FFB3B3"/><stop offset=".3" stop-color="#FF4D6A"/><stop offset=".7" stop-color="#D4123F"/><stop offset="1" stop-color="#7A0A2A"/></radialGradient>
    <linearGradient id="jvm-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6680"/><stop offset=".5" stop-color="#E11D48"/><stop offset="1" stop-color="#A3123A"/></linearGradient>
    <linearGradient id="jvm-arm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6A82"/><stop offset="1" stop-color="#B0123C"/></linearGradient>
    <linearGradient id="jvm-hat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9F6BFF"/><stop offset=".55" stop-color="#5B21D6"/><stop offset="1" stop-color="#2E0B85"/></linearGradient>
    <radialGradient id="jvm-coin" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF7C8"/><stop offset=".4" stop-color="#FFD53D"/><stop offset=".85" stop-color="#E89400"/><stop offset="1" stop-color="#B86A00"/></radialGradient>
    <linearGradient id="jvm-ribbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6A82"/><stop offset=".5" stop-color="#E11D48"/><stop offset="1" stop-color="#9F1239"/></linearGradient>
    <linearGradient id="jvm-trim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4B8"/><stop offset=".45" stop-color="#FFC92E"/><stop offset="1" stop-color="#C97400"/></linearGradient>
  </defs>

  <circle cx="400" cy="300" r="290" fill="url(#jvm-glow)"/>
  <g transform="translate(400 300)"><g class="lg-rays">${rays}</g></g>

  <circle cx="400" cy="300" r="186" fill="#12053A"/>
  <circle cx="400" cy="300" r="172" fill="none" stroke="url(#jvm-rim)" stroke-width="22"/>
  <circle cx="400" cy="300" r="183" fill="none" stroke="#5A2E00" stroke-width="3"/>
  <circle cx="400" cy="300" r="160" fill="none" stroke="#5A2E00" stroke-width="3"/>
  ${rivets}
  <circle cx="400" cy="300" r="158" fill="url(#jvm-door)"/>
  <circle cx="400" cy="300" r="132" fill="none" stroke="#2A0B7A" stroke-width="4" opacity=".45"/>
  <circle cx="400" cy="300" r="104" fill="none" stroke="#C9A8FF" stroke-width="3" opacity=".25"/>
  <ellipse cx="336" cy="196" rx="54" ry="28" fill="#FFFFFF" opacity=".2" transform="rotate(-30 336 196)"/>
  <g transform="rotate(-9 400 318)">
    <ellipse cx="400" cy="318" rx="308" ry="62" fill="none" stroke="#3A1600" stroke-width="22"/>
    <ellipse cx="400" cy="318" rx="308" ry="62" fill="none" stroke="url(#jvm-ring)" stroke-width="15"/>
    <ellipse cx="400" cy="318" rx="294" ry="54" fill="none" stroke="#FFF3C4" stroke-width="2" opacity=".7"/>
  </g>

  ${backCoins}
  ${chips}

  <g style="filter:drop-shadow(0 6px 10px rgba(10,2,40,.55))">
    <path d="M322 178 C296 166 276 146 268 122" fill="none" stroke="#1A0B3D" stroke-width="32" stroke-linecap="round"/>
    <path d="M322 178 C296 166 276 146 268 122" fill="none" stroke="url(#jvm-arm)" stroke-width="22" stroke-linecap="round"/>
    <path d="M278 138 L264 132" stroke="#FFD23A" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="250" cy="86" rx="7" ry="11" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4" transform="rotate(-22 250 86)"/>
    <ellipse cx="263" cy="81" rx="7" ry="12" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4"/>
    <ellipse cx="276" cy="86" rx="7" ry="11" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4" transform="rotate(22 276 86)"/>
    <ellipse cx="263" cy="106" rx="20" ry="21" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="5"/>
    <ellipse cx="282" cy="110" rx="7" ry="11" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4" transform="rotate(32 282 110)"/>
    <path d="M254 100 Q263 96 272 100" fill="none" stroke="#C8C2E0" stroke-width="3" stroke-linecap="round"/>
    <path d="M226 78 Q216 98 224 118" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity=".85"/>
    <path d="M212 70 Q200 98 210 126" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity=".55"/>

    <path d="M478 186 C504 176 522 162 530 144" fill="none" stroke="#1A0B3D" stroke-width="32" stroke-linecap="round"/>
    <path d="M478 186 C504 176 522 162 530 144" fill="none" stroke="url(#jvm-arm)" stroke-width="22" stroke-linecap="round"/>
    <path d="M520 158 L534 150" stroke="#FFD23A" stroke-width="6" stroke-linecap="round"/>
    <g transform="translate(560 110) rotate(14)">
      <circle cx="4" cy="5" r="38" fill="#8A4A00"/>
      <circle r="38" fill="url(#jvm-coin)" stroke="#9A5200" stroke-width="3"/>
      <circle r="28" fill="none" stroke="#C27800" stroke-width="3.5"/>
      <text y="14" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="40" fill="#C2410C" stroke="#7A2E00" stroke-width="2">7</text>
      <ellipse cx="-13" cy="-15" rx="11" ry="5" fill="#FFFFFF" opacity=".75" transform="rotate(-35 -13 -15)"/>
    </g>
    <ellipse cx="530" cy="138" rx="19" ry="20" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="5"/>
    <ellipse cx="544" cy="124" rx="7" ry="11" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4" transform="rotate(-30 544 124)"/>

    <rect x="300" y="108" width="16" height="26" rx="5" fill="url(#jvm-trim)" stroke="#5A2E00" stroke-width="3.5"/>
    <rect x="300" y="196" width="16" height="26" rx="5" fill="url(#jvm-trim)" stroke="#5A2E00" stroke-width="3.5"/>

    <rect x="310" y="72" width="180" height="182" rx="36" fill="url(#jvm-safe)" stroke="#1A0B3D" stroke-width="6"/>
    <rect x="326" y="88" width="148" height="150" rx="22" fill="url(#jvm-panel)" stroke="#5A2E00" stroke-width="2"/>
    <rect x="326" y="88" width="148" height="150" rx="22" fill="none" stroke="url(#jvm-trim)" stroke-width="7"/>
    <circle cx="334" cy="96" r="5.5" fill="#FFE58A" stroke="#5A2E00" stroke-width="2.5"/>
    <circle cx="466" cy="96" r="5.5" fill="#FFE58A" stroke="#5A2E00" stroke-width="2.5"/>
    <circle cx="334" cy="230" r="5.5" fill="#FFE58A" stroke="#5A2E00" stroke-width="2.5"/>
    <circle cx="466" cy="230" r="5.5" fill="#FFE58A" stroke="#5A2E00" stroke-width="2.5"/>
    <ellipse cx="346" cy="92" rx="26" ry="9" fill="#FFFFFF" opacity=".4" transform="rotate(-16 346 92)"/>

    <g transform="translate(494 164)">
      <circle r="22" fill="#1A0B3D"/>
      <circle r="18" fill="url(#jvm-trim)"/>
      ${ticks}
      <circle r="7" fill="#E11D48" stroke="#5A2E00" stroke-width="2.5"/>
      <circle cx="-2" cy="-2" r="2" fill="#FFFFFF" opacity=".8"/>
    </g>

    <path d="M352 122 Q368 110 386 118" fill="none" stroke="#1A0B3D" stroke-width="5" stroke-linecap="round"/>
    <path d="M414 118 Q432 110 448 122" fill="none" stroke="#1A0B3D" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="373" cy="152" rx="21" ry="26" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4"/>
    <ellipse cx="427" cy="152" rx="21" ry="26" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="4"/>
    <ellipse cx="377" cy="157" rx="12" ry="15" fill="#2B0F5E"/>
    <ellipse cx="431" cy="157" rx="12" ry="15" fill="#2B0F5E"/>
    <circle cx="377" cy="160" r="6.5" fill="#7C3AED"/>
    <circle cx="431" cy="160" r="6.5" fill="#7C3AED"/>
    <circle cx="371" cy="148" r="5.5" fill="#FFFFFF"/>
    <circle cx="425" cy="148" r="5.5" fill="#FFFFFF"/>
    <circle cx="382" cy="166" r="2.5" fill="#FFFFFF"/>
    <circle cx="436" cy="166" r="2.5" fill="#FFFFFF"/>
    <ellipse cx="348" cy="188" rx="12" ry="7" fill="#FFB0C4" opacity=".75"/>
    <ellipse cx="452" cy="188" rx="12" ry="7" fill="#FFB0C4" opacity=".75"/>
    <path d="M366 186 Q400 230 434 186 Q400 198 366 186 Z" fill="#4A0A24" stroke="#1A0B3D" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M386 204 Q400 218 414 204 Q400 208 386 204 Z" fill="#FF6F91"/>
    <path d="M380 190 L382 199 L390 192 Z" fill="#FFFFFF"/>
    <path d="M408 192 L416 199 L419 190 Z" fill="#FFD23A" stroke="#7A4200" stroke-width="1.5"/>

    <g transform="rotate(-12 400 70)">
      <ellipse cx="400" cy="74" rx="66" ry="13" fill="url(#jvm-hat)" stroke="#1A0B3D" stroke-width="5"/>
      <path d="M362 72 L366 16 Q400 8 434 16 L438 72 Q400 80 362 72 Z" fill="url(#jvm-hat)" stroke="#1A0B3D" stroke-width="5" stroke-linejoin="round"/>
      <path d="M364 52 Q400 58 436 52 L437 66 Q400 72 363 66 Z" fill="url(#jvm-trim)" stroke="#5A2E00" stroke-width="3" stroke-linejoin="round"/>
      <path d="M376 22 L374 46" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity=".45"/>
      <g transform="translate(428 40) rotate(16)">
        <rect x="-11" y="-15" width="22" height="30" rx="3" fill="#FFFFFF" stroke="#1A0B3D" stroke-width="3"/>
        <path d="M0 6 C-8 0 -8 -7 -3 -7 C-1 -7 0 -5 0 -4 C0 -5 1 -7 3 -7 C8 -7 8 0 0 6 Z" fill="#E11D48"/>
      </g>
    </g>
  </g>

  <g transform="translate(0 ${show777 ? 0 : 12})" style="filter:drop-shadow(0 8px 12px rgba(10,2,40,.6))">
    ${word("JACK", 352, 166, 410, "#2A0A00", "#5A2200", "#3A1200", "jvm-goldEdge", "jvm-gold")}
  </g>
  ${ribbon}
  <g transform="translate(0 ${show777 ? 0 : -22})" style="filter:drop-shadow(0 8px 12px rgba(10,2,40,.6))">
    ${word("VAULT", 528, 146, 480, "#04102E", "#0A2766", "#071A4A", "jvm-gemEdge", "jvm-gem")}
  </g>

  ${frontCoins}
  ${gems}
  ${sparks}
</svg>`;
}
