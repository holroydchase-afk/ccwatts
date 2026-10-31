// Browser check for the playground: loads the built page in headless Chromium, uses sample data,
// loads a log file through the file picker, and fails if the page makes any network request,
// logs an error, or scrolls sideways on a phone.
//
// Needs Playwright, which is not a project dependency:  npx playwright@1 install chromium
// Run after `npm run build`:                            tsx scripts/check-no-network.ts
// Set PLAYWRIGHT_MODULE to a Playwright path and CHROMIUM_PATH to a browser binary if needed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChromium, showcaseCheck } from "../tools/showcase-check/check.ts";

const chromium = await loadChromium();
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

// UX-R11: the footer's version is the CLI package version.
const cliVersion = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8")).version;
// UX-R1, UX-R2: a .jsonl file with no usage in it (a user line only).
const scratch = mkdtempSync(join(tmpdir(), "ccwatts-check-"));
const noUsage = join(scratch, "empty-session.jsonl");
writeFileSync(noUsage, JSON.stringify({ type: "user", timestamp: "2026-10-01T10:00:00.000Z", cwd: "proj", message: { role: "user", content: "" } }) + "\n");
const MONO = /monospace|Menlo|Consolas|SF Mono|Courier/i;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems: string[] = [];
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("console", (m) => m.type() === "error" && problems.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(pathToFileURL(page_).href);
  // An element missing from the page reads as "", so the check below reports it instead of crashing.
  const text = async (sel: string) => (await page.textContent(sel)) ?? "";
  // DEMO-BAR: the demo bar's toggle says which data is on screen (it replaced #source-pill and the
  // lede's sample-data clause). innerText, so text hidden at this width doesn't count.
  const barText = () => page.evaluate(() => (document.querySelector('section[aria-label="Demo"] button[aria-label="Demo details"]') as HTMLElement | null)?.innerText ?? "");
  const waitBar = (want: string, why: string) => page.waitForFunction((w) => ((document.querySelector('section[aria-label="Demo"] button[aria-label="Demo details"]') as HTMLElement | null)?.innerText ?? "").includes(w), want, { timeout: 8000 })
    .then(() => true, () => { problems.push(`${why}: demo bar never said "${want}" at ${viewport.width}px`); return false; });

  if (!(await barText()).includes("Sample data")) problems.push(`DEMO-BAR: did not open on sample data (bar says "${await barText()}")`);

  // Keyboard: Tab must reach both file pickers (recruiter-ready RR-5).
  const reached = new Set<string | undefined>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.id));
  }
  for (const id of ["pick-folder", "pick-files"]) if (!reached.has(id)) problems.push(`Tab never reaches #${id} at ${viewport.width}px`);

  // Tap targets: every button 44px tall or more (RR-9).
  const short = await page.$$eval("button, label.btn", (els) => (els as HTMLElement[]).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || (e.textContent ?? "").trim()));
  // Chart labels stay readable on a phone: drawn at the screen's pixel width, not scaled down (RR-8).
  const label = await page.$eval("#chart text", (t) => t.getBoundingClientRect().height);
  if (label < 11) problems.push(`chart labels ${label.toFixed(1)}px tall at ${viewport.width}px (want 11+)`);
  // Method table: no sideways scroll inside it on a phone, distinct source links 44px tall (RR-10, RR-11).
  const table = await page.$eval(".tablewrap", (t) => ({ over: t.scrollWidth - t.clientWidth }));
  if (table.over > 1) problems.push(`method table scrolls sideways by ${table.over}px at ${viewport.width}px`);
  const links = await page.$$eval("#params a", (as) => as.map((a) => ({ t: (a.textContent ?? "").trim(), h: a.getBoundingClientRect().height })));
  if (links.some((l) => l.t === "source")) problems.push("source links don't name their source");
  if (links.some((l) => l.h < 44)) problems.push(`source links under 44px at ${viewport.width}px`);
  // Phones get a hint that logs live on a computer (RR-13).
  const hint = await page.$eval("#phone-hint", (h) => h.getBoundingClientRect().height > 0).catch(() => null);
  if (hint !== viewport.width < 600) problems.push(`phone hint ${hint ? "shown" : "missing"} at ${viewport.width}px`);
  // CCW-UX1: the hero's meta line breaks between items, never inside a date or a number.
  const metaParts = await page.$$eval("#hero-meta > span", (ss) => ss.map((s) => ({ t: s.textContent, lines: s.getClientRects().length })));
  if (metaParts.length < 3) problems.push("hero meta line isn't split into items");
  for (const m of metaParts) if (m.lines > 1) problems.push(`hero meta item "${m.t}" wraps at ${viewport.width}px`);
  if (short.length) problems.push(`buttons under 44px at ${viewport.width}px: ${short.join(", ")}`);

  // UX-R4: reading text is in the sans stack; mono is for numbers and code only.
  // Callbacks that run in the page declare no named functions: tsx keeps function names with an
  // esbuild __name() helper that exists in Node but not in the browser.
  const fonts = await page.evaluate(() => {
    const [body, chartNote, post] = [document.body, document.querySelector("#chart-note"), document.querySelector("#post")]
      .map((el) => (el ? getComputedStyle(el).fontFamily : "(missing)"));
    return {
      body: body!,
      paragraphs: [...document.querySelectorAll("main p")].filter((p) => p.textContent?.trim())
        .map((p) => ({ id: p.id || p.className || (p.textContent ?? "").slice(0, 30), f: getComputedStyle(p).fontFamily })),
      chartNote: chartNote!,
      methodNotes: [...document.querySelectorAll("#params td[data-label='Parameter'] div")].map((d) => getComputedStyle(d).fontFamily),
      post: post!,
    };
  });
  if (MONO.test(fonts.body) || !/Helvetica|Arial|sans-serif/i.test(fonts.body)) problems.push(`UX-R4: body font is ${fonts.body}, want the sans stack`);
  for (const p of fonts.paragraphs) if (MONO.test(p.f)) problems.push(`UX-R4: paragraph ${p.id} is monospace at ${viewport.width}px`);
  if (MONO.test(fonts.chartNote)) problems.push("UX-R4: chart caption is monospace");
  if (!fonts.methodNotes.length || fonts.methodNotes.some((f) => MONO.test(f))) problems.push("UX-R4: method descriptions are monospace (or missing)");
  if (MONO.test(fonts.post)) problems.push("UX-R4: LinkedIn post preview is monospace");

  // UX-R5: method cards fold into a <details>; the phone page stays short.
  if (!(await page.$eval("#params", (t) => !!t.closest("details")))) problems.push("UX-R5: method parameter table is not inside a <details>");
  if (viewport.width < 600) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height >= 4500) problems.push(`UX-R5: page is ${height}px tall at ${viewport.width}x${viewport.height} (want under 4500)`);
  }

  // UX-R3: the hero links to the "Try it" box, which comes after the chart and the rankings.
  const order = await page.evaluate(() => {
    const drop = document.querySelector("#drop");
    const after = ["#chart", "#by-model", "#by-project"].every((sel) =>
      !!(drop && (document.querySelector(sel)?.compareDocumentPosition(drop) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING));
    const link = [...document.querySelectorAll(".hero a")].find((a) => a.textContent?.trim() === "Use your own logs");
    return { after, link: link?.getAttribute("href") ?? null };
  });
  if (!order.after) problems.push("UX-R3: 'Try it on your own logs' is not after the chart and the By model/By project lists");
  if (order.link !== "#drop") problems.push(`UX-R3: hero has no 'Use your own logs' link to #drop (got ${order.link})`);

  // UX-R1: errors are announced from #drop-status, and the hero isn't a live region.
  const live = await page.evaluate(() => ({
    role: document.querySelector("#drop-status")?.getAttribute("role"),
    polite: document.querySelector("#drop-status")?.getAttribute("aria-live"),
    hero: document.querySelector(".hero")?.getAttribute("aria-live"),
  }));
  if (live.role !== "status" || live.polite !== "polite") problems.push(`UX-R1: #drop-status role=${live.role} aria-live=${live.polite}`);
  if (live.hero) problems.push(`UX-R1: .hero still has aria-live=${live.hero}`);

  // UX-R11: footer version matches the CLI package.
  if (!(await text("#footer-version")).includes(`v${cliVersion}`)) problems.push(`UX-R11: footer doesn't show v${cliVersion}`);

  // CCW-M2.6.4 coverage: the 7 days / 30 days / All time toggle marks one button pressed and
  // changes the total; going back to All time gives the same total as before.
  const total = () => page.evaluate(() => `${document.querySelector("#hero-big")?.textContent}|${document.querySelector("#hero-range")?.textContent}`);
  const pressed = () => page.$$eval("[data-window]", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.id));
  await page.click("#w-all");
  const allTime = await total();
  if ((await pressed()).join() !== "w-all") problems.push(`window toggle: pressed is ${(await pressed()).join()} after All time`);
  await page.click("#w-7d");
  if ((await pressed()).join() !== "w-7d") problems.push(`window toggle: pressed is ${(await pressed()).join()} after 7 days`);
  if ((await total()) === allTime) problems.push("window toggle: 7 days shows the same total as All time");
  await page.click("#w-all");
  if ((await total()) !== allTime) problems.push("window toggle: All time total changed after a round trip");

  // WI-3, WI-4 (CCW-M2.6.5): the "What if?" cache-read slider recomputes the hero, says it's a
  // what-if, leaves the share card and LinkedIn post on the published estimate, and Reset undoes it.
  if (!(await page.$("#whatif-cache"))) problems.push(`WI-3: no #whatif-cache slider at ${viewport.width}px`);
  else {
    const share = () => page.evaluate(() => `${document.querySelector("#card")?.getAttribute("src")}|${document.querySelector("#post")?.textContent}`);
    const noteShown = () => page.$eval("#whatif-note", (n: HTMLElement) => !n.hidden && n.getBoundingClientRect().height > 0).catch(() => null);
    const heroBefore = await text("#hero-big");
    const shareBefore = await share();
    const box = await page.$eval("#whatif-cache", (s) => s.getBoundingClientRect().height);
    if (box < 44) problems.push(`WI-3: slider is ${box.toFixed(1)}px tall at ${viewport.width}px (want 44+)`);
    // WI-R7: 48px slider box; WI-R6: the 1% / published / 25% scale is 13px or more.
    if (box < 48) problems.push(`WI-R7: slider is ${box.toFixed(1)}px tall at ${viewport.width}px (want 48+)`);
    const scalePx = await page.$eval(".whatif-scale", (s) => parseFloat(getComputedStyle(s).fontSize)).catch(() => 0);
    if (scalePx < 13) problems.push(`WI-R6: .whatif-scale is ${scalePx}px at ${viewport.width}px (want 13+)`);
    if ((await noteShown()) !== false) problems.push("WI-3: #whatif-note missing or shown before the slider moves");
    await page.$eval("#whatif-cache", (s: HTMLInputElement) => {
      s.value = s.max;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if ((await text("#hero-big")) === heroBefore) problems.push("WI-3: hero total did not change with the slider at its max");
    if (!(await noteShown())) problems.push("WI-3: #whatif-note not shown while a what-if is active");
    // WI-R4 changes the wording to "What-if at 25%…", so WI-3 accepts either spelling.
    else if (!/What[- ]if/.test(await text("#whatif-note"))) problems.push(`WI-3: #whatif-note says "${await text("#whatif-note")}", want it to contain "What if"`);
    if ((await share()) !== shareBefore) problems.push("WI-3: share card or LinkedIn post changed with the what-if slider (must stay the published estimate)");
    const valuetext = await page.$eval("#whatif-cache", (s) => s.getAttribute("aria-valuetext"));
    if (!valuetext?.includes("%")) problems.push(`WI-3: slider aria-valuetext is ${JSON.stringify(valuetext)}, want a percent`);
    // WI-4: the method version stays on screen during a what-if.
    if (!(await text("#hero-meta")).includes(`method v`)) problems.push("WI-4: hero meta line lost the method version during a what-if");
    if (!(await text("#footer-version")).includes("method v")) problems.push("WI-4: footer lost the method version during a what-if");
    // WI-R1: the page pins the moved parameter (low = high = value) instead of scaling its bounds.
    // With scaled bounds the sample's all-time high at 25% is 63.4 kWh; pinned it must be lower.
    const rangeHigh = async () => {
      const m = /[–-]\s*([\d.,]+)\s*(kWh|Wh)/.exec(await text("#hero-range"));
      return m?.[1] ? Number(m[1].replace(/,/g, "")) / (m[2] === "Wh" ? 1000 : 1) : NaN;
    };
    const highAtMax = await rangeHigh();
    if (!(highAtMax < 63)) problems.push(`WI-R1: hero range high at 25% is ${highAtMax} kWh (want < 63: the cache parameter should be pinned, not scaled)`);
    if (!(await text("#hero-range")).includes("with cache reads fixed at 25%")) problems.push(`WI-R1: hero range "${await text("#hero-range")}" doesn't say "with cache reads fixed at 25%"`);
    // WI-R4: the note is short, leads with the setting, and keeps the published figure and method version.
    const noteText = (await text("#whatif-note")).trim();
    const words = noteText.split(/\s+/).filter(Boolean).length;
    if (words > 30) problems.push(`WI-R4: #whatif-note is ${words} words (want 30 or fewer): "${noteText}"`);
    if (!noteText.startsWith("What-if at 25%")) problems.push(`WI-R4: #whatif-note should start "What-if at 25%", got "${noteText.slice(0, 40)}"`);
    if (!noteText.includes("Published:")) problems.push("WI-R4: #whatif-note lacks \"Published:\"");
    if (!noteText.includes("Method v")) problems.push("WI-R4: #whatif-note lacks \"Method v\"");
    // WI-R5: the hero flag names the setting.
    const flag = await page.$eval(".whatif-flag", (f) => f.textContent ?? "").catch(() => "");
    if (!flag.includes("what-if: cache reads 25%")) problems.push(`WI-R5: hero flag says "${flag}", want "what-if: cache reads 25%"`);
    await page.click("#whatif-reset");
    if ((await text("#hero-big")) !== heroBefore) problems.push("WI-3: Reset did not restore the hero total");
    if ((await noteShown()) !== false) problems.push("WI-3: #whatif-note still shown after Reset");
    // WI-R2: Reset hides itself, so focus goes back to the slider (click and Enter).
    const focused = () => page.evaluate(() => document.activeElement?.id ?? null);
    if ((await focused()) !== "whatif-cache") problems.push(`WI-R2: after clicking Reset focus is on #${await focused()}, want #whatif-cache`);
    // WI-R1 at the slider's min: the range still renders and names the pinned setting.
    await page.$eval("#whatif-cache", (s: HTMLInputElement) => {
      s.value = s.min;
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const minRange = await text("#hero-range");
    if (!(await rangeHigh() > 0)) problems.push(`WI-R1: hero range doesn't render at 1%: "${minRange}"`);
    if (!minRange.includes("with cache reads fixed at 1%")) problems.push(`WI-R1: hero range "${minRange}" doesn't say "with cache reads fixed at 1%"`);
    await page.focus("#whatif-reset");
    await page.keyboard.press("Enter");
    if ((await text("#hero-big")) !== heroBefore) problems.push("WI-R2: Enter on Reset did not restore the hero total");
    if ((await focused()) !== "whatif-cache") problems.push(`WI-R2: after Enter on Reset focus is on #${await focused()}, want #whatif-cache`);
    // Keyboard: ArrowRight on the focused slider moves it.
    const v0 = await page.$eval("#whatif-cache", (s: HTMLInputElement) => s.value);
    await page.focus("#whatif-cache");
    await page.keyboard.press("ArrowRight");
    if ((await page.$eval("#whatif-cache", (s: HTMLInputElement) => s.value)) === v0) problems.push("WI-3: ArrowRight did not change the slider value");
    await page.click("#whatif-reset");
  }

  // UX-R17 (CCW-M2.6.4): on a phone the 1200px share card shrinks its text under 11px, so an
  // "Open full size" link sits under the card preview.
  if (viewport.width <= 600) {
    const full = await page.evaluate(() => {
      const card = document.querySelector("#card");
      const link = [...document.querySelectorAll("a")].find((a) => /open full size/i.test(a.textContent ?? ""));
      if (!card || !link) return null;
      return { after: !!(card.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING), visible: link.getBoundingClientRect().height > 0 };
    });
    if (!full) problems.push(`UX-R17: no "Open full size" link for the share card at ${viewport.width}px`);
    else if (!full.after || !full.visible) problems.push(`UX-R17: "Open full size" link is ${full.visible ? "above the card" : "hidden"} at ${viewport.width}px`);
  }

  // UX-R1, UX-R2: a file with no usage keeps the sample state (the demo bar still says Sample data)
  // and shows the next-step error, styled as an error.
  await page.setInputFiles("#pick-files", noUsage);
  await page.waitForFunction(() => !/Reading/.test(document.querySelector("#drop-status")?.textContent ?? "Reading"));
  const failed = await page.evaluate(() => ({ status: document.querySelector("#drop-status")?.textContent, error: document.querySelector("#drop-status")?.classList.contains("error") }));
  const failedBar = await barText();
  if (!failedBar.includes("Sample data") || failedBar.includes("Your files")) problems.push(`UX-R1/DEMO-BAR: demo bar says "${failedBar}" after a file with no usage (want Sample data)`);
  if (failed.status !== "We couldn't find any Claude Code usage in that file. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.") problems.push(`UX-R2: no-usage file says "${failed.status}"`);
  if (!failed.error) problems.push("UX-R2: no-usage error has no .error class");
  const sampleHeadline = await text("#hero-big");
  await page.setInputFiles("#pick-files", log);
  await page.waitForFunction((h) => document.querySelector("#hero-big")?.textContent !== h, sampleHeadline, { timeout: 8000 }).catch(() => problems.push("headline did not change after loading a file"));
  // DEMO-BAR (was RR-16 on the lede and the pill): the bar follows the data source.
  await waitBar("Your files", "DEMO-BAR after loading a file");
  if ((await barText()).includes("Sample data")) problems.push(`DEMO-BAR: bar still says Sample data after loading a file ("${await barText()}")`);
  const wantFilesLong = viewport.width >= 600;
  if ((await barText()).includes("read in this browser only") !== wantFilesLong) problems.push(`DEMO-BAR: "· read in this browser only" ${wantFilesLong ? "missing" : "shown"} at ${viewport.width}px ("${await barText()}")`);
  await page.click("#w-7d");
  await page.click("#use-sample");
  if (!(await barText()).includes("Sample data") || (await barText()).includes("Your files")) problems.push(`DEMO-BAR: bar says "${await barText()}" after Use sample data (want Sample data)`);
  // Claude Code on the web: the copied prompt's counts-only output, pasted inside a code fence, loads.
  await page.click("#export > summary");
  const prompt = await text("#export-prompt");
  if (!prompt.includes("never the full path") || !prompt.includes("message content")) problems.push("export prompt lost its counts-only wording");
  await page.fill("#paste-log", ["```json", counts, "```"].join("\n"));
  await page.click("#read-paste");
  await waitBar("Your files", "DEMO-BAR after pasting lines");
  if (!(await text("#drop-status")).includes("pasted text")) problems.push("pasted lines did not load");
  if (await page.$eval("#drop-status", (s) => s.classList.contains("error"))) problems.push("UX-R2: success status still has the .error class");

  // UX-R2: empty paste and paste with no usage get their own next-step copy, styled as errors.
  const pastes: [pasted: string, want: string][] = [
    ["   ", "Paste the lines first."],
    ["hello, not a log", "We couldn't find any usage lines in that text. Paste the lines Claude printed, one JSON object per line."],
  ];
  for (const [pasted, want] of pastes) {
    await page.fill("#paste-log", pasted);
    await page.click("#read-paste");
    const got = await page.evaluate(() => ({ t: document.querySelector("#drop-status")?.textContent, error: document.querySelector("#drop-status")?.classList.contains("error") }));
    if (got.t !== want) problems.push(`UX-R2: paste ${JSON.stringify(pasted)} says "${got.t}", want "${want}"`);
    if (!got.error) problems.push(`UX-R2: paste ${JSON.stringify(pasted)} error has no .error class`);
  }

  // One day of usage: the meta line shows the date once, not "D to D".
  await page.fill("#paste-log", counts.split("\n").filter((l) => l.includes('"timestamp":"2026-10-01')).join("\n"));
  await page.click("#read-paste");
  const meta = await text("#hero-meta");
  if (/(\d{4}-\d{2}-\d{2}) to \1/.test(meta)) problems.push(`one-day span printed twice in the meta line: "${meta}"`);
  if (!meta.includes("2026-10-01")) problems.push(`one-day meta line lost its date: "${meta}"`);

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > viewport.width) problems.push(`horizontal scroll at ${viewport.width}px (${width}px wide)`);
  await page.close();
}
// DEMO-BAR (studio demo bar standard, docs/DEMO-BANNER.md in pm-tools; intake #73). The playground
// opens with a slim "Demo" bar whose Details button opens a push-down drawer. Every check names its ID.
{
  const BAR = 'section[aria-label="Demo"]';
  const TOGGLE = `${BAR} button[aria-label="Demo details"]`;
  const SAMPLE_COPY = "This is the real ccwatts, running on made-up sample data. Nothing you do is saved or sent anywhere; reload to start over.";
  const FILES_COPY = "This is the real ccwatts, now showing the files you picked. They were read in this browser and never uploaded; nothing is saved, so reload to start over.";
  const sideways = (page: import("playwright-core").Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const at = `at ${viewport.width}px ${colorScheme}`;
      const page = await browser.newPage({ viewport, colorScheme });
      page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`DEMO-BAR network request: ${r.url()}`); });
      page.on("pageerror", (e) => problems.push(`DEMO-BAR page error: ${e}`));
      await page.goto(pathToFileURL(page_).href);
      const bar = page.locator(BAR);
      if ((await bar.count()) !== 1) { problems.push(`DEMO-BAR-1: no single <section aria-label="Demo"> ${at}`); await page.close(); continue; }
      const toggle = page.locator(TOGGLE);
      if ((await toggle.count()) !== 1) { problems.push(`DEMO-BAR-1: no "Demo details" toggle button in the bar ${at}`); await page.close(); continue; }
      // DEMO-BAR-1: first thing on the page, collapsed on load, at most 48px tall.
      const first = await page.evaluate((sel) => {
        const b = document.querySelector(sel)!.getBoundingClientRect();
        const others = [...document.querySelectorAll("main *, body > *")].filter((el) => !el.closest(sel) && !el.contains(document.querySelector(sel)) && el.getBoundingClientRect().height > 0);
        return others.every((el) => el.getBoundingClientRect().top >= b.bottom - 1);
      }, BAR);
      if (!first) problems.push(`DEMO-BAR-1: something on the page sits above or beside the demo bar ${at}`);
      const h = (await bar.boundingBox())?.height ?? 0;
      if (!(h > 0 && h <= 48)) problems.push(`DEMO-BAR-1: collapsed bar is ${h}px tall ${at} (want 1-48)`);
      if ((await toggle.getAttribute("aria-expanded")) !== "false") problems.push(`DEMO-BAR-1: toggle not collapsed on load ${at}`);
      // DEMO-UX-R1: the bar row spans the page column: the back link lines up with the brand, and the
      // toggle (with "Details") runs to the row's right edge instead of sitting mid-bar.
      const align = await page.evaluate(() => {
        const [home, brand, tog, row, wrap] = ["#demo-home", ".brand", "#demo-toggle", ".demo-bar__row", "main.wrap"].map((sel) => document.querySelector(sel)?.getBoundingClientRect());
        return home && brand && tog && row && wrap ? { home: home.left, brand: brand.left, togRight: tog.right, rowRight: row.right, wrapRight: wrap.right } : null;
      });
      if (!align) problems.push(`DEMO-UX-R1: bar parts missing ${at}`);
      else {
        if (Math.abs(align.home - align.brand) > 1) problems.push(`DEMO-UX-R1: "← Portfolio" at x=${align.home.toFixed(0)}, brand at x=${align.brand.toFixed(0)} ${at}`);
        if (Math.abs(align.togRight - align.rowRight) > 1) problems.push(`DEMO-UX-R1: toggle ends at x=${align.togRight.toFixed(0)}, row at x=${align.rowRight.toFixed(0)} ${at}`);
        if (Math.abs(align.rowRight - align.wrapRight) > 1) problems.push(`DEMO-UX-R1: bar row ends at x=${align.rowRight.toFixed(0)}, page column at x=${align.wrapRight.toFixed(0)} ${at}`);
      }
      const panelId = (await toggle.getAttribute("aria-controls")) ?? "";
      const panel = page.locator(`[id="${panelId}"]`);
      if (!panelId || (await panel.count()) !== 1) { problems.push(`DEMO-BAR-1: aria-controls "${panelId}" names no element ${at}`); await page.close(); continue; }
      if (await panel.isVisible()) problems.push(`DEMO-BAR-1: drawer is open on load ${at}`);
      // DEMO-BAR-2: the way back is visible on the collapsed bar and goes to the portfolio.
      const home = bar.getByRole("link", { name: "← Portfolio" });
      const builtBy = await page.getAttribute("#built-by", "href");
      if (!(await home.isVisible().catch(() => false))) problems.push(`DEMO-BAR-2: "← Portfolio" link not visible on the collapsed bar ${at}`);
      else if ((await home.getAttribute("href")) !== builtBy) problems.push(`DEMO-BAR-2: "← Portfolio" goes to ${await home.getAttribute("href")}, want ${builtBy}`);
      // DEMO-BAR-3: middle text. Phone: "Sample data"; from 600px the long form too.
      const mid = await toggle.evaluate((t) => (t as HTMLElement).innerText);
      if (!mid.includes("Sample data")) problems.push(`DEMO-BAR-3: bar doesn't say "Sample data" ${at} ("${mid}")`);
      if (mid.includes("nothing leaves this browser") !== viewport.width >= 600) problems.push(`DEMO-BAR-3: "· nothing leaves this browser" ${viewport.width >= 600 ? "missing" : "shown"} ${at}`);
      if (!/Details/.test(mid)) problems.push(`DEMO-BAR-3: toggle has no "Details" label ${at}`);
      // DEMO-BAR-4: font and surface are the page's own; the badge is never --accent or --sample.
      const look = await page.evaluate(({ barSel, togSel }) => {
        const probe = document.createElement("i");
        document.body.append(probe);
        probe.style.color = "var(--accent)"; const accent = getComputedStyle(probe).color;
        probe.style.color = "var(--sample)"; const sample = getComputedStyle(probe).color;
        probe.style.color = "var(--ink)"; const ink = getComputedStyle(probe).color;
        probe.style.backgroundColor = "var(--surface)"; const surface = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const b = getComputedStyle(document.querySelector(barSel)!);
        const badge = [...document.querySelector(togSel)!.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "Demo");
        const bs = badge ? getComputedStyle(badge) : null;
        return { accent, sample, ink, surface, barFont: b.fontFamily, bodyFont: getComputedStyle(document.body).fontFamily, barBg: b.backgroundColor, barFg: b.color,
          badge: bs ? { color: bs.color, bg: bs.backgroundColor, border: bs.borderTopColor } : null };
      }, { barSel: BAR, togSel: TOGGLE });
      if (look.barFont !== look.bodyFont) problems.push(`DEMO-BAR-4: bar font "${look.barFont}" isn't the page's "${look.bodyFont}" ${at}`);
      if (look.barBg !== look.surface) problems.push(`DEMO-BAR-4: bar background ${look.barBg} isn't --surface ${look.surface} ${at}`);
      if (look.barFg !== look.ink) problems.push(`DEMO-BAR-4: bar text ${look.barFg} isn't --ink ${look.ink} ${at}`);
      if (!look.badge) problems.push(`DEMO-BAR-4: no "Demo" badge inside the toggle ${at}`);
      else for (const [k, v] of Object.entries(look.badge)) if (v === look.accent || v === look.sample) problems.push(`DEMO-BAR-4: badge ${k} ${v} is --accent/--sample ${at}`);
      // DEMO-BAR-5: one notice only. #source-pill hidden in the playground, the old #back-link gone,
      // and the lede no longer says "You're looking at sample data".
      if (await page.locator("#source-pill").isVisible().catch(() => false)) problems.push(`DEMO-BAR-5: #source-pill still visible in the playground ${at}`);
      if (await page.$("#back-link")) problems.push(`DEMO-BAR-5: old #back-link still on the page ${at}`);
      if (((await page.textContent("#lede")) ?? "").includes("You're looking at sample data")) problems.push(`DEMO-BAR-5: lede still says "You're looking at sample data" ${at}`);
      // DEMO-BAR-6: open pushes the page down and shows the standard copy at 16px/1.5, max 70ch.
      const contentTop = () => page.evaluate(() => document.querySelector("h1")!.getBoundingClientRect().top);
      const closedTop = await contentTop();
      await toggle.click();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") problems.push(`DEMO-BAR-6: toggle not aria-expanded=true after a click ${at}`);
      if (!(await panel.isVisible())) problems.push(`DEMO-BAR-6: drawer not shown after a click ${at}`);
      const panelText = await panel.evaluate((p) => (p as HTMLElement).innerText);
      if (!panelText.includes(SAMPLE_COPY)) problems.push(`DEMO-BAR-6: drawer copy isn't the standard sample copy ${at} ("${panelText.slice(0, 80)}")`);
      if (!((await contentTop()) > closedTop)) problems.push(`DEMO-BAR-6: opening the drawer doesn't push the page down ${at}`);
      const para = await panel.evaluate((p) => {
        const el = [...p.querySelectorAll("p")].find((x) => x.textContent?.includes("This is the real")) as HTMLElement | undefined;
        if (!el) return null;
        const cs = getComputedStyle(el);
        // getComputedStyle resolves ch to px, so measure 70ch in the paragraph's own font to compare.
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;width:70ch";
        el.append(probe);
        const ch70 = probe.getBoundingClientRect().width;
        probe.remove();
        return { size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), maxW: cs.maxWidth, ch70 };
      });
      if (!para || para.size < 16 || Math.abs(para.lh - 1.5) > 0.05) problems.push(`DEMO-BAR-6: drawer text is ${JSON.stringify(para)} ${at} (want 16px, 1.5 line height)`);
      else if (!/px$/.test(para.maxW) || parseFloat(para.maxW) > para.ch70 + 0.5) problems.push(`DEMO-BAR-6: drawer text max-width ${para.maxW} ${at} (want at most 70ch = ${para.ch70}px)`);
      // DEMO-BAR-7: drawer actions go to the portfolio and the repo; every bar control is 44px+.
      const back = panel.getByRole("link", { name: /Chase Holroyd's portfolio/ });
      const code = panel.getByRole("link", { name: "Code on GitHub" });
      if ((await back.count()) !== 1 || (await back.getAttribute("href")) !== builtBy) problems.push(`DEMO-BAR-7: drawer's "← Chase Holroyd's portfolio" missing or not ${builtBy} ${at}`);
      if ((await code.count()) !== 1 || (await code.getAttribute("href")) !== (await page.getAttribute("#repo-link", "href"))) problems.push(`DEMO-BAR-7: drawer's "Code on GitHub" missing or not the repo link ${at}`);
      const small = await page.$$eval(`${BAR} a, ${BAR} button`, (els) => (els as HTMLElement[]).filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map((e) => `${(e.textContent ?? "").trim()} ${e.getBoundingClientRect().height.toFixed(0)}px`));
      if (small.length) problems.push(`DEMO-BAR-7: bar controls under 44px ${at}: ${small.join(", ")}`);
      // DEMO-BAR-8: Esc (from inside the drawer) closes it and puts focus back on the toggle.
      if (await code.count()) await code.focus(); else await toggle.focus();
      await page.keyboard.press("Escape");
      if ((await toggle.getAttribute("aria-expanded")) !== "false" || (await panel.isVisible())) problems.push(`DEMO-BAR-8: Esc didn't close the drawer ${at}`);
      if (!(await toggle.evaluate((t) => t === document.activeElement))) problems.push(`DEMO-BAR-8: after Esc focus isn't on the toggle ${at}`);
      if (Math.abs((await contentTop()) - closedTop) > 1) problems.push(`DEMO-BAR-8: page didn't move back up after Esc ${at}`);
      // DEMO-BAR-9: after loading a file, the bar and drawer say "Your files"; Use sample data restores them.
      await page.setInputFiles("#pick-files", log);
      await page.waitForFunction((sel) => ((document.querySelector(sel) as HTMLElement | null)?.innerText ?? "").includes("Your files"), TOGGLE, { timeout: 8000 })
        .catch(() => problems.push(`DEMO-BAR-9: bar never says "Your files" after loading a file ${at}`));
      await toggle.click();
      if (!(await panel.evaluate((p) => (p as HTMLElement).innerText)).includes(FILES_COPY)) problems.push(`DEMO-BAR-9: drawer copy isn't the own-files copy after loading a file ${at}`);
      await toggle.click();
      await page.click("#use-sample");
      const back2 = await toggle.evaluate((t) => (t as HTMLElement).innerText);
      if (!back2.includes("Sample data") || back2.includes("Your files")) problems.push(`DEMO-BAR-9: bar says "${back2}" after Use sample data ${at}`);
      await toggle.click();
      if (!(await panel.evaluate((p) => (p as HTMLElement).innerText)).includes(SAMPLE_COPY)) problems.push(`DEMO-BAR-9: drawer copy didn't go back to the sample copy ${at}`);
      // DEMO-BAR-10: a file with no usage keeps the sample state.
      await toggle.click();
      await page.setInputFiles("#pick-files", noUsage);
      await page.waitForFunction(() => !/Reading/.test(document.querySelector("#drop-status")?.textContent ?? "Reading"));
      const kept = await toggle.evaluate((t) => (t as HTMLElement).innerText);
      if (!kept.includes("Sample data") || kept.includes("Your files")) problems.push(`DEMO-BAR-10: bar says "${kept}" after a file with no usage ${at}`);
      if ((await sideways(page)) > 0) problems.push(`DEMO-BAR: page scrolls sideways ${at}`);
      await page.close();
    }
  }

  // DEMO-BAR-11: no sideways scroll at 320px (collapsed and open); middle text hidden below 360px.
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await page.goto(pathToFileURL(page_).href);
    const toggle = page.locator(TOGGLE);
    if ((await toggle.count()) !== 1) problems.push("DEMO-BAR-11: no demo bar toggle at 320px");
    else {
      if ((await sideways(page)) > 0) problems.push(`DEMO-BAR-11: scrolls sideways by ${await sideways(page)}px at 320px`);
      if (!(await page.locator(BAR).getByRole("link", { name: "← Portfolio" }).isVisible().catch(() => false))) problems.push("DEMO-BAR-11: back link not visible at 320px");
      if ((await toggle.evaluate((t) => (t as HTMLElement).innerText)).includes("Sample data")) problems.push("DEMO-BAR-11: middle text shown below 360px");
      const h = (await page.locator(BAR).boundingBox())?.height ?? 0;
      if (!(h > 0 && h <= 48)) problems.push(`DEMO-BAR-11: collapsed bar is ${h}px tall at 320px`);
      await toggle.click();
      if ((await sideways(page)) > 0) problems.push(`DEMO-BAR-11: open drawer scrolls sideways by ${await sideways(page)}px at 320px`);
    }
    await page.close();
  }

  // DEMO-BAR-12: under reduced motion the chevron doesn't animate.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await page.goto(pathToFileURL(page_).href);
    const durs = await page.evaluate((sel) => [...(document.querySelector(sel)?.querySelectorAll('[aria-hidden="true"]') ?? [])].map((el) => getComputedStyle(el).transitionDuration), TOGGLE);
    if (!durs.length) problems.push("DEMO-BAR-12: toggle has no aria-hidden chevron");
    else if (durs.some((d) => d.split(",").some((x) => parseFloat(x) > 0))) problems.push(`DEMO-BAR-12: chevron still animates under reduced motion (${durs.join(" / ")})`);
    await page.close();
  }

  // DEMO-BAR-13: dashboard mode (the user's own history) shows no demo bar and keeps its "Your history" pill.
  {
    const row = { date: "2026-10-01", source: "claude-code", model: "claude-opus-4-6", projectId: "0000000000000000", projectName: "proj", responses: 1, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 50 } };
    const json = JSON.stringify({ mode: "dashboard", generatedAt: new Date().toISOString(), rows: [row] }).replace(/</g, "\\u003c");
    const html = readFileSync(page_, "utf8").replace(/(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_m, open, _old, close) => `${open}${json}${close}`);
    const dash = join(scratch, "demo-bar-dashboard.html");
    writeFileSync(dash, html);
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.on("pageerror", (e) => problems.push(`DEMO-BAR-13 page error: ${e}`));
      await page.goto(pathToFileURL(dash).href);
      if (await page.locator(BAR).isVisible().catch(() => false)) problems.push(`DEMO-BAR-13: demo bar shown in dashboard mode at ${width}px`);
      if (await page.getByRole("button", { name: "Demo details" }).isVisible().catch(() => false)) problems.push(`DEMO-BAR-13: "Demo details" toggle shown in dashboard mode at ${width}px`);
      const pill = await page.locator("#source-pill").isVisible().catch(() => false) ? await page.textContent("#source-pill") : null;
      if (pill !== "Your history") problems.push(`DEMO-BAR-13: dashboard #source-pill is ${JSON.stringify(pill)} at ${width}px (want visible "Your history")`);
      await page.close();
    }
  }
}

