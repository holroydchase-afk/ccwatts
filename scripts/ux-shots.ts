#!/usr/bin/env node
// ux-shots: the ux-reviewer's visual pass as one command. Screenshots a page at phone (390x844)
// and laptop (1280x800) width, light and dark, viewport and full page, and reports what a person
// would see go wrong: console errors, failed requests, broken images, sideways scroll, small tap
// targets and unfinished text. Run it on a local build or a demo with sample data, never live data.
//
// Usage: npx tsx scripts/ux-shots.ts <url or file.html> [options]
//   --out DIR          where screenshots and report go (default dist/ux-shots)
//   --click SELECTOR   also shoot the page after clicking each element SELECTOR matches,
//                      e.g. --click "[role=tab]" for a tabbed app (repeatable)
//   --path PATH        another page under the same site, e.g. --path /about (repeatable)
//   --wait SELECTOR    wait for this element before shooting (default body)
//   --tap N            smallest tap target height in px on phones (default 44)
//   --no-network       block and report every request that leaves the page's own origin (any
//                      http request for a file target): the privacy gate for local-only apps
//   --strict           exit 1 when any issue is found (for CI)
// Writes report.json and report.md to --out. Needs Playwright with Chromium.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserType } from "playwright-core";
import { loadChromium } from "../tools/showcase-check/check.ts";

export const SIZES: [string, number, number][] = [["phone", 390, 844], ["laptop", 1280, 800]];
export const SCHEMES = ["light", "dark"] as const;
const USAGE = "usage: ux-shots.ts <url or file.html> [--out DIR] [--click SEL] [--path PATH] [--wait SEL] [--tap N] [--no-network] [--strict]";

export interface Options {
  target: string;
  out: string;
  clicks: string[];
  paths: string[];
  wait: string;
  tap: number;
  strict: boolean;
  noNetwork: boolean;
  help?: boolean;
}
/** What inspect() measures in the page. */
export type Seen = { sideways: string | null; smallTargets: string[]; brokenImages: string[]; unfinished: string[]; deadLinks: string[] };
export type Shot = Seen & {
  name: string; url: string; size: string; scheme: string; shot: string; full: string;
  consoleErrors: string[]; failedRequests: string[]; outsideRequests?: string[];
};

export function parseArgs(argv: string[]): Options {
  const o: Omit<Options, "target"> & { target: string | null } = { target: null, out: "dist/ux-shots", clicks: [], paths: [], wait: "body", tap: 44, strict: false, noNetwork: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!, next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out") o.out = next();
    else if (a === "--click") o.clicks.push(next());
    else if (a === "--path") o.paths.push(next());
    else if (a === "--wait") o.wait = next();
    else if (a === "--tap") o.tap = Number(next());
    else if (a === "--strict") o.strict = true;
    else if (a === "--no-network") o.noNetwork = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (!o.target) o.target = a;
    else throw new Error(`one target only (got ${o.target} and ${a})`);
  }
  if (!o.help && !o.target) throw new Error(USAGE);
  if (!Number.isFinite(o.tap) || o.tap <= 0) throw new Error("--tap must be a positive number");
  return { ...o, target: o.target ?? "" };
}

/** "https://x.dev/app/" + "/about" -> https://x.dev/about; a file path becomes a file:// URL. */
export function pageUrls(target: string, paths: string[] = []): [string, string][] {
  const base = /^[a-z]+:\/\//i.test(target) ? target : pathToFileURL(resolve(target)).href;
  return [["home", base], ...paths.map((p): [string, string] => [slug(p) || "page", new URL(p, base).href])];
}

/** True when a request leaves the page: another origin, or any network URL from a file:// page. */
export function isOutside(requestUrl: string, pageUrl: string): boolean {
  const req = new URL(requestUrl), from = new URL(pageUrl);
  if (!/^(https?|wss?):$/.test(req.protocol)) return false; // file:, data:, blob: stay on the device
  return from.protocol === "file:" || req.origin !== from.origin;
}

export const slug = (s: string): string => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function loadPlaywright(): Promise<BrowserType> {
  // PLAYWRIGHT_MODULE or the installed package (loadChromium), then a global install via NODE_PATH,
  // which only require() honors.
  try { return await loadChromium(); } catch {}
  try { return (createRequire(join(process.cwd(), "package.json"))("playwright") as typeof import("playwright-core")).chromium; } catch {
    throw new Error("Playwright isn't installed. Run: npm i -D playwright && npx playwright install chromium");
  }
}

