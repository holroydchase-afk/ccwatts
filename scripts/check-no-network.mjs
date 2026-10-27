// Browser check for the playground: loads the built page in headless Chromium with the showcase
// kit (tools/showcase-check), uses sample data, loads a log file through the file picker, and fails
// if the page makes any network request, logs an error, or scrolls sideways on a phone.
//
// Needs Playwright, which is not a project dependency:  npx playwright@1 install chromium
// Run after `npm run build`:                            node scripts/check-no-network.mjs
// Set PLAYWRIGHT_MODULE to a Playwright path and CHROMIUM_PATH to a browser binary if needed.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { showcaseCheck } from "../tools/showcase-check/check.mjs";

const page_ = fileURLToPath(new URL("../packages/web/dist/ccwatts.html", import.meta.url));
const log = fileURLToPath(new URL("../fixtures/claude-code/sample.jsonl", import.meta.url));

// What the export prompt asks Claude to write: the fixture reduced to counts, cwd as a folder name.
const counts = readFileSync(log, "utf8").split("\n").flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; } // the fixture has a deliberately broken line
  })
  .filter((d) => d.type === "assistant" && d.message?.usage)
  .map((d) => {
    const u = d.message.usage;
    return JSON.stringify({ type: d.type, timestamp: d.timestamp, requestId: d.requestId, cwd: basename(d.cwd ?? ""),
      message: { id: d.message.id, model: d.message.model, usage: { input_tokens: u.input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens, output_tokens: u.output_tokens } } });
  }).join("\n");

// Generic checks (network, errors, sideways scroll, 44px tap targets, Tab reach, unfinished text,
// broken images, tiny text) come from the showcase kit, at 390 and 1280px in light and dark.
// Everything below is specific to this page.
const problems = await showcaseCheck({
  url: pathToFileURL(page_).href,
  viewports: [{ width: 1280, height: 900 }, { width: 390, height: 844 }],
  tapTargets: "button, label.btn", // RR-9
  keyboardReach: ["pick-folder", "pick-files"], // RR-5
  tabPresses: 12,
  minTextPx: 11, // the chart-label floor from RR-8
  extra: async (page, { viewport, problem }) => {
    if ((await page.textContent("#source-pill")) !== "Sample data") problem("did not open on sample data");
    // Chart labels stay readable on a phone: drawn at the screen's pixel width, not scaled down (RR-8).
    const label = await page.$eval("#chart text", (t) => t.getBoundingClientRect().height);
    if (label < 11) problem(`chart labels ${label.toFixed(1)}px tall (want 11+)`);
    // Method table: no sideways scroll inside it on a phone, distinct source links 44px tall (RR-10, RR-11).
    const table = await page.$eval(".tablewrap", (t) => ({ over: t.scrollWidth - t.clientWidth }));
    if (table.over > 1) problem(`method table scrolls sideways by ${table.over}px`);
    const links = await page.$$eval("#params a", (as) => as.map((a) => ({ t: a.textContent.trim(), h: a.getBoundingClientRect().height })));
    if (links.some((l) => l.t === "source")) problem("source links don't name their source");
    if (links.some((l) => l.h < 44)) problem(`source links under 44px`);
    // Phones get a hint that logs live on a computer (RR-13).
    const hint = await page.$eval("#phone-hint", (h) => h.getBoundingClientRect().height > 0).catch(() => null);
    if (hint !== viewport.width < 600) problem(`phone hint ${hint ? "shown" : "missing"}`);
    // CCW-UX1: the hero's meta line breaks between items, never inside a date or a number.
    const metaParts = await page.$$eval("#hero-meta > span", (ss) => ss.map((s) => ({ t: s.textContent, lines: s.getClientRects().length })));
    if (metaParts.length < 3) problem("hero meta line isn't split into items");
    for (const m of metaParts) if (m.lines > 1) problem(`hero meta item "${m.t}" wraps`);
    const sampleHeadline = await page.textContent("#hero-big");
    await page.setInputFiles("#pick-files", log);
    await page.waitForFunction(() => document.querySelector("#source-pill")?.textContent === "Your files");
    if ((await page.textContent("#hero-big")) === sampleHeadline) problem("headline did not change after loading a file");
    // The lede follows the data source (recruiter-ready RR-16).
    if ((await page.textContent("#lede")).includes("sample data")) problem("lede still says sample data after loading a file");
    await page.click("#w-7d");
    await page.click("#use-sample");
    if (!(await page.textContent("#lede")).includes("sample data")) problem("lede lost its sample-data note after Use sample data");
    // Claude Code on the web: the copied prompt's counts-only output, pasted inside a code fence, loads.
    await page.click("#export > summary");
    const prompt = await page.textContent("#export-prompt");
    if (!prompt.includes("never the full path") || !prompt.includes("message content")) problem("export prompt lost its counts-only wording");
    await page.fill("#paste-log", ["```json", counts, "```"].join("\n"));
    await page.click("#read-paste");
    await page.waitForFunction(() => document.querySelector("#source-pill")?.textContent === "Your files");
    if (!(await page.textContent("#drop-status")).includes("pasted text")) problem("pasted lines did not load");

    // Loading a file changes the page, so check sideways scroll again.
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > viewport.width) problem(`horizontal scroll after loading a file (${width}px wide)`);
  },
});

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Playground check passed: no network requests, no errors, no sideways scroll.");
