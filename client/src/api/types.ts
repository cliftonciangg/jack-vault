/** Wire types for the Jack Vault server API (see ../../README.md, "API"). Money is integer cents. */

export type Sym =
  | "CROWN" | "GEM" | "PLANET" | "COMET"
  | "A" | "K" | "Q" | "J" | "TEN"
  | "WILD" | "SCATTER" | "BONUS";

export type JackpotTier = "GRAND" | "MAJOR" | "MINOR" | "MINI";
export const JACKPOT_TIERS: JackpotTier[] = ["GRAND", "MAJOR", "MINOR", "MINI"];

export type Jackpots = Record<JackpotTier, number>;
export type NextAction = "spin" | "wheel" | "freeSpin";
export type Pos = [number, number];

export interface LineWin {
  line: number;
  symbol: Sym;
  count: number;
  multiplier: number;
  winCents: number;
  positions: Pos[];
}

export interface ReelStep {
  type: "BASE" | "FREE";
  stops: number[];
  /** grid[reel][row], row 0 is the top. */
  grid: Sym[][];
  lineWins: LineWin[];
  scatter: { count: number; positions: Pos[]; winCents: number };
  bonus: { count: number; positions: Pos[] };
  multiplier: number;
  winCents: number;
  freeSpinsAwarded: number;
  wheelTriggered: boolean;
}

export type WheelSegment =
  | { kind: "CREDIT"; multiplier: number }
  | { kind: "FREE_SPINS"; spins: number }
  | { kind: "JACKPOT"; tier: JackpotTier };

export interface WheelStep {
  type: "WHEEL";
  segmentIndex: number;
  segment: WheelSegment;
  winCents: number;
  freeSpinsAwarded: number;
  jackpotTier: JackpotTier | null;
  jackpotWinCents: number;
}

export type Step = ReelStep | WheelStep;

export interface FreeSpinsState {
  remaining: number;
  played: number;
  awarded: number;
  multiplier: number;
  winCents: number;
}

export interface RoundView {
  roundId?: string;
  status: "OPEN" | "COMPLETE";
  betCents: number;
  totalWinCents: number;
  pending: { wheel: boolean; freeSpins: FreeSpinsState | null };
  steps: Step[];
}

export interface PlayResponse {
  roundId: string;
  action: NextAction;
  balanceCents: number;
  nextAction: NextAction;
  step: Step;
  round: RoundView;
  jackpots: Jackpots;
}

export interface GameState {
  playerId: string;
  /** Login name of an agent-made player account (server mode). */
  username?: string | null;
  balanceCents: number;
  nextAction: NextAction;
  openRound: (RoundView & { roundId: string }) | null;
  jackpots: Jackpots;
}

export interface GameConfig {
  betLevelsCents: number[];
  lines: number;
  paylines: number[][];
  paytable: Partial<Record<Sym, Partial<Record<"3" | "4" | "5", number>>>>;
  scatterPays: Partial<Record<"3" | "4" | "5", number>>;
  freeSpins: { triggerCount: number; spinsAwarded: number; retriggerSpins: number; multiplier: number };
  wheel: { triggerCount: number; segments: WheelSegment[] };
  jackpots: { tiers: JackpotTier[]; seedsCents: Jackpots };
  rtp: { min: number; max: number };
  /** Reel strips. The live server leaves these out; demo mode has them, so neighbours of each stop are the real ones. */
  reels?: { base: Sym[][]; free: Sym[][] };
}

export interface HistoryRound {
  roundId: string;
  betCents: number;
  totalWinCents: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  steps?: Step[];
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
  /** Network failure or server restart: the same request can be retried with the same requestId. */
  get retryable(): boolean {
    return this.code === "NETWORK" || this.status >= 500;
  }
}

/** What the game needs from a backend. RemoteApi talks to the Node server; LocalApi runs the same engine in the browser. */
export interface GameApi {
  readonly mode: "server" | "demo";
  connect(): Promise<GameState>;
  config(): Promise<GameConfig>;
  state(): Promise<GameState>;
  spin(requestId: string, betCents: number): Promise<PlayResponse>;
  wheel(requestId: string): Promise<PlayResponse>;
  freeSpin(requestId: string): Promise<PlayResponse>;
  history(limit?: number): Promise<HistoryRound[]>;
  /** Live jackpot values and other players' jackpot wins. Returns an unsubscribe function. */
  onJackpots(cb: (j: Jackpots) => void): () => void;
  onJackpotWon(cb: (tier: JackpotTier, amountCents: number) => void): () => void;
  /** Demo only: top the balance up. */
  addCoins?(amountCents: number): Promise<number>;
  /** Server only: the agent loaded or redeemed coins. */
  onBalance?(cb: (balanceCents: number) => void): () => void;
  /** Server only: end the player's session. */
  logout?(): Promise<void>;
}

export function newRequestId(): string {
  // randomUUID only exists in secure contexts; a phone testing over http://<lan-ip> gets the fallback.
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
