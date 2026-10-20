/**
 * Final symbol art for Crown of the Cosmos: 12 illustrated symbols on a 256x256
 * canvas, lit from the upper left (design-source Prompt 4). Pure SVG, so it stays
 * sharp on any screen and ships inside the single-file demo with no image files.
 *
 * Special symbols carry an empty ribbon; the word on it is drawn by the game in
 * the UI font (an SVG used as an image cannot load web fonts).
 */
import type { Sym } from "../api/types";

/** Ribbon centre (y) and height on the 256 canvas, for the label drawn over the art. */
export const RIBBON = { y: 212, h: 40, w: 196 };

const SPARK = (x: number, y: number, r: number, o = 1) =>
  `<path d="M${x} ${y - r}Q${x + r * 0.14} ${y - r * 0.14} ${x + r} ${y}Q${x + r * 0.14} ${y + r * 0.14} ${x} ${y + r}Q${x - r * 0.14} ${y + r * 0.14} ${x - r} ${y}Q${x - r * 0.14} ${y - r * 0.14} ${x} ${y - r}Z" fill="#fff" opacity="${o}"/>`;

const GLOW = (id: string, sd: number) =>
  `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

const DROP = `<filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".55"/></filter>`;

function svg(body: string, defs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs>${DROP}${defs}</defs>${body}</svg>`;
}

/** Ribbon banner across the bottom for WILD / FREE SPINS / BONUS. */
function ribbon(c2: string, edge: string) {
  const { y, h, w } = RIBBON;
  const x0 = 128 - w / 2, x1 = 128 + w / 2, t = y - h / 2, b = y + h / 2;
  return `<g filter="url(#drop)">
    <path d="M${x0 - 6} ${t + 8}L${x0 + 18} ${t + 8}L${x0 + 18} ${b + 6}L${x0 - 6} ${b + 6}L${x0 + 6} ${y + 7}Z" fill="${c2}" opacity=".9"/>
    <path d="M${x1 + 6} ${t + 8}L${x1 - 18} ${t + 8}L${x1 - 18} ${b + 6}L${x1 + 6} ${b + 6}L${x1 - 6} ${y + 7}Z" fill="${c2}" opacity=".9"/>
    <path d="M${x0 + 6} ${t}Q128 ${t - 8} ${x1 - 6} ${t}L${x1 - 6} ${b}Q128 ${b - 8} ${x0 + 6} ${b}Z" fill="url(#rib)" stroke="${edge}" stroke-width="3"/>
    <path d="M${x0 + 12} ${t + 5}Q128 ${t - 3} ${x1 - 12} ${t + 5}" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none"/>
  </g>`;
}
const ribbonGrad = (c1: string, c2: string) =>
  `<linearGradient id="rib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;

// ------------------------------------------------------------------ high pay

const CROWN = svg(`
  <ellipse cx="128" cy="150" rx="100" ry="84" fill="#F5B301" opacity=".28" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <path d="M40 196L30 84L84 128L128 44L172 128L226 84L216 196Z" fill="url(#gold)" stroke="#7A4A00" stroke-width="5" stroke-linejoin="round"/>
    <path d="M40 196L30 84L84 128L128 44L128 196Z" fill="#fff" opacity=".16"/>
    <path d="M48 186L42 104L84 140L128 66" fill="none" stroke="#FFF6C8" stroke-width="3" stroke-linecap="round" opacity=".8"/>
    <rect x="34" y="176" width="188" height="40" rx="10" fill="url(#band)" stroke="#7A4A00" stroke-width="5"/>
    <rect x="42" y="181" width="172" height="7" rx="3.5" fill="#FFF6C8" opacity=".55"/>
    <circle cx="30" cy="84" r="13" fill="url(#pearl)" stroke="#7A4A00" stroke-width="4"/>
    <circle cx="226" cy="84" r="13" fill="url(#pearl)" stroke="#7A4A00" stroke-width="4"/>
    <circle cx="128" cy="40" r="15" fill="url(#pearl)" stroke="#7A4A00" stroke-width="4"/>
    <path d="M128 96L150 128L128 160L106 128Z" fill="url(#ruby)" stroke="#5A0614" stroke-width="4" stroke-linejoin="round"/>
    <path d="M128 96L150 128L128 128L106 128Z" fill="#fff" opacity=".28"/>
    <circle cx="80" cy="152" r="12" fill="url(#sap)" stroke="#0B2A55" stroke-width="3.5"/>
    <circle cx="176" cy="152" r="12" fill="url(#sap)" stroke="#0B2A55" stroke-width="3.5"/>
    <ellipse cx="128" cy="196" rx="15" ry="11" fill="url(#ame)" stroke="#2E1065" stroke-width="3.5"/>
    <ellipse cx="74" cy="196" rx="11" ry="9" fill="url(#emer)" stroke="#053B2C" stroke-width="3"/>
    <ellipse cx="182" cy="196" rx="11" ry="9" fill="url(#emer)" stroke="#053B2C" stroke-width="3"/>
    <circle cx="123" cy="191" r="3.5" fill="#fff" opacity=".85"/><circle cx="70" cy="192" r="2.6" fill="#fff" opacity=".85"/><circle cx="178" cy="192" r="2.6" fill="#fff" opacity=".85"/>
    <circle cx="76" cy="148" r="3.2" fill="#fff" opacity=".85"/><circle cx="172" cy="148" r="3.2" fill="#fff" opacity=".85"/>
    <circle cx="124" cy="35" r="4.5" fill="#fff"/><circle cx="26" cy="80" r="3.6" fill="#fff"/><circle cx="222" cy="80" r="3.6" fill="#fff"/>
  </g>
  ${SPARK(196, 46, 14)}${SPARK(58, 50, 8, 0.8)}`,
  `${GLOW("g18", 18)}
  <linearGradient id="gold" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#FFF1A8"/><stop offset=".35" stop-color="#FFC928"/><stop offset=".75" stop-color="#E08A00"/><stop offset="1" stop-color="#9A5800"/></linearGradient>
  <linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset=".5" stop-color="#E9A100"/><stop offset="1" stop-color="#8A5000"/></linearGradient>
  <radialGradient id="pearl" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#FFE9B0"/><stop offset="1" stop-color="#D99A20"/></radialGradient>
  <radialGradient id="ruby" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF8DA1"/><stop offset=".45" stop-color="#E11D48"/><stop offset="1" stop-color="#6A0418"/></radialGradient>
  <radialGradient id="sap" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#BDE7FF"/><stop offset=".45" stop-color="#22A6EE"/><stop offset="1" stop-color="#0B3A80"/></radialGradient>
  <radialGradient id="ame" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#E9D5FF"/><stop offset=".45" stop-color="#9F5BF6"/><stop offset="1" stop-color="#3B0D7A"/></radialGradient>
  <radialGradient id="emer" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#B9FBDF"/><stop offset=".45" stop-color="#10B981"/><stop offset="1" stop-color="#044E36"/></radialGradient>`);

