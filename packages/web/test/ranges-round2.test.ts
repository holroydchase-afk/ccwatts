import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright-core";
import { launch } from "../../../tools/showcase-check/check.ts";

// M4.8.3 fix round, page half of UX-R13, UX-R14, UX-R15 (P2, ux-reviewer; SPEC-RANGES). Built page
// (packages/web/dist/ccwatts.html, synthetic sample only), real browser, light scheme.
//
// Pinned for the engineer:
//  - UX-R13: on Overview, the "How we got this range" link (#ov-how) starts its visible text at the same
//    x as the comparison line #ov-compare's text (±1px), at 390 and 1280 wide; the link's box (its 48px
//    tap target) ends at least 12px above #ov-compare's top. Measured on the TEXT start (a DOM Range over
//    the element), because that's the edge a person sees; the 48px box may keep its padding if it's
//    offset (e.g. a negative margin) so the text lines up.
//  - UX-R14: "about 28 miles (4.4–100)" and "about 5.7 days (0.9–20)" in #ov-compare and #hero-compare.
//  - UX-R15: kWh ranges use the tight en dash ("range 1.3–30.5 kWh"). Scope: every element outside the
//    Pace panel (#pace) and the Method parameter table (#params); those hold hour ranges and sourced
//    parameter bounds and are flagged separately in the hand-back, not pinned here.
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`). With no browser these tests are
// SKIPPED (labeled), never counted as passing.

const url = pathToFileURL(fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url))).href;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const EV = "about 28 miles (4.4–100)";
const FRIDGE = "about 5.7 days (0.9–20)";

let browser: Browser | null = null;
let noBrowser = "";
try {
  browser = await launch();
} catch (e) {
  noBrowser = `Playwright/Chromium not available (${(e as Error).message.split("\n")[0]}); set PLAYWRIGHT_MODULE`;
}
const withBrowser = describe.skipIf(!browser);
vi.setConfig({ testTimeout: 60_000 });
if (!browser) console.warn(`ranges-round2.test.ts: browser tests SKIPPED: ${noBrowser}`);
afterAll(async () => {
  await browser?.close();
});

const problems: string[] = [];
async function open(viewport: { width: number; height: number }, hash = ""): Promise<Page> {
  const page = await browser!.newPage({ viewport, colorScheme: "light" });
  page.on("request", (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(url + hash);
  await page
    .waitForFunction(() => ["#ov-energy", "#hero-big"].some((s) => /\d/.test(document.querySelector(s)?.textContent ?? "")), null, { timeout: 8000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page;
}
const text = async (page: Page, sel: string) => ((await page.locator(sel).first().textContent()) ?? "").replace(/\s+/g, " ").trim();

withBrowser("M4.8.3 fix round, playground sample data (browser)", () => {
  for (const vp of [PHONE, LAPTOP]) {
    const at = `${vp.width}x${vp.height}`;
    it(`UX-R13 Overview "How we got this range" (#ov-how) text shares the left edge of #ov-compare (±1px) and its box ends >= 12px above it (${at})`, async () => {
      const page = await open(vp);
      const link = page.locator("#p-overview").getByRole("link", { name: "How we got this range", exact: true });
      expect(await link.count()).toBe(1);
      expect(await link.getAttribute("id")).toBe("ov-how");
      const geo = await page.evaluate(() => {
        const textLeft = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return r.getClientRects()[0]?.left ?? NaN;
        };
        const how = document.querySelector("#ov-how")!;
        const cmp = document.querySelector("#ov-compare")!;
        return { howText: textLeft(how), cmpText: textLeft(cmp), howBottom: how.getBoundingClientRect().bottom, cmpTop: cmp.getBoundingClientRect().top };
      });
      expect(Math.abs(geo.howText - geo.cmpText), `link text starts at x=${geo.howText}, comparison at x=${geo.cmpText}`).toBeLessThanOrEqual(1);
      expect(geo.cmpTop - geo.howBottom, `link box bottom ${geo.howBottom}, #ov-compare top ${geo.cmpTop}`).toBeGreaterThanOrEqual(12);
      await page.close();
    });
  }

  it(`UX-R14 Overview #ov-compare reads "${EV}" and "${FRIDGE}"`, async () => {
    const page = await open(LAPTOP);
    const t = await text(page, "#ov-compare");
    expect(t).toContain(EV);
    expect(t).toContain(FRIDGE);
    await page.close();
  });

  it(`UX-R14 Electricity #hero-compare reads "${EV}" and "${FRIDGE}"`, async () => {
    const page = await open(LAPTOP);
    await page.getByRole("tab", { name: "Electricity", exact: true }).click();
    await page.waitForTimeout(150);
    const t = await text(page, "#hero-compare");
    expect(t).toContain(EV);
    expect(t).toContain(FRIDGE);
    await page.close();
  });

  it('UX-R15 Overview #ov-energy-detail reads "range 1.3–30.5 kWh" (tight en dash)', async () => {
    const page = await open(LAPTOP);
    expect(await text(page, "#ov-energy-detail")).toContain("range 1.3–30.5 kWh");
    await page.close();
  });

  it("UX-R15 no element outside #pace and #params has a spaced en dash between numbers (all tabs' content)", async () => {
    const page = await open(LAPTOP);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("script, style, template, #pace, #params")) continue;
        const s = (n.textContent ?? "").replace(/\s+/g, " ");
        if (/\d[  ]–[  ]\d/.test(s)) out.push(`${el.closest("[id]")?.id ?? el.tagName}: ${s.trim().slice(0, 80)}`);
      }
      return out;
    });
    expect(bad).toEqual([]);
    await page.close();
  });

  it("UX-R13/14/15 no network requests or page errors while checking", () => {
    expect(problems).toEqual([]);
  });
});
