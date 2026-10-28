// Browser check for the playground: loads the built page in headless Chromium, uses sample data,
// loads a log file through the file picker, and fails if the page makes any network request,
// logs an error, or scrolls sideways on a phone.
//
// Needs Playwright, which is not a project dependency:  npx playwright@1 install chromium
// Run after `npm run build`:                            node scripts/check-no-network.mjs
// Set PLAYWRIGHT_MODULE to a Playwright path and CHROMIUM_PATH to a browser binary if needed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
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
const problems = [];
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("console", (m) => m.type() === "error" && problems.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(pathToFileURL(page_).href);

  if ((await page.textContent("#source-pill")) !== "Sample data") problems.push("did not open on sample data");

  // Keyboard: Tab must reach both file pickers (recruiter-ready RR-5).
  const reached = new Set();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.id));
  }
  for (const id of ["pick-folder", "pick-files"]) if (!reached.has(id)) problems.push(`Tab never reaches #${id} at ${viewport.width}px`);

  // Tap targets: every button 44px tall or more (RR-9).
  const short = await page.$$eval("button, label.btn", (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.textContent.trim()));
  // Chart labels stay readable on a phone: drawn at the screen's pixel width, not scaled down (RR-8).
  const label = await page.$eval("#chart text", (t) => t.getBoundingClientRect().height);
  if (label < 11) problems.push(`chart labels ${label.toFixed(1)}px tall at ${viewport.width}px (want 11+)`);
  // Method table: no sideways scroll inside it on a phone, distinct source links 44px tall (RR-10, RR-11).
  const table = await page.$eval(".tablewrap", (t) => ({ over: t.scrollWidth - t.clientWidth }));
  if (table.over > 1) problems.push(`method table scrolls sideways by ${table.over}px at ${viewport.width}px`);
  const links = await page.$$eval("#params a", (as) => as.map((a) => ({ t: a.textContent.trim(), h: a.getBoundingClientRect().height })));
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
  const fonts = await page.evaluate(() => {
    const ff = (el) => (el ? getComputedStyle(el).fontFamily : "(missing)");
    return {
      body: ff(document.body),
      paragraphs: [...document.querySelectorAll("main p")].filter((p) => p.textContent.trim()).map((p) => ({ id: p.id || p.className || p.textContent.slice(0, 30), f: ff(p) })),
      chartNote: ff(document.querySelector("#chart-note")),
      methodNotes: [...document.querySelectorAll("#params td[data-label='Parameter'] div")].map(ff),
      post: ff(document.querySelector("#post")),
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
    const after = (sel) => !!(document.querySelector(sel).compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING);
    const link = [...document.querySelectorAll(".hero a")].find((a) => a.textContent.trim() === "Use your own logs");
    return { after: after("#chart") && after("#by-model") && after("#by-project"), link: link?.getAttribute("href") ?? null };
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
  if (!(await page.textContent("#footer-version")).includes(`v${cliVersion}`)) problems.push(`UX-R11: footer doesn't show v${cliVersion}`);

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
    const noteShown = () => page.$eval("#whatif-note", (n) => !n.hidden && n.getBoundingClientRect().height > 0).catch(() => null);
    const heroBefore = await page.textContent("#hero-big");
    const shareBefore = await share();
    const box = await page.$eval("#whatif-cache", (s) => s.getBoundingClientRect().height);
    if (box < 44) problems.push(`WI-3: slider is ${box.toFixed(1)}px tall at ${viewport.width}px (want 44+)`);
    if ((await noteShown()) !== false) problems.push("WI-3: #whatif-note missing or shown before the slider moves");
    await page.$eval("#whatif-cache", (s) => {
      s.value = s.max;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if ((await page.textContent("#hero-big")) === heroBefore) problems.push("WI-3: hero total did not change with the slider at its max");
    if (!(await noteShown())) problems.push("WI-3: #whatif-note not shown while a what-if is active");
    else if (!(await page.textContent("#whatif-note")).includes("What if")) problems.push(`WI-3: #whatif-note says "${await page.textContent("#whatif-note")}", want it to contain "What if"`);
    if ((await share()) !== shareBefore) problems.push("WI-3: share card or LinkedIn post changed with the what-if slider (must stay the published estimate)");
    const valuetext = await page.$eval("#whatif-cache", (s) => s.getAttribute("aria-valuetext"));
    if (!valuetext?.includes("%")) problems.push(`WI-3: slider aria-valuetext is ${JSON.stringify(valuetext)}, want a percent`);
    // WI-4: the method version stays on screen during a what-if.
    if (!(await page.textContent("#hero-meta")).includes(`method v`)) problems.push("WI-4: hero meta line lost the method version during a what-if");
    if (!(await page.textContent("#footer-version")).includes("method v")) problems.push("WI-4: footer lost the method version during a what-if");
    await page.click("#whatif-reset");
    if ((await page.textContent("#hero-big")) !== heroBefore) problems.push("WI-3: Reset did not restore the hero total");
    if ((await noteShown()) !== false) problems.push("WI-3: #whatif-note still shown after Reset");
    // Keyboard: ArrowRight on the focused slider moves it.
    const v0 = await page.$eval("#whatif-cache", (s) => s.value);
    await page.focus("#whatif-cache");
    await page.keyboard.press("ArrowRight");
    if ((await page.$eval("#whatif-cache", (s) => s.value)) === v0) problems.push("WI-3: ArrowRight did not change the slider value");
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

  // UX-R1, UX-R2: a file with no usage keeps the sample pill and shows the next-step error, styled as an error.
  await page.setInputFiles("#pick-files", noUsage);
  await page.waitForFunction(() => !/Reading/.test(document.querySelector("#drop-status")?.textContent ?? "Reading"));
  const failed = await page.evaluate(() => ({ pill: document.querySelector("#source-pill").textContent, status: document.querySelector("#drop-status").textContent, error: document.querySelector("#drop-status").classList.contains("error") }));
  if (failed.pill !== "Sample data") problems.push(`UX-R1: pill says "${failed.pill}" after a file with no usage`);
  if (failed.status !== "We couldn't find any Claude Code usage in that file. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.") problems.push(`UX-R2: no-usage file says "${failed.status}"`);
  if (!failed.error) problems.push("UX-R2: no-usage error has no .error class");
  const sampleHeadline = await page.textContent("#hero-big");
  await page.setInputFiles("#pick-files", log);
  await page.waitForFunction(() => document.querySelector("#source-pill")?.textContent === "Your files");
  if ((await page.textContent("#hero-big")) === sampleHeadline) problems.push("headline did not change after loading a file");
  // The lede follows the data source (recruiter-ready RR-16).
  if ((await page.textContent("#lede")).includes("sample data")) problems.push("lede still says sample data after loading a file");
  await page.click("#w-7d");
  await page.click("#use-sample");
  if (!(await page.textContent("#lede")).includes("sample data")) problems.push("lede lost its sample-data note after Use sample data");
  // Claude Code on the web: the copied prompt's counts-only output, pasted inside a code fence, loads.
  await page.click("#export > summary");
  const prompt = await page.textContent("#export-prompt");
  if (!prompt.includes("never the full path") || !prompt.includes("message content")) problems.push("export prompt lost its counts-only wording");
  await page.fill("#paste-log", ["```json", counts, "```"].join("\n"));
  await page.click("#read-paste");
  await page.waitForFunction(() => document.querySelector("#source-pill")?.textContent === "Your files");
  if (!(await page.textContent("#drop-status")).includes("pasted text")) problems.push("pasted lines did not load");
  if (await page.$eval("#drop-status", (s) => s.classList.contains("error"))) problems.push("UX-R2: success status still has the .error class");

  // UX-R2: empty paste and paste with no usage get their own next-step copy, styled as errors.
  for (const [text, want] of [
    ["   ", "Paste the lines first."],
    ["hello, not a log", "We couldn't find any usage lines in that text. Paste the lines Claude printed, one JSON object per line."],
  ]) {
    await page.fill("#paste-log", text);
    await page.click("#read-paste");
    const got = await page.evaluate(() => ({ t: document.querySelector("#drop-status").textContent, error: document.querySelector("#drop-status").classList.contains("error") }));
    if (got.t !== want) problems.push(`UX-R2: paste ${JSON.stringify(text)} says "${got.t}", want "${want}"`);
    if (!got.error) problems.push(`UX-R2: paste ${JSON.stringify(text)} error has no .error class`);
  }

  // One day of usage: the meta line shows the date once, not "D to D".
  await page.fill("#paste-log", counts.split("\n").filter((l) => l.includes('"timestamp":"2026-10-01')).join("\n"));
  await page.click("#read-paste");
  const meta = await page.textContent("#hero-meta");
  if (/(\d{4}-\d{2}-\d{2}) to \1/.test(meta)) problems.push(`one-day span printed twice in the meta line: "${meta}"`);
  if (!meta.includes("2026-10-01")) problems.push(`one-day meta line lost its date: "${meta}"`);

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > viewport.width) problems.push(`horizontal scroll at ${viewport.width}px (${width}px wide)`);
  await page.close();
}
// PS-R2 (privacy-security, CCW-M2.6.4): the chart writes day keys into svg.innerHTML. A dashboard
// row with markup for a date (a hand-edited or corrupt history file; the dashboard reads rows
// without the parser's checks) must render as text, never as an element.
{
  const xssRow = (date) => ({ date, source: "claude-code", model: "claude-opus-4-6", projectId: "0000000000000000", projectName: "proj", responses: 1, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 50 } });
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

await browser.close();
rmSync(scratch, { recursive: true, force: true });

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Playground check passed: no network requests, no errors, no sideways scroll.");
