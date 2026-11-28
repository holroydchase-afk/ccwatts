// Browser check for the playground: loads the built page in headless Chromium, uses sample data,
// loads a log file through the file picker, and fails if the page makes any network request,
// logs an error, or scrolls sideways on a phone.
//
// Needs Playwright, which is not a project dependency:  npx playwright@1 install chromium
// Run after `npm run build`:                            tsx scripts/check-no-network.ts
// Set PLAYWRIGHT_MODULE to a Playwright path and CHROMIUM_PATH to a browser binary if needed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChromium, showcaseCheck } from "../tools/showcase-check/check.ts";
import { PORTFOLIO_URL, REPO_URL } from "../packages/core/src/meta.ts";

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
// STUDIO-DS: the page shows one tab panel at a time (Overview is the default). Checks on panel content
// select its tab first. Your logs (#drop) is no longer a tab: the Overview CTA #ov-cta ("Try it on your logs") opens it.
const tab = (page: import("playwright-core").Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
const openLogs = async (page: import("playwright-core").Page) => {
  await tab(page, "Overview");
  await page.click("#ov-cta");
};
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
  // SITEHDR-14 (was DEMO-BAR): the "About this demo" drawer's copy says which data is on screen;
  // app.ts shows #demo-copy-sample or #demo-copy-files. "Sample data" / "Your files" name that state.
  const barText = () => page.evaluate(() => ["demo-copy-sample", "demo-copy-files"]
    .filter((id) => { const el = document.getElementById(id); return !!el && !el.hidden; })
    .map((id) => (id === "demo-copy-sample" ? "Sample data" : "Your files")).join(" + ") || "(no demo copy shown)");
  const waitBar = (want: string, why: string) => page.waitForFunction((w) => {
    const el = document.getElementById(w === "Your files" ? "demo-copy-files" : "demo-copy-sample");
    return !!el && !el.hidden;
  }, want, { timeout: 8000 })
    .then(() => true, () => { problems.push(`${why}: the demo drawer copy never switched to "${want}" at ${viewport.width}px`); return false; });

  if ((await barText()) !== "Sample data") problems.push(`DEMO-BAR: did not open on sample data (drawer copy: "${await barText()}")`);

  // Keyboard: Tab reaches the tabs and the Overview CTA "Try it on your logs" (#ov-cta); Enter on it opens
  // Your logs, and Tab then reaches both file pickers (recruiter-ready RR-5, now through #ov-cta, M4.8.1).
  const reached = new Set<string | undefined>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.id));
  }
  for (const id of ["tab-overview", "ov-cta"]) if (!reached.has(id)) problems.push(`Tab never reaches #${id} at ${viewport.width}px`);
  await page.focus("#ov-cta");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.id));
  }
  for (const id of ["pick-folder", "pick-files"]) if (!reached.has(id)) problems.push(`Tab never reaches #${id} from Your logs (#ov-cta) at ${viewport.width}px`);

  // Tap targets: every button 48px tall or more (RR-9, STUDIO-DS target 48), including link buttons like the CTA.
  const short = await page.$$eval("main button, label.btn, a.btn", (els) => (els as HTMLElement[]).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 48).map((e) => e.id || (e.textContent ?? "").trim()));
  // Chart labels stay readable on a phone: drawn at the screen's pixel width, never scaled down (RR-8):
  // 17px text (STUDIO-DS body floor) at real size.
  await tab(page, "Electricity");
  const label = await page.$eval("#chart text", (t) => parseFloat(getComputedStyle(t).fontSize) * ((t as SVGGraphicsElement).getScreenCTM()?.a ?? 1));
  if (label < 16.95) problems.push(`chart labels ${label.toFixed(1)}px at ${viewport.width}px (want 17+)`);
  // Method table: no sideways scroll inside it on a phone, distinct source links 48px tall (RR-10, RR-11).
  // Closed <details> content takes no space now, so open the Method tab and the parameter table first.
  await tab(page, "Method");
  // EF-12 (intake #112): #params-box starts open, so only click it open if it is closed.
  const paramsWasOpen = await page.$eval("#params-box", (d) => (d as HTMLDetailsElement).open);
  if (!paramsWasOpen) await page.click("#params-box > summary");
  const table = await page.$eval(".tablewrap", (t) => ({ over: t.scrollWidth - t.clientWidth }));
  if (table.over > 1) problems.push(`method table scrolls sideways by ${table.over}px at ${viewport.width}px`);
  const links = await page.$$eval("#params a", (as) => as.map((a) => ({ t: (a.textContent ?? "").trim(), h: a.getBoundingClientRect().height })));
  if (links.some((l) => l.t === "source")) problems.push("source links don't name their source");
  if (links.some((l) => l.h < 48)) problems.push(`source links under 48px at ${viewport.width}px`);
  if (!paramsWasOpen) await page.click("#params-box > summary");
  // Phones get a hint that logs live on a computer (RR-13).
  await openLogs(page);
  const hint = await page.$eval("#phone-hint", (h) => h.getBoundingClientRect().height > 0).catch(() => null);
  if (hint !== viewport.width < 600) problems.push(`phone hint ${hint ? "shown" : "missing"} at ${viewport.width}px`);
  await tab(page, "Electricity");
  // CCW-UX1: the hero's meta line breaks between items, never inside a date or a number.
  const metaParts = await page.$$eval("#hero-meta > span", (ss) => ss.map((s) => ({ t: s.textContent, lines: s.getClientRects().length })));
  if (metaParts.length < 3) problems.push("hero meta line isn't split into items");
  for (const m of metaParts) if (m.lines > 1) problems.push(`hero meta item "${m.t}" wraps at ${viewport.width}px`);
  if (short.length) problems.push(`buttons under 48px at ${viewport.width}px: ${short.join(", ")}`);

  // UX-R4: reading text is in the sans stack; mono is for numbers and code only.
  // Callbacks that run in the page declare no named functions: tsx keeps function names with an
  // esbuild __name() helper that exists in Node but not in the browser.
  const fonts = await page.evaluate(() => {
    const [body, post] = [document.body, document.querySelector("#post")]
      .map((el) => (el ? getComputedStyle(el).fontFamily : "(missing)"));
    return {
      body: body!,
      paragraphs: [...document.querySelectorAll("main p")].filter((p) => p.textContent?.trim())
        .map((p) => ({ id: p.id || p.className || (p.textContent ?? "").slice(0, 30), f: getComputedStyle(p).fontFamily })),
      methodNotes: [...document.querySelectorAll("#params details .note")].map((d) => getComputedStyle(d).fontFamily),
      post: post!,
    };
  });
  if (!/^"?Atkinson Hyperlegible Next"?, system-ui, sans-serif$/.test(fonts.body)) problems.push(`UX-R4/STUDIO-DS: body font is ${fonts.body}, want "Atkinson Hyperlegible Next", system-ui, sans-serif`);
  for (const p of fonts.paragraphs) if (MONO.test(p.f)) problems.push(`UX-R4: paragraph ${p.id} is monospace at ${viewport.width}px`);
  if (!fonts.methodNotes.length || fonts.methodNotes.some((f) => MONO.test(f))) problems.push("UX-R4: method descriptions are monospace (or missing)");
  if (MONO.test(fonts.post)) problems.push("UX-R4: LinkedIn post preview is monospace");

  // UX-R5: method cards fold into a <details>; the phone page stays short.
  if (!(await page.$eval("#params", (t) => !!t.closest("details")))) problems.push("UX-R5: method parameter table is not inside a <details>");
  if (viewport.width < 600) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height >= 4500) problems.push(`UX-R5: page is ${height}px tall at ${viewport.width}x${viewport.height} (want under 4500)`);
  }

  // UX-R3 (STUDIO-DS): the "Try it" box sits in the Overview, apart from the chart and the rankings,
  // and the Overview CTA "Try it on your logs" (#ov-cta, M4.8.1) opens it.
  const order = await page.evaluate(() => {
    const drop = document.querySelector("#drop");
    const apart = !!drop?.closest("#p-overview") && ["#chart", "#by-model", "#by-project"].every((sel) => !document.querySelector(sel)?.closest("#p-overview"));
    const row = document.querySelector("#ov-cta");
    return { apart, link: row && /^\s*Try it on your logs\s*$/.test(row.textContent ?? "") ? row.getAttribute("href") : null };
  });
  if (!order.apart) problems.push("UX-R3: 'Try it on your own logs' is not in the Overview, apart from the chart and the By model/By project lists");
  if (order.link !== "#drop") problems.push(`UX-R3: no Overview CTA 'Try it on your logs' linking to #drop (got ${order.link})`);

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
  const total = () => page.evaluate(() => `${document.querySelector("#hero-big")?.textContent}|${document.querySelector("#hero-range")?.getAttribute("aria-label")}`);
  // The hero's range is a bar (role=img); its words are in the aria-label.
  const rangeText = async () => (await page.getAttribute("#hero-range", "aria-label")) ?? "";
  const pressed = () => page.$$eval("[data-window]", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.id));
  await page.click("#w-all");
  const allTime = await total();
  if ((await pressed()).join() !== "w-all") problems.push(`window toggle: pressed is ${(await pressed()).join()} after All time`);
  await page.click("#w-7d");
  if ((await pressed()).join() !== "w-7d") problems.push(`window toggle: pressed is ${(await pressed()).join()} after 7 days`);
  if ((await total()) === allTime) problems.push("window toggle: 7 days shows the same total as All time");
  await page.click("#w-all");
  if ((await total()) !== allTime) problems.push("window toggle: All time total changed after a round trip");

  // EST-20 (was UX-R30, a phone <details> fold for What if): retired by the STUDIO-DS tabs. What if now
  // sits in the Electricity tab, so it no longer adds to the Overview's height; UX-R5 above still
  // caps the phone page. estimate-web.test.ts EST-20 checks the slider stays in that tab.

  // WI-3, WI-4 (CCW-M2.6.5): the "What if?" cache-read slider recomputes the hero, says it's a
  // what-if, leaves the share card and LinkedIn post on the published estimate, and Reset undoes it.
  await tab(page, "Electricity"); // the What if slider sits under "What drives your number"
  if (!(await page.$("#whatif-cache"))) problems.push(`WI-3: no #whatif-cache slider at ${viewport.width}px`);
  else {
    const share = () => page.evaluate(() => `${document.querySelector("#card")?.getAttribute("src")}|${document.querySelector("#post")?.textContent}`);
    const noteShown = () => page.$eval("#whatif-note", (n: HTMLElement) => !n.hidden && n.getBoundingClientRect().height > 0).catch(() => null);
    const heroBefore = await text("#hero-big");
    const shareBefore = await share();
    const box = await page.$eval("#whatif-cache", (s) => s.getBoundingClientRect().height);
    if (box < 44) problems.push(`WI-3: slider is ${box.toFixed(1)}px tall at ${viewport.width}px (want 44+)`);
    // WI-R7: 48px slider box; WI-R6: the 1% / published / 25% scale is 17px or more (STUDIO-DS).
    if (box < 48) problems.push(`WI-R7: slider is ${box.toFixed(1)}px tall at ${viewport.width}px (want 48+)`);
    const scalePx = await page.$eval(".whatif-scale", (s) => parseFloat(getComputedStyle(s).fontSize)).catch(() => 0);
    if (scalePx < 17) problems.push(`WI-R6: .whatif-scale is ${scalePx}px at ${viewport.width}px (want 17+)`);
    // EF-1 (intake #112): the note shows the published total with its range and method version on load, not a what-if.
    const loadNote = async () => {
      if (!(await noteShown())) return "missing or hidden";
      const t = await text("#whatif-note");
      return /range/.test(t) && /Method v\d/.test(t) && !/What[- ]if/.test(t) ? null : `says "${t}"`;
    };
    const onLoad = await loadNote();
    if (onLoad) problems.push(`WI-3: #whatif-note on load ${onLoad} (want the total with range and Method v, not a what-if)`);
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
      const m = /[–-]\s*([\d.,]+)\s*(kWh|Wh)/.exec(await rangeText());
      return m?.[1] ? Number(m[1].replace(/,/g, "")) / (m[2] === "Wh" ? 1000 : 1) : NaN;
    };
    const highAtMax = await rangeHigh();
    if (!(highAtMax < 63)) problems.push(`WI-R1: hero range high at 25% is ${highAtMax} kWh (want < 63: the cache parameter should be pinned, not scaled)`);
    if (!(await rangeText()).includes("with cache reads fixed at 25%")) problems.push(`WI-R1: hero range "${await rangeText()}" doesn't say "with cache reads fixed at 25%"`);
    // WI-R4: the note is short, leads with the setting, and keeps the published figure and method version.
    const noteText = (await text("#whatif-note")).trim();
    const words = noteText.split(/\s+/).filter(Boolean).length;
    if (words > 30) problems.push(`WI-R4: #whatif-note is ${words} words (want 30 or fewer): "${noteText}"`);
    if (!noteText.startsWith("What-if at 25%")) problems.push(`WI-R4: #whatif-note should start "What-if at 25%", got "${noteText.slice(0, 40)}"`);
    // UX-R71 (intake #112 review): "Published 10%:" replaces "Published:".
    if (!/Published( \d+%)?:/.test(noteText)) problems.push("WI-R4: #whatif-note lacks \"Published 10%:\"");
    if (!noteText.includes("Method v")) problems.push("WI-R4: #whatif-note lacks \"Method v\"");
    // WI-R5: the hero flag names the setting.
    const flag = await page.$eval(".whatif-flag", (f) => f.textContent ?? "").catch(() => "");
    if (!flag.includes("what-if: cache reads 25%")) problems.push(`WI-R5: hero flag says "${flag}", want "what-if: cache reads 25%"`);
    await page.click("#whatif-reset");
    if ((await text("#hero-big")) !== heroBefore) problems.push("WI-3: Reset did not restore the hero total");
    const afterReset = await loadNote();
    if (afterReset) problems.push(`WI-3: #whatif-note after Reset ${afterReset} (want the load text back)`);
    // WI-R2: Reset hides itself, so focus goes back to the slider (click and Enter).
    const focused = () => page.evaluate(() => document.activeElement?.id ?? null);
    if ((await focused()) !== "whatif-cache") problems.push(`WI-R2: after clicking Reset focus is on #${await focused()}, want #whatif-cache`);
    // WI-R1 at the slider's min: the range still renders and names the pinned setting.
    await page.$eval("#whatif-cache", (s: HTMLInputElement) => {
      s.value = s.min;
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const minRange = await rangeText();
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
  await tab(page, "Share");
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
  await tab(page, "Electricity");
  await page.click("#w-7d");
  await openLogs(page);
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
// SITEHDR Part A (docs/product/SPEC-SITE-HEADER.md): the portfolio's site header on the playground.
// The old DEMO-BAR-1..12 strip checks retired with Part B (Chase, Nov 25); the static half of these
// checks is packages/web/test/site-header.test.ts. Selected by role and label. Every check names its ID.
type Pw = import("playwright-core").Page;
const sideways = (page: Pw) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const SITE_ORIGIN = new URL(PORTFOLIO_URL).origin;
const HDR_LIGHT = { bg: "rgb(255, 255, 255)", ink: "rgb(20, 22, 26)", accent: "rgb(11, 122, 75)" };
const HDR_DARK = { bg: "rgb(19, 18, 16)", ink: "rgb(242, 240, 234)", accent: "rgb(76, 195, 138)" };
/** The header's parts, by role and label. includeHidden, so "hidden at this width" is a visibility check, not a missing element. */
const headerParts = (page: Pw) => {
  const bar = page.locator("#site-bar");
  const nav = bar.getByRole("navigation", { name: "Site", exact: true, includeHidden: true });
  return {
    bar,
    back: bar.getByRole("link", { name: "Chase Holroyd, back to the portfolio", exact: true, includeHidden: true }),
    nav,
    building: nav.getByRole("link", { name: "Building", exact: true, includeHidden: true }),
    agents: nav.getByRole("link", { name: "Agents", exact: true, includeHidden: true }),
    label: bar.getByText("ccwatts demo", { exact: true }),
    caseStudy: bar.getByRole("link", { name: "Case study", exact: true, includeHidden: true }),
    toggle: bar.getByRole("button", { name: "About this demo", exact: true, includeHidden: true }),
  };
};
const headerColours = (page: Pw) => page.evaluate(() => {
  const bar = document.querySelector("#site-bar");
  const cs = [...document.querySelectorAll("#site-bar a")].find((a) => (a.textContent ?? "").trim() === "Case study");
  return bar ? { bg: getComputedStyle(bar).backgroundColor, ink: getComputedStyle(bar).color, accent: cs ? getComputedStyle(cs).color : "(no Case study link)" } : null;
});
{
  const views = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }];
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of views) {
      const at = `at ${viewport.width}px ${colorScheme}`;
      const wide = viewport.width >= 560;
      const page = await browser.newPage({ viewport, colorScheme });
      page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`SITEHDR-9: network request ${r.url()} ${at}`); });
      page.on("pageerror", (e) => problems.push(`SITEHDR page error: ${e} ${at}`));
      await page.goto(pathToFileURL(page_).href);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const h = headerParts(page);
      if ((await h.bar.count()) !== 1) { problems.push(`SITEHDR-1: no single #site-bar ${at}`); await page.close(); continue; }
      // SITEHDR-1: the first visible element, 52px tall, fixed at top 0.
      const geo = await h.bar.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const above = [...document.querySelectorAll("body *")]
          .filter((el) => !b.contains(el) && !el.contains(b) && el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }))
          .filter((el) => { const q = el.getBoundingClientRect(); return q.width > 1 && q.height > 1 && q.top < r.bottom - 1; })
          .map((el) => el.id || el.tagName.toLowerCase());
        return { tag: b.tagName, top: r.top, height: r.height, position: cs.position, above };
      });
      if (geo.tag !== "HEADER") problems.push(`SITEHDR-1: #site-bar is a <${geo.tag.toLowerCase()}>, want <header> ${at}`);
      if (geo.position !== "fixed" || Math.abs(geo.top) > 0.5) problems.push(`SITEHDR-1: #site-bar is position ${geo.position} at top ${geo.top}, want fixed at 0 ${at}`);
      if (Math.abs(geo.height - 52) > 0.5) problems.push(`SITEHDR-1: #site-bar is ${geo.height}px tall, want 52 ${at}`);
      if (geo.above.length) problems.push(`SITEHDR-1: visible elements sit above or under the header: ${geo.above.slice(0, 6).join(", ")} ${at}`);
      // SITEHDR-1: in order: back link, nav "Site", "ccwatts demo", "Case study".
      const parts = [h.back, h.nav, h.label, h.caseStudy];
      const counts = await Promise.all(parts.map((l) => l.count()));
      if (counts.some((c) => c !== 1)) problems.push(`SITEHDR-1: header parts back/nav/label/Case study found ${counts.join("/")} times, want 1 each ${at}`);
      else {
        const handles = await Promise.all(parts.map((l) => l.elementHandle()));
        const inOrder = await page.evaluate((els) => els.every((el, i) => i === 0 || !!(els[i - 1]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING)), handles);
        if (!inOrder) problems.push(`SITEHDR-1: header parts are not in the order back link, nav, "ccwatts demo", "Case study" ${at}`);
        const backText = ((await h.back.textContent()) ?? "").replace(/\s+/g, " ").trim();
        if (backText !== "← Chase Holroyd") problems.push(`SITEHDR-1: back link reads "${backText}", want "← Chase Holroyd" ${at}`);
        for (const [name, l] of [["back link", h.back], ['"ccwatts demo"', h.label]] as const) if (!(await l.isVisible())) problems.push(`SITEHDR-1: ${name} hidden ${at}`);
        for (const [name, l] of [['nav "Site"', h.nav], ['"Case study"', h.caseStudy]] as const) {
          const vis = await l.isVisible();
          if (vis !== wide) problems.push(`SITEHDR-1: ${name} is ${vis ? "visible" : "hidden"} ${at}, want ${wide ? "visible" : "hidden"}`);
        }
      }
      // SITEHDR-2: absolute hrefs from the PORTFOLIO_URL origin; "Case study" is PORTFOLIO_URL.
      const hrefs: [string, typeof h.back, string][] = [["back link", h.back, `${SITE_ORIGIN}/`], ["Building", h.building, `${SITE_ORIGIN}/building.html`], ["Agents", h.agents, `${SITE_ORIGIN}/agents.html`], ["Case study", h.caseStudy, PORTFOLIO_URL]];
      for (const [name, l, want] of hrefs) {
        const got = (await l.count()) === 1 ? await l.getAttribute("href") : "(missing)";
        if (got !== want) problems.push(`SITEHDR-2: ${name} href is ${got}, want ${want} ${at}`);
      }
      // SITEHDR-3: the header follows the OS when the picker is on System (the default).
      const want = colorScheme === "light" ? HDR_LIGHT : HDR_DARK;
      const got = await headerColours(page);
      if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`SITEHDR-3: header bg/ink/accent ${JSON.stringify(got)}, want ${JSON.stringify(want)} (System, OS ${colorScheme}) ${at}`);
      // SITEHDR UX-R1 (ux-reviewer, P1): the name is bold (700) and its arrow is an <i aria-hidden> in the header accent.
      const nm = await h.back.evaluate((b) => {
        const i = b.querySelector("i[aria-hidden='true']");
        return { weight: getComputedStyle(b).fontWeight, arrow: i ? (i.textContent ?? "").trim() : null, arrowColour: i ? getComputedStyle(i).color : null };
      }).catch(() => null);
      if (!nm || nm.weight !== "700") problems.push(`SITEHDR UX-R1: back link "Chase Holroyd" is weight ${nm?.weight}, want 700 ${at}`);
      if (!nm || nm.arrow !== "←" || nm.arrowColour !== want.accent) problems.push(`SITEHDR UX-R1: back link arrow is ${nm?.arrow === null ? "not in an <i aria-hidden=\"true\">" : `"${nm?.arrow}" in ${nm?.arrowColour}`}, want "←" in the accent ${want.accent} ${at}`);
      // SITEHDR UX-R2 (ux-reviewer): at 1280 the text "Chase Holroyd" and "Building" sit at least 18px apart (links padded 0 6px).
      if (viewport.width === 1280) {
        const gap = await page.evaluate(() => {
          // No named helper here: tsx would wrap it in __name(), which the page doesn't have.
          const els = [document.querySelector("#site-bar a[aria-label='Chase Holroyd, back to the portfolio']"), [...document.querySelectorAll("#site-bar nav a")].find((a) => a.textContent?.trim() === "Building")];
          if (!els[0] || !els[1]) return null;
          const [back, building] = els.map((el) => { const r = document.createRange(); r.selectNodeContents(el!); return r.getBoundingClientRect(); });
          return building!.left - back!.right;
        });
        if (gap === null || gap < 18) problems.push(`SITEHDR UX-R2: "Chase Holroyd" to "Building" text gap is ${gap?.toFixed(1)}px, want >= 18 ${at}`);
      }
      // SITEHDR-4: font, 44px targets.
      const font = await h.bar.evaluate((b) => { const cs = getComputedStyle(b); return { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight }; });
      if (!/^"?Atkinson Hyperlegible Next"?,\s*system-ui/.test(font.family) || font.size !== "15px" || font.weight !== "500") problems.push(`SITEHDR-4: header font is ${JSON.stringify(font)}, want "Atkinson Hyperlegible Next", system-ui at 15px weight 500 ${at}`);
      const small = await page.$$eval("#site-bar a, #site-bar button", (els) => (els as HTMLElement[]).filter((e) => e.checkVisibility() && e.getBoundingClientRect().height < 44).map((e) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim()} ${e.getBoundingClientRect().height.toFixed(0)}px`));
      if (small.length) problems.push(`SITEHDR-4: header targets under 44px tall: ${small.join(", ")} ${at}`);
      // SITEHDR-4: a 2px accent outline on keyboard focus, on every visible header link.
      const rings: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || !el.closest("#site-bar") || el.tagName !== "A") return null;
          const cs = getComputedStyle(el);
          return { name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), ring: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
        });
        if (r) rings[r.name] = r.ring;
      }
      const visibleLinks = await page.$$eval("#site-bar a", (as) => (as as HTMLElement[]).filter((a) => a.checkVisibility()).map((a) => (a.getAttribute("aria-label") ?? a.textContent ?? "").trim()));
      if (!visibleLinks.length) problems.push(`SITEHDR-4: no visible header links to focus ${at}`);
      for (const name of visibleLinks) {
        if (!(name in rings)) problems.push(`SITEHDR-4: Tab never reaches header link "${name}" ${at}`);
        else if (rings[name] !== `solid 2px ${want.accent}`) problems.push(`SITEHDR-4: header link "${name}" focus ring is "${rings[name]}", want "solid 2px ${want.accent}" ${at}`);
      }
      // SITEHDR-5: playground light paints the page and tabs white; --bg stays #F7F7F4; cards keep their ring. Dark unchanged.
      const paint = await page.evaluate(() => {
        const probe = document.createElement("i");
        document.body.append(probe);
        probe.style.color = "var(--bg)"; const bg = getComputedStyle(probe).color;
        probe.style.color = "var(--line)"; const line = getComputedStyle(probe).color;
        probe.remove();
        const card = document.querySelector(".card");
        return { body: getComputedStyle(document.body).backgroundColor, tabs: getComputedStyle(document.querySelector(".tabs")!).backgroundColor, bg, line, ring: card ? getComputedStyle(card).boxShadow : "(no .card)" };
      });
      if (colorScheme === "light") {
        if (paint.body !== "rgb(255, 255, 255)" || paint.tabs !== "rgb(255, 255, 255)") problems.push(`SITEHDR-5: playground light body ${paint.body} / tabs ${paint.tabs}, want rgb(255, 255, 255) ${at}`);
        if (paint.bg !== "rgb(247, 247, 244)") problems.push(`SITEHDR-5: var(--bg) resolves to ${paint.bg}, want #F7F7F4 ${at}`);
      } else if (paint.body !== paint.bg) problems.push(`SITEHDR-5: dark body ${paint.body} isn't --bg ${paint.bg} (dark is unchanged) ${at}`);
      if (!(paint.ring.includes(paint.line) && paint.ring.includes("0px 0px 0px 1px"))) problems.push(`SITEHDR-5: .card ring is "${paint.ring}", want 1px --line ${paint.line} ${at}`);
      // SITEHDR-7: no sideways scroll.
      if ((await sideways(page)) > 0) problems.push(`SITEHDR-7: page scrolls sideways by ${await sideways(page)}px ${at}`);
      // Spec Part B: #page-top stays hidden in the playground; SITEHDR-10: #demo-home is gone.
      if (await page.locator("#page-top").isVisible()) problems.push(`SITEHDR: #page-top visible in the playground ${at}`);
      if (await page.locator("#demo-home").count()) problems.push(`SITEHDR-10: #demo-home ("← Portfolio") still on the page ${at}`);
      // SITEHDR-6: scrolled down, the sticky tabs sit at 52px, under the header and not behind it.
      if (viewport.width !== 320) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const stuck = await page.evaluate(() => {
          const t = document.querySelector("#tabs")!.getBoundingClientRect();
          const hit = document.elementFromPoint(window.innerWidth / 2, 26);
          return { scrolled: window.scrollY, tabsTop: t.top, headerOnTop: !!hit?.closest("#site-bar") };
        });
        if (!(stuck.scrolled > 0)) problems.push(`SITEHDR-6: page didn't scroll (scrollY ${stuck.scrolled}) ${at}`);
        if (Math.abs(stuck.tabsTop - 52) > 0.5) problems.push(`SITEHDR-6: scrolled tabs sit at ${stuck.tabsTop}px, want 52 ${at}`);
        if (!stuck.headerOnTop) problems.push(`SITEHDR-6: the header isn't on top of the page content when scrolled ${at}`);
      }
      // SITEHDR-3: the picker switches the header with no reload (one size, both OS schemes).
      if (viewport.width === 1280) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => { (window as unknown as { __mark: number }).__mark = 1; });
        for (const [pick, wantPick] of [["Dark", HDR_DARK], ["Light", HDR_LIGHT], ["System", want]] as const) {
          const btn = page.getByRole("button", { name: pick, exact: true });
          if ((await btn.count()) !== 1) { problems.push(`SITEHDR-3: no "${pick}" theme button ${at}`); break; }
          await btn.click();
          const now = await headerColours(page);
          if (JSON.stringify(now) !== JSON.stringify(wantPick)) problems.push(`SITEHDR-3: after picking ${pick}, header is ${JSON.stringify(now)}, want ${JSON.stringify(wantPick)} ${at}`);
        }
        if (!(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark === 1))) problems.push(`SITEHDR-3: switching the theme reloaded the page ${at}`);
        const stored = await page.evaluate(() => { try { return localStorage.length + sessionStorage.length + document.cookie.length; } catch { return 0; } });
        if (stored) problems.push(`SITEHDR-3: something was stored (${stored}) ${at}`);
      }
      await page.close();
    }
  }
  // SITEHDR-6: a deep link puts the panel's h2 fully below the header and the tabs.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const hash of ["#pace", "#electricity", "#share", "#method"]) {
      const at = `at ${viewport.width}px ${hash}`;
      const page = await browser.newPage({ viewport });
      await page.goto(pathToFileURL(page_).href + hash);
      await page.waitForTimeout(300);
      const pos = await page.evaluate((hsh) => {
        const panel = document.getElementById(hsh.slice(1)) ?? document.querySelector(`[role=tabpanel][id="p-${hsh.slice(1)}"]`);
        const h2 = panel?.querySelector("h2")?.getBoundingClientRect();
        const tabs = document.querySelector("#tabs")!.getBoundingClientRect();
        const bar = document.querySelector("#site-bar")?.getBoundingClientRect();
        return h2 ? { h2: h2.top, tabsBottom: tabs.bottom, barBottom: bar?.bottom ?? 0 } : null;
      }, hash);
      if (!pos) problems.push(`SITEHDR-6: no h2 in the ${hash} panel ${at}`);
      else if (!(pos.barBottom >= 51.5 && pos.h2 >= pos.tabsBottom - 0.5 && pos.h2 >= pos.barBottom - 0.5)) problems.push(`SITEHDR-6: h2 top ${pos.h2.toFixed(1)} is under the header (bottom ${pos.barBottom}) or tabs (bottom ${pos.tabsBottom.toFixed(1)}) ${at}`);
      await page.close();
    }
  }
  // SITEHDR-8: the `ccwatts --html` dashboard has no header and no offset, and its light bg is still Paper.
  {
    const row = { date: "2026-10-01", source: "claude-code", model: "claude-opus-4-6", projectId: "0000000000000000", projectName: "proj", responses: 1, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 50 } };
    const json = JSON.stringify({ mode: "dashboard", generatedAt: new Date().toISOString(), rows: [row] }).replace(/</g, "\\u003c");
    const dash = join(scratch, "sitehdr-dashboard.html");
    writeFileSync(dash, readFileSync(page_, "utf8").replace(/(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_m, open, _old, close) => `${open}${json}${close}`));
    for (const width of [390, 1280]) {
      const at = `at ${width}px dashboard`;
      const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: "light" });
      page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`SITEHDR-9: network request ${r.url()} ${at}`); });
      await page.goto(pathToFileURL(dash).href);
      if (await page.locator("#site-bar").isVisible()) problems.push(`SITEHDR-8: #site-bar visible ${at}`);
      if (await page.getByRole("button", { name: "About this demo" }).isVisible().catch(() => false)) problems.push(`SITEHDR-8: "About this demo" shown ${at}`);
      const d = await page.evaluate(() => ({ pad: getComputedStyle(document.body).paddingTop, bg: getComputedStyle(document.body).backgroundColor, tabsTop: getComputedStyle(document.querySelector("#tabs")!).top }));
      if (d.pad !== "0px") problems.push(`SITEHDR-8: dashboard body padding-top ${d.pad}, want 0px ${at}`);
      if (d.bg !== "rgb(247, 247, 244)") problems.push(`SITEHDR-8: dashboard light bg ${d.bg}, want #F7F7F4 ${at}`);
      if (d.tabsTop !== "0px") problems.push(`SITEHDR-8: dashboard sticky tabs top ${d.tabsTop}, want 0px ${at}`);
      await page.close();
    }
  }
}

