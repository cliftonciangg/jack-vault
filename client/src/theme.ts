/**
 * Design tokens and symbol art specs, copied from the Claude Design canvas
 * (design-source/project/Tokens.dc.html and Symbols.dc.html). Change values here,
 * not in components.
 */
import type { JackpotTier, Sym } from "./api/types";

export const C = {
  bgBase: "#0B0820", bgRaised: "#151030", bgOverlay: "#1F1844",
  lineNeon: "#2E2560", lineStrong: "#3B2F7A",
  violet: "#8B5CF6", violet600: "#7C3AED", violetGlow: "#A78BFA", cyan: "#22D3EE",
  burn500: "#FF7A1A", burn100: "#FFF3E0",
  gold100: "#FFE27A", gold500: "#F5B301", gold800: "#B87400",
  success: "#22C55E", warning: "#F59E0B", error: "#EF4444", disabled: "#6B6690",
  text: "#FFFFFF", text2: "#B9B3D9", muted: "#8A83AD",
} as const;

export const JP_STYLE: Record<JackpotTier, { bg: string; accent: string; light: string }> = {
  GRAND: { bg: "linear-gradient(160deg,#FFC94A,#E11D2E 55%,#7A0A14)", accent: "#E11D2E", light: "#FFE27A" },
  MAJOR: { bg: "linear-gradient(160deg,#F0ABFC,#C026D3 50%,#6D28D9)", accent: "#C026D3", light: "#F0ABFC" },
  MINOR: { bg: "linear-gradient(160deg,#67E8F9,#2563EB 50%,#1E3A8A)", accent: "#2563EB", light: "#67E8F9" },
  MINI: { bg: "linear-gradient(160deg,#6EE7B7,#0D9488 50%,#065F46)", accent: "#0D9488", light: "#6EE7B7" },
};

/** Payline colours, cycled over lines 1-25 (Reels.dc.html). */
export const LINE_COLORS = ["#F5B301", "#22D3EE", "#A78BFA", "#4ADE80", "#FF7A1A", "#F87171", "#FBBF24", "#F0ABFC", "#67E8F9", "#6EE7B7"];
export const lineColor = (line: number) => LINE_COLORS[(line - 1) % LINE_COLORS.length];

export interface SymbolArt {
  name: string;
  label: string;
  /** SVG path on a 24x24 viewBox. */
  d: string;
  fill: string | null;
  ink: string;
  /** Tile background: [centre, edge] of a radial gradient, or one flat colour. */
  bg: [string, string] | string;
  tier: "HIGH" | "LOW" | "SPECIAL";
}

export const SYMBOL_ART: Record<Sym, SymbolArt> = {
  CROWN: { name: "Crown", label: "CROWN", d: "M3 18L4 7l5 5 3-8 3 8 5-5 1 11z", fill: "#F5B301", ink: "#FFE27A", bg: ["#3B2A05", "#1A1203"], tier: "HIGH" },
  GEM: { name: "Gemstone", label: "GEM", d: "M12 3l7 6-7 12-7-12z M5 9h14", fill: "#8B5CF6", ink: "#C4B5FD", bg: ["#2E1F6B", "#130E36"], tier: "HIGH" },
  PLANET: { name: "Ringed planet", label: "PLANET", d: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M2 14c6 3 14 3 20 0", fill: "#0D9488", ink: "#F5B301", bg: ["#064E3B", "#06241C"], tier: "HIGH" },
  COMET: { name: "Comet", label: "COMET", d: "M15 9a4 4 0 1 1 0 .1z M15 9L3 21 M12 7L2 15 M17 12L9 22", fill: "#FF7A1A", ink: "#FFB066", bg: ["#5A2606", "#2A1003"], tier: "HIGH" },
  A: { name: "Ace", label: "A", d: "M5 20L12 4l7 16M8 14h8", fill: null, ink: "#F87171", bg: "#2A0F14", tier: "LOW" },
  K: { name: "King", label: "K", d: "M6 4v16M18 4l-9 8 9 8", fill: null, ink: "#22D3EE", bg: "#0A2A33", tier: "LOW" },
  Q: { name: "Queen", label: "Q", d: "M12 4a7 8 0 1 0 0 16 7 8 0 0 0 0-16zM14 16l5 5", fill: null, ink: "#A78BFA", bg: "#1E1450", tier: "LOW" },
  J: { name: "Jack", label: "J", d: "M15 4v11a4 4 0 0 1-8 0", fill: null, ink: "#4ADE80", bg: "#0A2A1A", tier: "LOW" },
  TEN: { name: "Ten", label: "10", d: "M5 7.5l3.5-2.5v14M16 5a4 7 0 1 0 0 14 4 7 0 0 0 0-14z", fill: null, ink: "#FBBF24", bg: "#2A2005", tier: "LOW" },
  WILD: { name: "Wild", label: "WILD", d: "M12 2l2.5 7h7l-5.6 4.2 2.1 7L12 16l-6 4.2 2.1-7L2.5 9h7z", fill: "#FFE27A", ink: "#FFFFFF", bg: ["#7C3AED", "#2E1065"], tier: "SPECIAL" },
  SCATTER: { name: "Scatter", label: "FREE SPINS", d: "M12 12a5 5 0 1 0 .1 0z M12 2a10 10 0 0 1 10 10 M12 22A10 10 0 0 1 2 12", fill: "#22D3EE", ink: "#A5F3FC", bg: ["#0E7490", "#0A2A33"], tier: "SPECIAL" },
  BONUS: { name: "Bonus", label: "BONUS", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M3 12h18M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", fill: "#B87400", ink: "#FFE27A", bg: ["#3B2A05", "#1A1203"], tier: "SPECIAL" },
};

export const SYMBOL_ORDER: Sym[] = ["CROWN", "GEM", "PLANET", "COMET", "A", "K", "Q", "J", "TEN", "WILD", "SCATTER", "BONUS"];

/** Big win thresholds, in multiples of total bet (Prompt 5). */
export const WIN_TIERS = [
  { name: "EPIC WIN", min: 50, ms: 6000 },
  { name: "MEGA WIN", min: 30, ms: 4500 },
  { name: "BIG WIN", min: 15, ms: 3000 },
] as const;
