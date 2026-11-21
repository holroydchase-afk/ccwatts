import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { defaultParams, estimate, formatEnergy, rollupRecords, type RollupRow } from "@ccwatts/core";
import { readSample } from "../src/inject.js";
import { launch } from "../../../tools/showcase-check/check.ts";

// VISUAL-REFRESH (ux-reviewer AC-R47..AC-R52): the playground's visual refresh, tested in a real
// browser on the built page (synthetic sample data only). The "Try it on your own logs" section
// (#drop) is out of scope here (PR #101 changes it), so page-wide counts below leave it out.
//
// API choices pinned here (for the engineer):
//  - AC-R47: the newest (in-progress) Pace week's active bar is drawn like any other week: computed
//    fill = --accent, fill-opacity 1, opacity 1. A later sibling <rect fill="url(#sofar)"> overlaps it,
//    with a <pattern id="sofar"> in the document. #pace-legend has an item "This week, so far".
//    No `.agent.partial` class, no `fill-opacity="0.5"` and no `.agent.partial` CSS rule.
//  - AC-R48: #pace-lead, #pace-legend and #pace-chart are not inside a closed <details> at 390px.
//    #pace-foot is the only folded part: inside a <details> whose <summary> reads "How Pace is counted".
//  - AC-R51: #hero-range is role="img" with an aria-label naming low, central and high. Inside it:
//    .range-track, .range-dot (inside the track's horizontal span), .range-low and .range-high
//    (text holds the low and high numbers of the hero's window, as formatEnergy prints them).
//  - AC-R49 / AC-R52: counted like scripts/ux-rules.ts V2 / V5 (visible text owners, rounded to 0.5px;
//    radii skip pills and circles), minus the #drop subtree.
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`), CHROMIUM_PATH optional.
// With no Playwright the browser tests are SKIPPED (labeled below), never counted as passing.

const htmlPath = fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url));
const url = pathToFileURL(htmlPath).href;
const html = readFileSync(htmlPath, "utf8");
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;

let browser: Browser | null = null;
let noBrowser = "";
try {
  browser = await launch();
} catch (e) {
  noBrowser = `Playwright/Chromium not available (${(e as Error).message.split("\n")[0]}); set PLAYWRIGHT_MODULE`;
}
const withBrowser = describe.skipIf(!browser);
if (!browser) console.warn(`refresh.test.ts: browser tests SKIPPED: ${noBrowser}`);

afterAll(async () => {
  await browser?.close();
});

type Opts = { width: number; height?: number; colorScheme?: "light" | "dark" };
const problems: string[] = [];
async function open({ width, height = 900, colorScheme = "light" }: Opts): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height }, colorScheme });
  page.on("request", (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(url);
  await page.waitForFunction(() => (document.getElementById("hero-big")?.textContent ?? "–") !== "–", null, { timeout: 8000 });
  return page;
}

/** AC-T1 tab names, in order. "Your logs" (panel #drop) is playground-only and its position isn't pinned. */
const TABS = ["Breakdown", "Pace", "What if", "Share", "Method"] as const;
/** Click the [role=tab] with this exact name; false (no wait) when the page has no such tab. */
async function selectTab(page: Page, name: string): Promise<boolean> {
  const tab = page.getByRole("tab", { name, exact: true });
  if ((await tab.count()) !== 1) return false;
  await tab.click();
  await page.waitForTimeout(50);
  return true;
}

/** Same cut as app.ts windowRows for sample data: count back from the last day in the file. */
function sampleWindow(rows: RollupRow[], id: "7d" | "30d" | "all"): RollupRow[] {
  if (id === "all") return rows;
  const days = id === "7d" ? 7 : 30;
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "0000-00-00");
  const start = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000 - days * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= start);
}
function expectedHero(id: "7d" | "30d" | "all") {
  const t = formatEnergy(estimate(rollupRecords(sampleWindow(readSample(html), id)), defaultParams).total);
  const [low, high] = t.range.split(" – ");
  return { low: low!, high: high!, central: t.central.split(" ")[0]! };
}

// ---------------------------------------------------------------------------------------------
// Static checks: these run everywhere, including CI's `npm test` (which has no browser).
// ---------------------------------------------------------------------------------------------
describe("VISUAL-REFRESH static (AC-R47, AC-R48, AC-R51, AC-R52)", () => {
  it("AC-R47 no half-opacity hack for the so-far week: no .agent.partial rule, no fill-opacity 0.5", () => {
    expect(template).not.toMatch(/\.agent\.partial/);
    expect(app).not.toMatch(/fill-opacity="0\.5"/);
    expect(app).not.toMatch(/agent\$\{partial \? " partial"/);
  });
  it("AC-R47 a sofar hatch pattern and the legend words exist in the source", () => {
    expect(template + app).toMatch(/<pattern[^>]*id="sofar"/);
    expect(template + app).toMatch(/fill="url\(#sofar\)"/);
    expect(template + app).toContain("This week, so far");
  });
  it("AC-R48 the method footnote folds behind 'How Pace is counted'", () => {
    expect(template).toMatch(/<summary[^>]*>\s*How Pace is counted\s*<\/summary>/);
  });
  it("AC-R51 #hero-range is an image with a label", () => {
    expect(template).toMatch(/id="hero-range"[^>]*role="img"|role="img"[^>]*id="hero-range"/);
  });
  it("AC-R52 the privacy note uses no emoji (inline SVG instead)", () => {
    const privacy = /<div class="privacy"[\s\S]*?<\/div><\/div>/.exec(template)?.[0] ?? "";
    expect(privacy, "no .privacy note in template").not.toBe("");
    expect(privacy).not.toMatch(EMOJI);
    expect(privacy).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

// ---------------------------------------------------------------------------------------------
// Browser checks.
// ---------------------------------------------------------------------------------------------
withBrowser("VISUAL-REFRESH AC-R47 so-far week at full colour with a hatch (real browser)", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    it(`AC-R47 the newest week's active bar resolves to --accent at full opacity, hatched by url(#sofar) (${colorScheme})`, async () => {
      const page = await open({ width: 1280, colorScheme });
      // Select Pace first: getBBox on a display:none panel returns zeros, so this test must not
      // depend on how hidden tab panels are laid out.
      expect(await selectTab(page, "Pace"), "no [role=tab] named \"Pace\" to select").toBe(true);
      const r = await page.evaluate(() => {
        const svg = document.getElementById("pace-chart")!;
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const rects = [...svg.querySelectorAll("rect")];
        const hatch = rects.filter((el) => el.getAttribute("fill") === "url(#sofar)");
        const active = rects.filter((el) => !hatch.includes(el) && !el.classList.contains("agent") && getComputedStyle(el).fill === accent);
        const newest = active.sort((a, b) => b.getBBox().x - a.getBBox().x)[0];
        const opacityChain = (el: Element | null) => {
          const out: string[] = [];
          for (let e = el; e && e !== svg; e = e.parentElement) out.push(getComputedStyle(e).opacity);
          return out;
        };
        const overlaps = (a: SVGGraphicsElement, b: SVGGraphicsElement) => {
          const p = a.getBBox(), q = b.getBBox();
          return p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        };
        const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          accent,
          activeCount: active.length,
          newestFill: newest ? getComputedStyle(newest).fill : null,
          newestFillOpacity: newest ? getComputedStyle(newest).fillOpacity : null,
          newestFillOpacityAttr: newest?.getAttribute("fill-opacity") ?? null,
          newestOpacity: newest ? opacityChain(newest) : [],
          hatchCount: hatch.length,
          hatchOverNewest: !!newest && hatch.some((h) => overlaps(h, newest) && after(newest, h)),
          pattern: !!document.querySelector("pattern#sofar"),
          partialEls: document.querySelectorAll(".agent.partial").length,
          legend: (document.getElementById("pace-legend")?.textContent ?? "").replace(/\s+/g, " "),
        };
      });
      await page.close();
      expect(r.activeCount, "no active-hours bars drawn in #pace-chart").toBeGreaterThan(0);
      expect(r.newestFill).toBe(r.accent);
      expect(r.newestFillOpacityAttr, "fill-opacity attribute on the so-far bar").toBeNull();
      expect(Number(r.newestFillOpacity), "computed fill-opacity of the so-far bar").toBe(1);
      for (const o of r.newestOpacity) expect(Number(o), "opacity on the so-far bar or a parent").toBe(1);
      expect(r.pattern, "no <pattern id=\"sofar\">").toBe(true);
      expect(r.hatchCount, "no rect with fill=\"url(#sofar)\"").toBeGreaterThan(0);
      expect(r.hatchOverNewest, "hatch rect does not sit over (after, overlapping) the newest week's active bar").toBe(true);
      expect(r.partialEls, "elements with class 'agent partial'").toBe(0);
      expect(r.legend).toContain("This week, so far");
    });
  }
});

