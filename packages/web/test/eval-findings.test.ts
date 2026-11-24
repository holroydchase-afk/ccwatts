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
    expect(after!.text).toContain(`The share card keeps ${pct(publishedCache)}`);
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
    expect(createHash("sha256").update(svg).digest("hex")).toBe("b9ea1343c9e18d88a34b139df0cfa37040f4131034c51bfb21a9106fa62daf5f");
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
