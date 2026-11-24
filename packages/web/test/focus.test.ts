import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Browser, Locator, Page } from "playwright-core";
import { injectData, readSample } from "../src/inject.js";
import { launch } from "../../../tools/showcase-check/check.ts";

// M4.8.1 "hero + one CTA" (PLAN.md M4.8, FOCUS-1..FOCUS-5; DECISIONS.md CCW-DEC-17; review
// 2026-11-22 demo focus, UX-R1/UX-R3, pm-report problem 1 and 5). Tested on the built page
// (packages/web/dist/ccwatts.html, synthetic sample data only) in a real browser, plus a few static
// checks on the built HTML that run with no browser.
//
// API choices pinned here (for the engineer):
//  - The CTA is one link or button in the Overview panel whose accessible name is exactly
//    "Try it on your logs". "Filled" means its computed background-color is the page's --accent
//    (the `.primary` style). No other visible a/button/label.btn/[role=button] on the page may be
//    filled while Overview is showing (the studio demo bar is exempt: it isn't part of the page).
//  - Clicking the CTA shows the Your logs view (#drop), as #ov-logs does today.
//  - Phone note (#ov-cta-note, QA-R1): at 390px a visible line right under the CTA reads
//    "On a phone? It works with Claude Code on the web." (the #cloud prompt in Your logs works from a phone).
//    At 1280px it isn't shown.
//  - FOCUS-3: the Overview panel shows a visible line with the same text as #hero-compare, below
//    the number (#ov-energy-value).
//  - FOCUS-4: loading the page at #pace or #share (390x844) leaves the panel's first h2 fully in
//    the viewport and not under the sticky tab bar (#tabs).
//  - Dashboard (`ccwatts dashboard`, mode "dashboard"): the person already sees their own data, so
//    there is no "Try it on your logs" CTA and no phone note; the Overview cut and tab order are the same.
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`), CHROMIUM_PATH optional.
// With no Playwright the browser tests are SKIPPED (labeled below), never counted as passing.

const htmlPath = fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url));
const url = pathToFileURL(htmlPath).href;
const html = readFileSync(htmlPath, "utf8");
const CTA = "Try it on your logs";
const NOTE = "On a phone? It works with Claude Code on the web.";
const TABS = ["Overview", "Electricity", "Share", "Method", "Pace"] as const;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

// A dashboard page, the way `ccwatts dashboard` writes one: the same template with mode "dashboard".
const scratch = mkdtempSync(join(tmpdir(), "ccwatts-focus-"));
const dashPath = join(scratch, "dashboard.html");
writeFileSync(dashPath, injectData(html, { mode: "dashboard", generatedAt: "2026-11-01T00:00:00Z", rows: readSample(html) }));
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
if (!browser) console.warn(`focus.test.ts: browser tests SKIPPED: ${noBrowser}`);
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
  await page.mouse.move(0, 0); // no hover styles on what we measure
  return page;
}
const overview = (page: Page) => page.locator("#p-overview");
/** The CTA, by role and name, inside the Overview panel. */
const cta = (page: Page): Locator => overview(page).getByRole("link", { name: CTA, exact: true }).or(overview(page).getByRole("button", { name: CTA, exact: true }));
/** Is the element fully inside the viewport (not just partly)? */
async function fullyInView(page: Page, loc: Locator): Promise<string> {
  const box = await loc.boundingBox();
  const vp = page.viewportSize()!;
  if (!box) return "not rendered";
  const ok = box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5;
  return ok ? "inside" : `box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} outside ${vp.width}x${vp.height}`;
}
/** Ids (or text) of visible controls with a filled accent background, outside the demo bar. */
const filledControls = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>("a, button, label.btn, [role=button], input[type=submit], input[type=button]")]
      .filter((el) => !el.closest("#demo-bar") && el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
      .filter((el) => getComputedStyle(el).backgroundColor === accent)
      .map((el) => el.id || (el.textContent ?? "").replace(/\s+/g, " ").trim());
  });
const tabNames = (page: Page) => page.getByRole("tab").evaluateAll((ts) => ts.map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim()));

// ---------------------------------------------------------------------------------------------
// Static checks on the built page (no browser).
// ---------------------------------------------------------------------------------------------
describe("M4.8.1 static (built page, no browser)", () => {
  it("FOCUS-2 the page has no Overview Pace row (#ov-pace), Share row (#ov-share) or 'Use your own logs' row (#ov-logs); What drives it stays", () => {
    for (const id of ["ov-pace", "ov-share", "ov-logs"]) expect(html, `#${id} still in the page`).not.toContain(`id="${id}"`);
    expect(html).not.toContain("Use your own logs");
    expect(html).toMatch(/id="ov-drives"[\s\S]*?What drives it/);
  });

  it("FOCUS-1 the page has a 'Try it on your logs' control", () => {
    expect(html).toMatch(/>\s*Try it on your logs\s*</);
  });

  it("FOCUS-5 the tab buttons are in the order Overview, Electricity, Share, Method, Pace", () => {
    const tablist = /<div[^>]*role="tablist"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    const names = [...tablist.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]!.trim());
    expect(names).toEqual([...TABS]);
  });
});