// PS-R2 (privacy-security, CCW-M2.6.4): the chart writes day keys into svg.innerHTML. A dashboard
// row with markup for a date (a hand-edited or corrupt history file; the dashboard reads rows
// without the parser's checks) must render as text, never as an element.
{
  const xssRow = (date: string) => ({ date, source: "claude-code", model: "claude-opus-4-6", projectId: "0000000000000000", projectName: "proj", responses: 1, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 50 } });
  const rows = [xssRow("2026-10-01"), xssRow("<i id=xss>")];
  const json = JSON.stringify({ mode: "dashboard", generatedAt: new Date().toISOString(), rows }).replace(/</g, "\\u003c");
  const html = readFileSync(page_, "utf8").replace(/(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_m, open, _old, close) => `${open}${json}${close}`);
  const crafted = join(scratch, "ps-r2-dashboard.html");
  writeFileSync(crafted, html);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => problems.push(`PS-R2 page error: ${e}`));
  await page.goto(pathToFileURL(crafted).href);
  await page.click("#w-all");
  if (await page.$("#xss")) problems.push("PS-R2: a row's date was rendered as markup (found <i id=xss> in the page)");
  await page.close();
}

// Generic checks from the showcase kit (unfinished text, broken images, tiny text, plus light and
// dark mode), on the same browser. Everything above is specific to this page.
for (const p of await showcaseCheck({
  url: pathToFileURL(page_).href,
  browser,
  viewports: [{ width: 1280, height: 900 }, { width: 390, height: 844 }],
  tapTargets: "button, label.btn", // RR-9
  keyboardReach: ["pick-folder", "pick-files"], // RR-5
  tabPresses: 12,
  minTextPx: 11, // the chart-label floor from RR-8
})) problems.push(`showcase kit: ${p}`);

await browser.close();
rmSync(scratch, { recursive: true, force: true });

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Playground check passed: no network requests, no errors, no sideways scroll.");