// SITEHDR Part B (Chase said yes, Nov 25): the #demo-bar strip becomes the header's "About this demo"
// button (#demo-toggle) and a dialog drawer. Replaces DEMO-BAR-1..12. Selected by role and label.
{
  const SAMPLE_COPY = "This is the real ccwatts, running on made-up sample data. Nothing you do is saved or sent anywhere; reload to start over.";
  const FILES_COPY = "This is the real ccwatts, now showing the files you picked. They were read in this browser and never uploaded; nothing is saved, so reload to start over.";
  /** A point on the scrim: outside the panel (left of it when wide, above it as a sheet), below the header. */
  const scrimPoint = (page: Pw, id: string) => page.evaluate((i) => {
    const r = document.getElementById(i)!.getBoundingClientRect();
    return window.innerWidth >= 700 ? { x: Math.max(8, r.left / 2), y: Math.round(window.innerHeight / 2) } : { x: Math.round(window.innerWidth / 2), y: Math.round((Math.max(r.top, 60) + 52) / 2) };
  }, id);
  const views = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }];
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of views) {
      const at = `at ${viewport.width}px ${colorScheme}`;
      const page = await browser.newPage({ viewport, colorScheme });
      page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`SITEHDR-9: network request ${r.url()} ${at}`); });
      page.on("pageerror", (e) => problems.push(`SITEHDR page error: ${e} ${at}`));
      await page.goto(pathToFileURL(page_).href);
      // SITEHDR-12: the strip is gone; the toggle sits in the header right after "ccwatts demo".
      if (await page.locator("#demo-bar").count()) problems.push(`SITEHDR-12: #demo-bar still on the page ${at}`);
      const h = headerParts(page);
      if ((await h.toggle.count()) !== 1) { problems.push(`SITEHDR-12: no "About this demo" button in #site-bar ${at}`); await page.close(); continue; }
      const toggle = h.toggle;
      if ((await toggle.getAttribute("id")) !== "demo-toggle") problems.push(`SITEHDR-12: the "About this demo" button isn't #demo-toggle ${at}`);
      if (!(await toggle.isVisible())) problems.push(`SITEHDR-12: "About this demo" hidden ${at}`);
      const tb = await toggle.boundingBox();
      if (!tb || tb.width < 44 || tb.height < 44) problems.push(`SITEHDR-12: toggle is ${tb?.width}x${tb?.height}, want 44x44 or larger ${at}`);
      if ((await toggle.getAttribute("aria-expanded")) !== "false") problems.push(`SITEHDR-12: toggle not aria-expanded=false on load ${at}`);
      const next = await page.evaluate(() => {
        const label = [...document.querySelectorAll("#site-bar *")].find((el) => el.children.length === 0 && el.textContent?.trim() === "ccwatts demo");
        const tog = document.querySelector("#site-bar #demo-toggle");
        if (!label || !tog) return null;
        const [l, t] = [label.getBoundingClientRect(), tog.getBoundingClientRect()];
        const between = [...document.querySelectorAll("#site-bar a, #site-bar button")].filter((el) => el !== tog && (el as HTMLElement).checkVisibility())
          .filter((el) => { const r = el.getBoundingClientRect(); const c = r.left + r.width / 2; return c > l.right && c < t.left; });
        return { right: t.left >= l.right - 0.5, between: between.length };
      });
      if (!next || !next.right || next.between) problems.push(`SITEHDR-12: toggle isn't right after "ccwatts demo" (${JSON.stringify(next)}) ${at}`);
      const dialogId = (await toggle.getAttribute("aria-controls")) ?? "";
      const dialog = page.locator(`[id="${dialogId}"]`);
      if (!dialogId || (await dialog.count()) !== 1) { problems.push(`SITEHDR-12: aria-controls "${dialogId}" names no element ${at}`); await page.close(); continue; }
      const kind = await dialog.evaluate((d) => ({ dialog: d.tagName === "DIALOG" || d.getAttribute("role") === "dialog", modal: d.getAttribute("aria-modal") }));
      if (!kind.dialog || kind.modal !== "true") problems.push(`SITEHDR-12: #${dialogId} isn't role=dialog aria-modal=true (${JSON.stringify(kind)}) ${at}`);
      if (await dialog.isVisible()) problems.push(`SITEHDR-12: dialog open on load ${at}`);
      // SITEHDR-13: a tap opens it, as a 360px right panel (>= 700px) or a full-width bottom sheet; the scrim shows; the page doesn't move.
      const before = await page.evaluate(() => ({ h1: document.querySelector("h1")!.getBoundingClientRect().top, y: window.scrollY }));
      await toggle.click();
      await page.waitForTimeout(400); // let any slide-in finish before measuring
      if ((await toggle.getAttribute("aria-expanded")) !== "true") problems.push(`SITEHDR-13: toggle not aria-expanded=true after a tap ${at}`);
      if (!(await dialog.isVisible())) { problems.push(`SITEHDR-13: dialog not shown after a tap ${at}`); await page.close(); continue; }
      const box = await dialog.evaluate((d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, bottom: r.bottom, top: r.top, vw: window.innerWidth, vh: window.innerHeight }; });
      if (viewport.width >= 700) {
        if (Math.abs(box.width - 360) > 1 || Math.abs(box.right - box.vw) > 1) problems.push(`SITEHDR-13: panel is ${box.width}px wide ending at ${box.right} of ${box.vw}, want 360px on the right ${at}`);
      } else if (Math.abs(box.width - box.vw) > 1 || Math.abs(box.bottom - box.vh) > 1 || box.left > 1) problems.push(`SITEHDR-13: sheet is ${box.width}px wide, bottom ${box.bottom} of ${box.vh}, want full width at the bottom ${at}`);
      const pt = await scrimPoint(page, dialogId);
      const scrim = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? { inPage: !!el.closest("main"), root: el === document.body || el === document.documentElement, tag: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") } : null;
      }, pt);
      if (!scrim || scrim.inPage || scrim.root) problems.push(`SITEHDR-13: no scrim over the page at (${pt.x}, ${pt.y}): hit ${scrim?.tag} ${at}`);
      // SITEHDR UX-R4 (ux-reviewer): in dark the scrim is at least rgba(0,0,0,.6)-strength (alpha >= 0.55).
      if (colorScheme === "dark") {
        const alpha = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!el) return null;
          const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
          const parts = m ? m[1]!.split(/[ ,/]+/).filter(Boolean) : [];
          return (parts.length > 3 ? Number(parts[3]) : parts.length === 3 ? 1 : 0) * Number(getComputedStyle(el).opacity);
        }, pt);
        if (alpha === null || alpha < 0.55) problems.push(`SITEHDR UX-R4: dark scrim alpha is ${alpha}, want >= 0.55 (rgba(0,0,0,.6)-strength) ${at}`);
      }
      // SITEHDR UX-R3 (ux-reviewer): with the drawer open, a 400px wheel over the scrim or the drawer leaves the page where it was.
      for (const [where, p] of [["scrim", pt], ["drawer", { x: Math.round(box.left + box.width / 2), y: Math.round(Math.max(box.top, 60) + 20) }]] as const) {
        const y0 = await page.evaluate(() => window.scrollY);
        await page.mouse.move(p.x, p.y);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(300);
        const y1 = await page.evaluate(() => window.scrollY);
        if (y1 !== y0) problems.push(`SITEHDR UX-R3: a 400px wheel over the open ${where} scrolled the page (scrollY ${y0} -> ${y1}) ${at}`);
        if (y1 !== y0) await page.evaluate((y) => window.scrollTo(0, y), y0);
      }
      const after = await page.evaluate(() => ({ h1: document.querySelector("h1")!.getBoundingClientRect().top, y: window.scrollY }));
      if (Math.abs(after.h1 - before.h1) > 0.5 || after.y !== before.y) problems.push(`SITEHDR-13: opening moved the page (h1 ${before.h1} -> ${after.h1}, scrollY ${before.y} -> ${after.y}) ${at}`);
      if ((await sideways(page)) > 0) problems.push(`SITEHDR-7/13: open drawer scrolls sideways by ${await sideways(page)}px ${at}`);
      // SITEHDR-15: focus moves into the dialog on open.
      if (!(await dialog.evaluate((d) => d.contains(document.activeElement)))) problems.push(`SITEHDR-15: focus isn't inside the dialog on open ${at}`);
      // SITEHDR-14: pill, title, sample copy, and the three links.
      const content = await dialog.evaluate((d, ids) => {
        const t = d.getAttribute("aria-labelledby");
        const title = t ? document.getElementById(t) : null;
        const s = document.getElementById(ids.s);
        const f = document.getElementById(ids.f);
        return {
          pill: [...d.querySelectorAll("*")].some((el) => el.children.length === 0 && el.textContent?.trim() === "Demo" && (el as HTMLElement).checkVisibility()),
          title: !!title && d.contains(title) && title.checkVisibility() && !!title.textContent?.trim(),
          sample: !!s && s.checkVisibility() && (s.textContent ?? "").includes(ids.sc),
          files: !!f && f.checkVisibility(),
        };
      }, { s: "demo-copy-sample", f: "demo-copy-files", sc: SAMPLE_COPY });
      if (!content.pill) problems.push(`SITEHDR-14: no visible "Demo" pill in the dialog ${at}`);
      if (!content.title) problems.push(`SITEHDR-14: the dialog's aria-labelledby title is missing, empty or hidden ${at}`);
      if (!content.sample || content.files) problems.push(`SITEHDR-14: dialog doesn't show only the standard sample copy (${JSON.stringify(content)}) ${at}`);
      for (const [name, l, want] of [
        ["#demo-back", dialog.locator("#demo-back"), PORTFOLIO_URL],
        ["#demo-code", dialog.locator("#demo-code"), REPO_URL],
        ["Case study", dialog.getByRole("link", { name: "Case study", exact: true }), PORTFOLIO_URL],
      ] as const) {
        if ((await l.count()) !== 1 || !(await l.isVisible())) problems.push(`SITEHDR-14: ${name} missing or hidden in the dialog ${at}`);
        else if ((await l.getAttribute("href")) !== want) problems.push(`SITEHDR-14: ${name} goes to ${await l.getAttribute("href")}, want ${want} ${at}`);
      }
      const closed = async (how: string) => {
        await page.waitForTimeout(400);
        if ((await toggle.getAttribute("aria-expanded")) !== "false" || (await dialog.isVisible())) problems.push(`SITEHDR-15: ${how} didn't close the dialog ${at}`);
        if (!(await toggle.evaluate((t) => t === document.activeElement))) problems.push(`SITEHDR-15: after ${how}, focus isn't on #demo-toggle ${at}`);
      };
      // SITEHDR-15: close button, Esc, scrim tap.
      const close = dialog.getByRole("button", { name: /close/i });
      if ((await close.count()) < 1) problems.push(`SITEHDR-15: no close button in the dialog ${at}`);
      else { await close.first().click(); await closed("the close button"); }
      await toggle.click();
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
      await closed("Esc");
      await toggle.click();
      await page.waitForTimeout(400);
      const pt2 = await scrimPoint(page, dialogId);
      await page.mouse.click(pt2.x, pt2.y);
      await closed("a scrim tap");
      // SITEHDR UX-R3: once closed, the same wheel scrolls the page as normal.
      {
        await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
        const y0 = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(300);
        const y1 = await page.evaluate(() => window.scrollY);
        if (!(y1 > y0)) problems.push(`SITEHDR UX-R3: after closing, a 400px wheel didn't scroll the page (scrollY ${y0} -> ${y1}) ${at}`);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      // SITEHDR-14: after a file loads the dialog shows the own-files copy; Use sample data switches back;
      // a file with no usage keeps the sample copy (was DEMO-BAR-9, DEMO-BAR-10).
      if (viewport.width !== 320 && colorScheme === "light") {
        const showing = () => page.evaluate(() => ["demo-copy-sample", "demo-copy-files"].filter((i) => (document.getElementById(i) as HTMLElement | null)?.checkVisibility()).join(","));
        await openLogs(page);
        await page.setInputFiles("#pick-files", log);
        await page.waitForFunction(() => !(document.getElementById("demo-copy-files")?.hidden ?? true), null, { timeout: 8000 }).catch(() => undefined);
        await toggle.click();
        if ((await showing()) !== "demo-copy-files") problems.push(`SITEHDR-14: after loading a file the dialog shows "${await showing()}", want demo-copy-files ${at}`);
        else if (!((await dialog.innerText()).includes(FILES_COPY))) problems.push(`SITEHDR-14: own-files copy isn't the standard text ${at}`);
        await page.keyboard.press("Escape");
        await openLogs(page);
        await page.click("#use-sample");
        await toggle.click();
        if ((await showing()) !== "demo-copy-sample") problems.push(`SITEHDR-14: after Use sample data the dialog shows "${await showing()}", want demo-copy-sample ${at}`);
        await page.keyboard.press("Escape");
        await page.setInputFiles("#pick-files", noUsage);
        await page.waitForFunction(() => !/Reading/.test(document.querySelector("#drop-status")?.textContent ?? "Reading"));
        await toggle.click();
        if ((await showing()) !== "demo-copy-sample") problems.push(`SITEHDR-14: a file with no usage switched the dialog to "${await showing()}" ${at}`);
        await page.keyboard.press("Escape");
      }
      await page.close();
    }
  }
  // SITEHDR-16: under reduced motion the dialog shows and hides with no transition or animation.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const at = `at ${viewport.width}px reduced motion`;
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    await page.goto(pathToFileURL(page_).href);
    const toggle = page.locator("#site-bar").getByRole("button", { name: "About this demo", exact: true });
    const id = (await toggle.count()) === 1 ? await toggle.getAttribute("aria-controls") : null;
    if (!id) { problems.push(`SITEHDR-16: no "About this demo" button with aria-controls ${at}`); await page.close(); continue; }
    await toggle.click();
    const pt = await scrimPoint(page, id);
    const motion = await page.evaluate(({ i, x, y }) => {
      const d = document.getElementById(i)!;
      const els = [d, d.parentElement, document.elementFromPoint(x, y)].filter((el): el is HTMLElement => !!el && el !== document.body && el !== document.documentElement);
      return els.map((el) => { const cs = getComputedStyle(el); return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} t=${cs.transitionDuration} a=${cs.animationDuration}/${cs.animationName}`; });
    }, { i: id, x: pt.x, y: pt.y });
    const moving = motion.filter((m) => /t=[^ ]*[1-9]|a=[^/]*[1-9][^/]*\/(?!none)/.test(m));
    if (moving.length) problems.push(`SITEHDR-16: still animates under reduced motion: ${moving.join("; ")} ${at}`);
    await page.close();
  }
}

// DEMO-BAR-13 (kept from the retired strip checks): dashboard mode shows no demo chrome and keeps its pill.
{
  const BAR = 'section[aria-label="Demo"]';
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
      if (await page.getByRole("button", { name: "About this demo" }).isVisible().catch(() => false)) problems.push(`DEMO-BAR-13: "About this demo" shown in dashboard mode at ${width}px`);
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
  await page.getByRole("tab", { name: "Electricity", exact: true }).click();
  await page.click("#w-all");
  if (await page.$("#xss")) problems.push("PS-R2: a row's date was rendered as markup (found <i id=xss> in the page)");
  await page.close();
}

// EST-17 "Have a token count?" box: typing a count shows a kWh range with the method version, bad
// input shows the hint, the model select changes the answer, and nothing is stored or put in the URL.
// Selected by role and label. Phone and desktop, light and dark.
{
  const methodVersion = JSON.parse(readFileSync(new URL("../methodology/params.json", import.meta.url), "utf8")).version as string;
  // The kWh line and the meta line may be separate lines (UX-R32); all four parts must be there.
  const RESULT = /≈ ([\d.]+) kWh \(range ([\d.]+)–([\d.]+)\)/;
  const META = `Method v${methodVersion} · typical Claude Code mix assumed`; // UX-R32
  const WIDE = "Wide range: the mix of token types is guessed."; // UX-R28
  const BAD = "Couldn't read that as a token count. Try 88.8M, 1.2k or 88800000."; // UX-R33
  // UX-R29: the comparison lines the CLI prints for the same input (built CLI, npm run build first). Since
  // M4.8.3 (RANGE-10) each comparison carries a range and gets its own "≈" line, so all of them must match.
  const cliCompare = (model: string) => JSON.stringify(spawnSync(process.execPath, [fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url)), "estimate", "88.8M", "--model", model], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: scratch } }).stdout
    .split("\n").map((l) => l.trim()).filter((l) => l.startsWith("≈ ")));
  const compare = { Opus: cliCompare("opus"), Sonnet: cliCompare("sonnet") };
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const at = `at ${viewport.width}px ${colorScheme}`;
      const page = await browser.newPage({ viewport, colorScheme });
      page.on("request", (r) => {
        if (!/^(file|data|blob):/.test(r.url())) problems.push(`EST-17: network request ${r.url()} ${at}`);
      });
      page.on("pageerror", (e) => problems.push(`EST-17: page error ${e} ${at}`));
      await page.goto(pathToFileURL(page_).href);
      // STUDIO-DS: the box lives in the Electricity tab, near What if. Open it the way a person would.
      await tab(page, "Electricity");
      const startUrl = page.url();
      // The tab panel is a <section> too, so take the innermost one: the region named by the heading.
      const box = page.getByRole("region", { name: "Have a token count?" });
      const input = box.getByRole("textbox", { name: /token/i });
      const model = box.getByRole("combobox", { name: /model/i });
      if ((await box.count()) !== 1 || (await input.count()) !== 1 || (await model.count()) !== 1) {
        problems.push(`EST-17: no "Have a token count?" section with a labeled token textbox and model select ${at}`);
        await page.close();
        continue;
      }
      const boxText = async () => (await box.innerText()).replace(/\s+/g, " ");
      const result = box.getByRole("status");
      /** The result's visible lines, trimmed, empty ones dropped. */
      const resultLines = async () => (await result.innerText()).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      const resultChecks = async (label: "Opus" | "Sonnet") => {
        const lines = await resultLines();
        const shown = JSON.stringify(lines);
        if (!lines.includes(META)) problems.push(`EST-17 UX-R32: ${label} result has no line "${META}" ${at}: ${shown}`);
        if (!lines.includes(WIDE)) problems.push(`EST-17 UX-R28: ${label} result has no line "${WIDE}" ${at}: ${shown}`);
        const cmp = lines.filter((l) => l.startsWith("≈ ") && !RESULT.test(l));
        if (cmp.length < 1 || JSON.stringify(cmp) !== compare[label]) problems.push(`EST-17 UX-R29: ${label} result's comparison lines are ${JSON.stringify(cmp)}, want the CLI's ${compare[label]} ${at}`);
      };
      await input.fill("88.8M");
      const opus = RESULT.exec(await boxText());
      if (!opus) problems.push(`EST-17: 88.8M shows no "≈ N kWh (range L–H)" ${at}: "${(await boxText()).slice(0, 200)}"`);
      else {
        await resultChecks("Opus");
        // UX-R32: the meta line is in the reading font, not monospace.
        const metaFont = await result.evaluate((el, want) => {
          const hit = [el, ...el.querySelectorAll("*")].filter((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim() === want);
          const last = hit.at(-1);
          return last ? getComputedStyle(last).fontFamily : null;
        }, META);
        if (metaFont === null) problems.push(`EST-17 UX-R32: no element holds exactly "${META}" ${at}`);
        else if (MONO.test(metaFont)) problems.push(`EST-17 UX-R32: meta line is monospace (${metaFont}) ${at}`);
        const [c, l, h] = [Number(opus[1]), Number(opus[2]), Number(opus[3])];
        if (!(l < c && c < h)) problems.push(`EST-17: range not low < central < high (${l}, ${c}, ${h}) ${at}`);
        if (!(c >= 4 && c <= 5.5)) problems.push(`EST-17: 88.8M on Opus is ${c} kWh, want 4-5.5 ${at}`);
        await model.selectOption({ label: "Sonnet" });
        const sonnet = RESULT.exec(await boxText());
        if (!sonnet || Number(sonnet[1]) >= c) problems.push(`EST-17: choosing Sonnet didn't lower the estimate ${at}`);
        else await resultChecks("Sonnet");
        await model.selectOption({ label: "Opus" });
      }
      await input.fill("abc");
      if (!(await resultLines()).includes(BAD)) problems.push(`EST-17 UX-R33: invalid input doesn't show "${BAD}" ${at}: ${JSON.stringify(await resultLines())}`);
      if (RESULT.test(await boxText())) problems.push(`EST-17: invalid input still shows a number ${at}`);
      await input.fill("");
      if (/NaN|undefined|Infinity/.test(await boxText())) problems.push(`EST-17: empty input shows NaN/undefined ${at}`);
      await input.fill("1234567890123");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) problems.push(`EST-17: page scrolls sideways by ${over}px with a long count ${at}`);
      if (page.url() !== startUrl) problems.push(`EST-17: the count changed the URL (${page.url()}) ${at}`);
      const stored = await page.evaluate(() => { try { return localStorage.length + sessionStorage.length + document.cookie.length; } catch { return 0; } });
      if (stored) problems.push(`EST-17: something was stored (${stored}) ${at}`);
      await page.close();
    }
  }
}

