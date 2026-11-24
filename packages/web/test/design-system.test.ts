import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright-core";
import { defaultParams, estimate, formatEnergy, rollupRecords, type RollupRow } from "@ccwatts/core";
import { readSample } from "../src/inject.js";
import { launch } from "../../../tools/showcase-check/check.ts";

// STUDIO-DS (Chase, Nov 21): the playground follows the studio design system (hearth
// docs/design/STUDIO-CORE.md + tokens.json, Paper theme, Atkinson Hyperlegible Next) and opens on an
// Overview roll-up instead of everything at once ("the current ccwatts visuals are overwhelming...
// I'd prefer a roll up with high level dashboard view of each ccwatts, pace, etc.").
//
// API pinned here for the engineer:
//  - DS-1: theme tokens live in template.html's <style> as CSS custom properties on :root:
//    --bg --surface --ink --muted --line --fill --accent --accent-ink --accent-soft --tab-line.
//    Light = plain :root; dark = @media (prefers-color-scheme:dark); high contrast =
//    @media (prefers-contrast:more) (alone for light, combined with dark for dark). Hex values only.
//  - DS-2: @font-face "Atkinson Hyperlegible Next", src url(data:font/woff2;base64,...) holding the bytes of
//    src/fonts/AtkinsonHyperlegibleNext-latin.woff2. Note the CSP is default-src 'none' today: a data:
//    font also needs `font-src data:` or document.fonts never loads it.
//  - DS-3..DS-5: the studio demo bar (#demo-bar, pm-tools DEMO-BANNER standard) is exempt.
//  - DS-6: data marks = shapes in svg.chart / [role=tabpanel] svg[role=img], plus the HTML swatches
//    and bars that stand for data (.legend i, .rank .bar span, .range-dot).
//  - DS-7: tabs are exactly Overview, Electricity, Share, Method, Pace (M4.8.1, FOCUS-5). Overview
//    controls #ov-energy, #ov-drives and the "Try it on your logs" CTA #ov-cta are each themselves an
//    <a> or <button>. #ov-drives shows "What drives your number" (#explain); #ov-cta shows the Your
//    logs panel #drop. The Pace and Share rows left Overview in M4.8.1 (CCW-DEC-17).
//  - DS-8: hashes are #electricity, #pace, #share, #method; each tab push-navigates (Back works).
//  - DS-9: a Light / Dark / System control (radios, toggle buttons or a <select>), saved in localStorage.
//
// Browser: Playwright from PLAYWRIGHT_MODULE (or an installed `playwright`), CHROMIUM_PATH optional.
// With no Playwright the browser tests are SKIPPED (labeled below), never counted as passing.

const htmlPath = fileURLToPath(new URL("../dist/ccwatts.html", import.meta.url));
const url = pathToFileURL(htmlPath).href;
const html = readFileSync(htmlPath, "utf8");
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");
const fontBytes = readFileSync(new URL("../src/fonts/AtkinsonHyperlegibleNext-latin.woff2", import.meta.url));

// Copied as-is from holroydchase-afk/hearth main docs/design/tokens.json, themes.paper (Nov 21, 2026).
const HEARTH_PAPER = {
  light: { bg: "#F7F7F4", surface: "#FFFFFF", ink: "#1E1B17", muted: "#5C564E", line: "#E3DED4", fill: "#EFECE5", accent: "#AD371D", accentInk: "#FFFFFF", accentSoft: "#F2EAE5", tabLine: "#928E87" },
  dark: { bg: "#131210", surface: "#1C1A17", ink: "#F1EEE8", muted: "#B2ACA2", line: "#2E2B27", fill: "#24221E", accent: "#FF8A65", accentInk: "#000000", accentSoft: "#3D281F", tabLine: "#696661" },
} as const;
// DARK-7 (intake #108, docs/product/SPEC-DARK-ELEVATION.md): ccwatts forks hearth Paper dark in four tokens
// so cards step lighter than the page (Material 3 tonal surfaces; hearth surface #1C1A17 on bg is 1.08:1).
// Source: SPEC-DARK-ELEVATION "What changes". Upstream fix: a hearth intake to adopt the same values
// (Decision 1). If the engineer tunes these in template.html, update them here too.
const DARK_108 = { surface: "#24221E", fill: "#33302B", line: "#383530", tabLine: "#77736D" } as const;
const PAPER = {
  light: HEARTH_PAPER.light,
  dark: { ...HEARTH_PAPER.dark, ...DARK_108 },
} as const;
type Token = keyof typeof PAPER.light;
const CSS_VAR: Record<Token, string> = {
  bg: "--bg", surface: "--surface", ink: "--ink", muted: "--muted", line: "--line", fill: "--fill",
  accent: "--accent", accentInk: "--accent-ink", accentSoft: "--accent-soft", tabLine: "--tab-line",
};
const TOKENS = Object.keys(CSS_VAR) as Token[];

