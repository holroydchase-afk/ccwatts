import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import {
  defaultParams,
  estimate,
  formatEnergy,
  paceHoursRange,
  paceWeeks,
  receiptSvg,
  rollupRecords,
  samplePaceDays,
} from "@ccwatts/core";
import { injectData, readSample } from "../src/inject.js";
import { launch } from "../../../tools/showcase-check/check.ts";

// EVAL-FINDINGS (intake #112, docs/product/SPEC-EVAL-FINDINGS.md): each tab's answer in the first
// screen at 390px. Synthetic sample data only.
//
// API choices pinned here (for the engineer):
//  - EF-1..EF-4: the What-if result line is the first element after `.whatif-scale` inside #whatif
//    (before #whatif-why). It is visible on load (no `hidden`), and the same element updates on
//    `input`. Any id works; reusing #whatif-note is fine. Note page.test.ts WI-2 ("#whatif-note hidden
//    until the slider moves") pins the old behavior and must change with this PR.
//  - EF-5: the sample label is the element directly before or after #card (sibling), text contains
//    "Sample data", not class `vh`, and every CSS rule that matches its id or class sets no font-size
//    under 17px. Hidden (hidden attribute or display:none) when the page shows the user's own logs.
//  - EF-8: no #pace-pill in the Pace panel. page/pace-web.test.ts PACE-WEB2 pins the pill and must
//    change with this PR.
//  - EF-9/EF-10: #pace-lead holds only the latest full week's active hours with its range. The
//    late-night, longest-stretch and days-active figures, #pace-sofar and #pace-agents sit after
//    #pace-chart in document order.
//  - EF-12: #params is visible on the Method tab without a click.
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`), CHROMIUM_PATH optional.
// With no Playwright the browser tests are SKIPPED (labeled below), never counted as passing.

const htmlPath = fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url));
const url = pathToFileURL(htmlPath).href;
const html = readFileSync(htmlPath, "utf8");
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");
const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(template)?.[1] ?? "";
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

let browser: Browser | null = null;
let noBrowser = "";
try {
  browser = await launch();
} catch (e) {
  noBrowser = `Playwright/Chromium not available (${(e as Error).message.split("\n")[0]}); set PLAYWRIGHT_MODULE`;
}
const withBrowser = describe.skipIf(!browser);
if (!browser) console.warn(`eval-findings.test.ts: browser tests SKIPPED: ${noBrowser}`);

const tmp = mkdtempSync(join(tmpdir(), "ccwatts-ef-"));
afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const problems: string[] = [];
async function open(width = 390, height = 844, pageUrl = url, waitHero = true): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height } });
  page.on("request", (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(pageUrl);
  // Own-logs pages count back from today, so sample-dated rows can leave the hero at "–": wait for the card instead.
  if (waitHero) await page.waitForFunction(() => (document.getElementById("hero-big")?.textContent ?? "–") !== "–", null, { timeout: 8000 });
  else await page.waitForFunction(() => !!(document.getElementById("card") as HTMLImageElement | null)?.getAttribute("src"), null, { timeout: 8000 });
  return page;
}
async function selectTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.waitForTimeout(50);
}

/** The What-if result line: first element after .whatif-scale inside #whatif, before #whatif-why. */
async function whatIfLine(page: Page) {
  return page.evaluate(() => {
    const scale = document.querySelector("#whatif .whatif-scale");
    const el = scale?.nextElementSibling ?? null;
    if (!el || el.id === "whatif-why") return null;
    if (!el.id) el.id = "ef-whatif-line";
    const shown = !el.hasAttribute("hidden") && getComputedStyle(el).display !== "none" && (el as HTMLElement).offsetHeight > 0;
    return { id: el.id, text: (el.textContent ?? "").replace(/\s+/g, " ").trim(), shown, role: el.getAttribute("role"), live: el.getAttribute("aria-live") };
  });
}
async function moveSlider(page: Page, value: number) {
  await page.evaluate((v) => {
    const s = document.getElementById("whatif-cache") as HTMLInputElement;
    s.value = String(v);
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(50);
}

const publishedCache = defaultParams.params["cache_read_vs_input"]!.value;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const sliderMax = Number(/<input[^>]*id="whatif-cache"[^>]*max="([^"]+)"/.exec(html)?.[1] ?? "NaN");

// ---------------------------------------------------------------------------------------------
// EF-CC-1 What if? result beside the slider
// ---------------------------------------------------------------------------------------------
withBrowser("EF-CC-1 What-if result beside the slider (EF-1..EF-4)", () => {
  it("EF-1 on load, a visible result line right after the slider scale shows the total with range and Method v", async () => {
    const page = await open();
    await selectTab(page, "Electricity");
    const line = await whatIfLine(page);
    const hero = (await page.textContent("#hero-big"))?.replace(/\s+/g, " ").trim() ?? "";
    await page.close();
    expect(line, "an element after .whatif-scale, before #whatif-why").not.toBeNull();
    expect(line!.shown, `the line after the slider scale (#${line!.id}) is hidden on load`).toBe(true);
    expect(line!.text).toMatch(/range/);
    expect(line!.text).toMatch(/Method v\d/);
    const central = /[\d.,]+/.exec(hero)?.[0] ?? "<none>";
    expect(line!.text, `the line names the hero total ${central}`).toContain(central);
  });

  it("EF-2 moving the slider updates that same line with the what-if and published totals and ranges", async () => {
    const page = await open();
    await selectTab(page, "Electricity");
    const before = await whatIfLine(page);
    await moveSlider(page, sliderMax);
    const after = await whatIfLine(page);
    await page.close();
    expect(before?.shown, "the line must already be shown before the slider moves (same line as EF-1)").toBe(true);
    expect(after?.id).toBe(before?.id);
    expect(after!.shown).toBe(true);
    expect(after!.text.match(/range \d/g)?.length ?? 0, "two ranges: what-if and published").toBeGreaterThanOrEqual(2);
    expect(after!.text).toMatch(/Published/i);
    expect(after!.text).not.toBe(before!.text);
  });

  it("EF-3 off the published value, the line says what-if and the share card keeps the published value; card image unchanged", async () => {
    const page = await open();
    await selectTab(page, "Electricity");
    const before = await whatIfLine(page);
    const cardBefore = await page.getAttribute("#card", "src");
    await moveSlider(page, sliderMax);
    const after = await whatIfLine(page);
    const cardAfter = await page.getAttribute("#card", "src");
    await page.close();
    expect(before?.shown, "the line must be shown on load (EF-1) so it is the same line here").toBe(true);
    expect(after!.text).toMatch(/what-if/i);
    // UX-R71 rewords this to "· share card keeps 10% ·" (was "The share card keeps 10%.").
    expect(after!.text).toMatch(new RegExp(`share card keeps ${pct(publishedCache)}`, "i"));
    expect(cardAfter).toBe(cardBefore);
  });

  it("EF-4 the line shown on load is a live region (role=status or aria-live=polite)", async () => {
    const page = await open();
    await selectTab(page, "Electricity");
    const line = await whatIfLine(page);
    await page.close();
    expect(line?.shown, "the live region must be the line shown on load").toBe(true);
    expect(line!.role === "status" || line!.live === "polite").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// EF-CC-4 Share card preview readable on a phone
// ---------------------------------------------------------------------------------------------
/** The sibling directly before or after #card whose text says Sample data (static HTML). */
function sampleLabelTag(): { tag: string; id: string; classes: string[] } | null {
  const block = /<section[^>]*id="p-share"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const tags = [...block.matchAll(/<([a-z0-9]+)([^>]*)>([^<]*)/g)];
  const i = tags.findIndex((m) => /id="card"/.test(m[2]!));
  for (const m of [tags[i - 1], tags[i + 1]]) {
    if (m && /Sample data/.test(m[3]!)) {
      return { tag: m[0]!, id: /id="([^"]+)"/.exec(m[2]!)?.[1] ?? "", classes: (/class="([^"]+)"/.exec(m[2]!)?.[1] ?? "").split(/\s+/).filter(Boolean) };
    }
  }
  return null;
}

describe("EF-CC-4 Share card preview (EF-5, EF-6, static)", () => {
  it("EF-5 a text label saying Sample data sits directly above or below #card, not visually hidden, at body size", () => {
    const label = sampleLabelTag();
    expect(label, "no Sample data label next to #card").not.toBeNull();
    expect(label!.classes).not.toContain("vh");
    const sels = [label!.id && `#${label!.id}`, ...label!.classes.map((c) => `.${c}`)].filter(Boolean) as string[];
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => sels.some((s) => m[1]!.split(",").some((x) => x.includes(s))));
    for (const r of rules) {
      const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(r[2]!)?.[1];
      if (size) expect(Number(size), `${r[1]!.trim()} font-size`).toBeGreaterThanOrEqual(17);
    }
  });

  it("EF-6 the sample card SVG from core is byte-identical to before (pinned hash)", () => {
    const rows = readSample(html);
    const svg = receiptSvg({ estimate: estimate(rollupRecords(rows), defaultParams), params: defaultParams, windowLabel: "EF-6 fixture", sample: true });
    // Re-pinned for M4.8.3 (SPEC-RANGES RANGE-8): the slip's per-type and model rows now carry ranges and the
    // comparison lines carry (low–high). The EF-6 intent stands: the web preview changes nothing in the card.
    // Re-pinned for the M4.8.3 fix round (UX-R14, UX-R15): diffed against the old card, the only changes are
    // "1.3 – 30.5" -> "1.3–30.5" (aria-label, headline, RANGE row) and "(4.4–102)" -> "(4.4–100)".
    expect(createHash("sha256").update(svg).digest("hex")).toBe("4b8d0512b622138489c4c6878041eca29a2df154c9520db97703eddb9e64a145");
  });
});