withBrowser("VISUAL-REFRESH AC-R48 Pace chart shows on a phone once the Pace tab is selected (390px)", () => {
  it("AC-R48 with the Pace tab selected, #pace-chart, #pace-lead and #pace-legend are visible at 390px and not inside a closed <details>", async () => {
    const page = await open({ width: 390, height: 844 });
    expect(await selectTab(page, "Pace"), "no [role=tab] named \"Pace\" to select").toBe(true);
    const r = await page.evaluate(() =>
      ["pace-chart", "pace-lead", "pace-legend"].map((id) => {
        const el = document.getElementById(id);
        const box = el?.getBoundingClientRect();
        return { id, exists: !!el, inClosedDetails: !!el?.closest("details:not([open])"), width: box?.width ?? 0, height: box?.height ?? 0, text: (el?.textContent ?? "").trim() };
      }),
    );
    const rects = await page.locator("#pace-chart rect").count();
    await page.close();
    for (const e of r) {
      expect(e.exists, `#${e.id} missing`).toBe(true);
      expect(e.inClosedDetails, `#${e.id} is inside a closed <details>`).toBe(false);
      expect(e.width * e.height, `#${e.id} has no size on screen`).toBeGreaterThan(0);
    }
    expect(r.find((e) => e.id === "pace-lead")!.text, "#pace-lead is empty").not.toBe("");
    expect(rects, "#pace-chart drew no bars at 390px").toBeGreaterThan(0);
  });

  it("AC-R48 only the method footnote is folded, behind a summary reading 'How Pace is counted'", async () => {
    const page = await open({ width: 390, height: 844 });
    await selectTab(page, "Pace");
    const r = await page.evaluate(() => {
      const foot = document.getElementById("pace-foot");
      const d = foot?.closest("details") ?? null;
      const summary = d?.querySelector(":scope > summary")?.textContent?.trim() ?? null;
      const section = document.getElementById("pace");
      const closed = [...(section?.querySelectorAll("details:not([open])") ?? [])].map((x) => x.querySelector(":scope > summary")?.textContent?.trim());
      return { summary, open: d?.open ?? null, footVisible: !!foot && foot.getClientRects().length > 0, closed };
    });
    await page.close();
    expect(r.summary).toBe("How Pace is counted");
    expect(r.open, "the footnote's <details> should start closed on a phone").toBe(false);
    expect(r.footVisible).toBe(false);
    expect(r.closed).toEqual(["How Pace is counted"]);
  });
});