// ---------------------------------------------------------------------------------------------
// WCAG 2 contrast, and a small CSS reader for the theme blocks (no browser).
// ---------------------------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hexToRgb(a)!), luminance(hexToRgb(b)!)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Rule = { media: string[]; selector: string; decls: Record<string, string> };
function parseCss(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const skipBlock = (i: number) => {
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return i + 1;
    }
    return i;
  };
  const block = (i: number, media: string[]): number => {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) return close + 1;
      if (open === -1) return src.length;
      const prelude = src.slice(i, open).trim();
      if (prelude.startsWith("@media")) i = block(open + 1, [...media, prelude.slice(6).trim()]);
      else if (prelude.startsWith("@")) i = skipBlock(open);
      else {
        const end = src.indexOf("}", open);
        const decls: Record<string, string> = {};
        for (const d of src.slice(open + 1, end).split(";")) {
          const c = d.indexOf(":");
          if (c > 0) decls[d.slice(0, c).trim()] = d.slice(c + 1).trim();
        }
        rules.push({ media, selector: prelude, decls });
        i = end + 1;
      }
    }
    return i;
  };
  block(0, []);
  return rules;
}
type Env = { scheme: "light" | "dark"; contrast: "more" | "no-preference"; theme: "light" | "dark" | null };
function mediaMatches(cond: string, env: Env): boolean {
  return cond.split(",").some((part) =>
    part.split(/\band\b/).every((raw) => {
      const f = raw.replace(/\s+/g, "").toLowerCase();
      if (f === "" || f === "screen" || f === "all" || f === "onlyscreen") return true;
      const m = /^\(prefers-(color-scheme|contrast):([a-z-]+)\)$/.exec(f);
      if (!m) return false; // width, print, forced-colors...: not a theme block
      return m[1] === "color-scheme" ? env.scheme === m[2] : (m[2] === "more") === (env.contrast === "more");
    }));
}
function selectorMatches(sel: string, env: Env): boolean {
  return sel.split(",").some((s) => {
    const m = /^(?::root|html)((?::not\(\[data-theme=["']?\w+["']?\]\)|\[data-theme=["']?\w+["']?\])*)$/.exec(s.trim());
    if (!m) return false;
    for (const p of m[1]!.match(/(:not\()?\[data-theme=["']?(\w+)["']?\]\)?/g) ?? []) {
      const want = /data-theme=["']?(\w+)/.exec(p)![1];
      if (p.startsWith(":not(") ? env.theme === want : env.theme !== want) return false;
    }
    return true;
  });
}
const styleCss = [...template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const RULES = parseCss(styleCss);
function themeFor(env: Env, rules: Rule[] = RULES): Record<Token, string> {
  const vars: Record<string, string> = {};
  for (const r of rules) {
    if (!r.media.every((m) => mediaMatches(m, env)) || !selectorMatches(r.selector, env)) continue;
    for (const [k, v] of Object.entries(r.decls)) if (k.startsWith("--")) vars[k] = v;
  }
  const resolve = (v: string | undefined, depth = 0): string | undefined => {
    const m = v && /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v.trim());
    if (!m || depth > 5) return v?.trim();
    return resolve(vars[m[1]!] ?? m[2], depth + 1);
  };
  return Object.fromEntries(TOKENS.map((t) => [t, resolve(vars[CSS_VAR[t]]) ?? "(missing)"])) as Record<Token, string>;
}
const SCENES = {
  light: { scheme: "light", contrast: "no-preference", theme: null },
  dark: { scheme: "dark", contrast: "no-preference", theme: null },
  "high contrast light": { scheme: "light", contrast: "more", theme: null },
  "high contrast dark": { scheme: "dark", contrast: "more", theme: null },
} satisfies Record<string, Env>;

describe("DS-1 Paper theme contrast (WCAG 2, no browser)", () => {
  it("DS-1 the WCAG helper agrees with known pairs (black/white 21:1, same colour 1:1, #767676 on white 4.54:1)", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777", "#777")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });
  it("DS-1 the CSS reader picks :root, the dark query, contrast:more and data-theme the way a browser would (self-check)", () => {
    const css = `/* c */ :root{--bg:#111111;--ink:var(--x);--x:#222222;--accent-ink:#000}
      @font-face{font-family:x;src:url(data:font/woff2;base64,AA==)}
      @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#333333}}
      :root[data-theme="dark"]{--bg:#444444}
      @media (prefers-contrast:more){:root{--ink:#555555}}
      @media (prefers-contrast:more) and (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#666666}}
      @media (min-width:600px){:root{--bg:#777777}}`;
    const rules = parseCss(css);
    const pick = (env: Env) => { const t = themeFor(env, rules); return [t.bg, t.ink, t.accentInk].join(" "); };
    expect(pick(SCENES.light)).toBe("#111111 #222222 #000");
    expect(pick(SCENES.dark)).toBe("#333333 #222222 #000");
    expect(pick(SCENES["high contrast light"])).toBe("#111111 #555555 #000");
    expect(pick(SCENES["high contrast dark"])).toBe("#666666 #555555 #000");
    expect(pick({ scheme: "light", contrast: "no-preference", theme: "dark" })).toBe("#444444 #222222 #000");
    expect(pick({ scheme: "dark", contrast: "no-preference", theme: "light" })).toBe("#111111 #222222 #000");
  });

  for (const mode of ["light", "dark"] as const) {
    it(`DS-1 ${mode} tokens in template.html equal tokens.json themes.paper.${mode} exactly`, () => {
      const got = themeFor(SCENES[mode]);
      const want = Object.fromEntries(TOKENS.map((t) => [t, PAPER[mode][t].toUpperCase()]));
      expect(Object.fromEntries(TOKENS.map((t) => [t, got[t].toUpperCase()]))).toEqual(want);
    });
  }

  for (const [name, env] of Object.entries(SCENES)) {
    const hc = env.contrast === "more";
    it(`DS-1 ${name}: every Paper pair meets its WCAG 2 ratio`, () => {
      const t = themeFor(env);
      const bad = TOKENS.filter((k) => !hexToRgb(t[k])).map((k) => `${CSS_VAR[k]} is ${t[k]} (want a hex colour)`);
      expect(bad, "every theme token is a hex colour").toEqual([]);
      const pairs: [string, Token, Token, number][] = [
        ["ink on bg", "ink", "bg", 7],
        ["muted on bg", "muted", "bg", hc ? 7 : 4.5],
        ["muted on fill", "muted", "fill", hc ? 7 : 4.5],
        ["accent on bg", "accent", "bg", 4.5],
        ["accent on fill", "accent", "fill", 4.5],
        ["accent on accentSoft", "accent", "accentSoft", 4.5],
        ["accentInk on accent", "accentInk", "accent", hc ? 7 : 4.5],
        ["tabLine on bg", "tabLine", "bg", 3],
        ["tabLine on surface", "tabLine", "surface", 3],
        ...(hc ? ([["line on bg", "line", "bg", 4.5]] as [string, Token, Token, number][]) : []),
      ];
      const fails = pairs
        .map(([label, fg, bg, min]) => ({ label, ratio: contrast(t[fg], t[bg]), min, fg: t[fg], bg: t[bg] }))
        .filter((p) => !(p.ratio >= p.min))
        .map((p) => `${p.label}: ${p.fg} on ${p.bg} is ${p.ratio.toFixed(2)}:1 (want ${p.min}:1)`);
      expect(fails).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// DARK-1..DARK-7 (intake #108): in dark mode cards step lighter than the page; elevation by tone, not shadow.
// ---------------------------------------------------------------------------------------------
const distCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const DIST_RULES = parseCss(distCss);
const DARK_SCENES = { dark: SCENES.dark, "high contrast dark": SCENES["high contrast dark"] } as const;
const ratioLine = (label: string, fg: string, bg: string, min: number) => {
  const r = contrast(fg, bg);
  return r >= min ? null : `${label}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (want ${min}:1)`;
};
// Light tokens as shipped before #108 (template.html lines 26-27 and 46), pinned so this PR can't move them.
const LIGHT_BEFORE = {
  light: { ...HEARTH_PAPER.light },
  "high contrast light": { ...HEARTH_PAPER.light, muted: "#534D46", line: "#75716A", accent: "#822F1B", accentSoft: "#EFE9E5" },
} as const;

describe("DARK dark-mode elevation by tone (intake #108, no browser)", () => {
  it("DARK-1 in the built page's dark scene, --surface on --bg is 1.15:1 or more (cards read one step lighter)", () => {
    const t = themeFor(SCENES.dark, DIST_RULES);
    expect(ratioLine("surface on bg", t.surface, t.bg, 1.15)).toBeNull();
  });

  for (const [name, env] of Object.entries(DARK_SCENES)) {
    it(`DARK-2 ${name}: --fill differs from --surface and fill on surface is 1.1:1 or more (buttons, .seg track, pressed segment)`, () => {
      const t = themeFor(env);
      expect(t.fill.toUpperCase(), "--fill equals --surface").not.toBe(t.surface.toUpperCase());
      expect(ratioLine("fill on surface", t.fill, t.surface, 1.1)).toBeNull();
    });

    it(`DARK-3 ${name}: text, accent and tab-line still pass on the surface and fill tones`, () => {
      const t = themeFor(env);
      const hc = env.contrast === "more";
      const fails = [
        ratioLine("ink on surface", t.ink, t.surface, 7),
        ratioLine("muted on surface", t.muted, t.surface, hc ? 7 : 4.5),
        ratioLine("muted on fill", t.muted, t.fill, hc ? 7 : 4.5),
        ratioLine("accent on surface", t.accent, t.surface, 4.5),
        ratioLine("accent on fill", t.accent, t.fill, 4.5),
        ratioLine("tabLine on surface", t.tabLine, t.surface, 3),
        ratioLine("tabLine on bg", t.tabLine, t.bg, 3),
      ].filter(Boolean);
      expect(fails).toEqual([]);
    });
  }

  it("DARK-4 the prefers-color-scheme dark block and the :root[data-theme=\"dark\"] block hold identical tokens", () => {
    const pick = (r: Rule | undefined) => Object.fromEntries(TOKENS.map((t) => [t, r?.decls[CSS_VAR[t]]?.toUpperCase() ?? "(missing)"]));
    const media = RULES.find((r) => r.media.length === 1 && /^\(prefers-color-scheme:\s*dark\)$/.test(r.media[0]!) && /^:root:not\(\[data-theme=["']?light["']?\]\)$/.test(r.selector));
    const attr = RULES.find((r) => r.media.length === 0 && /^:root\[data-theme=["']?dark["']?\]$/.test(r.selector));
    expect(media, "no @media (prefers-color-scheme:dark){:root:not([data-theme=\"light\"])} block").toBeDefined();
    expect(attr, "no :root[data-theme=\"dark\"] block").toBeDefined();
    expect(pick(attr)).toEqual(pick(media));
    expect(themeFor({ scheme: "light", contrast: "no-preference", theme: "dark" })).toEqual(themeFor(SCENES.dark));
  });

  for (const [name, want] of Object.entries(LIGHT_BEFORE)) {
    it(`DARK-5 ${name}: every token equals its value before #108`, () => {
      const env = SCENES[name as keyof typeof LIGHT_BEFORE];
      const got = themeFor(env);
      expect(Object.fromEntries(TOKENS.map((t) => [t, got[t].toUpperCase()]))).toEqual(want);
    });
  }
  it("DARK-5 picking Light with the OS in dark shows the same light tokens as before #108", () => {
    const got = themeFor({ scheme: "dark", contrast: "no-preference", theme: "light" });
    expect(Object.fromEntries(TOKENS.map((t) => [t, got[t].toUpperCase()]))).toEqual(LIGHT_BEFORE.light);
  });

  it("DARK-6 no box-shadow in template.html has a blur radius above 0 (rings and zero-blur insets only)", () => {
    const blurOf = (shadow: string): number => {
      const lengths = shadow.replace(/var\([^)]*\)|rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]+/gi, " ").replace(/\binset\b/g, " ")
        .trim().split(/\s+/).filter((x) => /^-?[\d.]+(px|rem|em)?$/.test(x)).map(parseFloat);
      return lengths[2] ?? 0;
    };
    const splitTop = (v: string) => {
      const out: string[] = []; let depth = 0, cur = "";
      for (const ch of v) {
        if (ch === "(") depth++; else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
      }
      return [...out, cur];
    };
    const shadows = RULES.flatMap((r) => Object.entries(r.decls).filter(([k]) => k === "box-shadow").map(([, v]) => ({ sel: r.selector, v })));
    expect(shadows.length, "self-check: the reader found box-shadows").toBeGreaterThan(0);
    // Self-check of the blur reader on known values.
    expect([blurOf("0 0 0 1px var(--line)"), blurOf("inset 0 -2px 0 var(--accent)"), blurOf("0 2px 8px rgba(0,0,0,.3)")]).toEqual([0, 0, 8]);
    const bad = shadows.flatMap(({ sel, v }) => v === "none" ? [] : splitTop(v).filter((s) => blurOf(s) > 0).map((s) => `${sel}: ${s.trim()}`));
    expect(bad).toEqual([]);
  });

  it("DARK-7 PAPER.dark forks hearth themes.paper.dark in exactly surface, fill, line and tab-line (#108)", () => {
    const diff = TOKENS.filter((t) => PAPER.dark[t] !== HEARTH_PAPER.dark[t]);
    expect(diff).toEqual(["surface", "line", "fill", "tabLine"]);
    // The DS-1 "dark tokens ... equal" check above then pins template.html to these values.
  });
});

describe("DS-2 Atkinson Hyperlegible Next is bundled (static)", () => {
  it("DS-2 the built page has an @font-face for \"Atkinson Hyperlegible Next\" whose src is the bundled woff2 as a data: URL", () => {
    const faces = [...html.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const face = faces.find((f) => /font-family\s*:\s*["']?Atkinson Hyperlegible Next["']?/.test(f));
    expect(face, "no @font-face for Atkinson Hyperlegible Next in dist/ccwatts.html").toBeDefined();
    const data = /url\(\s*["']?data:font\/woff2;base64,([A-Za-z0-9+/=]+)["']?\s*\)/.exec(face!);
    expect(data, "the @font-face src is not a data:font/woff2;base64 URL").not.toBeNull();
    expect(Buffer.from(data![1]!, "base64").equals(fontBytes), "the inlined font is not src/fonts/AtkinsonHyperlegibleNext-latin.woff2").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Browser checks.
// ---------------------------------------------------------------------------------------------
let browser: Browser | null = null;
let noBrowser = "";
try {
  browser = await launch();
} catch (e) {
  noBrowser = `Playwright/Chromium not available (${(e as Error).message.split("\n")[0]}); set PLAYWRIGHT_MODULE`;
}
const withBrowser = describe.skipIf(!browser);
// A real browser visits every tab at two widths; 5s is too short for that.
vi.setConfig({ testTimeout: 90_000 });
if (!browser) console.warn(`design-system.test.ts: browser tests SKIPPED: ${noBrowser}`);
afterAll(async () => {
  await browser?.close();
});

const problems: string[] = [];
type Opts = { width: number; height?: number; colorScheme?: "light" | "dark"; hash?: string };
async function open({ width, height = 900, colorScheme = "light", hash = "" }: Opts): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height }, colorScheme });
  page.on("request", (r) => {
    if (!/^(file|data|blob|about):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(url + hash);
  await ready(page);
  return page;
}
async function ready(page: Page) {
  // Wait for numbers to render; don't throw, so each test fails on its own assertion.
  await page
    .waitForFunction(() => ["#ov-energy", "#hero-big"].some((s) => /\d/.test(document.querySelector(s)?.textContent ?? "")), null, { timeout: 8000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const TABS = ["Overview", "Electricity", "Share", "Method", "Pace"] as const;
/** Names of the tabs a person can see, in order. */
const tabNames = (page: Page) => page.getByRole("tab").evaluateAll((ts) => ts.map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim()));
async function selectTab(page: Page, name: string): Promise<boolean> {
  const tab = page.getByRole("tab", { name, exact: true });
  if ((await tab.count()) !== 1) return false;
  await tab.click();
  await page.waitForTimeout(50);
  return true;
}
/** An attribute of the one tab with this name, or null at once when there is no such tab (no auto-wait). */
async function tabAttr(page: Page, name: string, attr: string): Promise<string | null> {
  const tab = page.getByRole("tab", { name, exact: true });
  return (await tab.count()) === 1 ? tab.getAttribute(attr) : null;
}
const isSelected = (page: Page, name: string) => tabAttr(page, name, "aria-selected");
/** Text of the element with this id, or "(missing)" at once. */
const textOf = (page: Page, id: string) => page.evaluate((i) => (document.getElementById(i)?.textContent ?? "(missing)").replace(/\s+/g, " "), id);
async function panelOf(page: Page, name: string) {
  const id = await tabAttr(page, name, "aria-controls");
  return id ? page.locator(`[id="${id}"]`) : null;
}

/** In-page helpers, as a string so no bundler helper (tsx's __name) leaks into the page. */
const HELPERS = `
window.__ds = (() => {
  const exempt = (el) => !!el.closest("#demo-bar");
  const clipped = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a); const r = a.getBoundingClientRect();
      if ((r.width <= 1 || r.height <= 1) && (cs.overflow !== "visible" || cs.clip !== "auto")) return true;
    }
    return false;
  };
  const visible = (el) => {
    if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && !clipped(el);
  };
  const where = (el) => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.getAttribute("class") ? "." + el.getAttribute("class").trim().split(/\\s+/).join(".") : "") + (el.parentElement ? " in " + (el.parentElement.id ? "#" + el.parentElement.id : el.parentElement.tagName.toLowerCase()) : "");
  const openDetails = () => { for (const d of document.querySelectorAll("details")) if (!exempt(d)) d.open = true; };
  const svgScale = (el) => { const m = el.getScreenCTM && el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 1; };
  const textOwners = () => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || exempt(el) || el.closest("script,style,noscript,template")) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !visible(el)) continue;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize) * (el instanceof SVGElement ? svgScale(el) : 1);
      out.push({ where: where(el), text: n.textContent.trim().slice(0, 40), px: Math.round(px * 10) / 10, weight: cs.fontWeight, transform: cs.textTransform, style: cs.fontStyle });
    }
    for (const el of document.body.querySelectorAll("*")) {
      if (exempt(el) || !visible(el)) continue;
      for (const pseudo of ["::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        const c = cs.content;
        if (!c || c === "none" || c === "normal" || !/[\\p{L}\\p{N}\\p{S}\\p{P}]/u.test(c.replace(/^"\\s*"$/, "").replace(/^""$/, ""))) continue;
        if (/^"\\s*"$/.test(c)) continue;
        out.push({ where: where(el) + pseudo, text: c.slice(0, 40), px: parseFloat(cs.fontSize), weight: cs.fontWeight, transform: cs.textTransform, style: cs.fontStyle });
      }
      if (el.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), textarea, select")) {
        const cs = getComputedStyle(el);
        out.push({ where: where(el), text: "(field)", px: parseFloat(cs.fontSize), weight: cs.fontWeight, transform: cs.textTransform, style: cs.fontStyle });
      }
    }
    return out;
  };
  const inlineLink = (a) => !!a.closest("p") || [...(a.parentElement?.childNodes ?? [])].some((n) => n.nodeType === 3 && n.textContent.trim());
  const targets = () => {
    const out = [];
    for (const el of document.querySelectorAll("button, a, [role=tab], summary, input:not([type=hidden]), select, textarea")) {
      if (exempt(el)) continue;
      if (el.tagName === "A" && inlineLink(el)) continue;
      let t = el;
      if (el.tagName === "INPUT" && !visible(el)) {
        // A visually hidden input is tapped through its <label>.
        const label = el.id && document.querySelector('label[for="' + el.id + '"]');
        if (!label || !visible(label)) continue;
        t = label;
      } else if (!visible(el)) continue;
      const r = t.getBoundingClientRect();
      if (r.width < 47.5 || r.height < 47.5) out.push(where(t) + " " + JSON.stringify((t.textContent || t.getAttribute("aria-label") || "").trim().slice(0, 30)) + " is " + r.width.toFixed(1) + "x" + r.height.toFixed(1));
    }
    return out;
  };
  const SPACE = [0, 4, 8, 12, 16, 24, 32];
  const okSpace = (v) => { const a = Math.abs(v); return SPACE.some((s) => Math.abs(a - s) < 0.05) || (a > 32 && Math.abs(a / 32 - Math.round(a / 32)) < 0.002); };
  const okRadius = (v) => v.split(/\\s+/).every((p) => p === "50%" || ["0px", "4px", "12px", "999px"].includes(p));
  const shape = () => {
    const out = [];
    const props = ["row-gap", "column-gap", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left"];
    for (const el of document.body.querySelectorAll("*")) {
      if (exempt(el) || (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") || !visible(el)) continue;
      const cs = getComputedStyle(el);
      for (const corner of ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]) {
        const v = cs.getPropertyValue(corner);
        if (!okRadius(v)) out.push(where(el) + " " + corner + " " + v);
      }
      for (const p of props) {
        const v = cs.getPropertyValue(p);
        if (v === "normal" || v === "auto") continue;
        if (okSpace(parseFloat(v))) continue;
        let specified = "";
        try { specified = String(el.computedStyleMap().get(p)); } catch {}
        if (specified === "auto" || specified === "normal") continue;
        out.push(where(el) + " " + p + " " + v);
      }
    }
    return [...new Set(out)];
  };
  const probe = (css) => { const s = document.createElement("span"); s.style.color = css; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; };
  const rgb = (c) => { const m = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?/.exec(c); return m && (m[4] === undefined || +m[4] > 0) ? [+m[1], +m[2], +m[3]] : null; };
  const hue = ([r, g, b]) => {
    const [R, G, B] = [r / 255, g / 255, b / 255]; const mx = Math.max(R, G, B), mn = Math.min(R, G, B); const l = (mx + mn) / 2; const d = mx - mn;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  };
  const kind = (c) => {
    const v = rgb(c); if (!v) return null;
    const { h, s, l } = hue(v);
    if (l < 0.1 || l > 0.92) return null;
    if (h >= 75 && h <= 165 && s >= 0.2) return "green";
    if ((h <= 20 || h >= 340) && s >= 0.35) return "red";
    return null;
  };
  const dataMarks = () => {
    const accent = probe("var(--accent)");
    // Gridlines and axes drawn in the structural tokens aren't data series.
    const structural = ["--line", "--tab-line", "--ink", "--muted", "--bg", "--surface", "--fill"].map((v) => probe("var(" + v + ")"));
    const out = [];
    const check = (el, what, c) => {
      if (!rgb(c)) return;
      if (c === accent) out.push(where(el) + " " + what + " is the accent " + c);
      const k = !structural.includes(c) && kind(c); if (k) out.push(where(el) + " " + what + " is " + k + " " + c);
    };
    const svgs = new Set([...document.querySelectorAll("svg.chart, [role=tabpanel] svg[role=img]")].filter((s) => !exempt(s)));
    for (const svg of svgs) {
      for (const el of svg.querySelectorAll("rect, path, circle, ellipse, polygon, polyline, line")) {
        const cs = getComputedStyle(el);
        const fill = el.getAttribute("fill") || "";
        if (/^url\\(/.test(fill) || /^url\\(/.test(cs.fill)) continue; // the pattern's own shapes are checked below
        check(el, "fill", cs.fill);
        if (cs.fill === "none" || el.tagName === "line" || el.tagName === "polyline") check(el, "stroke", cs.stroke);
      }
    }
    for (const el of document.querySelectorAll(".legend i, .rank .bar span, .range-dot")) {
      if (exempt(el)) continue;
      check(el, "background", getComputedStyle(el).backgroundColor);
    }
    return [...new Set(out)];
  };
  const tokens = () => ({ bg: probe("var(--bg)"), ink: probe("var(--ink)") });
  return { openDetails, textOwners, targets, shape, dataMarks, tokens, visible: (sel) => { const e = document.querySelector(sel); return !!e && visible(e); } };
})();
`;
async function helpers(page: Page) {
  await page.evaluate(HELPERS);
}

/** Visit every visible tab and the Your logs panel (via the #ov-cta button, which must exist), run `fn` there. */
async function eachView<T>(page: Page, fn: (view: string) => Promise<T>): Promise<Record<string, T>> {
  await helpers(page);
  const out: Record<string, T> = {};
  for (const name of await tabNames(page)) {
    await selectTab(page, name);
    await page.evaluate("window.__ds.openDetails()");
    out[name] = await fn(name);
  }
  // QA-R3: every eachView caller opens the playground, which always has the CTA. A missing CTA (or
  // Overview tab) must fail the check, not skip the Your logs view silently.
  if ((await page.locator("#ov-cta").count()) !== 1) throw new Error("eachView: no #ov-cta button, so the Your logs view can't be checked");
  if (!(await selectTab(page, "Overview"))) throw new Error("eachView: no Overview tab to reach #ov-cta from");
  await page.locator("#ov-cta").click();
  await page.waitForTimeout(50);
  await page.evaluate("window.__ds.openDetails()");
  out["Your logs (#ov-cta)"] = await fn("Your logs");
  return out;
}
const nonEmpty = <T>(r: Record<string, T[]>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.length));

withBrowser("DS-0 in-page measuring helpers (self-check on a fixture, not the product)", () => {
  it("DS-0 the helpers flag 13px text, weight 700, uppercase, a 44px button, a 10px radius, 20px padding and accent/green/red chart fills, and pass the good twins", async () => {
    const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<style>:root{--accent:#AD371D;--line:#E3DED4;--ink:#1E1B17}body{margin:0;font:17px/22px sans-serif}p{margin:0}</style>
      <p id="good">Good text</p><p id="small" style="font-size:13px">Small</p><p id="bold" style="font-weight:700">Bold</p><p id="caps" style="text-transform:uppercase">Caps</p>
      <button id="ok" style="min-height:48px;min-width:48px;font-size:17px;border-radius:12px;padding:0 16px">OK</button><button id="short" style="height:44px;width:80px;font-size:17px;padding:0">Short</button>
      <div id="r10" style="border-radius:10px;padding:20px;font-size:17px">x</div>
      <p>Read the <a href="#" id="inline">docs</a> here.</p>
      <svg class="chart" viewBox="0 0 100 50" width="200" height="100"><line x1="0" x2="100" y1="1" y2="1" stroke="var(--line)"/><rect id="ra" x="0" y="0" width="5" height="5" fill="var(--accent)"/><rect x="10" y="0" width="5" height="5" fill="#2f6b4f"/><rect x="20" y="0" width="5" height="5" fill="#4a6fa5"/><text x="0" y="40" font-size="8">tiny</text></svg>`);
    await helpers(page);
    const text = (await page.evaluate("window.__ds.textOwners()")) as { text: string; px: number; weight: string; transform: string }[];
    const targets = (await page.evaluate("window.__ds.targets()")) as string[];
    const shape = (await page.evaluate("window.__ds.shape()")) as string[];
    const marks = (await page.evaluate("window.__ds.dataMarks()")) as string[];
    await page.close();
    const px = Object.fromEntries(text.map((t) => [t.text, t.px]));
    expect(px).toMatchObject({ "Good text": 17, Small: 13, tiny: 16 }); // 8 user units x 2 (200px / 100 viewBox)
    expect(text.find((t) => t.text === "Bold")?.weight).toBe("700");
    expect(text.find((t) => t.text === "Caps")?.transform).toBe("uppercase");
    expect(targets.join("\n")).toMatch(/#short/);
    expect(targets.join("\n")).not.toMatch(/#ok|#inline/);
    expect(shape.join("\n")).toMatch(/#r10 border-top-left-radius 10px/);
    expect(shape.join("\n")).toMatch(/#r10 padding-top 20px/);
    expect(shape.join("\n")).not.toMatch(/#ok /);
    expect(marks.join("\n")).toMatch(/is the accent/);
    expect(marks.join("\n")).toMatch(/is green/);
    expect(marks.join("\n")).toMatch(/is red/);
    expect(marks.join("\n")).not.toMatch(/line .*stroke/);
    expect(marks.join("\n")).not.toMatch(/74, 111, 165/);
  });
});

withBrowser("DS-2 the font loads with no network", () => {
  it("DS-2 body font-family is \"Atkinson Hyperlegible Next\", system-ui, sans-serif and document.fonts reports it loaded", async () => {
    const page = await open({ width: 1280 });
    const got = await page.evaluate(() => ({
      family: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === "Atkinson Hyperlegible Next").map((f) => f.status),
      check: document.fonts.check('17px "Atkinson Hyperlegible Next"'),
    }));
    await page.close();
    expect(got.family).toMatch(/^["']?Atkinson Hyperlegible Next["']?\s*,\s*system-ui\s*,\s*sans-serif$/);
    expect(got.loaded, "FontFace status for Atkinson Hyperlegible Next").toContain("loaded");
    expect(got.check).toBe(true);
  });
});

withBrowser("QA-R3 eachView must visit the Your logs view (harness self-check)", () => {
  it("QA-R3 eachView visits Your logs (#ov-cta) on the playground", async () => {
    const page = await open({ width: 390, height: 844 });
    const views = await eachView(page, async () => true);
    await page.close();
    expect(Object.keys(views), "Your logs view not visited").toContain("Your logs (#ov-cta)");
  });
  it("QA-R3 eachView fails, instead of skipping silently, when the #ov-cta button is missing", async () => {
    const page = await open({ width: 390, height: 844 });
    await page.evaluate(() => document.getElementById("ov-cta")?.remove()); // simulate a lost CTA in this page only
    const outcome = await eachView(page, async () => true).then((v) => `resolved with views ${JSON.stringify(Object.keys(v))}`, () => "rejected");
    await page.close();
    expect(outcome, "eachView skipped Your logs silently").toBe("rejected");
  });
});

withBrowser("DS-3 type: 17px floor, weights 400/500/600, no caps or italics", () => {
  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    it(`DS-3 at ${width}px no visible text in any tab is under 17px (demo bar exempt)`, async () => {
      const page = await open({ width, height });
      const small = await eachView(page, async () =>
        (await page.evaluate("window.__ds.textOwners()") as { where: string; text: string; px: number }[])
          .filter((t) => t.px < 16.95).map((t) => `${t.px}px ${t.where} "${t.text}"`));
      await page.close();
      expect(Object.keys(small).length, "no tabs found").toBeGreaterThan(0);
      expect(nonEmpty(small)).toEqual({});
    });
    it(`DS-3 at ${width}px visible text uses weight 400, 500 or 600, no uppercase, no italics`, async () => {
      const page = await open({ width, height });
      const bad = await eachView(page, async () =>
        (await page.evaluate("window.__ds.textOwners()") as { where: string; text: string; weight: string; transform: string; style: string }[])
          .filter((t) => !["400", "500", "600"].includes(t.weight) || t.transform === "uppercase" || t.style !== "normal")
          .map((t) => `${t.where} "${t.text}" weight ${t.weight} ${t.transform} ${t.style}`));
      await page.close();
      expect(nonEmpty(bad)).toEqual({});
    });
  }
});

withBrowser("DS-4 tap targets are 48x48", () => {
  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    it(`DS-4 at ${width}px every visible button, link, tab, summary and input is at least 48x48 (inline text links exempt)`, async () => {
      const page = await open({ width, height });
      const small = await eachView(page, async () => (await page.evaluate("window.__ds.targets()")) as string[]);
      await page.close();
      expect(nonEmpty(small)).toEqual({});
    });
  }
});

withBrowser("DS-5 spacing and corners from the studio scale", () => {
  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    it(`DS-5 at ${width}px radii are 0/4/12/999px/50% and gap, margin, padding are 0/4/8/12/16/24/32 or multiples of 32`, async () => {
      const page = await open({ width, height });
      const bad = await eachView(page, async () => (await page.evaluate("window.__ds.shape()")) as string[]);
      await page.close();
      expect(nonEmpty(bad)).toEqual({});
    });
  }
});

withBrowser("DS-6 the accent means tap here: no accent, green or red data marks", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    it(`DS-6 (${colorScheme}) chart shapes and data swatches use neither the accent nor green or red`, async () => {
      const page = await open({ width: 1280, colorScheme });
      const bad = await eachView(page, async () => (await page.evaluate("window.__ds.dataMarks()")) as string[]);
      await page.close();
      expect(nonEmpty(bad)).toEqual({});
    });
  }
});

/** Same cut as app.ts windowRows for sample data: count back from the last day in the file. */
function sampleWindow(rows: RollupRow[], days: number): RollupRow[] {
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "0000-00-00");
  const start = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000 - days * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= start);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

withBrowser("DS-7 Overview roll-up", () => {
  it("DS-7 one tablist with exactly 5 tabs: Overview, Electricity, Share, Method, Pace", async () => {
    const page = await open({ width: 1280 });
    const lists = await page.getByRole("tablist").count();
    const names = await tabNames(page);
    await page.close();
    expect(lists).toBe(1);
    expect(names).toEqual([...TABS]);
  });

  it("DS-7 Overview is selected by default and its panel holds #ov-energy, #ov-drives and the #ov-cta button", async () => {
    const page = await open({ width: 1280 });
    const selected = await isSelected(page, "Overview");
    const panel = await panelOf(page, "Overview");
    const inside = panel ? await panel.evaluate((p) => ["ov-energy", "ov-drives", "ov-cta"].filter((id) => !p.querySelector(`#${id}`))) : "no Overview panel";
    const shown = panel ? await panel.isVisible() : false;
    await page.close();
    expect(selected, "Overview aria-selected").toBe("true");
    expect(shown, "Overview panel visible").toBe(true);
    expect(inside, "rows missing from the Overview panel").toEqual([]);
  });

  for (const width of [390, 1280]) {
    it(`DS-7 at ${width}px each Overview row (and the CTA) is one link or button, at least 48px tall`, async () => {
      const page = await open({ width });
      const rows = await page.evaluate(() =>
        ["ov-energy", "ov-drives", "ov-cta"].map((id) => {
          const el = document.getElementById(id);
          return { id, tag: el?.tagName ?? "(missing)", h: el ? Math.round(el.getBoundingClientRect().height) : 0, nested: el ? el.querySelectorAll("a, button").length : 0 };
        }));
      await page.close();
      const bad = rows.filter((r) => !["A", "BUTTON"].includes(r.tag) || r.h < 48 || r.nested > 0).map((r) => `#${r.id} <${r.tag.toLowerCase()}> ${r.h}px tall, ${r.nested} nested controls`);
      expect(bad).toEqual([]);
    });
  }

  const ROWS = [
    { id: "ov-energy", tab: "Electricity", shows: "#chart" },
    { id: "ov-drives", tab: null, shows: "#explain" },
    { id: "ov-cta", tab: null, shows: "#drop" },
  ] as const;
  for (const row of ROWS) {
    it(`DS-7 clicking #${row.id} ${row.tab ? `selects the ${row.tab} tab and ` : ""}shows ${row.shows}`, async () => {
      const page = await open({ width: 1280 });
      await helpers(page);
      const found = (await page.locator(`#${row.id}`).count()) === 1;
      if (found) {
        await page.locator(`#${row.id}`).click();
        await page.waitForTimeout(100);
      }
      const selected = row.tab ? await isSelected(page, row.tab) : "n/a";
      const shown = await page.evaluate(`window.__ds.visible(${JSON.stringify(row.shows)})`);
      const overviewSelected = await isSelected(page, "Overview");
      await page.close();
      expect(found, `no #${row.id}`).toBe(true);
      if (row.tab) expect(selected, `${row.tab} aria-selected`).toBe("true");
      expect(shown, `${row.shows} visible`).toBe(true);
      if (row.id !== "ov-cta") expect(overviewSelected, "Overview no longer selected").toBe("false");
    });
  }

  it("DS-7 #ov-energy shows the central kWh, its range and the method version", async () => {
    const t = formatEnergy(estimate(rollupRecords(sampleWindow(readSample(html), 30)), defaultParams).total);
    const [low, high] = t.range.split(" – ");
    const central = t.central.split(" ")[0]!;
    const page = await open({ width: 1280 });
    const text = await textOf(page, "ov-energy");
    await page.close();
    expect(text).toMatch(new RegExp(`(^|[^\\d.])${esc(central)}(?![\\d.])`));
    expect(text).toMatch(new RegExp(`${esc(low!)}\\s*[–-]\\s*${esc(high!)}`));
    expect(text).toMatch(/kWh/);
    expect(text).toMatch(new RegExp(`method v${esc(defaultParams.version)}`, "i"));
  });

  // M4.8.1 took the Pace row off Overview (CCW-DEC-17); its hours and range now show only in the Pace tab.
  it("DS-7 the Pace tab's lead shows the headline week's hours with a range, and Overview has no Pace row", async () => {
    const page = await open({ width: 1280 });
    await selectTab(page, "Pace");
    const lead = await textOf(page, "pace-lead");
    const paceRow = await page.locator("#ov-pace").count();
    await page.close();
    const m = /about (\d+(?:\.\d+)?) active hours \(range (\d+(?:\.\d+)?) – (\d+(?:\.\d+)?)\)/.exec(lead);
    expect(m, `Pace lead "${lead}" has no hours and range`).not.toBeNull();
    const [, central, low, high] = m!;
    expect(Number(low) <= Number(central) && Number(central) <= Number(high), `range ${low} – ${high} around ${central}`).toBe(true);
    expect(paceRow, "#ov-pace still on the page").toBe(0);
  });

  it("DS-7 at 1280x800 the Overview page is at most 1100px tall (scrollHeight)", async () => {
    const page = await open({ width: 1280, height: 800 });
    const selected = await isSelected(page, "Overview");
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.close();
    expect(selected, "Overview selected").toBe("true");
    expect(h).toBeLessThanOrEqual(1100);
  });
});

withBrowser("DS-8 deep links and Back", () => {
  for (const [hash, name] of [["#electricity", "Electricity"], ["#pace", "Pace"], ["#share", "Share"], ["#method", "Method"]] as const) {
    it(`DS-8 loading the page at ${hash} opens the ${name} tab`, async () => {
      const page = await open({ width: 1280, hash });
      const selected = await isSelected(page, name);
      const panel = await panelOf(page, name);
      const shown = panel ? await panel.isVisible() : false;
      await page.close();
      expect(selected, `${name} aria-selected`).toBe("true");
      expect(shown, `${name} panel visible`).toBe(true);
    });
  }

  it("DS-8 selecting a tab sets location.hash", async () => {
    const page = await open({ width: 1280 });
    const got: Record<string, string> = {};
    for (const name of ["Electricity", "Pace", "Share", "Method"]) {
      await selectTab(page, name);
      got[name] = await page.evaluate(() => location.hash);
    }
    await page.close();
    expect(got).toEqual({ Electricity: "#electricity", Pace: "#pace", Share: "#share", Method: "#method" });
  });

  it("DS-8 Back returns to the previous tab", async () => {
    const page = await open({ width: 1280 });
    const pace = await selectTab(page, "Pace");
    const share = await selectTab(page, "Share");
    await page.goBack({ waitUntil: "commit", timeout: 3000 }).catch(() => null);
    await page.waitForTimeout(150);
    const afterBack = { pace: await isSelected(page, "Pace"), share: await isSelected(page, "Share"), hash: await page.evaluate(() => location.hash) };
    await page.close();
    expect(pace && share, "no Pace or Share tab").toBe(true);
    expect(afterBack).toEqual({ pace: "true", share: "false", hash: "#pace" });
  });
});

/** Find the Light / Dark / System control (any tab) and pick `choice`. Returns whether it was found. */
async function pickTheme(page: Page, choice: "Light" | "Dark" | "System"): Promise<boolean> {
  const candidates = () => [
    page.getByRole("radio", { name: choice, exact: true }),
    page.getByRole("button", { name: choice, exact: true }),
  ];
  const select = page.locator("select").filter({ has: page.locator(`option`, { hasText: new RegExp(`^\\s*${choice}\\s*$`) }) });
  const tryPick = async () => {
    for (const c of candidates()) if ((await c.count()) === 1 && (await c.isVisible())) { await c.click(); return true; }
    if ((await select.count()) === 1 && (await select.isVisible())) { await select.selectOption({ label: choice }); return true; }
    return false;
  };
  if (await tryPick()) return true;
  for (const name of await tabNames(page)) {
    await selectTab(page, name);
    if (await tryPick()) return true;
  }
  return false;
}
async function themeIsPicked(page: Page, choice: string): Promise<boolean> {
  for (const c of [page.getByRole("radio", { name: choice, exact: true }), page.getByRole("button", { name: choice, exact: true })]) {
    if ((await c.count()) === 1) return (await c.getAttribute("aria-checked")) === "true" || (await c.getAttribute("aria-pressed")) === "true" || (await c.isChecked().catch(() => false));
  }
  const opt = page.locator("select option", { hasText: new RegExp(`^\\s*${choice}\\s*$`) });
  return (await opt.count()) === 1 && (await opt.evaluate((o: HTMLOptionElement) => o.selected));
}
const rgbOf = (hex: string) => `rgb(${hexToRgb(hex)!.join(", ")})`;
async function pageTokens(page: Page) {
  await helpers(page);
  return (await page.evaluate("window.__ds.tokens()")) as { bg: string; ink: string };
}

withBrowser("DS-9 people pick Light, Dark or System (principle 10)", () => {
  // Persistence moved to PS-R1 (privacy-security, Nov 21): the choice lasts this visit only, no storage.
  it("DS-9 with the OS in light, picking Dark shows the dark Paper tokens and marks Dark as picked", async () => {
    const page = await open({ width: 1280, colorScheme: "light" });
    const found = await pickTheme(page, "Dark");
    await page.waitForTimeout(50);
    const after = await pageTokens(page);
    const picked = found && (await themeIsPicked(page, "Dark"));
    await page.close();
    expect(found, "no Light / Dark / System control named Dark").toBe(true);
    expect(after).toEqual({ bg: rgbOf(PAPER.dark.bg), ink: rgbOf(PAPER.dark.ink) });
    expect(picked, "Dark is not marked picked (aria-checked / aria-pressed / selected)").toBe(true);
  });

  it("DS-9 with the OS in dark, picking Light shows the light Paper tokens; picking System goes back to dark", async () => {
    const page = await open({ width: 390, colorScheme: "dark" });
    const before = await pageTokens(page);
    const light = await pickTheme(page, "Light");
    await page.waitForTimeout(50);
    const asLight = await pageTokens(page);
    const system = await pickTheme(page, "System");
    await page.waitForTimeout(50);
    const asSystem = await pageTokens(page);
    await page.close();
    expect(before, "OS dark, nothing picked").toEqual({ bg: rgbOf(PAPER.dark.bg), ink: rgbOf(PAPER.dark.ink) });
    expect(light && system, "no Light or System choice").toBe(true);
    expect(asLight).toEqual({ bg: rgbOf(PAPER.light.bg), ink: rgbOf(PAPER.light.ink) });
    expect(asSystem).toEqual({ bg: rgbOf(PAPER.dark.bg), ink: rgbOf(PAPER.dark.ink) });
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round on 13d193c: privacy-security PS-R1, PS-R2; ux-reviewer UX-R61, UX-R62, UX-R64.
// ---------------------------------------------------------------------------------------------
describe("PS-R1 no browser storage (static)", () => {
  it("PS-R1 the built page contains no localStorage and no sessionStorage", () => {
    expect(html.match(/localStorage|sessionStorage/g) ?? []).toEqual([]);
  });
});

withBrowser("PS-R1 the theme choice lasts this visit only", () => {
  it("PS-R1 picking Dark applies the dark tokens; after a reload the page is back on System (OS light shows light, System picked)", async () => {
    const page = await open({ width: 1280, colorScheme: "light" });
    const found = await pickTheme(page, "Dark");
    await page.waitForTimeout(50);
    const dark = await pageTokens(page);
    await page.reload();
    await ready(page);
    const reloaded = await pageTokens(page);
    const system = await themeIsPicked(page, "System");
    const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
    await page.close();
    expect(found, "no Dark choice").toBe(true);
    expect(dark).toEqual({ bg: rgbOf(PAPER.dark.bg), ink: rgbOf(PAPER.dark.ink) });
    expect(reloaded, "after reload").toEqual({ bg: rgbOf(PAPER.light.bg), ink: rgbOf(PAPER.light.ink) });
    expect(system, "System marked picked after reload").toBe(true);
    expect(stored).toEqual({ local: 0, session: 0, cookie: "" });
  });
});

withBrowser("PS-R2 hostile hashes land on Overview", () => {
  for (const hash of ["#<img src=x onerror=alert(1)>", '#"]']) {
    it(`PS-R2 loading the page at ${JSON.stringify(hash)} shows Overview, adds no img and throws no page error`, async () => {
      const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      const dialogs: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("dialog", (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      // Count imgs on a clean load first, so the hostile load is compared with the same page.
      await page.goto(url);
      await ready(page);
      const imgs = await page.evaluate(() => document.querySelectorAll("img").length);
      await page.goto("about:blank");
      await page.goto(url + hash);
      await ready(page);
      await page.waitForTimeout(150);
      const got = {
        overview: await isSelected(page, "Overview"),
        overviewShown: (await panelOf(page, "Overview"))?.isVisible() ?? false,
        imgs: await page.evaluate(() => document.querySelectorAll("img").length),
        xImg: await page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => i.getAttribute("src") === "x").length),
      };
      await page.close();
      expect({ ...got, overviewShown: await got.overviewShown }).toEqual({ overview: "true", overviewShown: true, imgs, xImg: 0 });
      expect(errors, "page errors").toEqual([]);
      expect(dialogs, "dialogs").toEqual([]);
    });
  }
});

withBrowser("UX-R61 the Overview number outranks the heading", () => {
  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    it(`UX-R61 at ${width}px #ov-energy's value is 34px or more and bigger than the h1; the h1 is 22px`, async () => {
      const page = await open({ width, height });
      const got = await page.evaluate(() => {
        const row = document.getElementById("ov-energy");
        // The value element: the one inside the row whose own text holds the central number.
        const els = row ? [...row.querySelectorAll<HTMLElement>("*")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /\d/.test(n.textContent ?? ""))) : [];
        const value = els.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
        const h1 = document.querySelector("h1");
        return { value: value ? parseFloat(getComputedStyle(value).fontSize) : 0, h1: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0 };
      });
      await page.close();
      expect(got.h1, "h1 font-size").toBe(22);
      expect(got.value, "#ov-energy value font-size").toBeGreaterThanOrEqual(34);
      expect(got.value, "value bigger than h1").toBeGreaterThan(got.h1);
    });
  }
});

withBrowser("UX-R62 tabs on a 320px screen", () => {
  // Method was the last tab; since M4.8.1 Pace is, so both are checked.
  for (const name of ["Method", "Pace"] as const) it(`UX-R62 at 320px the selected ${name} tab is fully inside the viewport, and the tablist fades at the right edge (mask-image) or doesn't overflow`, async () => {
    const page = await open({ width: 320, height: 640 });
    const selected = await selectTab(page, name);
    await page.waitForTimeout(300);
    const got = await page.evaluate(() => {
      const tab = [...document.querySelectorAll<HTMLElement>("[role=tab]")].find((t) => t.getAttribute("aria-selected") === "true");
      const list = document.querySelector<HTMLElement>("[role=tablist]")!;
      const r = tab?.getBoundingClientRect();
      const cs = getComputedStyle(list);
      const mask = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
      return {
        name: tab?.textContent?.trim(),
        inside: !!r && r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
        tab: r ? `${r.left.toFixed(1)}..${r.right.toFixed(1)} of ${window.innerWidth}` : "none",
        overflows: list.scrollWidth > list.clientWidth + 1,
        mask: mask && mask !== "none" ? mask : "",
      };
    });
    await page.close();
    expect(selected, `no ${name} tab`).toBe(true);
    expect(got.name).toBe(name);
    expect(got.inside, `selected tab spans ${got.tab}`).toBe(true);
    expect(!got.overflows || got.mask !== "", `tablist overflows with no fade (mask-image: "${got.mask || "none"}")`).toBe(true);
  });
});

describe("UX-R64 the Your logs CTA doesn't repeat the privacy line", () => {
  it("UX-R64 the #ov-cta block (button and phone note) says neither \"never leaves\" nor \"never uploaded\"", () => {
    const row = /<div[^>]*id="ov-cta-wrap"[\s\S]*?<\/div>/.exec(html)?.[0];
    expect(row, "no #ov-cta-wrap in the built page").toBeDefined();
    const text = row!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).not.toMatch(/never leaves|never uploaded/i);
  });
});

withBrowser("DS constraints still hold", () => {
  it("DS no network requests or page errors across the pages opened above", () => {
    expect(problems).toEqual([]);
  });
});
