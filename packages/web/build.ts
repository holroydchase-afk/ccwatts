// Builds dist/ccwatts.html: one static file, no network after load. Used as the hosted
// playground as-is, and by `ccwatts dashboard` with the user's history injected.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
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
const script = app.outputFiles![0]!.text.trim();

// Sample rollups are computed here from the synthetic demo fixture, so the page ships counts only.
mkdirSync(here("dist"), { recursive: true });
const tmp = here("dist/.sample.mjs");
await build({ entryPoints: [here("src/sample.ts")], bundle: true, format: "esm", platform: "node", outfile: tmp, alias });
const { sampleRows, samplePace, paceNoteLines, paceLateLabel } = await import(`${tmp}?t=${Date.now()}`);
rmSync(tmp);
const rows: { date: string }[] = sampleRows(here("../../fixtures/claude-code/demo.jsonl"));
const sample = JSON.stringify(rows).replace(/</g, "\\u003c");
// Sample pace (synthetic, no times of day) ends on the energy sample's last day.
const lastSampleDate = rows.map((r) => r.date).sort().at(-1);
if (!lastSampleDate) throw new Error("The sample has no days.");
const samplePaceJson = JSON.stringify(samplePace(lastSampleDate)).replace(/</g, "\\u003c");
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paceNotes = (paceNoteLines() as string[]).map(escHtml).join(" ");
const paceLate = escHtml(paceLateLabel() as string);

// Read from core/src/meta.ts so the URL lives in one place.
const PLAYGROUND_URL = /PLAYGROUND_URL = "([^"]+)"/.exec(readFileSync(here("../core/src/meta.ts"), "utf8"))?.[1];
if (!PLAYGROUND_URL) throw new Error("PLAYGROUND_URL not found in core/src/meta.ts");

// The "What if?" slider's bounds come from params.json, so it can never leave the published range.
const cacheRead: { value: number; low: number; high: number } = JSON.parse(readFileSync(here("../../methodology/params.json"), "utf8")).params.cache_read_vs_input;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const at = (cacheRead.value - cacheRead.low) / (cacheRead.high - cacheRead.low);
const mark = `calc(${(at * 100).toFixed(2)}% + ${(8 - 16 * at).toFixed(1)}px)`;

// Atkinson Hyperlegible Next (SIL OFL, src/fonts/OFL.txt), inlined so the page loads no font file.
const font = readFileSync(here("src/fonts/AtkinsonHyperlegibleNext-latin.woff2")).toString("base64");

const hash = createHash("sha256").update(script).digest("base64");
// Nothing can be fetched: no connect-src, no external scripts, styles or frames. The one font is a
// data: URL in the page itself (font-src data:, QA-R8).
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * The page is one file a visitor downloads, so ship it without the notes and indentation the source
 * keeps for reading: stylesheet comments, and the leading spaces on each line (the newline itself
 * stays, so inline text still has its space). Content where whitespace shows (<pre>, <textarea>) and
 * the <script> blocks are left byte for byte. Saves about 5 KB against scripts/check-live.ts MAX_BYTES.
 */
function shrink(src: string): string {
  const keep = /<(pre|textarea)\b[\s\S]*?<\/\1[^>]*>|<script\b[\s\S]*?<\/script[^>]*>/gi;
  const thin = (part: string) =>
    part
      .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, (s) => s.replace(/\/\*[\s\S]*?\*\//g, ""))
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{2,}/g, "\n");
  let out = "";
  let at = 0;
  for (let m = keep.exec(src); m; m = keep.exec(src)) {
    out += thin(src.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + thin(src.slice(at));
}

const html = shrink(readFileSync(here("src/template.html"), "utf8"))
  .replace("__CSP__", () => csp)
  .replace("__FONT__", () => font)
  .replaceAll("__PLAYGROUND_URL__", () => PLAYGROUND_URL)
  .replace("__WHATIF_MIN__", () => String(cacheRead.low))
  .replace("__WHATIF_MAX__", () => String(cacheRead.high))
  .replace("__WHATIF_VALUE__", () => String(cacheRead.value))
  .replace("__WHATIF_MARK__", () => mark)
  .replaceAll("__WHATIF_PCT__", () => pct(cacheRead.value))
  .replaceAll("__WHATIF_LOW_PCT__", () => pct(cacheRead.low))
  .replaceAll("__WHATIF_HIGH_PCT__", () => pct(cacheRead.high))
  .replace("__SAMPLE__", () => sample)
  .replace("__SAMPLE_PACE__", () => samplePaceJson)
  .replace("__PACE_NOTES__", () => paceNotes)
  .replace("__PACE_LATE__", () => paceLate)
  .replace("__SCRIPT__", () => script);
writeFileSync(here("dist/ccwatts.html"), html);
console.log(`Wrote dist/ccwatts.html (${Math.round(html.length / 1024)} KB)`);
