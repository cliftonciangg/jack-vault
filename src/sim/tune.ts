import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProfile, TuningKnob } from "../math/design.js";
import { PROFILES_DIR, profileHash, validateProfile } from "../math/profile.js";
import { theoreticalRtp } from "../math/theoretical.js";

/**
 * Builds reel strips for an RTP target and writes profiles/<id>.json.
 *
 *   npm run tune                         -> rtp94, rtp95, rtp96
 *   npm run tune -- --target 0.955 --id rtp955
 *
 * RTP varies slightly by bet (jackpot odds scale with bet, and the weight
 * they give up goes to a credit segment), and it is lowest at max bet. The
 * search targets the max-bet RTP, so the target is the game's minimum RTP.
 */
function minRtp(knob: TuningKnob): number {
  const p = buildProfile("tune", knob);
  return theoreticalRtp(p, Math.max(...p.betLevelsCents)).rtp;
}

/** Within this distance of the target, prefer evenly spread filler (strips that look alike). */
const TOLERANCE = 0.0002;

export function tune(target: number): { knob: TuningKnob; rtp: number } {
  let best: { knob: TuningKnob; rtp: number; err: number; spread: number } | null = null;
  for (let a = 0; a <= 12; a++) {
    for (let b = 0; b <= 12; b++) {
      // RTP falls as reel-5 filler grows: binary search it.
      let lo = 0;
      let hi = 24;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (minRtp({ filler: [a, a, b, mid] }) > target) lo = mid + 1;
        else hi = mid;
      }
      for (const c of [lo - 1, lo]) {
        if (c < 0 || c > 24) continue;
        const knob: TuningKnob = { filler: [a, a, b, c] };
        const rtp = minRtp(knob);
        const err = Math.abs(rtp - target);
        const spread = Math.max(a, b, c) - Math.min(a, b, c);
        const better = !best
          ? true
          : err <= TOLERANCE && best.err <= TOLERANCE
            ? spread < best.spread || (spread === best.spread && err < best.err)
            : err < best.err;
        if (better) best = { knob, rtp, err, spread };
      }
    }
  }
  return best!;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const targets = arg("--target")
    ? [{ id: arg("--id") ?? `rtp${Math.round(Number(arg("--target")) * 1000)}`, target: Number(arg("--target")) }]
    : [
        { id: "rtp94", target: 0.94 },
        { id: "rtp95", target: 0.95 },
        { id: "rtp96", target: 0.96 },
      ];
  for (const { id, target } of targets) {
    if (!(target > 0.8 && target < 1)) throw new Error(`Target ${target} out of range`);
    const t0 = Date.now();
    const { knob, rtp } = tune(target);
    const profile = buildProfile(id, knob);
    profile.description += ` (target RTP ${(target * 100).toFixed(2)}%, filler ${knob.filler.join("/")})`;
    validateProfile(profile);
    writeFileSync(join(PROFILES_DIR, `${id}.json`), JSON.stringify(profile, null, 1) + "\n");
    console.log(
      `${id}: target ${(target * 100).toFixed(2)}%  achieved ${(rtp * 100).toFixed(3)}%  filler ${knob.filler.join("/")}  ` +
        `hash ${profileHash(profile).slice(0, 12)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }
}

main();