withBrowser("EF-CC-4 Share card preview (EF-5, in a browser)", () => {
  it("EF-5 the label is visible at >= 17px for the sample", async () => {
    const page = await open();
    await selectTab(page, "Share");
    const r = await page.evaluate(() => {
      const card = document.getElementById("card")!;
      const el = [card.previousElementSibling, card.nextElementSibling].find((e) => /Sample data/.test(e?.textContent ?? "")) as HTMLElement | undefined;
      if (!el) return null;
      return { shown: el.offsetHeight > 0 && getComputedStyle(el).display !== "none", size: parseFloat(getComputedStyle(el).fontSize) };
    });
    await page.close();
    expect(r, "no Sample data label next to #card").not.toBeNull();
    expect(r!.shown).toBe(true);
    expect(r!.size).toBeGreaterThanOrEqual(17);
  });

  it("EF-5 the label is hidden when the page shows the user's own logs", async () => {
    const own = join(tmp, "own.html");
    writeFileSync(own, injectData(html, { mode: "dashboard", generatedAt: "2026-11-24T00:00:00Z", rows: readSample(html) }));
    const page = await open(390, 844, pathToFileURL(own).href, false);
    await selectTab(page, "Share");
    const r = await page.evaluate(() => {
      const card = document.getElementById("card")!;
      const sibs = [card.previousElementSibling, card.nextElementSibling] as (HTMLElement | null)[];
      return {
        any: sibs.some((e) => /Sample data/.test(e?.textContent ?? "")),
        shown: sibs.some((e) => !!e && /Sample data/.test(e.textContent ?? "") && e.offsetHeight > 0 && getComputedStyle(e).display !== "none"),
      };
    });
    await page.close();
    expect(r.any, "the label must exist (EF-5) for this check to mean anything").toBe(true);
    expect(r.shown).toBe(false);
  });
});

