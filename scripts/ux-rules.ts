#!/usr/bin/env node
// ux-rules: checks a page against the studio design rules that code can check, so a broken screen
// fails a test instead of depending on someone reading a screenshot right. Layer 1 of the rules (G1-G12)
// is in plugins/studio/agents/ux-reviewer.md; this checks G1-G5, G7-G9 and G11 at phone (390x844),
// laptop (1280x800) and reflow (320x640, G8 only) width. It also counts the visual system behind the page
// (V2 type sizes and families, V5 corner radii, V9 a card inside a card): an engineer-built page passes
// Layer 1 and still fails these. Pair it with ux-shots for the screenshots.
//
// Usage: npx tsx scripts/ux-rules.ts <url or file.html> [options]
//   --primary SEL   what counts as a primary button (default ".primary, .btn-primary, [data-primary]")
//   --click SEL     click the first visible match, then check again, e.g. --click "#addBtn" to open a
//                   dialog (repeatable, applied in order)
//   --out DIR       where report.json and report.md go (default dist/ux-rules)
//   --strict        exit 1 when any G rule fails (for CI)
//   --strict-visual with --strict, V findings fail too
// Needs Playwright with Chromium. Run it on a local build or a demo with sample data, never live data.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserType } from "playwright-core";
import { loadChromium } from "../tools/showcase-check/check.ts";

export const VIEWS: [string, number, number][] = [["phone", 390, 844], ["laptop", 1280, 800], ["reflow", 320, 640]];
const USAGE = "usage: ux-rules.ts <url or file.html> [--primary SEL] [--click SEL] [--out DIR] [--strict] [--strict-visual]";

export interface Options {
  target: string;
  primary: string;
  clicks: string[];
  out: string;
  strict: boolean;
  strictVisual: boolean;
  help?: boolean;
}
export type Finding = { rule: string; what: string; where: string };
export type View = { view: string; url: string; findings: Finding[] };
type RGBA = [number, number, number, number];
type Contrast = (a: readonly number[], b: readonly number[]) => number;
type InspectArgs = { primary: string; onlyReflow: boolean; contrastSrc: string };

export function parseArgs(argv: string[]): Options {
  const o: Omit<Options, "target"> & { target: string | null } = { target: null, primary: ".primary, .btn-primary, [data-primary]", clicks: [], out: "dist/ux-rules", strict: false, strictVisual: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!, next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--primary") o.primary = next();
    else if (a === "--click") o.clicks.push(next());
    else if (a === "--out") o.out = next();
    else if (a === "--strict") o.strict = true;
    else if (a === "--strict-visual") o.strictVisual = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (!o.target) o.target = a;
    else throw new Error(`one target only (got ${o.target} and ${a})`);
  }
  if (!o.help && !o.target) throw new Error(USAGE);
  return { ...o, target: o.target ?? "" };
}

