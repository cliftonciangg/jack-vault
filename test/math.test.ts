import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGrid, payLine, windowFor } from "../src/math/evaluate.js";
import { listProfiles, loadProfile, profileHash } from "../src/math/profile.js";
import { assertSpacing, buildStrip } from "../src/math/strips.js";
import { countDistribution, lineExpectation } from "../src/math/theoretical.js";
import { MathProfile, Symbol } from "../src/math/types.js";

const p = loadProfile("rtp95");
const pt = p.paytable;

test("payLine: left-to-right runs with wild substitution", () => {
  assert.deepEqual(payLine(["CROWN", "CROWN", "CROWN", "A", "A"], pt), { symbol: "CROWN", count: 3, multiplier: 50 });
  assert.deepEqual(payLine(["CROWN", "WILD", "CROWN", "WILD", "CROWN"], pt), { symbol: "CROWN", count: 5, multiplier: 1000 });
  assert.deepEqual(payLine(["WILD", "WILD", "GEM", "K", "K"], pt), { symbol: "GEM", count: 3, multiplier: 40 });
  assert.equal(payLine(["CROWN", "CROWN", "A", "CROWN", "CROWN"], pt), null);
  assert.equal(payLine(["A", "SCATTER", "A", "A", "A"], pt), null, "SCATTER breaks a line");
  assert.equal(payLine(["BONUS", "BONUS", "BONUS", "A", "A"], pt), null, "BONUS does not pay on lines");
  assert.equal(payLine(["TEN", "TEN", "Q", "Q", "Q"], pt), null, "two of a kind does not pay");
});

test("evaluateGrid counts scatters and bonus anywhere and sums lines", () => {
  const grid: Symbol[][] = [
    ["CROWN", "SCATTER", "BONUS", "A"],
    ["CROWN", "K", "Q", "J"],
    ["CROWN", "SCATTER", "BONUS", "TEN"],
    ["A", "K", "Q", "J"],
    ["SCATTER", "BONUS", "TEN", "K"],
  ];
  const ev = evaluateGrid(grid, p);
  assert.equal(ev.scatterCount, 3);
  assert.equal(ev.scatterMultiplier, p.scatterPays[3]);
  assert.equal(ev.bonusCount, 3);
  // Line 1 (top row) is CROWN x3 = 50; line 9 [0,0,1,0,0] is CROWN, CROWN, SCATTER -> no.
  assert.ok(ev.lineWins.some((w) => w.line === 1 && w.multiplier === 50));
  assert.equal(ev.lineMultiplier, ev.lineWins.reduce((a, w) => a + w.multiplier, 0));
});

test("all shipped profiles validate, are spaced, and have 25 lines", () => {
  for (const id of listProfiles()) {
    const prof = loadProfile(id);
    assert.equal(prof.paylines.length, 25);
    assert.equal(new Set(prof.paylines.map((l) => l.join())).size, 25, "lines are distinct");
    prof.reels.base.forEach((s, i) => assertSpacing(s, i));
    assert.match(profileHash(prof), /^[0-9a-f]{64}$/);
  }
});

test("strip builder rejects layouts that would put two scatters in one window", () => {
  assert.throws(() => buildStrip({ A: 5, SCATTER: 3 }, 1));
  assert.throws(() => assertSpacing(["SCATTER", "A", "SCATTER", "A", "A", "A", "A", "A"], 0));
});

/** Tiny profile so every stop combination can be enumerated. */
function toyProfile(): MathProfile {
  const strip = (extra: Symbol[]): Symbol[] => ["CROWN", "A", "SCATTER", "K", "WILD", "A", "K", "CROWN", ...extra];
  return {
    ...p,
    reels: {
      base: [strip([]), strip(["A"]), strip(["K", "K"]), strip([]), strip(["CROWN"])].map((s, i) => (i === 0 ? s.map((x) => (x === "WILD" ? "Q" : x)) : s)),
      free: p.reels.free,
    },
  };
}

test("exact line and scatter math equals brute-force enumeration of every stop", () => {
  const toy = toyProfile();
  const strips = toy.reels.base;
  let lineTotal = 0;
  let combos = 0;
  const scat = new Array(6).fill(0);
  const stops = [0, 0, 0, 0, 0];
  const rec = (r: number) => {
    if (r === 5) {
      const ev = evaluateGrid(windowFor(strips, stops), toy);
      lineTotal += ev.lineMultiplier;
      scat[ev.scatterCount]++;
      combos++;
      return;
    }
    for (let i = 0; i < strips[r].length; i++) {
      stops[r] = i;
      rec(r + 1);
    }
  };
  rec(0);
  const exactPerLine = lineExpectation(strips, toy.paytable);
  assert.ok(Math.abs(lineTotal / combos / toy.paylines.length - exactPerLine) < 1e-12);
  const dist = countDistribution(strips, "SCATTER");
  scat.forEach((c, k) => assert.ok(Math.abs(c / combos - dist[k]) < 1e-12, `k=${k}`));
});