const GEM = svg(`
  <ellipse cx="128" cy="130" rx="96" ry="90" fill="#8B5CF6" opacity=".38" filter="url(#g18)"/>
  <g filter="url(#drop)" stroke="#2A0B63" stroke-width="3.5" stroke-linejoin="round">
    <path d="M78 52H178L226 104L128 224L30 104Z" fill="#4C1D95"/>
    <path d="M78 52L98 104H30Z" fill="#C4B5FD"/>
    <path d="M78 52H128L98 104Z" fill="#DDD6FE"/>
    <path d="M128 52H178L158 104Z" fill="#A78BFA"/>
    <path d="M178 52L226 104H158Z" fill="#7C3AED"/>
    <path d="M128 52L158 104H98Z" fill="#EDE9FE"/>
    <path d="M30 104H98L128 224Z" fill="#8B5CF6"/>
    <path d="M98 104H158L128 224Z" fill="#6D28D9"/>
    <path d="M158 104H226L128 224Z" fill="#4C1D95"/>
    <path d="M98 104L128 224L114 104Z" fill="#A78BFA" stroke="none" opacity=".6"/>
  </g>
  <path d="M86 60H124L104 96Z" fill="#fff" opacity=".55"/>
  <path d="M44 108H92L118 196Z" fill="#fff" opacity=".18"/>
  ${SPARK(84, 64, 18)}${SPARK(190, 150, 9, 0.85)}${SPARK(150, 36, 7, 0.7)}`,
  GLOW("g18", 18));

