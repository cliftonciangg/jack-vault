import {
  ApiError, GameApi, GameConfig, GameState, HistoryRound, JackpotTier, Jackpots, PlayResponse,
} from "./types";

const TOKEN_KEY = "jackvault.token";

function store(key: string, value?: string | null): string | null {
  try {
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return value ?? null;
  }
}

/**
 * Talks to the Jack Vault Node server. Players log in with the username and
 * password their agent gave them; connect() throws LOGIN_REQUIRED until then. Money-moving calls go over REST with a
 * requestId, so a retry after a dropped connection can never play twice. The
 * WebSocket only carries the live jackpot ticker and other players' jackpot wins.
 */
export class RemoteApi implements GameApi {
  readonly mode = "server" as const;
  private token: string | null = store(TOKEN_KEY);
  private ws: WebSocket | null = null;
  private jackpotSubs = new Set<(j: Jackpots) => void>();
  private wonSubs = new Set<(t: JackpotTier, a: number) => void>();
  private balanceSubs = new Set<(c: number) => void>();
  private cachedConfig: GameConfig | null = null;
  private closed = false;
  /** Called when the server drops the session mid-game (logged out elsewhere, disabled, password reset). */
  onAuthLost: (() => void) | null = null;

  constructor(private readonly base = "") {}

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("NETWORK", "Connection lost");
    }
    if (res.status === 401 && auth) {
      this.dropSession();
      this.onAuthLost?.();
      throw new ApiError("LOGIN_REQUIRED", "Please log in again", 401);
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new ApiError(e.code ?? "HTTP_" + res.status, e.message ?? res.statusText, res.status);
    }
    return data as T;
  }

  private dropSession() {
    this.token = store(TOKEN_KEY, null);
    this.closed = true;
    this.ws?.close();
  }

  /** Resumes a saved session, or throws ApiError LOGIN_REQUIRED. */
  async connect(): Promise<GameState> {
    if (!this.token) throw new ApiError("LOGIN_REQUIRED", "Please log in", 401);
    const saved = this.onAuthLost;
    this.onAuthLost = null; // a stale saved token just means "show the login", not "reload"
    try {
      const s = await this.state();
      this.closed = false;
      this.openSocket();
      return s;
    } finally {
      this.onAuthLost = saved;
    }
  }

  /** Player login with the credentials from their agent. */
  async login(username: string, password: string): Promise<GameState> {
    const r = await this.request<{ token: string; state: GameState }>("POST", "/api/player/login", { username, password }, false);
    this.token = store(TOKEN_KEY, r.token);
    this.closed = false;
    this.openSocket();
    return r.state;
  }

  async logout(): Promise<void> {
    const token = this.token;
    this.dropSession();
    if (token) {
      await fetch(this.base + "/api/player/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
  }

  private openSocket() {
    if (this.ws || !this.token || this.closed) return;
    const url = new URL(this.base || location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "?token=" + encodeURIComponent(this.token);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "jackpots") this.jackpotSubs.forEach((f) => f(m.jackpots));
        if (m.type === "jackpotWon") this.wonSubs.forEach((f) => f(m.tier, m.amountCents));
        if (m.type === "balance") this.balanceSubs.forEach((f) => f(m.balanceCents));
      } catch {
        /* ignore malformed pushes */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.openSocket(), 3000);
    };
  }

  async config(): Promise<GameConfig> {
    return (this.cachedConfig ??= await this.request<GameConfig>("GET", "/api/config", undefined, false));
  }
  state(): Promise<GameState> {
    return this.request("GET", "/api/state");
  }
  spin(requestId: string, betCents: number): Promise<PlayResponse> {
    return this.request("POST", "/api/spin", { requestId, betCents });
  }
  wheel(requestId: string): Promise<PlayResponse> {
    return this.request("POST", "/api/wheel", { requestId });
  }
  freeSpin(requestId: string): Promise<PlayResponse> {
    return this.request("POST", "/api/free-spin", { requestId });
  }
  async history(limit = 20): Promise<HistoryRound[]> {
    const r = await this.request<{ rounds: HistoryRound[] }>("GET", `/api/history?limit=${limit}`);
    return r.rounds;
  }
  onJackpots(cb: (j: Jackpots) => void) {
    this.jackpotSubs.add(cb);
    return () => this.jackpotSubs.delete(cb);
  }
  onBalance(cb: (c: number) => void) {
    this.balanceSubs.add(cb);
    return () => this.balanceSubs.delete(cb);
  }
  onJackpotWon(cb: (t: JackpotTier, a: number) => void) {
    this.wonSubs.add(cb);
    return () => this.wonSubs.delete(cb);
  }
}

export async function serverReachable(base = "", timeoutMs = 1500): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + "/api/health", { signal: ctl.signal });
    const j = await r.json();
    return !!j?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