/** Visible elements with their own text, outside #drop (PR #101); ux-rules V2 rounding. */
const fontSizes = (page: Page) =>
  page.evaluate(() => {
    const vis = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const sizes = new Set<number>();
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el) || el.closest("#drop")) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
      sizes.add(Math.round(parseFloat(getComputedStyle(el).fontSize) * 2) / 2);
    }
    return [...sizes].sort((a, b) => a - b);
  });

/** Corner radii on visible elements outside #drop; pills and circles skipped (ux-rules V5). */
const radii = (page: Page) =>
  page.evaluate(() => {
    const out = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!(el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden") || el.closest("#drop")) continue;
      const raw = getComputedStyle(el).borderTopLeftRadius, r = parseFloat(raw);
      if (raw.includes("%") ? r >= 50 : r >= Math.min(el.offsetWidth, el.offsetHeight) / 2 - 1) continue;
      if (r > 0) out.add(raw.includes("%") ? `${r}%` : String(r));
    }
    return [...out].sort((a, b) => parseFloat(a) - parseFloat(b));
  });

withBrowser("VISUAL-REFRESH AC-R49 type scale (ux-rules V2)", () => {
  for (const width of [1280, 390]) {
    it(`AC-R49 visible text uses 8 font sizes or fewer at ${width}px (outside #drop)`, async () => {
      const page = await open({ width });
      const sizes = await fontSizes(page);
      await page.close();
      expect(sizes.length, `font sizes: ${sizes.join(", ")}px`).toBeLessThanOrEqual(8);
    });
  }
});

