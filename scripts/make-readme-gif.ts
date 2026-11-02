// Records the README's terminal GIFs from the real CLI: docs/images/cli-demo.gif (the summary on the
// synthetic demo fixture, plus its still docs/images/cli-summary.png) and docs/images/cli-nudge.gif
// (`nudge --preview`, one line from each bedtime-nudge persona; it changes nothing). Run by hand after
// `npm run build` when that output changes, and commit the images. Needs Playwright and ffmpeg, which are
// not project dependencies (same Playwright setup as check-no-network.ts: PLAYWRIGHT_MODULE, CHROMIUM_PATH).
// Run it outside 11pm to 5am local time so the nudge preview shows its fixed sample time (1:14am).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChromium } from "../tools/showcase-check/check.ts";

const chromium = await loadChromium();
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cli = here("../packages/cli/dist/index.js");
const work = mkdtempSync(join(tmpdir(), "ccwatts-gif-"));

// What each GIF types, and the arguments that reproduce it from a clone. A throwaway CCWATTS_HOME keeps
// the runs from reading or writing anyone's real history or nudge setting.
const scenes = [
  {
    typed: "npx ccwatts --path demo.jsonl --since all",
    args: ["--path", here("../fixtures/claude-code/demo.jsonl"), "--since", "all"],
    expect: ["kWh", "range"],
    gif: "cli-demo.gif",
    still: "cli-summary.png",
  },
  { typed: "npx ccwatts nudge --preview", args: ["nudge", "--preview"], expect: ["persona", "grandma"], gif: "cli-nudge.gif" },
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const scene of scenes) await record(scene);
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log("Wrote docs/images/cli-demo.gif, cli-summary.png and cli-nudge.gif");

async function record(scene: (typeof scenes)[number]) {
  const { typed } = scene;
  const home = join(work, "home");
  mkdirSync(home, { recursive: true });
  const output = execFileSync(process.execPath, [cli, ...scene.args], {
    env: { ...process.env, CCWATTS_HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
  }).replace(/\s+$/, "");
  for (const word of scene.expect) if (!output.includes(word)) throw new Error("unexpected CLI output:\n" + output);
  const lines = output.split("\n");
  const frameDir = mkdtempSync(join(work, "frames-"));

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const page = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #0d1a14; font: 15px/1.6 ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", monospace; }
    .win { margin: 28px; background: #13241c; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px #0006; }
    .bar { height: 34px; background: #1b3027; display: flex; align-items: center; gap: 8px; padding-left: 14px; }
    .bar i { width: 12px; height: 12px; border-radius: 50%; background: #3a5246; }
    pre { margin: 0; padding: 18px 26px 22px; color: #e8efe9; white-space: pre; min-height: ${(lines.length + 1) * 24}px; }
    .p { color: #7fc7a0; } .cur { background: #e8efe9; }
  </style><div class="win"><div class="bar"><i></i><i></i><i></i></div><pre id="t"></pre></div>`;

  const tab = await browser.newPage({ viewport: { width: 860, height: 400 }, deviceScaleFactor: 2 });
  await tab.setContent(page);
  // Size the window to the finished output, so the longest line never touches the edge.
  await tab.$eval("#t", (el, text) => (el.textContent = text), [`$ ${typed} `, ...lines].join("\n"));
  // The text plus the pre's 26px right padding (the scroll width leaves it out), plus the window's 28px margins.
  const width = await tab.$eval("#t", (el) => Math.ceil(el.scrollWidth + 26 + 56));
  await tab.setViewportSize({ width: Math.max(860, width), height: 400 });

  const frames: { file: string; seconds: number }[] = [];
  async function frame(typedSoFar: string, shown: string[], cursor: boolean, seconds: number) {
    const prompt = `<span class="p">$ ${esc(typedSoFar)}</span>${cursor ? '<span class="cur"> </span>' : ""}`;
    await tab.$eval("#t", (el, html) => (el.innerHTML = html), [prompt, ...shown.map(esc)].join("\n"));
    const file = join(frameDir, `f${String(frames.length).padStart(3, "0")}.png`);
    await tab.locator(".win").screenshot({ path: file });
    frames.push({ file, seconds });
  }

  await frame("", [], true, 0.8);
  for (let i = 2; i <= typed.length; i += 2) await frame(typed.slice(0, i), [], true, 0.06);
  await frame(typed, [], true, 0.6);
  for (let i = 1; i <= lines.length; i++) await frame(typed, lines.slice(0, i), false, i === lines.length ? 5 : 0.05);
  if (scene.still) await tab.locator(".win").screenshot({ path: here(`../docs/images/${scene.still}`) });
  await tab.close();

  // ffmpeg's concat list sets each frame's duration; one shared palette keeps the GIF small and sharp.
  const list = join(frameDir, "frames.txt");
  writeFileSync(list, frames.map((f) => `file '${f.file}'\nduration ${f.seconds}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none",
    "-loop", "0", here(`../docs/images/${scene.gif}`),
  ]);
}