// EST-24 UX-R65: at 1280px the What if column and the "Have a token count?" box sit side by side,
// both start with a 22/28 h2, and the two h2 tops line up within 2px. Selected by role and name.
for (const colorScheme of ["light", "dark"] as const) {
  const at = `at 1280px ${colorScheme}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme });
  await page.goto(pathToFileURL(page_).href);
  await tab(page, "Electricity");
  const panel = page.locator("#p-electricity");
  const whatifH = panel.getByRole("heading", { level: 2, name: "What if?", exact: true });
  const boxH = panel.getByRole("heading", { level: 2, name: "Have a token count?", exact: true });
  if ((await whatifH.count()) !== 1 || (await boxH.count()) !== 1) {
    problems.push(`EST-24 UX-R65: want one h2 "What if?" and one h2 "Have a token count?" in Electricity ${at}, got ${await whatifH.count()} and ${await boxH.count()}`);
  } else {
    const measure = (l: typeof whatifH) => l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { top: r.top, left: r.left, size: cs.fontSize, line: cs.lineHeight, weight: cs.fontWeight };
    });
    const [a, b] = [await measure(whatifH), await measure(boxH)];
    for (const [name, m] of [["What if?", a], ["Have a token count?", b]] as const) {
      if (m.size !== "22px" || m.line !== "28px") problems.push(`EST-24 UX-R65: h2 "${name}" is ${m.size}/${m.line}, want 22px/28px ${at}`);
    }
    if (a.weight !== b.weight) problems.push(`EST-24 UX-R65: h2 weights differ (${a.weight} vs ${b.weight}) ${at}`);
    if (!(b.left > a.left)) problems.push(`EST-24 UX-R65: the box isn't beside What if (lefts ${a.left}, ${b.left}) ${at}`);
    if (Math.abs(a.top - b.top) > 2) problems.push(`EST-24 UX-R65: h2 tops differ by ${Math.abs(a.top - b.top).toFixed(1)}px (What if ${a.top}, box ${b.top}), want within 2px ${at}`);
  }
  const label = panel.getByText("Cache-read cost", { exact: true });
  if ((await panel.getByRole("slider", { name: "Cache-read cost", exact: true }).count()) !== 1 || (await label.count()) !== 1) problems.push(`EST-24 UX-R65: the slider isn't labeled exactly "Cache-read cost" ${at}`);
  await page.close();
}

