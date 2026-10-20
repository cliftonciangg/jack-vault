import { BONUS, MathProfile, ROWS, SCATTER, Symbol, WILD } from "./types.js";

/** grid[reel][row] */
export type Grid = Symbol[][];

export interface LineWin {
  /** 1-based line number, as shown on the reel edges. */
  line: number;
  symbol: Symbol;
  count: number;
  /** Multiple of line bet. */
  multiplier: number;
  /** [reel, row] of each symbol in the win. */
  positions: [number, number][];
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  /** Sum of line multipliers (line-bet units). */
  lineMultiplier: number;
  scatterCount: number;
  scatterPositions: [number, number][];
  /** Scatter pay in total-bet units. */
  scatterMultiplier: number;
  bonusCount: number;
  bonusPositions: [number, number][];
}

/** The visible window for a set of stops: 4 consecutive symbols per reel, wrapping. */
export function windowFor(strips: Symbol[][], stops: number[]): Grid {
  return strips.map((strip, r) => {
    const col: Symbol[] = [];
    for (let row = 0; row < ROWS; row++) col.push(strip[(stops[r] + row) % strip.length]);
    return col;
  });
}

/**
 * Pays one line left to right. WILD substitutes for every pay symbol but not
 * SCATTER or BONUS. If WILD has its own pays, the better of the wild-only run
 * and the substituted run is paid.
 */
export function payLine(
  syms: readonly Symbol[],
  paytable: MathProfile["paytable"],
): { symbol: Symbol; count: number; multiplier: number } | null {
  let wildRun = 0;
  while (wildRun < syms.length && syms[wildRun] === WILD) wildRun++;
  const wildPay = wildRun >= 3 ? paytable[WILD]?.[wildRun as 3 | 4 | 5] ?? 0 : 0;

  let best: { symbol: Symbol; count: number; multiplier: number } | null =
    wildPay > 0 ? { symbol: WILD, count: wildRun, multiplier: wildPay } : null;

  if (wildRun < syms.length) {
    const base = syms[wildRun];
    if (base !== SCATTER && base !== BONUS) {
      let n = wildRun + 1;
      while (n < syms.length && (syms[n] === base || syms[n] === WILD)) n++;
      const pay = n >= 3 ? paytable[base]?.[n as 3 | 4 | 5] ?? 0 : 0;
      if (pay > 0 && (!best || pay > best.multiplier)) best = { symbol: base, count: n, multiplier: pay };
    }
  }
  return best;
}

export function evaluateGrid(grid: Grid, profile: MathProfile): SpinEvaluation {
  const lineWins: LineWin[] = [];
  let lineMultiplier = 0;
  const syms: Symbol[] = new Array(grid.length);
  profile.paylines.forEach((rows, i) => {
    for (let r = 0; r < grid.length; r++) syms[r] = grid[r][rows[r]];
    const win = payLine(syms, profile.paytable);
    if (win) {
      lineMultiplier += win.multiplier;
      lineWins.push({
        line: i + 1,
        ...win,
        positions: Array.from({ length: win.count }, (_, r) => [r, rows[r]] as [number, number]),
      });
    }
  });

  const scatterPositions: [number, number][] = [];
  const bonusPositions: [number, number][] = [];
  grid.forEach((col, r) =>
    col.forEach((s, row) => {
      if (s === SCATTER) scatterPositions.push([r, row]);
      else if (s === BONUS) bonusPositions.push([r, row]);
    }),
  );
  const scatterCount = scatterPositions.length;
  const scatterMultiplier = profile.scatterPays[Math.min(scatterCount, 5) as 3 | 4 | 5] ?? 0;

  return {
    lineWins,
    lineMultiplier,
    scatterCount,
    scatterPositions,
    scatterMultiplier,
    bonusCount: bonusPositions.length,
    bonusPositions,
  };
}