describe("EF-CC-4 manual (EF-7)", () => {
  it.todo("EF-7 (manual) at 390px the Sample data label reads without zoom; Open full size still opens the card");
});

// ---------------------------------------------------------------------------------------------
// EF-CC-5 Pace leads with one heading, one number, then the chart
// ---------------------------------------------------------------------------------------------
const paceSection = /<section[^>]*id="pace"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("EF-CC-5 Pace (EF-8, EF-11 static)", () => {
  it("EF-8 one heading containing Pace, no eyebrow repeating it, and no #pace-pill", () => {
    const headings = [...paceSection.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(headings.filter((h) => /Pace/.test(h))).toHaveLength(1);
    const eyebrows = [...paceSection.matchAll(/<[a-z]+[^>]*class="[^"]*\beyebrow\b[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]!);
    expect(eyebrows.filter((e) => /Pace/i.test(e))).toEqual([]);
    expect(paceSection).not.toContain('id="pace-pill"');
  });

  it("EF-11 opt-in, skipped and unreadable notes are unchanged", () => {
    expect(paceSection).toContain('<p class="note" id="pace-skipped" hidden>Pace is skipped with --path or --no-history, which leave pace.jsonl alone. Run <code>ccwatts dashboard</code> without them to see it.</p>');
    expect(paceSection).toContain('<p class="note" id="pace-unreadable" hidden>Couldn\'t read pace.jsonl, so Pace is left out this time. The file is left as it is.</p>');
    expect(paceSection).toContain('<p class="note" id="pace-optin" hidden>Pace is off. Run <code>ccwatts pace</code> once to turn it on: it keeps daily minutes and whole hours in <code>~/.ccwatts/pace.jsonl</code> on this computer, and this page shows it next time.</p>');
  });
});

withBrowser("EF-CC-5 Pace (EF-9..EF-11, in a browser)", () => {
  const last = readSample(html).map((r) => r.date).sort().at(-1)!;
  const weeks = paceWeeks(samplePaceDays(last), last, 4);
  const lastFull = weeks[1]!;

  async function pace(page: Page) {
    await selectTab(page, "Pace");
    return page.evaluate(() => {
      const body = document.getElementById("pace-body")!;
      const chart = document.getElementById("pace-chart")!;
      const lead = document.getElementById("pace-lead")!;
      const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const shown = (e: Element) => (e as HTMLElement).offsetHeight > 0 && !e.closest("[hidden]") && !e.closest("details:not([open])") && !e.closest(".vh");
      const details = [...body.querySelectorAll("p, li, div")]
        .filter((e) => e !== lead && !e.contains(chart) && !e.closest("#pace-legend") && shown(e) && !e.querySelector("p, li, div"))
        .map((e) => ({ id: e.id, text: (e.textContent ?? "").replace(/\s+/g, " ").trim(), afterChart: after(chart, e) }))
        .filter((d) => d.text);
      return {
        lead: (lead.textContent ?? "").replace(/\s+/g, " ").trim(),
        leadBeforeChart: after(lead, chart),
        details,
        panelText: (document.getElementById("pace")!.textContent ?? "") + (document.getElementById("footer-version")?.textContent ?? ""),
      };
    });
  }

  it("EF-9 #pace-lead is one line: the latest full week's active hours with its range, nothing else", async () => {
    const page = await open();
    const p = await pace(page);
    await page.close();
    expect(p.lead).toMatch(/active hours/);
    expect(p.lead).toContain(`range ${paceHoursRange(lastFull.activeHours)}`);
    expect(p.lead, "late-night figure moves below the chart").not.toMatch(/\bpast \d/);
    expect(p.lead, "longest stretch moves below the chart").not.toMatch(/longest stretch/i);
    expect(p.lead, "days active moves below the chart").not.toMatch(/active \d+ of \d+ days/);
    expect(p.lead).not.toMatch(/so far|Agents worked/);
  });

  it("EF-10 #pace-lead comes before #pace-chart, and the chart comes before every detail line", async () => {
    const page = await open();
    const p = await pace(page);
    await page.close();
    expect(p.leadBeforeChart).toBe(true);
    const moved = p.details.filter((d) => /past \d|longest stretch|active \d+ of \d+ days|so far|Agents worked/i.test(d.text));
    expect(moved.length, "the moved details are shown somewhere in the panel").toBeGreaterThan(0);
    for (const d of moved) expect(d.afterChart, `"${d.text}" (#${d.id}) should come after #pace-chart`).toBe(true);
    expect(p.details.some((d) => /longest stretch/i.test(d.text) && d.afterChart), "longest stretch below the chart").toBe(true);
  });

  it("EF-11 every hour figure in the detail lines keeps a range, and the panel or footer shows the method version", async () => {
    const page = await open();
    const p = await pace(page);
    await page.close();
    const below = p.details.filter((d) => d.afterChart);
    expect(below.length, "detail lines below the chart").toBeGreaterThan(0);
    for (const d of below) {
      // An "N hours" figure needs a range: "range a – b" or an explicit "a – b hours".
      for (const m of d.text.matchAll(/(about )?\d+(?:\.\d+)? hours/g)) {
        const at = m.index!;
        const around = d.text.slice(Math.max(0, at - 24), at + m[0].length + 24);
        expect(around, `"${d.text}": hour figure without a range`).toMatch(/\d+(?:\.\d+)? – \d+(?:\.\d+)? hours|range \d/);
      }
    }
    expect(p.panelText).toMatch(new RegExp(`method v${defaultParams.version.replace(/\./g, "\\.")}`, "i"));
  });
});

// ---------------------------------------------------------------------------------------------
// EF-CC-6 Method tab shows parameters and sources by default
// ---------------------------------------------------------------------------------------------
describe("EF-CC-6 Method parameters (EF-12, EF-13 static)", () => {
  it("EF-12 #params-box renders open, or #params is no longer inside a <details>", () => {
    const method = /<section[^>]*id="p-method"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(method).toContain('id="params"');
    const closedDetails = [...method.matchAll(/<details(?![^>]*\sopen[\s>=])[^>]*>[\s\S]*?<\/details>/g)].map((m) => m[0]);
    expect(closedDetails.some((d) => d.includes('id="params"')), "#params is inside a closed <details>").toBe(false);
  });

  it("EF-13 the table stays inside .tablewrap", () => {
    expect(html).toMatch(/<div class="tablewrap">\s*<table id="params">/);
  });
});

withBrowser("EF-CC-6 Method parameters (EF-12, EF-13, in a browser at 390px)", () => {
  it("EF-12 the table is visible without a click and lists each parameter's value, low, high and source", async () => {
    const page = await open();
    await selectTab(page, "Method");
    const r = await page.evaluate(() => {
      const t = document.getElementById("params") as HTMLTableElement;
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
      const rows = [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? ""));
      return { shown: t.offsetHeight > 0, heads, rows };
    });
    await page.close();
    expect(r.shown, "#params visible on the Method tab without a click").toBe(true);
    const ids = Object.keys(defaultParams.params);
    expect(r.rows).toHaveLength(ids.length);
    const col = (name: RegExp) => r.heads.findIndex((h) => name.test(h));
    for (const name of [/Value/, /Range|Low/, /Source/]) expect(col(name), String(name)).toBeGreaterThanOrEqual(0);
    ids.forEach((id, i) => {
      const p = defaultParams.params[id]!;
      const row = r.rows.find((cells) => cells[0]!.startsWith(id)) ?? r.rows[i]!;
      expect(row[col(/Value/)]).toBe(String(p.value));
      expect(row.join(" ")).toContain(`${p.low} – ${p.high}`);
      expect(row[col(/Source/)]!.length, `${id} source`).toBeGreaterThan(0);
    });
  });

  it("EF-13 at 390px the shown table scrolls inside .tablewrap and the page has no horizontal scroll", async () => {
    const page = await open();
    await selectTab(page, "Method");
    const r = await page.evaluate(() => {
      const t = document.getElementById("params")!;
      return {
        shown: t.offsetHeight > 0,
        inWrap: !!t.closest(".tablewrap"),
        pageScroll: document.scrollingElement!.scrollWidth - window.innerWidth,
      };
    });
    await page.close();
    expect(r.shown, "#params must be shown (EF-12) for the scroll check to mean anything").toBe(true);
    expect(r.inWrap).toBe(true);
    expect(r.pageScroll).toBeLessThanOrEqual(0);
  });
});

