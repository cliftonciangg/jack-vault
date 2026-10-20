// Dev check of one feature: node scripts/feature.mjs <url-with-force> <outDir> <name> [portrait|landscape]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require("playwright");
const [url, out, name, orient = "portrait"] = process.argv.slice(2);
const vp = orient === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
const browser = await pw.chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on("console", (m) => (m.type() === "error") && errors.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.goto(url);
await page.waitForSelector(".play", { timeout: 30000 });
await page.click(".play");
await page.waitForTimeout(800);
await page.click(".spin", { force: true });
let n = 0;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}-${orient}-${String(n++).padStart(2, "0")}.png` });
  const btn = await page.$(".ov .start:visible, .ov .collect:visible, .ov .hub:not([disabled]), .ov [data-id]:visible");
  if (btn) await btn.click({ force: true }).catch(() => {});
  const idle = await page.evaluate(() => !document.querySelector(".ov") && document.querySelector(".spincap")?.textContent === "HOLD FOR AUTO");
  if (idle && n > 4) break;
}
await page.screenshot({ path: `${out}/${name}-${orient}-end.png` });
console.log(JSON.stringify({ shots: n, errors }, null, 1));
await browser.close();
