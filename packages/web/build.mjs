// Builds dist/ccwatts.html: one static file, no network after load. Used as the hosted
// playground as-is, and by `ccwatts dashboard` with the user's history injected.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const alias = { "@ccwatts/core": here("../core/src/index.ts") };

const app = await build({
  entryPoints: [here("src/app.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
  alias,
  legalComments: "none",
});
const script = app.outputFiles[0].text.trim();

// Sample rollups are computed here from the synthetic demo fixture, so the page ships counts only.
mkdirSync(here("dist"), { recursive: true });
const tmp = here("dist/.sample.mjs");
await build({ entryPoints: [here("src/sample.ts")], bundle: true, format: "esm", platform: "node", outfile: tmp, alias });
const { sampleRows } = await import(`${tmp}?t=${Date.now()}`);
rmSync(tmp);
const sample = JSON.stringify(sampleRows(here("../../fixtures/claude-code/demo.jsonl"))).replace(/</g, "\\u003c");

const hash = createHash("sha256").update(script).digest("base64");
// Nothing can be fetched: no connect-src, no external scripts, styles, fonts or frames.
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const html = readFileSync(here("src/template.html"), "utf8")
  .replace("__CSP__", () => csp)
  .replace("__SAMPLE__", () => sample)
  .replace("__SCRIPT__", () => script);
writeFileSync(here("dist/ccwatts.html"), html);
console.log(`Wrote dist/ccwatts.html (${Math.round(html.length / 1024)} KB)`);