// CLOUDP-1, 5, 6, 7 (SPEC-CLOUDP): the "Use Claude Code on the web? Ask it." disclosure in Your logs.
// On a phone it comes before the folder pickers and is open; on a wide screen it is closed and below
// them. The prompt is in the reading font at 17px or more, nothing scrolls sideways at 320px, the
// Copy button reads "Copied" for about 2 s, and nothing is requested or stored. Light and dark.
// Your logs opens via the #drop hash, and once (390px light) through the Overview row.
{
  const SUMMARY = "Use Claude Code on the web? Ask it.";
  const views = [
    { viewport: { width: 390, height: 844 }, open: true, first: true },
    { viewport: { width: 320, height: 640 }, open: true, first: true },
    { viewport: { width: 1280, height: 800 }, open: false, first: false },
  ];
  for (const colorScheme of ["light", "dark"] as const) {
    for (const v of views) {
      const at = `at ${v.viewport.width}px ${colorScheme}`;
      const page = await browser.newPage({ viewport: v.viewport, colorScheme });
      page.on("request", (r) => {
        if (!/^(file|data|blob):/.test(r.url())) problems.push(`CLOUDP-7: network request ${r.url()} ${at}`);
      });
      page.on("pageerror", (e) => problems.push(`CLOUDP: page error ${e} ${at}`));
      // A clipboard that works on file://: keeps what was written in a page variable (not storage).
      // A string, not a callback: tsx names object-literal functions with a __name() helper the page lacks.
      await page.addInitScript({ content: 'Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });' });
      const viaRow = v.viewport.width === 390 && colorScheme === "light";
      if (viaRow) {
        await page.goto(pathToFileURL(page_).href);
        await openLogs(page);
      } else {
        await page.goto(pathToFileURL(page_).href + "#drop");
      }
      const cloud = page.locator("#drop details#cloud");
      if ((await cloud.count()) !== 1 || !(await page.locator("#drop").isVisible())) {
        problems.push(`CLOUDP-1: no <details id="cloud"> in a visible Your logs ${at}${viaRow ? " (opened via #ov-logs)" : " (opened via #drop)"}`);
        await page.close();
        continue;
      }
      const summary = ((await cloud.locator("> summary").textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (summary !== SUMMARY) problems.push(`CLOUDP-1: summary reads "${summary}", want "${SUMMARY}" ${at}`);
      // CLOUDP-5: open on a phone, closed on a wide screen; before / below the folder pickers.
      const open = await cloud.evaluate((d) => (d as HTMLDetailsElement).open);
      if (open !== v.open) problems.push(`CLOUDP-5: #cloud is ${open ? "open" : "closed"} ${at}, want ${v.open ? "open" : "closed"}`);
      const tops = await page.evaluate(() => {
        const c = document.querySelector("#cloud")?.getBoundingClientRect();
        const p = document.querySelector('label[for="pick-folder"]')?.getBoundingClientRect();
        return c && p ? { cloud: c.top, cloudBottom: c.bottom, picker: p.top, pickerBottom: p.bottom } : null;
      });
      if (!tops) problems.push(`CLOUDP-5: can't measure #cloud or the Choose folder picker ${at}`);
      else if (v.first && !(tops.cloudBottom <= tops.picker)) problems.push(`CLOUDP-5: #cloud (top ${tops.cloud}) isn't above the folder pickers (top ${tops.picker}) ${at}`);
      else if (!v.first && !(tops.cloud >= tops.pickerBottom)) problems.push(`CLOUDP-5: #cloud (top ${tops.cloud}) isn't below the folder pickers (bottom ${tops.pickerBottom}) ${at}`);
      const oldSummary = ((await page.locator("#export > summary").textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (oldSummary !== "Can't find the folder?") problems.push(`CLOUDP-5: old disclosure's summary reads "${oldSummary}" ${at}`);
      // Open it everywhere for the remaining checks.
      if (!open) await cloud.locator("> summary").click();
      // CLOUDP-6: reading font, 17px or more; no sideways scroll.
      const prompt = cloud.locator("#cloud-prompt");
      if ((await prompt.count()) !== 1 || !(await prompt.isVisible())) problems.push(`CLOUDP-1: #cloud-prompt missing or hidden in the open disclosure ${at}`);
      else {
        const f = await prompt.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, size: parseFloat(getComputedStyle(el).fontSize) }));
        if (MONO.test(f.family)) problems.push(`CLOUDP-6: the prompt is monospace (${f.family}) ${at}`);
        if (!(f.size >= 17)) problems.push(`CLOUDP-6: the prompt is ${f.size}px, want 17px or more ${at}`);
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) problems.push(`CLOUDP-6: page scrolls sideways by ${over}px with #cloud open ${at}`);
      // CLOUDP-1: "Copy prompt" reads "Copied" after a tap, then goes back after about 2 s.
      const btn = cloud.getByRole("button", { name: "Copy prompt", exact: true });
      if ((await btn.count()) !== 1) problems.push(`CLOUDP-1: no "Copy prompt" button in #cloud ${at}`);
      else {
        const startUrl = page.url();
        await btn.click();
        const now = ((await page.locator("#copy-cloud").textContent()) ?? "").trim();
        if (now !== "Copied") problems.push(`CLOUDP-1: #copy-cloud reads "${now}" right after a tap, want "Copied" ${at}`);
        const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? null);
        const want = await prompt.textContent().catch(() => null);
        if (copied === null || copied !== want) problems.push(`CLOUDP-1: Copy prompt didn't copy the prompt text ${at}`);
        await page.waitForTimeout(1200);
        const mid = ((await page.locator("#copy-cloud").textContent()) ?? "").trim();
        if (mid !== "Copied") problems.push(`CLOUDP-1: #copy-cloud went back after only ~1.2 s ("${mid}") ${at}`);
        await page.waitForTimeout(1800);
        const after = ((await page.locator("#copy-cloud").textContent()) ?? "").trim();
        if (after !== "Copy prompt") problems.push(`CLOUDP-1: #copy-cloud still reads "${after}" ~3 s after a tap ${at}`);
        if (page.url() !== startUrl) problems.push(`CLOUDP-7: copying changed the URL (${page.url()}) ${at}`);
      }
      // CLOUDP-7: no em-dash in the disclosure or the phone hint; nothing stored.
      const words = (await cloud.textContent()) ?? "";
      if (words.includes("—")) problems.push(`CLOUDP-7: em-dash in #cloud ${at}`);
      if (((await page.locator("#phone-hint").textContent()) ?? "").includes("—")) problems.push(`CLOUDP-7: em-dash in #phone-hint ${at}`);
      const stored = await page.evaluate(() => { try { return localStorage.length + sessionStorage.length + document.cookie.length; } catch { return 0; } });
      if (stored) problems.push(`CLOUDP-7: something was stored (${stored}) ${at}`);
      await page.close();
    }
  }
}

