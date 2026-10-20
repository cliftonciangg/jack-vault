// Inlines the built JS and CSS into one HTML file, so the demo can be opened or shared as a single page.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [src, out] = process.argv.slice(2);
const dir = dirname(src);
let html = readFileSync(src, "utf8");
html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, f) => {
  const js = readFileSync(join(dir, f), "utf8").replace(/<\/script/g, "<\\/script");
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, f) => `<style>${readFileSync(join(dir, f), "utf8")}</style>`);
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