withBrowser("VISUAL-REFRESH AC-R52 shape language and no emoji (ux-rules V5)", () => {
  for (const width of [1280, 390]) {
    it(`AC-R52 visible elements use 4 corner radii or fewer at ${width}px (outside #drop)`, async () => {
      const page = await open({ width });
      const r = await radii(page);
      await page.close();
      expect(r.length, `radii: ${r.join(", ")}px`).toBeLessThanOrEqual(4);
    });
  }

  it("AC-R52 the rendered page text has no emoji, and the privacy note carries an inline SVG", async () => {
    const page = await open({ width: 1280 });
    const r = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelector("#drop")?.remove();
      return { text: clone.textContent ?? "", svg: !!document.querySelector("#privacy svg[aria-hidden='true']") };
    });
    await page.close();
    expect(r.text.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu) ?? []).toEqual([]);
    expect(r.svg, "no aria-hidden inline <svg> in #privacy").toBe(true);
  });
});

withBrowser("VISUAL-REFRESH AC-R51 hero range bar", () => {
  it("AC-R51 #hero-range has a track, a central dot inside it, and low/high labels; role=img labelled low, central, high", async () => {
    const page = await open({ width: 1280 });
    const want = expectedHero("30d");
    const r = await page.evaluate(() => {
      const root = document.getElementById("hero-range");
      const q = (s: string) => root?.querySelector<HTMLElement>(s) ?? null;
      const box = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().toJSON() as DOMRect : null);
      const track = q(".range-track"), dot = q(".range-dot");
      return {
        role: root?.getAttribute("role") ?? null,
        label: root?.getAttribute("aria-label") ?? "",
        track: box(track), dot: box(dot),
        low: q(".range-low")?.textContent ?? null,
        high: q(".range-high")?.textContent ?? null,
        big: document.getElementById("hero-big")?.textContent ?? "",
      };
    });
    await page.close();
    expect(r.role).toBe("img");
    expect(r.track, "no .range-track in #hero-range").not.toBeNull();
    expect(r.dot, "no .range-dot in #hero-range").not.toBeNull();
    expect(r.track!.width).toBeGreaterThan(0);
    const cx = r.dot!.x + r.dot!.width / 2;
    expect(cx).toBeGreaterThanOrEqual(r.track!.x);
    expect(cx).toBeLessThanOrEqual(r.track!.x + r.track!.width);
    expect(r.low, "no .range-low label").toContain(want.low);
    expect(r.high, "no .range-high label").toContain(want.high);
    expect(r.big).toContain(want.central);
    for (const n of [want.low, want.central, want.high]) expect(r.label).toContain(n);
  });

  it("AC-R51 the range bar follows the 7 days / 30 days / All time window", async () => {
    const page = await open({ width: 1280 });
    const seen: Record<string, { low: string | null; high: string | null; label: string }> = {};
    for (const [id, btn] of [["7d", "7 days"], ["all", "All time"], ["30d", "30 days"]] as const) {
      await page.getByRole("button", { name: btn, exact: true }).click();
      seen[id] = await page.evaluate(() => {
        const root = document.getElementById("hero-range");
        return { low: root?.querySelector(".range-low")?.textContent ?? "(no .range-low)", high: root?.querySelector(".range-high")?.textContent ?? "(no .range-high)", label: root?.getAttribute("aria-label") ?? "" };
      });
    }
    await page.close();
    for (const id of ["7d", "30d", "all"] as const) {
      const want = expectedHero(id);
      expect(seen[id]!.low, `${id} low`).toContain(want.low);
      expect(seen[id]!.high, `${id} high`).toContain(want.high);
      for (const n of [want.low, want.central, want.high]) expect(seen[id]!.label, `${id} aria-label`).toContain(n);
    }
    expect(expectedHero("7d").high, "sample windows should differ, or this test proves nothing").not.toBe(expectedHero("all").high);
  });
});