// ---------------------------------------------------------------------------------------------
// Browser checks: playground in sample (demo) mode.
// ---------------------------------------------------------------------------------------------
withBrowser("M4.8.1 playground, sample data (browser)", () => {
  for (const vp of [PHONE, LAPTOP]) {
    const at = `${vp.width}x${vp.height}`;

    it(`FOCUS-1 "${CTA}" is in Overview, filled, and fully inside the first viewport at ${at}`, async () => {
      const page = await open(vp);
      expect(await page.evaluate(() => window.scrollY), "page did not open at the top").toBe(0);
      expect(await cta(page).count(), `one "${CTA}" control in Overview`).toBe(1);
      expect(await fullyInView(page, cta(page)), "CTA position").toBe("inside");
      const filled = await filledControls(page);
      expect(filled.length, `filled controls on Overview: ${JSON.stringify(filled)}`).toBe(1);
      expect(await cta(page).evaluate((el, f) => f.includes(el.id || (el.textContent ?? "").replace(/\s+/g, " ").trim()), filled)).toBe(true);
      await page.close();
    });

    it(`FOCUS-1 "${CTA}" opens the Your logs view (#drop) at ${at}`, async () => {
      const page = await open(vp);
      await cta(page).first().click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(100);
      expect(await page.locator("#drop").isVisible(), "#drop shown after the CTA").toBe(true);
      expect(await page.getByRole("heading", { name: "Try it on your own logs" }).isVisible()).toBe(true);
      await page.close();
    });

    it(`FOCUS-1 QA-R1 the "${NOTE}" note shows under the CTA on phone only (${at})`, async () => {
      const page = await open(vp);
      const note = overview(page).getByText(NOTE, { exact: true });
      const shown = (await note.count()) > 0 && (await note.first().isVisible());
      if (vp.width < 600) {
        expect(shown, `no visible "${NOTE}" note on phone`).toBe(true);
        const [b, n] = [await cta(page).first().boundingBox(), await note.first().boundingBox()];
        expect(b && n && n.y >= b.y + b.height - 0.5, "note sits under the CTA").toBe(true);
        expect(await fullyInView(page, note.first()), "note position").toBe("inside");
      } else {
        expect(shown, "phone note shown on a laptop").toBe(false);
      }
      await page.close();
    });

    it(`FOCUS-2 Overview has no Pace row, no Share row, no "Use your own logs" row and one link to Your logs; What drives it stays (${at})`, async () => {
      const page = await open(vp);
      for (const id of ["ov-pace", "ov-share", "ov-logs"]) expect(await page.locator(`#${id}`).count(), `#${id}`).toBe(0);
      expect(await overview(page).getByText("Use your own logs").count()).toBe(0);
      expect(await overview(page).getByRole("link", { name: /^Pace\b/ }).count(), "a Pace row").toBe(0);
      expect(await overview(page).getByRole("link", { name: /Share card/ }).count(), "a Share row").toBe(0);
      const toDrop = await overview(page).locator('a[href="#drop"]').evaluateAll((as) => as.filter((a) => (a as HTMLElement).checkVisibility()).length);
      expect(toDrop, "visible links to #drop on Overview (the CTA only)").toBeLessThanOrEqual(1);
      expect(await overview(page).getByRole("link", { name: /What drives it/ }).isVisible()).toBe(true);
      await page.close();
    });

    it(`FOCUS-3 the EV comparison from Electricity sits under the Overview number (${at})`, async () => {
      const page = await open(vp);
      const compare = ((await page.textContent("#hero-compare")) ?? "").trim();
      expect(compare, "Electricity has an EV line").toMatch(/^That's like driving an EV about [\d,.]+ miles/);
      const line = overview(page).getByText(compare, { exact: true });
      expect(await line.count(), `Overview has no line "${compare}"`).toBe(1);
      expect(await line.isVisible()).toBe(true);
      const [num, l] = [await page.locator("#ov-energy-value").boundingBox(), await line.boundingBox()];
      expect(num && l && l.y >= num.y + num.height - 0.5, "EV line is below the number").toBe(true);
      await page.close();
    });

    // EF-CC-2 (issue #112, P1): a recruiter on a phone must be able to tell what the tool is.
    it(`FOCUS-6 EF-CC-2 a visible sentence in the first viewport says it estimates Claude Code electricity from its logs, and "${CTA}" stays in view (${at})`, async () => {
      const page = await open(vp);
      // The smallest visible element (outside the studio demo bar) whose text names Claude Code,
      // electricity and logs together, and that sits above the tabs or inside Overview.
      const found = await page.evaluate(() => {
        const tabsTop = document.querySelector("#tabs")!.getBoundingClientRect().top;
        const hits = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => !el.closest("#demo-bar") && !["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName))
          // One sentence must carry all three words (innerText splits blocks onto new lines), so the
          // Overview panel's "Electricity" row + "Claude Code" note + "logs" button don't add up to a pass.
          .filter((el) => (el.innerText ?? "").split(/(?<=[.!?])\s+|\n+/).some((t) => /Claude Code/.test(t) && /electricity/i.test(t) && /logs/.test(t)))
          .filter((el) => el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true }))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 1 && r.height > 1 && (r.bottom <= tabsTop + 0.5 || !!el.closest("#p-overview")))
          .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
        const best = hits[0];
        if (!best) return null;
        const { r } = best;
        return { text: (best.el.innerText ?? "").replace(/\s+/g, " ").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      });
      expect(found, "no visible sentence naming Claude Code + electricity + logs above the tabs or in Overview").not.toBeNull();
      const v = page.viewportSize()!;
      const inside = found!.x >= 0 && found!.y >= 0 && found!.x + found!.w <= v.width + 0.5 && found!.y + found!.h <= v.height + 0.5;
      expect(inside, `"${found!.text}" at ${Math.round(found!.x)},${Math.round(found!.y)} ${Math.round(found!.w)}x${Math.round(found!.h)} not fully inside ${at}`).toBe(true);
      expect(await fullyInView(page, cta(page)), "CTA position after the explainer").toBe("inside");
      await page.close();
    });

    // UX-R8 (P2): the EV line under the number lines up with the CTA's left edge.
    it(`FOCUS-7 UX-R8 the Overview EV line's left text edge matches the "${CTA}" left edge, within 1px (${at})`, async () => {
      const page = await open(vp);
      const compare = ((await page.textContent("#hero-compare")) ?? "").trim();
      const line = overview(page).getByText(compare, { exact: true });
      expect(await line.count(), `Overview has no line "${compare}"`).toBe(1);
      // Left edge of the rendered text itself (not the box, which may include padding).
      const textLeft = await line.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return rects.length ? Math.min(...rects.map((r) => r.left)) : NaN;
      });
      const btn = await cta(page).first().boundingBox();
      expect(btn, "CTA not rendered").not.toBeNull();
      expect(Math.abs(textLeft - btn!.x), `EV text starts at x ${textLeft.toFixed(1)}, CTA at x ${btn!.x.toFixed(1)}`).toBeLessThanOrEqual(1);
      await page.close();
    });

    it(`FOCUS-5 tabs read Overview, Electricity, Share, Method, Pace (${at})`, async () => {
      const page = await open(vp);
      expect(await tabNames(page)).toEqual([...TABS]);
      await page.close();
    });
  }

  // Two ways in: the page opened at the link, and the link followed from a scrolled Overview
  // (hashchange; today #share hides its heading 7px under the tabs that way, #pace 21px both ways).
  for (const [hash, how] of [["#pace", "opened at"], ["#pace", "followed from a scrolled Overview to"], ["#share", "opened at"], ["#share", "followed from a scrolled Overview to"]] as const) {
    it(`FOCUS-4 a deep link ${how} ${hash} at 390x844 leaves the panel's heading fully visible below the sticky tabs`, async () => {
      const page = await open(PHONE, how === "opened at" ? hash : "");
      if (how !== "opened at") {
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.evaluate((h) => { location.hash = h; }, hash);
      }
      await page.waitForTimeout(200);
      const name = hash === "#pace" ? "Pace" : "Share";
      expect(await page.getByRole("tab", { name, exact: true }).getAttribute("aria-selected")).toBe("true");
      const panelId = await page.getByRole("tab", { name, exact: true }).getAttribute("aria-controls");
      const h = page.locator(`[id="${panelId}"] h2`).first();
      const [tabs, head] = [await page.locator("#tabs").boundingBox(), await h.boundingBox()];
      expect(head, "panel heading not rendered").not.toBeNull();
      const detail = `heading top ${head?.y.toFixed(0)}, tabs bottom ${tabs ? (tabs.y + tabs.height).toFixed(0) : "?"}`;
      expect(head!.y >= tabs!.y + tabs!.height - 0.5, `heading under the tabs: ${detail}`).toBe(true);
      expect(await fullyInView(page, h), detail).toBe("inside");
      await page.close();
    });
  }

  // -------------------------------------------------------------------------------------------
  // M4.8.2 "header trim" (UX-R2, P1, review 2026-11-22 demo focus): the brand line, two-line h1,
  // lede, lock line and tabs fill ~300 of 844px on a phone, and a laptop states the privacy
  // promise twice (demo bar + lock line). Fix: "ccwatts" moves into the demo bar; only the lock
  // line keeps the promise.
  // -------------------------------------------------------------------------------------------
  for (const vp of [PHONE, LAPTOP]) {
    const at = `${vp.width}x${vp.height}`;

    it(`FOCUS-8 UX-R2 no standalone "ccwatts" brand line above the h1; the name shows in the demo bar instead (${at})`, async () => {
      const page = await open(vp);
      const h1 = page.getByRole("heading", { level: 1 });
      const h1Top = (await h1.boundingBox())?.y ?? NaN;
      // Visible elements outside the demo bar whose whole text is just the name, sitting above the h1.
      const brandLines = await page.evaluate((top) =>
        [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => !el.closest("#demo-bar") && !["SCRIPT", "STYLE", "TEMPLATE", "TITLE"].includes(el.tagName))
          .filter((el) => (el.innerText ?? "").trim().toLowerCase() === "ccwatts")
          .filter((el) => el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true }))
          .filter((el, _i, all) => !all.some((o) => o !== el && el.contains(o))) // innermost only
          .map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 1 && r.height > 1 && r.bottom <= top + 0.5)
          .map(({ tag, cls, r }) => `<${tag} class="${cls}"> at y ${Math.round(r.y)}`), h1Top);
      expect(brandLines, `standalone brand line(s) above the h1 (h1 top ${Math.round(h1Top)})`).toEqual([]);
      const inBar = page.locator("#demo-bar").getByText(/\bccwatts\b/i);
      const shown = (await inBar.count()) > 0 && (await inBar.first().isVisible());
      expect(shown, 'the demo bar shows no visible "ccwatts"').toBe(true);
      expect(await fullyInView(page, inBar.first()), '"ccwatts" in the demo bar position').toBe("inside");
      await page.close();
    });

    it(`FOCUS-9 UX-R2 the "never leaves this browser" promise is visible exactly once in the first viewport, in the lock line (${at})`, async () => {
      const page = await open(vp);
      // Smallest visible element carrying the promise in any wording ("never leave(s)", "nothing
      // leaves" ... "this browser"), counted if any of it shows in the first viewport.
      const hits = await page.evaluate(() => {
        const promise = /\b(never|nothing)\b[^.]*\bleaves?\b[^.]*\bbrowser\b/i;
        const vh = window.innerHeight;
        const all = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => !["SCRIPT", "STYLE", "TEMPLATE", "TITLE", "META"].includes(el.tagName))
          .filter((el) => el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true }))
          .filter((el) => promise.test(el.innerText ?? ""));
        return all
          .filter((el) => !all.some((o) => o !== el && el.contains(o)))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 1 && r.height > 1 && r.top < vh && r.bottom > 0)
          .map(({ el, r }) => ({ text: (el.innerText ?? "").replace(/\s+/g, " ").trim(), y: Math.round(r.y), inLock: !!el.closest("#privacy") }));
      });
      expect(hits.length, `privacy promise shown in the first viewport: ${JSON.stringify(hits.map((h) => `${h.text} @y${h.y}`))}`).toBe(1);
      expect(hits[0]!.inLock, `the one promise isn't the lock line: "${hits[0]!.text}"`).toBe(true);
      await page.close();
    });
  }

  it("FOCUS-10 UX-R2 at 390x844 the tab bar starts at y <= 240, the CTA and EV line stay fully in view, and the EF-CC-2 lede stays visible", async () => {
    const page = await open(PHONE);
    const tabs = await page.locator("#tabs").boundingBox();
    expect(tabs, "#tabs not rendered").not.toBeNull();
    // Logged so the red run records today's value (~295).
    console.log(`FOCUS-10 measured tab bar top at 390x844: ${tabs!.y.toFixed(1)}px`);
    expect(tabs!.y, `tab bar top at ${tabs!.y.toFixed(1)}px`).toBeLessThanOrEqual(240);
    expect(await fullyInView(page, cta(page)), "CTA position").toBe("inside");
    const compare = ((await page.textContent("#hero-compare")) ?? "").trim();
    const ev = overview(page).getByText(compare, { exact: true });
    expect(await ev.count(), `Overview has no line "${compare}"`).toBe(1);
    expect(await fullyInView(page, ev), "EV line position").toBe("inside");
    // EF-CC-2 (FOCUS-6): the one-sentence phone lede naming Claude Code and its logs, above the tabs.
    const lede = await page.evaluate(() => {
      const tabsTop = document.querySelector("#tabs")!.getBoundingClientRect().top;
      return [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => !el.closest("#demo-bar") && !["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName))
        .filter((el) => (el.innerText ?? "").split(/(?<=[.!?])\s+|\n+/).some((t) => /Claude Code/.test(t) && /electricity/i.test(t) && /logs/.test(t)))
        .filter((el) => el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true }))
        .map((el) => el.getBoundingClientRect())
        .some((r) => r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= tabsTop + 0.5);
    });
    expect(lede, "no visible Claude Code + electricity + logs sentence above the tabs").toBe(true);
    await page.close();
  });

  it("FOCUS no network requests or page errors while checking", () => {
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Browser checks: `ccwatts dashboard` (same template, the person's own data).
// ---------------------------------------------------------------------------------------------
withBrowser("M4.8.1 ccwatts dashboard (browser)", () => {
  for (const vp of [PHONE, LAPTOP]) {
    const at = `${vp.width}x${vp.height}`;

    it(`FOCUS-1 dashboard shows no "${CTA}" control and no phone note (${at})`, async () => {
      const page = await open(vp, "", dashUrl);
      expect(await page.getByRole("link", { name: CTA }).or(page.getByRole("button", { name: CTA })).count()).toBe(0);
      const note = page.getByText(NOTE, { exact: true });
      expect((await note.count()) > 0 && (await note.first().isVisible()), "phone note shown in dashboard").toBe(false);
      await page.close();
    });

    it(`FOCUS-2 / FOCUS-5 dashboard Overview has no Pace or Share rows and the same tab order (${at})`, async () => {
      const page = await open(vp, "", dashUrl);
      for (const id of ["ov-pace", "ov-share", "ov-logs"]) expect(await page.locator(`#${id}`).count(), `#${id}`).toBe(0);
      expect(await overview(page).getByRole("link", { name: /What drives it/ }).isVisible()).toBe(true);
      expect(await tabNames(page)).toEqual([...TABS]);
      await page.close();
    });

    // Dashboard has no demo bar, so the name must still show in the page header (above the tabs).
    it(`FOCUS-8 UX-R2 dashboard (no demo bar) still shows "ccwatts" in the header above the tabs (${at})`, async () => {
      const page = await open(vp, "", dashUrl);
      expect(await page.locator("#demo-bar").isVisible(), "dashboard shows the demo bar").toBe(false);
      const tabsTop = (await page.locator("#tabs").boundingBox())!.y;
      const name = page.getByText(/\bccwatts\b/i);
      const visibleAbove = await name.evaluateAll((els, top) =>
        els.some((el) => {
          const r = el.getBoundingClientRect();
          return (el as HTMLElement).checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, opacityProperty: true }) && r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= top + 0.5;
        }), tabsTop);
      expect(visibleAbove, `no visible "ccwatts" above the tabs (tabs top ${Math.round(tabsTop)})`).toBe(true);
      await page.close();
    });
  }
});
