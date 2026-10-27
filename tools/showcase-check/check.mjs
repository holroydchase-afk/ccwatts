// Showcase check kit: loads a page in headless Chromium at phone and laptop sizes, in light and
// dark mode, and returns a list of problems a recruiter or first-time user would hit. Product
// specific checks plug in through `extra`. No dependencies; Playwright is loaded at run time.
//
// Built-in checks, each one a plain sentence in the returned list:
//   network requests (anything but file:, data:, blob:, about: and the page's own origin),
//   console and page errors, sideways scroll, tap targets under minTapPx, controls Tab never
//   reaches (keyboardReach), unfinished text (TODO, lorem ipsum, coming soon, example.com),
//   broken images, and text under minTextPx (off when 0).

export const DEFAULT_VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
export const DEFAULT_TAP_TARGETS = "button, label.btn, a.btn, [role=button], input[type=submit], input[type=button]";
const UNFINISHED = /\b(TODO|TBD|FIXME|lorem ipsum|coming soon)\b|example\.com/i;

/** Playwright, from PLAYWRIGHT_MODULE when set (a path to its index.mjs), else the installed package. */
export async function loadChromium() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  return chromium;
}

export async function launch() {
  const chromium = await loadChromium();
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

function defaultAllow(pageUrl) {
  const origin = /^https?:/.test(pageUrl) ? new URL(pageUrl).origin : null;
  return (url) => /^(file|data|blob|about):/.test(url) || (origin !== null && url.startsWith(`${origin}/`));
}

/**
 * @param {object} o
 * @param {string} o.url  file:// or http(s):// address of the built page
 * @param {{width:number,height:number}[]} [o.viewports]
 * @param {("light"|"dark")[]} [o.colorSchemes]
 * @param {(url: string) => boolean} [o.allowRequest]  requests that are fine; default local only
 * @param {string} [o.tapTargets]  selector for controls that must be minTapPx tall
 * @param {number} [o.minTapPx]
 * @param {string[]} [o.keyboardReach]  element ids Tab must reach
 * @param {number} [o.tabPresses]
 * @param {number} [o.minTextPx]  smallest allowed rendered font size; 0 skips the check
 * @param {(page: any, ctx: {viewport: any, colorScheme: string, problem: (msg: string) => void}) => Promise<void>} [o.extra]
 * @param {any} [o.browser]  an open Playwright browser to reuse
 * @returns {Promise<string[]>} problems, each tagged with where it happened, e.g. "[390px dark]"
 */
export async function showcaseCheck({
  url,
  viewports = DEFAULT_VIEWPORTS,
  colorSchemes = ["light", "dark"],
  allowRequest = defaultAllow(url),
  tapTargets = DEFAULT_TAP_TARGETS,
  minTapPx = 44,
  keyboardReach = [],
  tabPresses = 30,
  minTextPx = 0,
  extra,
  browser: given,
}) {
  const browser = given ?? (await launch());
  const problems = new Set();
  try {
    for (const colorScheme of colorSchemes) {
      for (const viewport of viewports) {
        const where = `[${viewport.width}px ${colorScheme}]`;
        const problem = (msg) => problems.add(`${msg} ${where}`);
        const page = await browser.newPage({ viewport, colorScheme });
        page.on("request", (r) => allowRequest(r.url()) || problem(`network request: ${r.url()}`));
        page.on("console", (m) => m.type() === "error" && problem(`console error: ${m.text()}`));
        page.on("pageerror", (e) => problem(`page error: ${e.message ?? e}`));
        await page.goto(url, { waitUntil: "load" });

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (scrollWidth > viewport.width) problem(`horizontal scroll: page is ${scrollWidth}px wide`);

        const short = await page.$$eval(
          tapTargets,
          (els, min) => els.filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < min)
            .map((e) => e.id || e.textContent.trim().slice(0, 30)),
          minTapPx,
        );
        if (short.length) problem(`tap targets under ${minTapPx}px: ${short.join(", ")}`);

        if (keyboardReach.length) {
          const reached = new Set();
          for (let i = 0; i < tabPresses; i++) {
            await page.keyboard.press("Tab");
            reached.add(await page.evaluate(() => document.activeElement?.id));
          }
          for (const id of keyboardReach) if (!reached.has(id)) problem(`Tab never reaches #${id}`);
        }

        const text = await page.evaluate(() => document.body.innerText);
        const line = text.split("\n").find((l) => UNFINISHED.test(l));
        if (line) problem(`unfinished text "${line.trim().slice(0, 60)}"`);

        const broken = await page.$$eval("img", (imgs) =>
          imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")));
        for (const src of broken) problem(`broken image: ${src}`);

        if (minTextPx > 0) {
          const tiny = await page.evaluate((min) => {
            const out = [];
            for (const el of document.body.querySelectorAll("*")) {
              const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
              if (!own || !el.getClientRects().length) continue;
              const size = parseFloat(getComputedStyle(el).fontSize);
              if (size < min) out.push(`"${el.textContent.trim().slice(0, 30)}" ${size}px`);
            }
            return out;
          }, minTextPx);
          if (tiny.length) problem(`text under ${minTextPx}px: ${tiny.slice(0, 3).join(", ")}`);
        }

        if (extra) await extra(page, { viewport, colorScheme, problem });
        await page.close();
      }
    }
  } finally {
    if (!given) await browser.close();
  }
  return [...problems];
}