// ---------------------------------------------------------------------------------------------
// Chase's feedback on the live page (coordinator, Nov 21): "too much information on one flowing page,
// not broken up; too much large chunky text; little light grey text everywhere". AC-T1..AC-T4.
// "Your logs" (#drop) is left out of the T2-T4 counts: PR #101 changes its contents.
// ---------------------------------------------------------------------------------------------

/** Tabs and panels as the page exposes them. */
const tabState = (page: Page) =>
  page.evaluate(() => {
    const lists = [...document.querySelectorAll("[role=tablist]")];
    const tabs = [...(lists[0]?.querySelectorAll("[role=tab]") ?? [])] as HTMLElement[];
    const shown = (el: Element | null) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    return {
      lists: lists.length,
      tabs: tabs.map((t) => {
        const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
        return {
          name: (t.textContent ?? "").trim(),
          controls: t.getAttribute("aria-controls"),
          selected: t.getAttribute("aria-selected"),
          tabindex: t.getAttribute("tabindex"),
          focused: document.activeElement === t,
          panelRole: panel?.getAttribute("role") ?? null,
          panelShown: shown(panel),
          panelHidden: panel ? panel.hidden : null,
        };
      }),
      visiblePanels: [...document.querySelectorAll("[role=tabpanel]")].filter(shown).map((p) => p.id),
    };
  });