// SITEHDR-17 (SPEC-SITE-HEADER, issue #127 follow-up): the portfolio iframes the playground with ?embed=1.
// Embedded, there's no site header, no "About this demo" toggle and no 52px offset anywhere; light is still
// white and nothing goes over the network. Each embed measurement is compared with a normal visit's.
{
  const base = pathToFileURL(page_).href;
  /** Where the #pace h2 and the tabs sit: on a direct #pace load, and after picking Pace from the bottom of Overview. */
  const paceSpots = async (page: Pw) => {
    const spot = () => page.evaluate(() => {
      const h2 = document.querySelector("#pace h2")?.getBoundingClientRect();
      const tabs = document.querySelector("#tabs")!.getBoundingClientRect();
      return h2 ? { h2: h2.top, tabsTop: tabs.top, tabsBottom: tabs.bottom } : null;
    });
    await page.waitForTimeout(300);
    const load = await spot();
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    await page.getByRole("tab", { name: "Pace", exact: true }).click();
    await page.waitForTimeout(300);
    return { load, picked: await spot() };
  };
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    for (const query of ["?embed=1", "?from=portfolio&embed=1"]) {
      if (query !== "?embed=1" && viewport.width !== 390) continue;
      const at = `at ${viewport.width}px ${query}`;
      const page = await browser.newPage({ viewport, colorScheme: "light" });
      page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`SITEHDR-17: network request ${r.url()} ${at}`); });
      page.on("pageerror", (e) => problems.push(`SITEHDR-17 page error: ${e} ${at}`));
      await page.goto(base + query);
      // No header and no info toggle.
      if (await page.locator("#site-bar").isVisible()) problems.push(`SITEHDR-17: #site-bar visible in embed mode ${at}`);
      if (await page.getByRole("button", { name: "About this demo", exact: true }).isVisible()) problems.push(`SITEHDR-17: "About this demo" toggle visible in embed mode ${at}`);
      // No 52px offset; the page is still white.
      const css = await page.evaluate(() => ({
        pad: getComputedStyle(document.body).paddingTop,
        tabsTop: getComputedStyle(document.querySelector("#tabs")!).top,
        body: getComputedStyle(document.body).backgroundColor,
        tabs: getComputedStyle(document.querySelector("#tabs")!).backgroundColor,
      }));
      if (css.pad !== "0px") problems.push(`SITEHDR-17: body padding-top ${css.pad} in embed mode, want 0px ${at}`);
      if (css.tabsTop !== "0px") problems.push(`SITEHDR-17: sticky .tabs top ${css.tabsTop} in embed mode, want 0px ${at}`);
      if (css.body !== "rgb(255, 255, 255)" || css.tabs !== "rgb(255, 255, 255)") problems.push(`SITEHDR-17: embed light body ${css.body} / tabs ${css.tabs}, want rgb(255, 255, 255) ${at}`);
      if (query === "?embed=1") {
        // Scrolled to the bottom, the stuck tabs sit at the very top of the frame.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const stuck = await page.evaluate(() => document.querySelector("#tabs")!.getBoundingClientRect().top);
        if (Math.abs(stuck) > 0.5) problems.push(`SITEHDR-17: scrolled, the tabs sit at ${stuck}px, want 0 ${at}`);
        // Deep links and toViewTop: #pace's h2 and the tabs land 52px higher than on a normal visit (no header to clear).
        const normalPage = await browser.newPage({ viewport, colorScheme: "light" });
        await normalPage.goto(base + "#pace");
        const normal = await paceSpots(normalPage);
        await normalPage.close();
        const embedPage = await browser.newPage({ viewport, colorScheme: "light" }); // a fresh load, not a same-page hash change
        embedPage.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`SITEHDR-17: network request ${r.url()} ${at}#pace`); });
        await embedPage.goto(base + query + "#pace");
        const embed = await paceSpots(embedPage);
        await embedPage.close();
        for (const how of ["load", "picked"] as const) {
          const n = normal[how], e = embed[how];
          const what = how === "load" ? "opening #pace directly" : "picking Pace from the bottom of Overview";
          if (!n || !e) { problems.push(`SITEHDR-17: no #pace h2 after ${what} (normal ${!!n}, embed ${!!e}) ${at}`); continue; }
          if (Math.abs(e.tabsTop - (n.tabsTop - 52)) > 0.5) problems.push(`SITEHDR-17: after ${what}, the tabs sit at ${e.tabsTop.toFixed(1)}px, want ${(n.tabsTop - 52).toFixed(1)} (a normal visit's ${n.tabsTop.toFixed(1)} minus the 52px header) ${at}`);
          if (e.h2 < e.tabsBottom - 0.5) problems.push(`SITEHDR-17: after ${what}, the h2 (${e.h2.toFixed(1)}) is under the tabs (bottom ${e.tabsBottom.toFixed(1)}) ${at}`);
          if (Math.abs(e.h2 - (n.h2 - 52)) > 4) problems.push(`SITEHDR-17: after ${what}, the h2 top is ${e.h2.toFixed(1)}px, want ~${(n.h2 - 52).toFixed(1)} (a normal visit's ${n.h2.toFixed(1)} minus the 52px header) ${at}`);
        }
      }
      await page.close();
    }
  }
}

// Generic checks from the showcase kit (unfinished text, broken images, tiny text, plus light and
// dark mode), on the same browser. Everything above is specific to this page.
for (const p of await showcaseCheck({
  url: pathToFileURL(page_).href,
  browser,
  viewports: [{ width: 1280, height: 900 }, { width: 390, height: 844 }],
  tapTargets: "button, label.btn, a.btn", // RR-9 (a.btn: the Overview CTA)
  // RR-5. Not the pickers (QA-R5): they sit in Your logs, so the RR-5 loop above opens it via #ov-cta first.
  keyboardReach: ["tab-overview", "ov-cta"],
  tabPresses: 12,
  // 12px: the "Demo" pill in the About this demo dialog (exempt, QA-R9; SPEC-SITE-HEADER). The kit can't exempt one
  // region, so the 17px STUDIO-DS floor for the rest of the page is design-system.test.ts DS-3.
  minTextPx: 12,
})) problems.push(`showcase kit: ${p}`);

await browser.close();
rmSync(scratch, { recursive: true, force: true });

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Playground check passed: no network requests, no errors, no sideways scroll.");