describe("EF manual cases outside this file's range", () => {
  it.todo("EF-14 (manual) at 390px the first parameter row is visible within one screen of the tab bar");
});

describe("EF no network and no page errors", () => {
  it("EF browser runs made no network request and threw no page error", () => {
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Review round for intake #112: ux-reviewer findings UX-R68..UX-R73 (390px first).
// API choices pinned here (for the engineer):
//  - UX-R68: the sample label stays the sibling of #card (EF-5) and reads
//    "Sample data · <central> <unit> (range <low>–<high> <unit>) · method v<version>", built from the
//    published estimate the card shows (not hard-coded in template.html). In sample mode no other visible
//    text in #p-share says "sample data" (the "This card shows sample data…" status line goes).
//  - UX-R69: no `.eyebrow` in #pace; "opt-in" and "stays local" move into #pace-how. #pace-lead is
//    22px, weight 600 or more, and at least as large as h2#pace-h ("Pace", unchanged).
//  - UX-R70: on the stacked 390px layout, each row's "About this value" summary sits below its Source.
//  - UX-R71: the What-if line (#whatif-note) reads as two lines (innerText split on "\n", e.g. two
//    block children or a <br>) during a what-if, one at rest; see the exact wording in the tests.
//  - UX-R72: an "a – b" range in the Pace panel never breaks across lines. Note: U+00A0 after an en dash
//    still allows a break (UAX #14, BA × GL is not forbidden), so use e.g. a white-space:nowrap span.
//  - UX-R73: #params-box summary reads "Parameters and sources".
// ---------------------------------------------------------------------------------------------
const num = "[\\d.,]+";
const ver = defaultParams.version.replace(/\./g, "\\.");
/** Central and low/high of the hero (published while no what-if is active). */
async function heroFigures(page: Page) {
  return page.evaluate(() => {
    const big = (document.getElementById("hero-big")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const range = (document.getElementById("hero-range")?.textContent ?? "").replace(/\s+/g, " ");
    const c = /([\d.,]+)\s*(k?Wh)/.exec(big);
    const r = /([\d.,]+)\s*k?Wh[\s\S]*?([\d.,]+)\s*k?Wh/.exec(range);
    return { central: c?.[1] ?? "?", unit: c?.[2] ?? "?", low: r?.[1] ?? "?", high: r?.[2] ?? "?" };
  });
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("UXR-68..73 review round (static)", () => {
  it("UXR-68 the sample label is not hard-coded with figures in template.html (filled from the live estimate)", () => {
    const tag = /<p[^>]*id="card-sample"[^>]*>[\s\S]*?<\/p>/.exec(template)?.[0] ?? "";
    expect(tag, "#card-sample still in template.html").not.toBe("");
    expect(tag).not.toMatch(/\d\s*k?Wh/);
    expect(app, "the duplicate status line under the buttons is gone").not.toContain("This card shows sample data");
  });

  it("UXR-69 no eyebrow in the Pace panel; 'opt-in · stays local' lives in the 'How Pace is counted' details; h2 stays Pace", () => {
    expect(paceSection).not.toMatch(/class="[^"]*\beyebrow\b/);
    expect(paceSection).toMatch(/<h2[^>]*id="pace-h"[^>]*>Pace<\/h2>/);
    const how = /<details[^>]*id="pace-how"[^>]*>[\s\S]*?<\/details>/.exec(paceSection)?.[0] ?? "";
    expect(how, "#pace-how details").not.toBe("");
    expect(how).toMatch(/opt-in/);
    expect(how).toMatch(/stays local/);
  });

  it("UXR-70 in the parameter row, 'About this value' comes after the Source cell in source order", () => {
    const row = /<tr><td data-label="Parameter">[\s\S]*?<\/tr>/.exec(app)?.[0] ?? "";
    expect(row, "row template in app.ts").not.toBe("");
    expect(row.indexOf("About this value"), "About this value after Source").toBeGreaterThan(row.indexOf('data-label="Source"'));
  });

  it("UXR-73 the parameters summary reads 'Parameters and sources'", () => {
    const summary = /<details[^>]*id="params-box"[^>]*>\s*<summary[^>]*>([^<]*)<\/summary>/.exec(html)?.[1]?.trim();
    expect(summary).toBe("Parameters and sources");
  });
});

withBrowser("UXR-68..73 review round (in a browser)", () => {
  it("UXR-68 at 390px the sample label reads 'Sample data · <total> (range …) · method v' at 17px+, matching the published hero", async () => {
    const page = await open();
    const hero = await heroFigures(page);
    await selectTab(page, "Share");
    const r = await page.evaluate(() => {
      const el = document.getElementById("card-sample")!;
      return { text: (el.textContent ?? "").replace(/\s+/g, " ").trim(), size: parseFloat(getComputedStyle(el).fontSize), shown: el.offsetHeight > 0 };
    });
    await page.close();
    expect(r.shown).toBe(true);
    expect(r.size).toBeGreaterThanOrEqual(17);
    expect(r.text).toMatch(
      new RegExp(`^Sample data · ${reEsc(hero.central)} ${hero.unit} \\(range ${reEsc(hero.low)}–${reEsc(hero.high)} k?Wh\\) · method v${ver}$`),
    );
  });

  it("UXR-68 the sample label keeps the published total while a what-if is active (it describes the card)", async () => {
    const page = await open();
    await selectTab(page, "Share");
    const before = await page.textContent("#card-sample");
    await selectTab(page, "Electricity");
    await moveSlider(page, sliderMax);
    await selectTab(page, "Share");
    const after = await page.textContent("#card-sample");
    await page.close();
    expect(before).toMatch(/\d/);
    expect(after).toBe(before);
  });

  it("UXR-68 in sample mode only one visible line in #p-share says 'sample data' (no repeat under the buttons)", async () => {
    const page = await open();
    await selectTab(page, "Share");
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#p-share *")]
        .filter((e) => e.offsetHeight > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && /sample data/i.test(n.textContent ?? "")))
        .map((e) => `#${e.id || e.className}: ${(e.textContent ?? "").trim()}`),
    );
    await page.close();
    expect(lines, lines.join(" | ")).toHaveLength(1);
  });

  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    it(`UXR-69 at ${width}px #pace-lead is 22px and 600+ weight, at least the size of h2 Pace, and no eyebrow shows`, async () => {
      const page = await open(width, height);
      await selectTab(page, "Pace");
      const r = await page.evaluate(() => {
        const lead = document.getElementById("pace-lead")!;
        const textEl = ([lead, ...lead.querySelectorAll<HTMLElement>("*")].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /\d/.test(n.textContent ?? ""))) ?? lead) as HTMLElement;
        const h2 = document.getElementById("pace-h")!;
        const eyebrows = [...document.querySelectorAll<HTMLElement>("#pace .eyebrow")].filter((e) => e.offsetHeight > 0).length;
        return {
          size: parseFloat(getComputedStyle(textEl).fontSize),
          weight: Number(getComputedStyle(textEl).fontWeight),
          h2: parseFloat(getComputedStyle(h2).fontSize),
          h2Text: (h2.textContent ?? "").trim(),
          eyebrows,
        };
      });
      await page.close();
      expect(r.size, "#pace-lead font-size").toBe(22);
      expect(r.weight, "#pace-lead weight").toBeGreaterThanOrEqual(600);
      expect(r.size, "answer at least as large as the label").toBeGreaterThanOrEqual(r.h2);
      expect(r.h2Text).toBe("Pace");
      expect(r.eyebrows, "visible eyebrow lines in #pace").toBe(0);
    });
  }

  it("UXR-70 at 390px each stacked parameter row shows name, Value, Range, Unit, Label, Source, then 'About this value' last", async () => {
    const page = await open();
    await selectTab(page, "Method");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLTableRowElement>("#params tbody tr")].map((tr) => {
        const top = (e: Element | null) => (e ? e.getBoundingClientRect().top : NaN);
        const about = [...tr.querySelectorAll("summary")].find((s) => /About this value/.test(s.textContent ?? "")) ?? null;
        const cells = ["Parameter", "Value", "Range", "Unit", "Label", "Source"].map((l) => top(tr.querySelector(`[data-label="${l}"]`)));
        const name = top(tr.querySelector("code"));
        return { id: tr.querySelector("code")?.textContent ?? "?", name, cells, about: top(about) };
      }),
    );
    await page.close();
    expect(rows.length).toBe(Object.keys(defaultParams.params).length);
    for (const r of rows) {
      const order = [r.name, ...r.cells.slice(1), r.about];
      expect(order.every((v) => Number.isFinite(v)), `${r.id}: missing a cell or the About summary`).toBe(true);
      for (let i = 1; i < order.length; i++) expect(order[i]!, `${r.id}: item ${i} of name, Value, Range, Unit, Label, Source, About`).toBeGreaterThan(order[i - 1]!);
    }
  });

  it("UXR-71 at rest the What-if line is one line: 'Published 10%: <total> (range … kWh) · Method v'", async () => {
    const page = await open();
    const hero = await heroFigures(page);
    await selectTab(page, "Electricity");
    const t = await page.evaluate(() => (document.getElementById("whatif-note") as HTMLElement).innerText.replace(/[ \t ]+/g, " ").trim());
    await page.close();
    expect(t).toMatch(
      new RegExp(`^Published ${pct(publishedCache)}: ${reEsc(hero.central)} ${hero.unit} \\(range ${reEsc(hero.low)}–${reEsc(hero.high)} k?Wh\\) · Method v${ver}$`),
    );
  });

  it("UXR-71 at 390px after moving to 15% the line is two lines: What-if total, then Published total · share card keeps 10% · Method v; at most 4 rendered rows", async () => {
    const page = await open();
    await selectTab(page, "Electricity");
    const published = await heroFigures(page);
    await moveSlider(page, 0.15);
    const whatIf = await heroFigures(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById("whatif-note") as HTMLElement;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
      return { lines: el.innerText.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean), rows: Math.round(el.getBoundingClientRect().height / lh) };
    });
    await page.close();
    expect(r.lines, r.lines.join(" / ")).toHaveLength(2);
    expect(r.lines[0]).toMatch(new RegExp(`^What-if at 15%: ${reEsc(whatIf.central)} ${whatIf.unit} \\(range ${num}–${num}( k?Wh)?\\)$`));
    expect(r.lines[1]).toMatch(
      new RegExp(`^Published ${pct(publishedCache)}: ${reEsc(published.central)} ${published.unit} \\(range ${reEsc(published.low)}–${reEsc(published.high)}( k?Wh)?\\) · share card keeps ${pct(publishedCache)} · Method v${ver}$`),
    );
    expect(r.rows, "rendered rows at 390px").toBeLessThanOrEqual(4);
  });

  it("UXR-72 no 'a – b' range in the Pace panel breaks across lines at widths 320 to 480px", async () => {
    const page = await open();
    await selectTab(page, "Pace");
    const broken: string[] = [];
    for (let w = 320; w <= 480; w += 4) {
      await page.setViewportSize({ width: w, height: 844 });
      const b = await page.evaluate(() => {
        const out: string[] = [];
        const panel = document.getElementById("pace")!;
        const tw = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = tw.nextNode())) {
          const p = n.parentElement!;
          if (p.closest("svg, .vh, [hidden], details:not([open])") || p.offsetHeight === 0) continue;
          for (const m of (n.textContent ?? "").matchAll(/\d+(?:\.\d+)?[\s ⁠ ]*–[\s ⁠ ]*\d+(?:\.\d+)?/g)) {
            const rg = document.createRange();
            rg.setStart(n, m.index!);
            rg.setEnd(n, m.index! + m[0].length);
            const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
            if (tops.size > 1) out.push(`#${p.closest("[id]")?.id}: "${m[0]}"`);
          }
        }
        return out;
      });
      for (const x of b) broken.push(`${w}px ${x}`);
    }
    await page.close();
    expect(broken).toEqual([]);
  });

  it("UXR-73 with the table open the summary says 'Parameters and sources', not 'Show …'", async () => {
    const page = await open();
    await selectTab(page, "Method");
    const r = await page.evaluate(() => {
      const d = document.getElementById("params-box") as HTMLDetailsElement;
      return { open: d.open, summary: (d.querySelector("summary")?.textContent ?? "").trim() };
    });
    await page.close();
    expect(r.open).toBe(true);
    expect(r.summary).toBe("Parameters and sources");
  });
});
