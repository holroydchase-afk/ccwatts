import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTFOLIO_URL } from "@ccwatts/core";

// SPEC-SITE-HEADER Part A (docs/product/SPEC-SITE-HEADER.md): the portfolio's site header on the
// playground. Static checks on the template, app.ts and the built page (no browser). Layout, colours,
// fonts, focus rings, sticky tabs, deep links, sideways scroll, the dashboard and zero requests are
// checked in a real browser by scripts/check-no-network.ts (npm run check:browser), blocks
// "SITEHDR Part A" and "SITEHDR Part B".
//
// API pinned here for the engineer:
//  - The header is markup in template.html: <header id="site-bar"> ... </header>, before <main>.
//    Its hrefs are set by app.ts from PORTFOLIO_URL (like #repo-link), so the page source keeps no
//    absolute URL outside meta tags (page.test.ts "link preview").
//  - The back link's accessible name is "Chase Holroyd, back to the portfolio"; its text is "← Chase Holroyd".
//  - <nav aria-label="Site"> holds "Building" and "Agents"; then the label "ccwatts demo"; then "Case study".
const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const header = /<header[^>]*id="site-bar"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&larr;/g, "←").replace(/\s+/g, " ").trim();

describe("SITEHDR Part A: the site header (static)", () => {
  it("SITEHDR-1 the built page has one <header id=\"site-bar\"> before <main>", () => {
    expect(html.match(/<header[^>]*id="site-bar"/g)?.length ?? 0, "count of #site-bar").toBe(1);
    expect(html.indexOf('id="site-bar"'), "#site-bar comes before <main>").toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf('id="site-bar"')).toBeGreaterThan(-1);
  });

  it("SITEHDR-1 the header holds, in order, the back link, nav \"Site\", \"ccwatts demo\" and \"Case study\"", () => {
    expect(header, "#site-bar markup").not.toBe("");
    const back = /<a[^>]*aria-label="Chase Holroyd, back to the portfolio"[^>]*>([\s\S]*?)<\/a>/.exec(header);
    expect(back, "back link with aria-label").not.toBeNull();
    expect(text(back![1]!)).toBe("← Chase Holroyd");
    expect(back![0]).toMatch(/class="[^"]*\bnm\b/);
    const nav = /<nav[^>]*aria-label="Site"[^>]*>([\s\S]*?)<\/nav>/.exec(header);
    expect(nav, "<nav aria-label=\"Site\">").not.toBeNull();
    expect([...nav![1]!.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]!))).toEqual(["Building", "Agents"]);
    const at = (needle: string) => header.indexOf(needle);
    const order = [at('aria-label="Chase Holroyd, back to the portfolio"'), at('aria-label="Site"'), at("ccwatts demo"), at(">Case study<")];
    expect(order.every((i) => i >= 0), `all four parts present: ${order}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("SITEHDR-2 no hard-coded origin in app.ts or template.html; header hrefs are set by script from PORTFOLIO_URL", () => {
    // The only absolute URL source is PORTFOLIO_URL in packages/core/src/meta.ts.
    for (const [name, src] of [["app.ts", app], ["template.html", template]] as const) {
      expect(src, `${name} has a literal https?:// URL`).not.toMatch(/https?:\/\//);
      expect(src, `${name} names the portfolio host`).not.toMatch(/chaseholroyd/i);
    }
    expect(header, "#site-bar markup").not.toBe("");
    expect(header, "absolute href in the header markup").not.toMatch(/href="https?:/);
    expect(app).toContain("PORTFOLIO_URL");
    for (const path of ["/building.html", "/agents.html"]) expect(html, `${path} built from the PORTFOLIO_URL origin`).toContain(path);
    expect(new URL(PORTFOLIO_URL).origin).toBe("https://chaseholroyd.com");
  });

  it("SITEHDR-3 the header palette (light and dark) is in the page CSS", () => {
    for (const hex of ["#14161A", "#5B6068", "#E4E6E2", "#0B7A4B", "#131210", "#F2F0EA", "#A8A49A", "#2C2A26", "#4CC38A"]) {
      expect(css.toLowerCase(), `header colour ${hex}`).toContain(hex.toLowerCase());
    }
    expect(css, "a #site-bar rule").toMatch(/#site-bar[^{]*\{/);
  });

  it("SITEHDR-3 the theme follows the picker in CSS: no 'dk' class and no storage from app.ts", () => {
    expect(app).not.toMatch(/["']dk["']/);
    expect(app).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("SITEHDR-5 the light --bg token stays #F7F7F4 (the playground paints white with --surface instead)", () => {
    expect(css).toMatch(/:root\{\s*--bg:#F7F7F4;\s*--surface:#FFFFFF;/);
    expect(css.match(/--bg:#F7F7F4/gi)?.length, "--bg:#F7F7F4 defined once").toBe(1);
  });

  it("SITEHDR-9 the CSP is byte-identical to before: nothing added, no 'self', no new source", () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const hash = createHash("sha256").update(script).digest("base64");
    expect(csp).toBe(`default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'`);
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/);
  });

  it("SITEHDR-10 the strip's old \"← Portfolio\" link (#demo-home) is gone; the header carries the way back", () => {
    expect(html).not.toContain('id="demo-home"');
    expect(html).not.toContain("← Portfolio");
    expect(app).not.toContain("demo-home");
  });

  it("SITEHDR UX-R1 the back link's arrow sits in its own <i aria-hidden=\"true\"> so it can take the accent colour", () => {
    const back = /<a[^>]*aria-label="Chase Holroyd, back to the portfolio"[^>]*>([\s\S]*?)<\/a>/.exec(header);
    expect(back, "back link with aria-label").not.toBeNull();
    expect(back![1], "arrow wrapped in <i aria-hidden>").toMatch(/<i\b[^>]*\saria-hidden="true"[^>]*>\s*(←|&larr;)\s*<\/i>/);
    expect(text(back![1]!)).toBe("← Chase Holroyd");
  });

  it("SITEHDR QA-R1 the built playground page stays under the 150,000-byte budget (scripts/check-live.ts MAX_BYTES)", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(150_000);
  });
});