const PLANET = svg(`
  <circle cx="128" cy="128" r="94" fill="#14B8A6" opacity=".28" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <g transform="rotate(-16 128 126)">
      <path d="M22 126A106 30 0 0 1 234 126" fill="none" stroke="url(#ringB)" stroke-width="15"/>
    </g>
    <circle cx="128" cy="124" r="70" fill="url(#ball)" stroke="#053B33" stroke-width="4"/>
    <g clip-path="url(#ballClip)">
      <path d="M50 92C90 80 160 80 210 96" stroke="#F5B301" stroke-width="12" fill="none" opacity=".7"/>
      <path d="M50 122C96 110 162 112 206 126" stroke="#5EEAD4" stroke-width="9" fill="none" opacity=".5"/>
      <path d="M56 152C100 142 156 146 200 158" stroke="#F5B301" stroke-width="7" fill="none" opacity=".55"/>
      <ellipse cx="152" cy="136" rx="14" ry="8" fill="#B45309" opacity=".55"/>
      <circle cx="128" cy="124" r="70" fill="url(#shade)"/>
    </g>
    <ellipse cx="100" cy="86" rx="22" ry="13" fill="#fff" opacity=".35" transform="rotate(-30 100 86)"/>
    <g transform="rotate(-16 128 126)">
      <path d="M22 126A106 30 0 0 0 234 126" fill="none" stroke="url(#ringF)" stroke-width="15"/>
      <path d="M30 132A98 25 0 0 0 226 132" fill="none" stroke="#FFF6C8" stroke-width="2.5" opacity=".7"/>
    </g>
  </g>
  ${SPARK(214, 52, 12)}${SPARK(44, 62, 7, 0.75)}<circle cx="200" cy="206" r="3" fill="#fff" opacity=".8"/>`,
  `${GLOW("g18", 18)}
  <clipPath id="ballClip"><circle cx="128" cy="124" r="68"/></clipPath>
  <radialGradient id="ball" cx=".32" cy=".28" r=".85"><stop offset="0" stop-color="#99F6E4"/><stop offset=".35" stop-color="#14B8A6"/><stop offset=".8" stop-color="#0F5F57"/><stop offset="1" stop-color="#06302B"/></radialGradient>
  <radialGradient id="shade" cx=".3" cy=".25" r=".95"><stop offset=".55" stop-color="#011A16" stop-opacity="0"/><stop offset="1" stop-color="#011A16" stop-opacity=".75"/></radialGradient>
  <linearGradient id="ringF" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFE27A"/><stop offset=".5" stop-color="#F5B301"/><stop offset="1" stop-color="#B87400"/></linearGradient>
  <linearGradient id="ringB" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8A5600"/><stop offset="1" stop-color="#C98A10"/></linearGradient>`);

const COMET = svg(`
  <circle cx="164" cy="92" r="70" fill="#FF7A1A" opacity=".4" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <path d="M150 64C110 90 60 140 22 232C80 190 126 160 186 118Z" fill="url(#tail1)"/>
    <path d="M154 80C120 112 84 160 56 220C100 182 140 150 180 120Z" fill="url(#tail2)"/>
    <path d="M164 92C140 120 118 150 98 186C130 160 156 140 176 120Z" fill="#FFF3E0" opacity=".75"/>
    <circle cx="168" cy="92" r="42" fill="url(#head)" stroke="#7A2A00" stroke-width="4"/>
    <circle cx="168" cy="92" r="28" fill="url(#core)"/>
    <ellipse cx="154" cy="76" rx="13" ry="8" fill="#fff" opacity=".85" transform="rotate(-35 154 76)"/>
  </g>
  <circle cx="70" cy="128" r="4" fill="#FFD27A"/><circle cx="104" cy="196" r="3" fill="#FFB066"/><circle cx="46" cy="184" r="2.5" fill="#FFD27A"/>
  <circle cx="122" cy="150" r="2.5" fill="#fff"/>
  ${SPARK(222, 40, 12)}${SPARK(214, 168, 7, 0.7)}`,
  `${GLOW("g18", 18)}
  <linearGradient id="tail1" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF7A1A"/><stop offset=".6" stop-color="#E11D48" stop-opacity=".55"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/></linearGradient>
  <linearGradient id="tail2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset=".7" stop-color="#FF7A1A" stop-opacity=".5"/><stop offset="1" stop-color="#FF7A1A" stop-opacity="0"/></linearGradient>
  <radialGradient id="head" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#FFE4B0"/><stop offset=".4" stop-color="#FF8A1A"/><stop offset="1" stop-color="#A02A00"/></radialGradient>
  <radialGradient id="core" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#FFF0C0" stop-opacity=".9"/><stop offset="1" stop-color="#FFB066" stop-opacity="0"/></radialGradient>`);

