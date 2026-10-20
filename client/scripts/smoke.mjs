// Smoke test: open the game on a phone-sized viewport, play a few spins, screenshot each stage.
// Usage: node scripts/smoke.mjs <url> <outDir> [portrait|landscape]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(process.env.PLAYWRIGHT_PATH ?? "playwright"); }
const [url, out, orient = "portrait"] = process.argv.slice(2);
const vp = orient === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
const browser = await pw.chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(url);
await page.waitForSelector(".play", { timeout: 30000 });
await page.screenshot({ path: `${out}/${orient}-0-loading.png` });
await page.click(".play");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/${orient}-1-idle.png` });
for (let i = 0; i < 6; i++) {
  await page.click(".spin", { force: true });
  await page.waitForTimeout(300);
  if (i === 0) await page.screenshot({ path: `${out}/${orient}-2-spinning.png` });
  await page.waitForTimeout(2600);
  // Dismiss any overlay.
  for (let k = 0; k < 40 && (await page.$(".ov")); k++) {
    const btn = await page.$(".ov .start, .ov .collect, .ov .hub, .ov [data-id]");
    await page.screenshot({ path: `${out}/${orient}-ov-${i}-${k}.png` });
    if (btn && (await btn.isVisible())) await btn.click().catch(() => {});
    else await page.mouse.click(195, 400).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${out}/${orient}-3-after-${i}.png` });
}
await page.click(".menu");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/${orient}-4-menu.png` });
await page.click('.body [data-t="paytable"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/${orient}-5-paytable.png` });
console.log(JSON.stringify({ errors: errors.slice(0, 20) }, null, 1));
await browser.close();
