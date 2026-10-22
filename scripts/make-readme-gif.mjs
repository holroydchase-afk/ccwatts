// Records the README's terminal GIF (docs/images/cli-demo.gif) and its still (docs/images/cli-summary.png)
// from the real CLI output on the synthetic demo fixture. Run by hand after `npm run build` when the
// summary changes, and commit both images. Needs Playwright and ffmpeg, which are not project
// dependencies (same Playwright setup as check-no-network.mjs: PLAYWRIGHT_MODULE, CHROMIUM_PATH).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// What the GIF types, and the arguments that reproduce it from a clone. A throwaway CCWATTS_HOME keeps
// the run from reading or writing anyone's real history.
const typed = "npx ccwatts --path demo.jsonl --since all";
const work = mkdtempSync(join(tmpdir(), "ccwatts-gif-"));
const output = execFileSync(
  process.execPath,
  [here("../packages/cli/dist/index.js"), "--path", here("../fixtures/claude-code/demo.jsonl"), "--since", "all"],
  { env: { ...process.env, CCWATTS_HOME: join(work, "home"), NO_COLOR: "1" }, encoding: "utf8" },
).replace(/\s+$/, "");
if (!output.includes("kWh") || !output.includes("range")) throw new Error("unexpected CLI output:\n" + output);
const lines = output.split("\n");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #0d1a14; font: 15px/1.6 ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", monospace; }
  .win { margin: 28px; background: #13241c; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px #0006; }
  .bar { height: 34px; background: #1b3027; display: flex; align-items: center; gap: 8px; padding-left: 14px; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #3a5246; }
  pre { margin: 0; padding: 18px 26px 22px; color: #e8efe9; white-space: pre; min-height: ${(lines.length + 1) * 24}px; }
  .p { color: #7fc7a0; } .cur { background: #e8efe9; }
</style><div class="win"><div class="bar"><i></i><i></i><i></i></div><pre id="t"></pre></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const tab = await browser.newPage({ viewport: { width: 860, height: 400 }, deviceScaleFactor: 2 });
await tab.setContent(page);
const width = await tab.$eval(".win", (el) => Math.ceil(el.getBoundingClientRect().right + 28));
await tab.setViewportSize({ width: Math.max(860, width), height: 400 });

const frames = [];
async function frame(typedSoFar, shown, cursor, seconds) {
  const prompt = `<span class="p">$ ${esc(typedSoFar)}</span>${cursor ? '<span class="cur"> </span>' : ""}`;
  await tab.$eval("#t", (el, html) => (el.innerHTML = html), [prompt, ...shown.map(esc)].join("\n"));
  const file = join(work, `f${String(frames.length).padStart(3, "0")}.png`);
  await tab.locator(".win").screenshot({ path: file });
  frames.push({ file, seconds });
}

await frame("", [], true, 0.8);
for (let i = 2; i <= typed.length; i += 2) await frame(typed.slice(0, i), [], true, 0.06);
await frame(typed, [], true, 0.6);
for (let i = 1; i <= lines.length; i++) await frame(typed, lines.slice(0, i), false, i === lines.length ? 5 : 0.05);
await tab.locator(".win").screenshot({ path: here("../docs/images/cli-summary.png") });
await browser.close();

// ffmpeg's concat list sets each frame's duration; one shared palette keeps the GIF small and sharp.
const list = join(work, "frames.txt");
writeFileSync(list, frames.map((f) => `file '${f.file}'\nduration ${f.seconds}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`);
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
  "-vf", "split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none",
  "-loop", "0", here("../docs/images/cli-demo.gif"),
]);
rmSync(work, { recursive: true, force: true });
console.log("Wrote docs/images/cli-demo.gif and docs/images/cli-summary.png");