// ------------------------------------------------------------------ low pay: carved crystal letters

const LETTERS: Record<"A" | "K" | "Q" | "J" | "TEN", string> = {
  A: "M128 34L208 216H164L151 182H105L92 216H48ZM128 102L114 146H142Z",
  K: "M58 38H104V110L160 38H212L146 122L216 218H162L104 136V218H58Z",
  Q: "M128 34C176 34 208 74 208 124C208 174 176 214 128 214C80 214 48 174 48 124C48 74 80 34 128 34ZM128 74C104 74 92 96 92 124C92 152 104 174 128 174C152 174 164 152 164 124C164 96 152 74 128 74ZM154 170L182 148L226 206L194 230Z",
  J: "M104 38H190V160C190 202 164 222 124 222C88 222 62 204 54 170L98 158C102 174 110 182 124 182C138 182 144 172 144 156V78H104Z",
  TEN: "M44 76L94 42H122V216H80V98L44 116ZM182 40C214 40 232 76 232 128C232 180 214 216 182 216C150 216 132 180 132 128C132 76 150 40 182 40ZM182 78C172 78 170 102 170 128C170 154 172 178 182 178C192 178 194 154 194 128C194 102 192 78 182 78Z",
};

const LETTER_COLORS: Record<keyof typeof LETTERS, [string, string, string, string]> = {
  // light, mid, deep, outline
  A: ["#FFC1C9", "#F43F5E", "#7F0A22", "#3A0410"],
  K: ["#CFFAFE", "#22D3EE", "#0E5A73", "#042833"],
  Q: ["#EDE9FE", "#A78BFA", "#4C1D95", "#1E0B4A"],
  J: ["#D1FAE5", "#34D399", "#065F46", "#022C20"],
  TEN: ["#FEF3C7", "#FBBF24", "#92400E", "#3D1A03"],
};

function letter(k: keyof typeof LETTERS): string {
  const d = LETTERS[k];
  const [l, m, deep, o] = LETTER_COLORS[k];
  return svg(`
    <path d="${d}" fill="${m}" opacity=".45" filter="url(#g12)"/>
    <g filter="url(#drop)">
      <path d="${d}" fill="${o}" stroke="${o}" stroke-width="12" stroke-linejoin="round"/>
      <path d="${d}" fill="url(#cr)"/>
      <g clip-path="url(#lc)">
        <path d="M0 0H256L0 150Z" fill="#fff" opacity=".22"/>
        <path d="M0 150L256 0V40L0 190Z" fill="#fff" opacity=".1"/>
        <path d="M256 256H0L256 120Z" fill="#000" opacity=".22"/>
      </g>
      <path d="${d}" fill="none" stroke="${l}" stroke-width="3" stroke-linejoin="round" opacity=".9"/>
    </g>
    ${SPARK(k === "TEN" ? 112 : 78, 54, 13)}`,
    `${GLOW("g12", 12)}
    <clipPath id="lc"><path d="${d}"/></clipPath>
    <linearGradient id="cr" x1=".1" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${l}"/><stop offset=".45" stop-color="${m}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`);
}

// ------------------------------------------------------------------ specials

function starPath(cx: number, cy: number, r1: number, r2: number) {
  let p = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? r2 : r1;
    p += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return p + "Z";
}

