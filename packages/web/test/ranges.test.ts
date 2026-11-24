import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright-core";
import { injectData, readSample } from "../src/inject.js";
import { launch } from "../../../tools/showcase-check/check.ts";

// M4.8.3 "ranges on every number" (docs/product/SPEC-RANGES.md RANGE-4..7, RANGE-11 web half,
// RANGE-12; UX-R6 P1, CCW-DEC-17). Tested on the built page (packages/web/dist/ccwatts.html,
// synthetic sample data only) in a real browser, playground and `ccwatts dashboard` mode.
//
// Expected numbers come from the sample (method v0.1.2): total 1.3–30.5 kWh, central 8.5;
// cache read share 30 / 64 / 72 %, cache write 48 / 26 / 21, output 22 / 10 / 7;
// EV 4.4 / 28 / 102 miles, fridge 0.9 / 5.7 / 20 days. If params.json or the sample move, these move.
//
// API choices pinned here (for the engineer):
//  - A share reads "64% (30–72%)" and a comparison "about 28 miles (4.4–100)" (core formatShare /
//    comparisons, en dash, no spaces), inside the same block element as the number.
//  - RANGE-7: one link per panel (Overview, Electricity), accessible name exactly "How we got this
//    range", href="#method", not nested in another <a>, tap target >= 48x48 px, within 120px
//    (vertically) of the range it explains (#ov-energy-detail, #hero-range).
//  - RANGE-12: every <title> in #chart says "(central)".
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`), CHROMIUM_PATH optional.
// With no Playwright the browser tests are SKIPPED (labeled below), never counted as passing.

const htmlPath = fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url));
const url = pathToFileURL(htmlPath).href;
const html = readFileSync(htmlPath, "utf8");
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const TABS = ["Overview", "Electricity", "Share", "Method", "Pace"] as const;
const LINK = "How we got this range";

const CACHE_READ = "64% (30–72%)";
const CACHE_WRITE = "26% (21–48%)";
const OUTPUT = "10% (7–22%)";
const EV = "about 28 miles (4.4–100)"; // UX-R14 (was 4.4–102)
const FRIDGE = "about 5.7 days (0.9–20)";

// ---------------------------------------------------------------------------------------------
// PENDING CHASE (SPEC-RANGES "Decision for Chase"): the recommended headline drops "Most". If Chase
// picks other words, change only these two constants and the RANGE-4 WORDING test below.
// ---------------------------------------------------------------------------------------------
const HEADLINE = `About ${CACHE_READ} comes from re-reading the conversation`;
const EXPLAIN_LEAD = `About ${CACHE_READ}`;

/**
 * RANGE-11 allowlist: blocks (by their own id, or the nearest ancestor id) whose bare % values are
 * exact counts or stated inputs, not estimates (SPEC-RANGES "Exempt"). Each needs a reason.
 */
const EXEMPT_IDS: Record<string, string> = {
  "whatif-value": "the what-if slider value (an input)",
  whatif: "the slider's tick labels 1% / published 10% / 25% (inputs)",
  "whatif-note": 'names the slider value ("Published 10%", an input); its kWh carry ranges',
  "whatif-why": "explains the tested input range, 1% to 25% of fresh input",
  params: "Method parameter notes: sourced inputs, not estimates",
};
// Also exempt by the scan's shape, so no id needed: responses, tokens, dates, chart axis ticks (SVG text
// has no %), Pace's late-night time, longest stretch and rest days ("5 of 7 days" is not "about N days").
/** Text exemptions inside any block: count ratios that must say so. */
const EXEMPT_TEXT = [/\d+% of tokens/g];

// A dashboard page, the way `ccwatts dashboard` writes one: the same template with mode "dashboard".
// Dashboard windows count back from today, so the sample's days are moved to end today (else the
// window is empty and the audit would pass on "0 Wh").
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sampleRows = readSample(html);
const lastDay = sampleRows.reduce((m, r) => (r.date > m ? r.date : m), "0000-00-00");
const shiftMs = Date.parse(`${localDay(new Date())}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`);
const recentRows = sampleRows.map((r) => ({ ...r, date: new Date(Date.parse(`${r.date}T00:00:00Z`) + shiftMs).toISOString().slice(0, 10) }));
const scratch = mkdtempSync(join(tmpdir(), "ccwatts-ranges-"));
const dashPath = join(scratch, "dashboard.html");
writeFileSync(dashPath, injectData(html, { mode: "dashboard", generatedAt: "2026-11-01T00:00:00Z", rows: recentRows }));
const dashUrl = pathToFileURL(dashPath).href;

let browser: Browser | null = null;
let noBrowser = "";
try {
  browser = await launch();
} catch (e) {
  noBrowser = `Playwright/Chromium not available (${(e as Error).message.split("\n")[0]}); set PLAYWRIGHT_MODULE`;
}
const withBrowser = describe.skipIf(!browser);
vi.setConfig({ testTimeout: 60_000 });
if (!browser) console.warn(`ranges.test.ts: browser tests SKIPPED: ${noBrowser}`);
afterAll(async () => {
  await browser?.close();
  rmSync(scratch, { recursive: true, force: true });
});

const problems: string[] = [];
async function open(viewport: { width: number; height: number }, hash = "", at = url): Promise<Page> {
  const page = await browser!.newPage({ viewport, colorScheme: "light" });
  page.on("request", (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(at + hash);
  await page
    .waitForFunction(() => ["#ov-energy", "#hero-big"].some((s) => /\d/.test(document.querySelector(s)?.textContent ?? "")), null, { timeout: 8000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.mouse.move(0, 0);
  return page;
}
const text = async (page: Page, sel: string) => ((await page.locator(sel).first().textContent()) ?? "").replace(/\s+/g, " ").trim();
const showTab = async (page: Page, name: string) => {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.waitForTimeout(150);
};
/** Ranged shares ("64% (30–72%)", "<1%" ends allowed) removed, so what's left is bare. */
const stripRanged = (s: string) => s.replace(/(?:<1|\d+(?:\.\d+)?)% ?\((?:<1|\d+(?:\.\d+)?) ?[–-] ?\d+(?:\.\d+)?%\)/g, "");
const bareShares = (s: string) => stripRanged(EXEMPT_TEXT.reduce((t, re) => t.replace(re, ""), s)).match(/(?:<1|\d+(?:\.\d+)?)%/g) ?? [];
/** Comparison numbers ("about 28 miles") not followed at once by a (low–high) range. */
const bareComparisons = (s: string) =>
  [...s.matchAll(/\babout ([\d.,]+) (miles?|days?|times)\b/g)]
    .filter((m) => !/^\s*\((?:range )?[<\d.,]+ ?[–-] ?[\d.,]+/.test(s.slice(m.index! + m[0].length)))
    .map((m) => m[0]);

/** Every visible block (nearest non-inline element) holding a % or a comparison number, with its nearest id. */
const numberBlocks = (page: Page) =>
  page.evaluate(() => {
    const out: { id: string; text: string }[] = [];
    const seen = new Set<Element>();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!/%|\babout [\d.,]+ (miles?|days?|times)\b/.test(n.textContent ?? "")) continue;
      let el = n.parentElement;
      if (!el || el.closest("script, style, title, template, #demo-bar")) continue;
      if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) continue;
      while (el.parentElement && getComputedStyle(el).display === "inline") el = el.parentElement;
      if (seen.has(el)) continue;
      seen.add(el);
      out.push({ id: el.id || el.closest("[id]")?.id || el.tagName.toLowerCase(), text: (el.textContent ?? "").replace(/\s+/g, " ").trim() });
    }
    return out;
  });

// ---------------------------------------------------------------------------------------------
// Playground, sample data.
// ---------------------------------------------------------------------------------------------
withBrowser("M4.8.3 ranges, playground sample data (browser)", () => {
  it(`RANGE-4 Overview "What drives it" (#ov-drives-text) shows the cache read share as "${CACHE_READ}"`, async () => {
    const page = await open(LAPTOP);
    const t = await text(page, "#ov-drives-text");
    expect(t).toContain(CACHE_READ);
    expect(bareShares(t), `bare % in "${t}"`).toEqual([]);
    await page.close();
  });

  it(`RANGE-4 Overview #ov-compare carries the EV and fridge ranges ("${EV}", "${FRIDGE}")`, async () => {
    const page = await open(LAPTOP);
    const t = await text(page, "#ov-compare");
    expect(t).toContain(EV);
    expect(t).toContain(FRIDGE);
    expect(bareComparisons(t)).toEqual([]);
    await page.close();
  });

  it("RANGE-4 no new Overview row: still exactly the Electricity and What drives it rows", async () => {
    const page = await open(LAPTOP);
    const rows = await page.locator("#p-overview a.row, #p-overview .row").evaluateAll((els) => [...new Set(els)].map((e) => e.id));
    expect(rows).toEqual(["ov-energy", "ov-drives"]);
    await page.close();
  });

  // PENDING CHASE: the one wording assertion. Change HEADLINE / EXPLAIN_LEAD above if Chase picks other words.
  it(`RANGE-4 WORDING (pending Chase, SPEC-RANGES "Decision for Chase") the headline reads "${HEADLINE}" and the Electricity lead drops "Most"`, async () => {
    const page = await open(LAPTOP);
    expect(await text(page, "#ov-drives-text")).toBe(HEADLINE);
    await showTab(page, "Electricity");
    const lead = await text(page, "#explain");
    expect(lead.startsWith(EXPLAIN_LEAD), `#explain reads "${lead}"`).toBe(true);
    expect(lead).not.toMatch(/\bMost\b/);
    await page.close();
  });

  it(`RANGE-5 Electricity #hero-compare carries the EV and fridge ranges`, async () => {
    const page = await open(LAPTOP, "#electricity");
    const t = await text(page, "#hero-compare");
    expect(t).toContain(EV);
    expect(t).toContain(FRIDGE);
    expect(bareComparisons(t)).toEqual([]);
    await page.close();
  });

  it(`RANGE-5 Electricity #explain shows the cache read share with its range`, async () => {
    const page = await open(LAPTOP, "#electricity");
    const t = await text(page, "#explain");
    expect(t).toContain(CACHE_READ);
    expect(bareShares(t), `bare % in "${t}"`).toEqual([]);
    await page.close();
  });

  it(`RANGE-5 Electricity #explain-more ranges every share (${CACHE_READ}, ${CACHE_WRITE}, ${OUTPUT}); the token share says "of tokens"`, async () => {
    const page = await open(LAPTOP, "#electricity");
    const t = await text(page, "#explain-more");
    for (const s of [CACHE_READ, CACHE_WRITE, OUTPUT]) expect(t).toContain(s);
    expect(t).toMatch(/\d+% of tokens/);
    expect(bareShares(t), `bare % in "${t}"`).toEqual([]);
    await page.close();
  });

  for (const list of ["by-model", "by-project"]) {
    it(`RANGE-6 #${list} rows show no %, and each keeps its central kWh and "range"`, async () => {
      const page = await open(LAPTOP, "#electricity");
      const rows = await page.locator(`#${list} li`).allTextContents();
      expect(rows.length).toBeGreaterThan(1);
      for (const raw of rows) {
        const r = raw.replace(/\s+/g, " ").trim();
        expect(r, `row "${r}"`).not.toContain("%");
        expect(r, `row "${r}"`).toMatch(/[\d.]+ k?Wh/);
        expect(r, `row "${r}"`).toMatch(/\brange\b/);
      }
      await page.close();
    });
  }

  for (const vp of [PHONE, LAPTOP]) {
    const at = `${vp.width}x${vp.height}`;
    for (const [panel, tab, rangeSel] of [["#p-overview", "Overview", "#ov-energy-detail"], ["#p-electricity", "Electricity", "#hero-range"]] as const) {
      it(`RANGE-7 ${tab} has one "${LINK}" link to #method beside the range, not inside another <a>, >= 48px (${at})`, async () => {
        const page = await open(vp);
        if (tab !== "Overview") await showTab(page, tab);
        const links = page.locator(panel).getByRole("link", { name: LINK, exact: true });
        expect(await links.count(), `"${LINK}" links in ${panel}`).toBe(1);
        const link = links.first();
        expect(await link.isVisible()).toBe(true);
        expect(await link.getAttribute("href")).toBe("#method");
        expect(await link.evaluate((el) => el.parentElement?.closest("a")?.id ?? null), "nested in another <a>").toBeNull();
        const box = (await link.boundingBox())!;
        expect(box.height, "tap target height").toBeGreaterThanOrEqual(48);
        expect(box.width, "tap target width").toBeGreaterThanOrEqual(48);
        const range = (await page.locator(rangeSel).boundingBox())!;
        const gap = Math.max(0, box.y - (range.y + range.height), range.y - (box.y + box.height));
        expect(gap, `link is ${Math.round(gap)}px from ${rangeSel}`).toBeLessThanOrEqual(120);
        await page.close();
      });

      it(`RANGE-7 following "${LINK}" from ${tab} opens Method with its heading below the sticky tabs (${at})`, async () => {
        const page = await open(vp);
        if (tab !== "Overview") await showTab(page, tab);
        await page.locator(panel).getByRole("link", { name: LINK, exact: true }).first().click({ timeout: 2000 });
        await page.waitForTimeout(250);
        expect(await page.getByRole("tab", { name: "Method", exact: true }).getAttribute("aria-selected")).toBe("true");
        const h = page.locator("#p-method h2").first();
        const [tabs, head] = [(await page.locator("#tabs").boundingBox())!, await h.boundingBox()];
        expect(head, "Method heading not rendered").not.toBeNull();
        expect(head!.y, `heading top ${head!.y.toFixed(0)}, tabs bottom ${(tabs.y + tabs.height).toFixed(0)}`).toBeGreaterThanOrEqual(tabs.y + tabs.height - 0.5);
        expect(head!.y + head!.height).toBeLessThanOrEqual(vp.height + 0.5);
        await page.close();
      });
    }
  }

  it("RANGE-12 every daily chart tooltip (#chart <title>) says (central)", async () => {
    const page = await open(LAPTOP, "#electricity");
    const titles = await page.locator("#chart title").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    const missing = titles.filter((t) => !t.includes("(central)"));
    expect(missing.slice(0, 3), `${missing.length} of ${titles.length} tooltips lack "(central)"`).toEqual([]);
    await page.close();
  });

  it("RANGE no network requests or page errors while checking", () => {
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// RANGE-11 audit guard: every tab, playground and dashboard, every <details> open.
// ---------------------------------------------------------------------------------------------
withBrowser("M4.8.3 RANGE-11 audit guard (browser)", () => {
  for (const [mode, at] of [["playground", url], ["dashboard", dashUrl]] as const) {
    for (const tab of TABS) {
      it(`RANGE-11 ${mode} ${tab}: every % and comparison number has a range in the same element (allowlist: ${Object.keys(EXEMPT_IDS).join(", ")})`, async () => {
        const page = await open(LAPTOP, "", at);
        await showTab(page, tab);
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        await page.waitForTimeout(100);
        const blocks = await numberBlocks(page);
        // Not vacuous: these tabs show estimates on sample data.
        if (tab === "Overview" || tab === "Electricity") expect(await page.locator("#ov-energy-value, #hero-big").first().textContent(), "no data shown").toMatch(/\d/);
        if (tab !== "Method" && tab !== "Pace") expect(blocks.length, "no % or comparison found to audit").toBeGreaterThan(0);
        const bad = blocks
          .filter((b) => !(b.id in EXEMPT_IDS))
          .map((b) => ({ ...b, bare: [...bareShares(b.text), ...bareComparisons(b.text)] }))
          .filter((b) => b.bare.length)
          .map((b) => `#${b.id}: ${b.bare.join(", ")} in "${b.text.slice(0, 140)}"`);
        expect(bad).toEqual([]);
        await page.close();
      });
    }
  }

  it("RANGE-11 the allowlist is still needed: each exempt id holds a bare % somewhere (stale entries fail)", async () => {
    const seen = new Set<string>();
    for (const at of [url, dashUrl]) {
      const page = await open(LAPTOP, "", at);
      for (const tab of TABS) {
        await showTab(page, tab);
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        for (const b of await numberBlocks(page)) if (b.id in EXEMPT_IDS && bareShares(b.text).length) seen.add(b.id);
      }
      await page.close();
    }
    expect(Object.keys(EXEMPT_IDS).filter((id) => !seen.has(id))).toEqual([]);
  });
});
