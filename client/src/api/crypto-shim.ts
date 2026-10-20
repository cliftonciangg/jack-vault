// Browser stand-in for node:crypto, used only so the server's rng module can be
// bundled for demo mode. Demo mode uses BrowserRng (local.ts), never CryptoRng.
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}
export function createHash(): never {
  throw new Error("createHash is not available in the browser");
}
