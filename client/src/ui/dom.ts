export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el as HTMLElement;
}

/** [CURRENCY]: coins with 2 decimals, e.g. 1,250.00 */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const svg = (d: string, extra = 'fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="square"', size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${extra} aria-hidden="true"><path d="${d}"/></svg>`;

/** Icon set from Icons.dc.html / Reels.dc.html. */
export const ICON = {
  menu: (s = 22) => svg("M3 6h18M3 12h13M3 18h18", undefined, s),
  info: (s = 22) => svg("M12 2l10 10-10 10L2 12zM12 11v6M12 7v1", undefined, s),
  turbo: (s = 22) => svg("M13 2L4 14h7l-1 8 10-13h-7z", 'fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="miter"', s),
  auto: (s = 22) => svg("M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M20 12a8 8 0 0 1-14 5.3M6 21v-4h4M10 9l5 3-5 3z", undefined, s),
  close: (s = 22) => svg("M5 5l14 14M19 5L5 19", undefined, s),
  back: (s = 22) => svg("M15 4l-8 8 8 8", undefined, s),
  soundOn: (s = 22) => svg("M3 9h4l5-4v14l-5-4H3zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14", undefined, s),
  soundOff: (s = 22) => svg("M3 9h4l5-4v14l-5-4H3zM16 9l6 6M22 9l-6 6", undefined, s),
  spin: `<svg class="ico" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#0B0820" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></svg>`,
  wheel: (s = 14, c = "#F5B301") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>`,
  star: (s = 18, c = "#FFFFFF") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}" aria-hidden="true"><path d="M12 2l2.5 7h7l-5.6 4.2 2.1 7L12 16l-6 4.2 2.1-7L2.5 9h7z"/></svg>`,
  crown: (s = 64, id = "cg") => `<svg width="${s}" height="${s * 0.625}" viewBox="0 0 64 40" aria-hidden="true" style="filter: drop-shadow(0 0 12px rgba(245,179,1,.7))"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset=".6" stop-color="#F5B301"/><stop offset="1" stop-color="#B87400"/></linearGradient></defs><path d="M4 36L6 8l14 12 12-18 12 18 14-12 2 28z" fill="url(#${id})" stroke="#FFF3E0" stroke-width="1.5"/><circle cx="32" cy="24" r="4" fill="#8B5CF6"/><circle cx="16" cy="28" r="3" fill="#22D3EE"/><circle cx="48" cy="28" r="3" fill="#22D3EE"/></svg>`,
  home: (s = 22) => svg("M3 11l9-8 9 8v10h-6v-6H9v6H3z", undefined, s),
  gift: (s = 22) => svg("M3 10h18v4H3zM5 14h14v7H5zM12 10v11M12 10s-4-6-6-3 6 3 6 3 8 0 6-3-6 3-6 3", undefined, s),
  history: (s = 22) => svg("M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 3", undefined, s),
  user: (s = 22) => svg("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", undefined, s),
  grid: (s = 22) => svg("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", undefined, s),
  coin: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#F5B301" stroke="#FFE27A" stroke-width="2"/><path d="M12 7v10M9 9.5h4.5a1.8 1.8 0 0 1 0 3.5H10a1.8 1.8 0 0 0 0 3.5h4.5" fill="none" stroke="#7A4E00" stroke-width="1.6"/></svg>`,
  plug: (s = 26) => svg("M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3", 'fill="none" stroke="#22D3EE" stroke-width="2" stroke-linecap="round"', s),
  alert: (s = 26, c = "#F59E0B") => svg("M12 3l10 18H2zM12 10v5M12 17.5v.5", `fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"`, s),
};

export function haptic(pattern: number | number[]) {
  try {
    if (settings.haptics && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

export interface Settings {
  sound: boolean;
  volume: number;
  turbo: boolean;
  haptics: boolean;
  lefty: boolean;
  saver: boolean;
  betIndex: number;
}

const SETTINGS_KEY = "jackvault.settings";
export const settings: Settings = (() => {
  const d: Settings = { sound: true, volume: 70, turbo: false, haptics: true, lefty: false, saver: false, betIndex: 2 };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return d;
  }
})();
export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* not persisted */
  }
}