// Runs in the page: what a person would notice. Kept free of outside variables, and declares no
// named function or name-bound arrow: under tsx those get an esbuild __name() wrapper that the
// browser doesn't have. The helpers are parameters of an anonymous call instead.
function inspect(tap: number): Seen {
  return ((visible, label) => {
    const phone = innerWidth < 600;
    const small = [...document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]")]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24 || (phone && r.height < tap)))
      .map(({ el, r }) => `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).map((i) => i.currentSrc || i.src);
    const text = document.body ? document.body.innerText : "";
    const unfinished = text.match(/\b(TODO|TBD|FIXME|lorem ipsum|coming soon|placeholder|undefined|NaN)\b|\{\{[^}]*\}\}/gi) || [];
    const deadLinks = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "").filter((h) => /^(#?$|javascript:)|example\.(com|org|net)/i.test(h.trim()));
    return {
      sideways: document.documentElement.scrollWidth > innerWidth + 1 ? `page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px window` : null,
      smallTargets: [...new Set(small)],
      brokenImages: [...new Set(broken)],
      unfinished: [...new Set(unfinished)],
      deadLinks: [...new Set(deadLinks)],
    };
  })(
    // visible
    (el: HTMLElement) => el.offsetParent !== null || getComputedStyle(el).position === "fixed",
    // label
    (el: HTMLElement) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`,
  );
}

export const issueCount = (r: Shot): number => (r.sideways ? 1 : 0) + r.smallTargets.length + r.brokenImages.length + r.unfinished.length + r.deadLinks.length + r.consoleErrors.length + r.failedRequests.length + (r.outsideRequests?.length || 0);

export function markdown(report: Shot[], target: string): string {
  const lines = [`# ux-shots: ${target}`, "", `${report.length} shots, ${report.filter((r) => issueCount(r)).length} with issues.`,
    "Measured, not judged: a link inside a sentence is exempt from the 24px target rule (WCAG 2.5.8), and a word like \"placeholder\" can be fine in context. Open the screenshots before calling anything a defect.", ""];
  for (const r of report) {
    const n = issueCount(r);
    lines.push(`## ${r.name}: ${n ? `${n} issue${n > 1 ? "s" : ""}` : "clean"}`, "", `Screens: \`${r.shot}\`, \`${r.full}\``);
    const add = (title: string, items: string[]): void => { if (items.length) lines.push(`- ${title}: ${items.map((x) => `\`${x}\``).join(", ")}`); };
    if (r.sideways) lines.push(`- Sideways scroll: ${r.sideways}`);
    add("Small tap targets", r.smallTargets);
    add("Broken images", r.brokenImages);
    add("Unfinished text", r.unfinished);
    add("Dead or sample links", r.deadLinks);
    add("Console errors", r.consoleErrors);
    add("Failed requests", r.failedRequests);
    add("Requests that left the page (blocked)", r.outsideRequests || []);
    lines.push("");
  }
  return lines.join("\n");
}

export async function run(o: Options): Promise<Shot[]> {
  const chromium = await loadPlaywright();
  mkdirSync(o.out, { recursive: true });
  const browser = await chromium.launch();
  const report: Shot[] = [];
  try {
    for (const [pageName, url] of pageUrls(o.target, o.paths)) {
      for (const [size, width, height] of SIZES) {
        for (const scheme of SCHEMES) {
          const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
          const consoleErrors: string[] = [], failedRequests: string[] = [], outsideRequests: string[] = [];
          if (o.noNetwork) {
            await page.route("**/*", (route) => {
              const u = route.request().url();
              if (!isOutside(u, url)) return route.continue();
              outsideRequests.push(u);
              return route.abort("blockedbyclient");
            });
          }
          page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
          page.on("console", (m) => {
            if (m.type() !== "error") return;
            if (o.noNetwork && /ERR_BLOCKED_BY_CLIENT/.test(m.text())) return; // our own block, already listed
            consoleErrors.push(m.text());
          });
          page.on("requestfailed", (r) => { if (!outsideRequests.includes(r.url())) failedRequests.push(`${r.url()} (${r.failure()?.errorText || "failed"})`); });
          page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.url()} (${r.status()})`); });
          await page.goto(url, { waitUntil: "load" });
          await page.waitForSelector(o.wait);
          await page.evaluate(() => document.fonts && document.fonts.ready);
          const shoot = async (name: string): Promise<void> => {
            await page.mouse.move(0, 0);
            await page.waitForTimeout(150);
            const shot = join(o.out, `${name}.png`), full = join(o.out, `${name}-full.png`);
            await page.screenshot({ path: shot });
            await page.screenshot({ path: full, fullPage: true });
            report.push({ name, url, size, scheme, shot, full, ...(await page.evaluate(inspect, o.tap)),
              consoleErrors: [...new Set(consoleErrors.splice(0))], failedRequests: [...new Set(failedRequests.splice(0))],
              outsideRequests: [...new Set(outsideRequests.splice(0))] });
          };
          await shoot(`${pageName}-${size}-${scheme}`);
          for (const sel of o.clicks) {
            const count = await page.locator(sel).count();
            for (let i = 0; i < count; i++) {
              const el = page.locator(sel).nth(i);
              if (!(await el.isVisible())) continue;
              const what = slug((await el.getAttribute("aria-label")) || (await el.textContent()) || `${i + 1}`) || `${i + 1}`;
              await el.click();
              await shoot(`${pageName}-${slug(sel)}-${what}-${size}-${scheme}`);
            }
          }
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(o.out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(o.out, "report.md"), markdown(report, o.target));
  return report;
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let o: Options;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); process.exit(2); }
  if (o.help) { console.log(USAGE); process.exit(0); }
  if (!/^[a-z]+:\/\//i.test(o.target) && !existsSync(o.target)) { console.error(`no such file: ${o.target}`); process.exit(2); }
  try {
    const report = await run(o);
    const withIssues = report.filter((r) => issueCount(r));
    console.log(`${report.length} shots in ${o.out}, ${withIssues.length} with issues. Details: ${join(o.out, "report.md")}`);
    if (o.strict && withIssues.length) process.exit(1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
