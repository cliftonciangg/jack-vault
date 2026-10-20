/**
 * Full-screen space backdrop for Crown of the Cosmos (Prompt 3, BACKGROUND):
 * nebula clouds, a ringed gas giant, a small moon, distant stars and two jet
 * contrails. Generated as SVG from a fixed seed, so it is identical on every load,
 * sharp at any size and costs no image download. The live twinkling stars are
 * drawn on top by ui/stars.ts.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stars(w: number, h: number, n: number, seed: number) {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = (r() * w).toFixed(1), y = (r() * h).toFixed(1);
    const big = r() < 0.08;
    const rad = big ? 1.1 + r() * 0.8 : 0.35 + r() * 0.6;
    const tint = r() < 0.2 ? "#C4B5FD" : r() < 0.15 ? "#A5F3FC" : "#fff";
    s += `<circle cx="${x}" cy="${y}" r="${rad.toFixed(2)}" fill="${tint}" opacity="${(0.35 + r() * 0.6).toFixed(2)}"/>`;
  }
  return s;
}

export function backgroundSvg(w = 390, h = 844): string {
  const m = Math.min(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A1050"/><stop offset=".45" stop-color="#0E0A2C"/><stop offset="1" stop-color="#05030C"/></linearGradient>
  <filter id="b40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="b18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="b2"><feGaussianBlur stdDeviation="1.2"/></filter>
  <radialGradient id="giant" cx=".3" cy=".3" r=".8"><stop offset="0" stop-color="#F0ABFC"/><stop offset=".35" stop-color="#A21CAF"/><stop offset=".75" stop-color="#3B0764"/><stop offset="1" stop-color="#12052A"/></radialGradient>
  <radialGradient id="moon" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#CFFAFE"/><stop offset=".5" stop-color="#3B82B6"/><stop offset="1" stop-color="#0B1E3D"/></radialGradient>
  <linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="#C4B5FD" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient>
  <linearGradient id="trail2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF7A1A" stop-opacity="0"/><stop offset=".9" stop-color="#FFB066" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>
  <clipPath id="gc"><circle cx="${w * 0.92}" cy="${h * 0.86}" r="${m * 0.42}"/></clipPath>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
<g filter="url(#b40)">
  <ellipse cx="${w * 0.18}" cy="${h * 0.14}" rx="${w * 0.5}" ry="${h * 0.12}" fill="#7C3AED" opacity=".55"/>
  <ellipse cx="${w * 0.85}" cy="${h * 0.32}" rx="${m * 0.42}" ry="${h * 0.14}" fill="#C026D3" opacity=".32"/>
  <ellipse cx="${m * 0.1}" cy="${h * 0.62}" rx="${w * 0.45}" ry="${h * 0.12}" fill="#0D9488" opacity=".28"/>
  <ellipse cx="${w * 0.6}" cy="${h * 0.05}" rx="${w * 0.35}" ry="${h * 0.06}" fill="#2563EB" opacity=".35"/>
  <ellipse cx="${w * 0.45}" cy="${h * 0.9}" rx="${w * 0.6}" ry="${h * 0.1}" fill="#4C1D95" opacity=".45"/>
</g>
<path d="M${-w * 0.2} ${h * 0.55} Q${w * 0.4} ${h * 0.3} ${w * 1.2} ${h * 0.08}" stroke="#A78BFA" stroke-width="${w * 0.22}" opacity=".12" fill="none" filter="url(#b18)"/>
${stars(w, h, 260, 777)}
<g opacity=".95">
  <circle cx="${w * 0.92}" cy="${h * 0.86}" r="${m * 0.42}" fill="#C026D3" opacity=".25" filter="url(#b18)"/>
  <circle cx="${w * 0.92}" cy="${h * 0.86}" r="${m * 0.42}" fill="url(#giant)"/>
  <g clip-path="url(#gc)" opacity=".35">
    <path d="M${w * 0.4} ${h * 0.78} Q${w * 0.9} ${h * 0.74} ${w * 1.4} ${h * 0.8}" stroke="#F0ABFC" stroke-width="10" fill="none"/>
    <path d="M${w * 0.4} ${h * 0.84} Q${w * 0.9} ${h * 0.8} ${w * 1.4} ${h * 0.86}" stroke="#7E22CE" stroke-width="16" fill="none"/>
    <path d="M${w * 0.4} ${h * 0.9} Q${w * 0.9} ${h * 0.87} ${w * 1.4} ${h * 0.93}" stroke="#F0ABFC" stroke-width="6" fill="none"/>
  </g>
  <ellipse cx="${w * 0.92}" cy="${h * 0.86}" rx="${m * 0.72}" ry="${m * 0.1}" fill="none" stroke="#FFE27A" stroke-opacity=".55" stroke-width="5" transform="rotate(-14 ${w * 0.92} ${h * 0.86})"/>
  <ellipse cx="${w * 0.92}" cy="${h * 0.86}" rx="${m * 0.64}" ry="${m * 0.085}" fill="none" stroke="#F5B301" stroke-opacity=".3" stroke-width="9" transform="rotate(-14 ${w * 0.92} ${h * 0.86})"/>
</g>
<circle cx="${w * 0.88}" cy="${h * 0.075}" r="${m * 0.045}" fill="#22D3EE" opacity=".3" filter="url(#b18)"/>
<circle cx="${w * 0.88}" cy="${h * 0.075}" r="${m * 0.04}" fill="url(#moon)"/>
<circle cx="${w * 0.08}" cy="${h * 0.45}" r="${m * 0.018}" fill="url(#moon)" opacity=".8"/>
<g transform="rotate(-24 ${w * 0.5} ${h * 0.5})">
  <rect x="${-w * 0.2}" y="${h * 0.36}" width="${w * 0.75}" height="1.6" fill="url(#trail)"/>
  <rect x="${-w * 0.2}" y="${h * 0.364}" width="${w * 0.75}" height="1.2" fill="url(#trail)" opacity=".6"/>
  <circle cx="${w * 0.55}" cy="${h * 0.3615}" r="2.2" fill="#fff" filter="url(#b2)"/>
  <rect x="${w * 0.25}" y="${h * 0.66}" width="${w * 0.6}" height="1.4" fill="url(#trail2)"/>
  <circle cx="${w * 0.85}" cy="${h * 0.6607}" r="2" fill="#FFE4B0" filter="url(#b2)"/>
</g>
<rect width="${w}" height="${h}" fill="#06040F" opacity=".18"/>
</svg>`;
}

const cache = new Map<string, string>();
/** CSS url() value for the backdrop in the given orientation. */
export function backgroundUrl(landscape: boolean): string {
  const key = landscape ? "l" : "p";
  let u = cache.get(key);
  if (!u) {
    u = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(landscape ? backgroundSvg(900, 420) : backgroundSvg())}")`;
    cache.set(key, u);
  }
  return u;
}