withBrowser("VISUAL-REFRESH AC-T1 tabs under the hero", () => {
  it("AC-T1 one tablist after the hero, tabs Breakdown, Pace, What if, Share, Method (+ Your logs), each controlling a tabpanel", async () => {
    const page = await open({ width: 1280 });
    const s = await tabState(page);
    const order = await page.evaluate(() => {
      const list = document.querySelector("[role=tablist]");
      const after = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const inPanel = (id: string) => !!document.getElementById(id)?.closest("[role=tabpanel]");
      return {
        afterHero: ["hero-big", "hero-range", "w-30d"].every((id) => after(document.getElementById(id), list)),
        heroInPanel: ["hero-big", "hero-range", "w-30d"].some(inPanel),
      };
    });
    await page.close();
    expect(s.lists, "[role=tablist] count").toBe(1);
    expect(s.tabs.map((t) => t.name).filter((n) => (TABS as readonly string[]).includes(n))).toEqual([...TABS]);
    expect(s.tabs.map((t) => t.name), "playground mode has a Your logs tab").toContain("Your logs");
    for (const t of s.tabs) {
      expect(t.controls, `${t.name} has no aria-controls`).toBeTruthy();
      expect(t.panelRole, `${t.name}'s aria-controls doesn't point to a [role=tabpanel]`).toBe("tabpanel");
    }
    expect(order.afterHero, "tablist should come after the big number, range bar and window picker").toBe(true);
    expect(order.heroInPanel, "the hero must stay outside the tab panels").toBe(false);
  });

  it("AC-T1 panels hold the right content: Breakdown #chart, Pace #pace-chart, What if #whatif-cache, Share #save-png, Method #params, Your logs #drop", async () => {
    const page = await open({ width: 1280 });
    const r = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll("[role=tablist] [role=tab]")];
      const panelOf = (name: string) => {
        const t = tabs.find((x) => (x.textContent ?? "").trim() === name);
        return t ? document.getElementById(t.getAttribute("aria-controls") ?? "") : null;
      };
      const has = (name: string, id: string) => { const p = panelOf(name); return !!p && (p.id === id || !!p.querySelector(`#${id}`)); };
      return { Breakdown: has("Breakdown", "chart"), Pace: has("Pace", "pace-chart"), "What if": has("What if", "whatif-cache"), Share: has("Share", "save-png"), Method: has("Method", "params"), "Your logs": has("Your logs", "drop") };
    });
    await page.close();
    expect(r).toEqual({ Breakdown: true, Pace: true, "What if": true, Share: true, Method: true, "Your logs": true });
  });

  it("AC-T1 Breakdown is selected by default and exactly its panel is visible", async () => {
    const page = await open({ width: 1280 });
    const s = await tabState(page);
    await page.close();
    const selected = s.tabs.filter((t) => t.selected === "true").map((t) => t.name);
    expect(selected).toEqual(["Breakdown"]);
    for (const t of s.tabs) if (t.name !== "Breakdown") expect(t.selected, `${t.name} aria-selected`).toBe("false");
    expect(s.visiblePanels.length, "visible [role=tabpanel] count").toBe(1);
    expect(s.tabs.find((t) => t.name === "Breakdown")?.panelShown).toBe(true);
  });

  it("AC-T1 clicking each tab keeps aria-selected and panel visibility in sync", async () => {
    const page = await open({ width: 1280 });
    const names = [...TABS, "Your logs"];
    const missing: string[] = [];
    for (const name of names) {
      if (!(await selectTab(page, name))) { missing.push(name); continue; }
      const s = await tabState(page);
      for (const t of s.tabs) {
        const on = t.name === name;
        expect(t.selected, `after clicking ${name}: ${t.name} aria-selected`).toBe(String(on));
        expect(t.panelShown, `after clicking ${name}: ${t.name}'s panel shown`).toBe(on);
        expect(t.panelHidden, `after clicking ${name}: ${t.name}'s panel hidden attribute`).toBe(!on);
      }
      expect(s.visiblePanels.length, `after clicking ${name}: visible panels`).toBe(1);
    }
    await page.close();
    expect(missing, "tabs that don't exist").toEqual([]);
  });

  it("AC-T1 ArrowRight/ArrowLeft move selection and focus, wrapping at the ends, with a roving tabindex", async () => {
    const page = await open({ width: 1280 });
    const first = page.getByRole("tab", { name: "Breakdown", exact: true });
    expect(await first.count(), "no Breakdown tab").toBe(1);
    await first.focus();
    const now = async () => {
      const s = await tabState(page);
      return { focused: s.tabs.find((t) => t.focused)?.name, selected: s.tabs.filter((t) => t.selected === "true").map((t) => t.name), tabbable: s.tabs.filter((t) => t.tabindex !== "-1").map((t) => t.name), last: s.tabs.at(-1)?.name };
    };
    const start = await now();
    expect(start.tabbable, "only the selected tab is in the Tab order").toEqual(["Breakdown"]);
    await page.keyboard.press("ArrowRight");
    expect(await now()).toMatchObject({ focused: "Pace", selected: ["Pace"], tabbable: ["Pace"] });
    await page.keyboard.press("ArrowLeft");
    expect(await now()).toMatchObject({ focused: "Breakdown", selected: ["Breakdown"] });
    await page.keyboard.press("ArrowLeft");
    const wrapped = await now();
    expect(wrapped.focused, "ArrowLeft on the first tab wraps to the last").toBe(wrapped.last);
    expect(wrapped.selected).toEqual([wrapped.last]);
    await page.keyboard.press("ArrowRight");
    expect(await now()).toMatchObject({ focused: "Breakdown", selected: ["Breakdown"] });
    await page.close();
  });

  it("AC-T1 clicking #jump selects the Your logs tab and shows #drop", async () => {
    const page = await open({ width: 1280 });
    await page.locator("#jump").click();
    await page.waitForTimeout(100);
    const s = await tabState(page);
    const dropShown = await page.locator("#drop").isVisible();
    await page.close();
    expect(s.tabs.filter((t) => t.selected === "true").map((t) => t.name)).toEqual(["Your logs"]);
    expect(dropShown).toBe(true);
    expect(s.visiblePanels.length).toBe(1);
  });
});

/** Measure something with each tab selected (or the page as it is, labeled, when the tab doesn't exist). */
async function perTab<T>(page: Page, measure: () => Promise<T>): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const name of TABS) {
    const ok = await selectTab(page, name);
    out[ok ? name : `${name} (no tab: whole page)`] = await measure();
  }
  return out;
}