/** WCAG contrast ratio of two [r, g, b] colors. Its source is evaluated in the page, so it names no inner function. */
export function contrast(a: readonly number[], b: readonly number[]): number {
  const [hi = 0, lo = 0] = [a, b]
    .map(([r = 0, g = 0, bl = 0]) => [r, g, bl].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((s, c, i) => s + c * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0))
    .sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function loadPlaywright(): Promise<BrowserType> {
  // PLAYWRIGHT_MODULE or the installed package (loadChromium), then a global install via NODE_PATH,
  // which only require() honors.
  try { return await loadChromium(); } catch {}
  try { return (createRequire(join(process.cwd(), "package.json"))("playwright") as typeof import("playwright-core")).chromium; } catch {
    throw new Error("Playwright isn't installed. Run: npm i -D playwright && npx playwright install chromium");
  }
}

// Runs in the page. Gets everything it needs as arguments. Declares no named function or name-bound
// arrow: under tsx those get an esbuild __name() wrapper that the browser doesn't have. The helpers
// are instead parameters of anonymous calls (an IIFE), which TypeScript types from the arguments.
function inspect({ primary, onlyReflow, contrastSrc }: InspectArgs): Finding[] {
  const contrast = eval(`(${contrastSrc})`) as Contrast;
  const out: Finding[] = [];
  const cards = new Map<Element, boolean>();
  return ((label, visible, text, rgb) => ((add, all, background, boxed) => {
    // G8: fits a 320px screen without sideways scroll (WCAG 1.4.10).
    if (document.documentElement.scrollWidth > innerWidth + 1) add("G8", `page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px window`);
    if (onlyReflow) return out;

    // G1 and G2: one primary action per view (the page, and each open dialog), and it is never destructive.
    const dialogs = all("dialog[open], [role=dialog], [role=alertdialog]");
    const scopes: [HTMLElement, string][] = [[document.body, "page"], ...dialogs.map((d): [HTMLElement, string] => [d, "dialog"])];
    for (const [root, kind] of scopes) {
      const mine = all(primary, root).filter((el) => kind === "dialog" || !dialogs.some((d) => d.contains(el)));
      if (mine.length > 1) add("G1", `${mine.length} primary buttons in one ${kind}: ${mine.map((el) => `"${text(el)}"`).join(", ")}`, root === document.body ? null : root);
      for (const el of mine) if (/\b(delete|remove|erase|clear|reset|discard|destroy)\b/i.test(text(el))) add("G2", "destructive action styled as the primary button", el);
    }

    // G3: every dialog has a name and a way out.
    for (const d of dialogs) {
      const named = d.getAttribute("aria-label") || d.getAttribute("aria-labelledby") || d.querySelector("h1, h2, h3, h4");
      if (!named) add("G3", "dialog has no title (heading, aria-label or aria-labelledby)", d);
      const exits = all("button, [role=button], a[href]", d).filter((b) => /^(close|cancel|keep|no|not now|back|done|×|✕|x)\b/i.test(text(b) || b.getAttribute("aria-label") || "") || /close|cancel|dismiss/i.test(b.getAttribute("aria-label") || "") || b.closest("form[method=dialog]"));
      if (!exits.length) add("G3", "dialog has no Cancel or Close button", d);
    }

    // G4: every control has a name a screen reader can say; a placeholder is not a label.
    for (const el of all("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea") as HTMLInputElement[]) {
      if (!(el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title)) add("G4", el.placeholder ? "placeholder is the only label" : "no label", el);
    }
    for (const el of all("button, a[href], [role=button]")) {
      if (!text(el) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.title && !el.querySelector("img[alt]:not([alt=''])")) add("G4", "button or link with no name", el);
    }

    // G5: anything clickable is a real button or link.
    for (const el of all("[onclick]")) {
      if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(el.tagName) && !(el.getAttribute("role") && el.hasAttribute("tabindex"))) add("G5", "clickable element that isn't a button or link (no keyboard access)", el);
    }

    // G7: readable text: nothing under 11px, contrast 4.5:1 (3:1 for large text).
    const owners = all("body *").filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim()));
    for (const el of owners) {
      const s = getComputedStyle(el), size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
      if (size < 11) add("G7", `${size}px text (11px is the floor, for small caps labels; body text 16-17px)`, el);
      const fg = rgb(s.color), bg = background(el);
      if (!fg || !bg || fg[3] === 0) continue;
      const ratio = contrast(fg.slice(0, 3), bg), need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) add("G7", `contrast ${ratio.toFixed(2)}:1, needs ${need}:1`, el);
    }

    // G9: one h1 that says what the page is.
    const h1s = all("h1");
    if (h1s.length !== 1) add("G9", `${h1s.length} h1 headings (want exactly 1)`);

    // G11: images have alt text (alt="" for decoration).
    for (const img of all("img")) if (!img.hasAttribute("alt")) add("G11", "image with no alt attribute", img);

    // V checks: the visual system. Limits calibrated so Build Slate and Roadmap (the studio references) pass.
    // V2: a hand-picked type scale: at most 8 sizes and 3 families in one view.
    const sizes = new Set<number>(), families = new Set<string>();
    for (const el of owners) {
      const s = getComputedStyle(el);
      sizes.add(Math.round(parseFloat(s.fontSize) * 2) / 2);
      families.add((s.fontFamily.split(",")[0] ?? "").trim().replace(/["']/g, ""));
    }
    if (sizes.size > 8) add("V2", `${sizes.size} font sizes (${[...sizes].sort((a, b) => a - b).join(", ")}px); pick a scale of 8 or fewer`);
    if (families.size > 3) add("V2", `${families.size} font families (${[...families].join(", ")}); use 2, 3 at most`);
    // V5: one shape language: at most 4 corner radii (pills and circles don't count).
    const boxes = all("body *"), radii = new Set<number | string>();
    for (const el of boxes) {
      const raw = getComputedStyle(el).borderTopLeftRadius, r = parseFloat(raw);
      if (raw.includes("%") ? r >= 50 : r >= Math.min(el.offsetWidth, el.offsetHeight) / 2 - 1) continue; // a pill or a circle
      if (r > 0) radii.add(raw.includes("%") ? `${r}%` : r);
    }
    if (radii.size > 4) add("V5", `${radii.size} corner radii (${[...radii].sort((a, b) => Number(a) - Number(b)).join(", ")}px); use 4 or fewer`);
    // V9: no card inside a card (a bordered or shadowed box inside another). Dialogs and form controls aren't cards.
    for (const el of boxes) {
      if (!boxed(el)) continue;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (boxed(p)) { add("V9", "card inside a card; separate with space or a divider instead", el); break; }
    }
    return out;
  })(
    // add
    (rule: string, what: string, el?: Element | null) => { out.push({ rule, what, where: el ? label(el) : "page" }); },
    // all
    (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)].filter(visible),
    // background: the color behind el: translucent layers blended down to the first opaque one (white if none).
    (el: Element): number[] | null => {
      const layers: RGBA[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage !== "none") return null; // over an image or gradient: judge it from the screenshot
        const c = rgb(s.backgroundColor);
        if (!c || c[3] === 0) continue;
        layers.push(c);
        if (c[3] >= 1) break;
      }
      return layers.reduceRight<number[]>((under, [r, g, b, a]) => [r, g, b].map((x, i) => x * a + (under[i] ?? 0) * (1 - a)), [255, 255, 255]);
    },
    // boxed: is el a card?
    (el: HTMLElement): boolean => {
      const known = cards.get(el);
      if (known !== undefined) return known;
      const s = getComputedStyle(el);
      const border = (["Top", "Right", "Bottom", "Left"] as const).every((k) => parseFloat(s[`border${k}Width`]) > 0);
      const control = /^(DIALOG|TEXTAREA|INPUT|SELECT|BUTTON|FIELDSET|IMG|VIDEO|IFRAME)$/.test(el.tagName) || /dialog/.test(el.getAttribute("role") || "");
      const card = !control && (border || s.boxShadow !== "none") && el.offsetWidth > 120 && el.offsetHeight > 60;
      cards.set(el, card);
      return card;
    },
  ))(
    // label
    (el: Element) => {
      const h = el as HTMLInputElement;
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(h.innerText || h.value || el.getAttribute("aria-label") || el.getAttribute("src") || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
    },
    // visible
    (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
    // text
    (el: HTMLElement) => (el.innerText || el.textContent || "").trim(),
    // rgb: computed colors come as rgb()/rgba(), or color(srgb r g b / a) for color-mix(); returns [r, g, b, a] in 0-255.
    (c: string): RGBA | null => {
      const m = c.match(/[\d.]+/g);
      if (!m) return null;
      const n = m.map(Number), k = c.startsWith("color(") ? 255 : 1;
      return [(n[0] ?? NaN) * k, (n[1] ?? NaN) * k, (n[2] ?? NaN) * k, n[3] ?? 1];
    },
  );
}

const slug = (s: string): string => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function markdown(report: View[], target: string): string {
  const lines = [`# ux-rules: ${target}`, "", `${report.reduce((n, v) => n + v.findings.length, 0)} rule failures across ${report.length} views.`,
    "Each line names a rule from ux-reviewer.md (G: Layer 1, V: visual system). A failing rule is a fact about the page: fix it, or record the exception in docs/design-rules.md (Layer 3) with the reason.", ""];
  for (const v of report) {
    lines.push(`## ${v.view}: ${v.findings.length ? `${v.findings.length} failing` : "clean"}`, "");
    for (const f of v.findings) lines.push(`- **${f.rule}** ${f.what}: \`${f.where}\``);
    if (v.findings.length) lines.push("");
  }
  return lines.join("\n");
}

export async function run(o: Options): Promise<View[]> {
  const chromium = await loadPlaywright();
  mkdirSync(o.out, { recursive: true });
  const url = /^[a-z]+:\/\//i.test(o.target) ? o.target : pathToFileURL(resolve(o.target)).href;
  const browser = await chromium.launch();
  const report: View[] = [];
  try {
    for (const [size, width, height] of VIEWS) {
      const page = await browser.newPage({ viewport: { width, height }, bypassCSP: true }); // inspect() evals the shared contrast()
      await page.goto(url, { waitUntil: "load" });
      const check = async (view: string): Promise<void> => {
        report.push({ view, url, findings: await page.evaluate(inspect, { primary: o.primary, onlyReflow: size === "reflow", contrastSrc: contrast.toString() }) });
      };
      await check(`home-${size}`);
      if (size !== "reflow") {
        for (const sel of o.clicks) {
          const el = page.locator(sel).filter({ visible: true }).first();
          if (!(await el.count())) { report.push({ view: `${slug(sel)}-${size}`, url, findings: [{ rule: "setup", what: `nothing visible matches --click ${sel}`, where: "page" }] }); continue; }
          await el.click();
          await page.waitForTimeout(150);
          await check(`after-${slug(sel)}-${size}`);
        }
      }
      await page.close();
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
    const n = report.reduce((s, v) => s + v.findings.length, 0);
    const failing = report.reduce((s, v) => s + v.findings.filter((f) => o.strictVisual || !f.rule.startsWith("V")).length, 0);
    console.log(`${n} rule failures across ${report.length} views. Details: ${join(o.out, "report.md")}`);
    if (o.strict && failing) process.exit(1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
