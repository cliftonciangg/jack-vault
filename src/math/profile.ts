import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSpacing } from "./strips.js";
import { JACKPOT_TIERS, MathProfile, REELS, SYMBOLS } from "./types.js";

export const PROFILES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../profiles");

/** Stable JSON (sorted keys) so the hash only changes when the math does. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function profileHash(p: MathProfile): string {
  return createHash("sha256").update(canonicalJson(p)).digest("hex");
}

export function validateProfile(p: MathProfile): void {
  const lines = p.paylines.length;
  if (p.reels.base.length !== REELS || p.reels.free.length !== REELS) throw new Error("Need 5 reels");
  for (const set of [p.reels.base, p.reels.free]) {
    set.forEach((strip, i) => {
      for (const s of strip) if (!SYMBOLS.includes(s)) throw new Error(`Unknown symbol ${s}`);
      assertSpacing(strip, i);
    });
  }
  if (p.reels.free.some((s) => s.includes("BONUS"))) throw new Error("BONUS must not appear on free-spin reels");
  for (const b of p.betLevelsCents) {
    if (!Number.isInteger(b) || b <= 0 || b % lines !== 0) throw new Error(`Bet ${b} not divisible by ${lines} lines`);
  }
  for (const t of JACKPOT_TIERS) if (!p.jackpots[t]) throw new Error(`Missing jackpot tier ${t}`);
  const fb = p.wheel.segments[p.wheel.jackpotFallbackSegment];
  if (!fb || fb.kind === "JACKPOT") throw new Error("Wheel fallback segment must be a non-jackpot segment");
}

export function loadProfile(id: string): MathProfile {
  const p = JSON.parse(readFileSync(join(PROFILES_DIR, `${id}.json`), "utf8")) as MathProfile;
  validateProfile(p);
  return p;
}

export function listProfiles(): string[] {
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}