withBrowser("VISUAL-REFRESH AC-T2 short views", () => {
  for (const [width, height, limit] of [[1280, 800, 1900], [390, 844, 3200]] as const) {
    it(`AC-T2 at ${width}x${height} each tab's view is at most ${limit}px tall (Your logs excluded, PR #101)`, async () => {
      const page = await open({ width, height });
      const paramsOpen = await page.evaluate(() => (document.getElementById("params-box") as HTMLDetailsElement | null)?.open ?? null);
      const heights = await perTab(page, () => page.evaluate(() => document.scrollingElement!.scrollHeight));
      await page.close();
      expect(paramsOpen, "the params table starts closed").toBe(false);
      for (const [name, h] of Object.entries(heights)) expect(h, `${name} at ${width}px: ${h}px`).toBeLessThanOrEqual(limit);
    });
  }
});

/** Visible text outside #drop and the hero number/h1 whose own text node is 20px or more: total characters. */
const chunky = (page: Page) =>
  page.evaluate(() => {
    let chars = 0;
    const where: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!(el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")) continue;
      if (el.closest("#drop, #hero-big, h1")) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 20) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()).join(" ").trim();
      if (!own) continue;
      chars += own.length;
      where.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}:${own.length}`);
    }
    return { chars, where: where.join(", ") };
  });

withBrowser("VISUAL-REFRESH AC-T3 less chunky text", () => {
  for (const width of [1280, 390]) {
    it(`AC-T3 at ${width}px each tab shows at most 120 characters of 20px+ text (besides #hero-big and h1)`, async () => {
      const page = await open({ width });
      const r = await perTab(page, () => chunky(page));
      await page.close();
      for (const [name, c] of Object.entries(r)) expect(c.chars, `${name} at ${width}px: ${c.where}`).toBeLessThanOrEqual(120);
    });
  }

  it("AC-T3 #pace-lead is 17px or smaller", async () => {
    const page = await open({ width: 1280 });
    await selectTab(page, "Pace");
    const size = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("pace-lead")!).fontSize));
    await page.close();
    expect(size).toBeLessThanOrEqual(17);
  });
});

/** Visible text outside #drop drawn in the --muted colour: total, and the longest muted block. */
const muted = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.append(probe);
    const grey = getComputedStyle(probe).color;
    probe.remove();
    const vis = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    let total = 0;
    const blocks = new Map<Element, number>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!el || !t || !vis(el) || el.closest("#drop, script, style, svg")) continue;
      if (getComputedStyle(el).color !== grey) continue;
      total += t.length;
      let b: Element | null = el;
      while (b && getComputedStyle(b).display.startsWith("inline")) b = b.parentElement;
      if (b) blocks.set(b, (blocks.get(b) ?? 0) + t.length);
    }
    const [longEl, longN] = [...blocks].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return { total, longest: longN, longestAt: longEl ? `${longEl.tagName.toLowerCase()}${longEl.id ? "#" + longEl.id : ""}${longEl.className ? "." + String(longEl.className).replace(/\s+/g, ".") : ""}` : "" };
  });

withBrowser("VISUAL-REFRESH AC-T4 less grey text", () => {
  it("AC-T4 at 1280px each tab shows at most 280 characters of --muted text, and no muted block over 140", async () => {
    const page = await open({ width: 1280 });
    const r = await perTab(page, () => muted(page));
    await page.close();
    for (const [name, m] of Object.entries(r)) {
      expect(m.total, `${name}: muted characters`).toBeLessThanOrEqual(280);
      expect(m.longest, `${name}: longest muted block ${m.longestAt}`).toBeLessThanOrEqual(140);
    }
  });

  it("AC-T4 the long fine print (#pace-foot, the what-if explainer, #chart-note) is cut or behind a closed <details>", async () => {
    const page = await open({ width: 1280 });
    const r = await page.evaluate(() => {
      const explainer = [...document.querySelectorAll("#whatif p")].find((p) => /Cache reads are most of your tokens/.test(p.textContent ?? "")) ?? null;
      const folded = (el: Element | null) => !el || !!el.closest("details:not([open])");
      return { "pace-foot": folded(document.getElementById("pace-foot")), "what-if explainer": folded(explainer), "chart-note": folded(document.getElementById("chart-note")) };
    });
    await page.close();
    expect(r).toEqual({ "pace-foot": true, "what-if explainer": true, "chart-note": true });
  });
});

withBrowser("VISUAL-REFRESH constraints still hold", () => {
  it("no network requests or page errors across the pages opened above", () => {
    expect(problems).toEqual([]);
  });
});