function rays(cx: number, cy: number, n: number, r0: number, r1: number, w: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    const b = a + w, c = a - w;
    s += `M${cx + r0 * Math.cos(a)} ${cy + r0 * Math.sin(a)}L${cx + r1 * Math.cos(b)} ${cy + r1 * Math.sin(b)}L${cx + r1 * Math.cos(c)} ${cy + r1 * Math.sin(c)}Z`;
  }
  return s;
}

const WILD = svg(`
  <path d="${rays(128, 100, 16, 20, 130, 0.07)}" fill="url(#ray)" opacity=".5"/>
  <circle cx="128" cy="100" r="74" fill="#FFE27A" opacity=".45" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <path d="${starPath(128, 102, 86, 38)}" fill="url(#star)" stroke="#8A4B00" stroke-width="5" stroke-linejoin="round"/>
    <path d="${starPath(128, 102, 62, 27)}" fill="none" stroke="#FFF6C8" stroke-width="3" stroke-linejoin="round" opacity=".7"/>
    <path d="M128 16L148 74L128 102Z M42 75L104 75L128 102Z" fill="#fff" opacity=".28"/>
    <circle cx="128" cy="102" r="17" fill="url(#core)" stroke="#8A4B00" stroke-width="3"/>
    <circle cx="123" cy="97" r="5" fill="#fff"/>
  </g>
  ${ribbon("#4C1D95", "#FFE27A")}
  ${SPARK(214, 40, 14)}${SPARK(40, 150, 8, 0.8)}`,
  `${GLOW("g18", 18)}${ribbonGrad("#A855F7", "#5B21B6")}
  <radialGradient id="ray" cx=".5" cy=".4" r=".55"><stop offset="0" stop-color="#FFF6C8"/><stop offset="1" stop-color="#FFE27A" stop-opacity="0"/></radialGradient>
  <linearGradient id="star" x1=".2" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="#FFF8D0"/><stop offset=".4" stop-color="#FFD23A"/><stop offset=".8" stop-color="#F59E0B"/><stop offset="1" stop-color="#B45309"/></linearGradient>
  <radialGradient id="core" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#F5D0FE"/><stop offset=".5" stop-color="#C026D3"/><stop offset="1" stop-color="#581C87"/></radialGradient>`);

function spiralArms() {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += `<path d="M128 100C150 72 196 80 200 118C204 150 178 170 150 168" fill="none" stroke="url(#arm)" stroke-width="${14 - i}" stroke-linecap="round" transform="rotate(${i * 90} 128 100)" opacity=".9"/>`;
  }
  return s;
}

const SCATTER = svg(`
  <circle cx="128" cy="100" r="92" fill="#22D3EE" opacity=".35" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <circle cx="128" cy="100" r="84" fill="url(#void)" stroke="url(#rim)" stroke-width="8"/>
    <circle cx="128" cy="100" r="76" fill="none" stroke="#A5F3FC" stroke-width="1.5" stroke-dasharray="3 9" opacity=".8"/>
    <g clip-path="url(#portal)">
      <g transform="rotate(-18 128 100)">${spiralArms()}</g>
      <g transform="rotate(27 128 100) scale(1)" opacity=".55" filter="url(#g3)">${spiralArms()}</g>
      <circle cx="128" cy="100" r="30" fill="url(#coreS)"/>
      <circle cx="80" cy="70" r="2" fill="#fff"/><circle cx="170" cy="130" r="1.6" fill="#fff"/><circle cx="160" cy="58" r="1.4" fill="#fff"/><circle cx="92" cy="142" r="1.8" fill="#fff"/><circle cx="186" cy="92" r="1.2" fill="#fff"/>
    </g>
    <path d="M62 52A84 84 0 0 1 150 20" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".65"/>
  </g>
  ${ribbon("#0B4A5C", "#A5F3FC")}
  ${SPARK(218, 36, 13)}${SPARK(38, 168, 7, 0.8)}`,
  `${GLOW("g18", 18)}${GLOW("g3", 3)}${ribbonGrad("#0EA5C6", "#0B4A6E")}
  <clipPath id="portal"><circle cx="128" cy="100" r="80"/></clipPath>
  <radialGradient id="void" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="#1E3A8A"/><stop offset=".7" stop-color="#170F45"/><stop offset="1" stop-color="#05030F"/></radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#CFFAFE"/><stop offset=".5" stop-color="#22D3EE"/><stop offset="1" stop-color="#7C3AED"/></linearGradient>
  <linearGradient id="arm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ECFEFF"/><stop offset=".5" stop-color="#22D3EE"/><stop offset="1" stop-color="#A78BFA" stop-opacity=".2"/></linearGradient>
  <radialGradient id="coreS" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#CFFAFE"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></radialGradient>`);

