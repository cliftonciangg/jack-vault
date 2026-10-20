import { test } from "node:test";
import assert from "node:assert/strict";
import { CryptoRng, RecordingRng, ReplayRng, SeededRng, weightedIndex } from "../src/rng/rng.js";

test("CryptoRng stays in range and is uniform (chi-square)", () => {
  const rng = new CryptoRng();
  for (const k of [1, 2, 3, 7, 61, 1000]) {
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(k);
      assert.ok(Number.isInteger(v) && v >= 0 && v < k);
    }
  }
  // 67 bins (a strip-length-like, non power of two range), 670k draws.
  const bins = 67;
  const n = 670_000;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) counts[rng.int(bins)]++;
  const e = n / bins;
  const chi2 = counts.reduce((a, c) => a + ((c - e) * (c - e)) / e, 0);
  // df = 66; P(chi2 > 115) < 1e-4
  assert.ok(chi2 < 115, `chi2=${chi2}`);
});

test("CryptoRng rejects bad ranges", () => {
  const rng = new CryptoRng();
  assert.throws(() => rng.int(0));
  assert.throws(() => rng.int(1.5));
  assert.throws(() => rng.int(2 ** 33));
});

test("SeededRng is deterministic", () => {
  const a = new SeededRng(7);
  const b = new SeededRng(7);
  const xs = Array.from({ length: 50 }, () => a.int(1000));
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b.int(1000)));
  assert.ok(new Set(xs).size > 40);
});

test("RecordingRng + ReplayRng reproduce draws and detect mismatch", () => {
  const rec = new RecordingRng(new CryptoRng());
  const xs = [10, 20, 30].map((m) => rec.int(m));
  const rep = new ReplayRng(rec.draws);
  assert.deepEqual([10, 20, 30].map((m) => rep.int(m)), xs);
  assert.throws(() => new ReplayRng(rec.draws).int(11));
});

test("weightedIndex follows weights", () => {
  const rng = new SeededRng(3);
  const counts = [0, 0, 0];
  for (let i = 0; i < 60_000; i++) counts[weightedIndex(rng, [1, 2, 3])]++;
  [1, 2, 3].forEach((w, i) => assert.ok(Math.abs(counts[i] / 60_000 - w / 6) < 0.01));
});