function wheelSegs() {
  const cols = ["#E11D48", "#F5B301", "#7C3AED", "#22D3EE", "#E11D48", "#F5B301", "#7C3AED", "#10B981"];
  const cx = 128, cy = 102, r = 66;
  let s = "";
  for (let i = 0; i < 8; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 4 - Math.PI / 8, a1 = a0 + Math.PI / 4;
    s += `<path d="M${cx} ${cy}L${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy + r * Math.sin(a0)).toFixed(1)}A${r} ${r} 0 0 1 ${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)}Z" fill="${cols[i]}" stroke="#5A3300" stroke-width="2.5"/>`;
  }
  let bulbs = "";
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    bulbs += `<circle cx="${(cx + 78 * Math.cos(a)).toFixed(1)}" cy="${(cy + 78 * Math.sin(a)).toFixed(1)}" r="4.2" fill="${i % 2 ? "#FFF6C8" : "#fff"}"/>`;
  }
  return { s, bulbs };
}

const BONUS = (() => {
  const w = wheelSegs();
  return svg(`
  <circle cx="128" cy="102" r="92" fill="#F5B301" opacity=".35" filter="url(#g18)"/>
  <g filter="url(#drop)">
    <circle cx="128" cy="102" r="86" fill="url(#rimG)" stroke="#6B3E00" stroke-width="4"/>
    <circle cx="128" cy="102" r="70" fill="#2A1800"/>
    ${w.s}
    <g clip-path="url(#wc)"><path d="M40 20H216L40 150Z" fill="#fff" opacity=".2"/></g>
    ${w.bulbs}
    <circle cx="128" cy="102" r="20" fill="url(#hub)" stroke="#6B3E00" stroke-width="4"/>
    <circle cx="122" cy="96" r="5" fill="#fff" opacity=".9"/>
    <path d="M112 8H144L128 36Z" fill="url(#hub)" stroke="#6B3E00" stroke-width="4" stroke-linejoin="round"/>
  </g>
  ${ribbon("#7A4A00", "#FFE27A")}
  ${SPARK(220, 34, 13)}${SPARK(36, 150, 8, 0.8)}`,
    `${GLOW("g18", 18)}${ribbonGrad("#F5B301", "#9A5800")}
  <clipPath id="wc"><circle cx="128" cy="102" r="66"/></clipPath>
  <linearGradient id="rimG" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#FFF1A8"/><stop offset=".45" stop-color="#F5B301"/><stop offset="1" stop-color="#8A5000"/></linearGradient>
  <radialGradient id="hub" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FFF6C8"/><stop offset=".5" stop-color="#F5B301"/><stop offset="1" stop-color="#8A5000"/></radialGradient>`);
})();

export const SYMBOL_SVG: Record<Sym, string> = {
  CROWN, GEM, PLANET, COMET,
  A: letter("A"), K: letter("K"), Q: letter("Q"), J: letter("J"), TEN: letter("TEN"),
  WILD, SCATTER, BONUS,
};

/** Text drawn on the ribbon of a special symbol. */
export const RIBBON_LABEL: Partial<Record<Sym, string>> = { WILD: "WILD", SCATTER: "FREE SPINS", BONUS: "BONUS" };

export const svgUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

/** Loads every symbol as an image, ready for canvas drawing. */
export function loadSymbolArt(): Promise<Partial<Record<Sym, HTMLImageElement>>> {
  const out: Partial<Record<Sym, HTMLImageElement>> = {};
  return Promise.all(
    (Object.keys(SYMBOL_SVG) as Sym[]).map(
      (k) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.onload = () => {
            out[k] = img;
            res();
          };
          img.onerror = () => res();
          img.src = svgUrl(SYMBOL_SVG[k]);
        }),
    ),
  ).then(() => out);
}
