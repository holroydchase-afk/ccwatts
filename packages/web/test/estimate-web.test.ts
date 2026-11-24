import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// EST-14..16: the playground's "Have a token count?" box. Static checks on the built page; the
// typing behavior (88.8M shows a kWh range, bad input shows the hint, no network, nothing stored,
// nothing in the URL) is checked in a real browser by scripts/check-no-network.ts (npm run check:browser).
const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

/** Visible text of the <label for=id>, or "" when the control has no label. */
const labelFor = (id: string) => (new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();

/** The section that holds the "Have a token count?" heading. */
const section = /<section[^>]*>(?:(?!<\/section>)[\s\S])*?<h[23][^>]*>\s*Have a token count\?\s*<\/h[23]>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("EST-14 token-count box on the playground", () => {
  it("EST-14 has a section headed \"Have a token count?\"", () => {
    expect(section).not.toBe("");
  });

  it("EST-14 has a labeled text input with placeholder 88.8M", () => {
    const input = /<input[^>]*placeholder="88\.8M"[^>]*>/.exec(section)?.[0] ?? "";
    expect(input).not.toBe("");
    expect(input).not.toMatch(/type="(number|range|hidden)"/);
    const id = /id="([^"]+)"/.exec(input)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(labelFor(id)).toMatch(/token/i);
  });

  it("EST-14 has a labeled model select: Opus, Sonnet, Haiku, Opus by default", () => {
    const select = /<select[^>]*>[\s\S]*?<\/select>/.exec(section)?.[0] ?? "";
    expect(select).not.toBe("");
    const id = /<select[^>]*id="([^"]+)"/.exec(select)?.[1] ?? "";
    expect(labelFor(id)).toMatch(/model/i);
    const options = [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1].trim());
    expect(options).toEqual(["Opus", "Sonnet", "Haiku"]);
    const selected = /<option[^>]*selected[^>]*>([^<]*)</.exec(select)?.[1]?.trim();
    expect(selected ?? options[0]).toBe("Opus");
  });

  it("EST-14 has a polite live region for the result, so screen readers hear the update", () => {
    expect(section).toMatch(/role="status"|aria-live="polite"|<output[\s>]/);
  });

  it("EST-14 shows the hint copy under it", () => {
    expect(section).toContain("For a cloud thread or chat that shows a token total. Local Claude Code logs give a tighter range.");
  });
});

describe("EST-15 the box uses the core estimate and the same copy", () => {
  it("EST-15 calls estimateFromTotal and parseTokenCount from core", () => {
    expect(app).toMatch(/estimateFromTotal\(/);
    expect(app).toMatch(/parseTokenCount\(/);
  });

  it("EST-15 has the invalid-input hint and the assumed-mix label", () => {
    expect(html).toContain("Couldn't read that as a token count. Try 88.8M, 1.2k or 88800000."); // UX-R33
    expect(html).toContain("typical Claude Code mix assumed");
    expect(html).toContain("Wide range: the mix of token types is guessed."); // UX-R28
  });
});

describe("EST-16 no network, nothing stored, nothing in the URL", () => {
  it("EST-16 the page still ships no request APIs and no storage", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
      expect(html, api).not.toContain(api);
    }
  });

  // The STUDIO-DS tabs (PR #102) write the tab's hash, so this looks only at the box's own code;
  // check:browser EST-17 also asserts the URL doesn't change while typing a count.
  it("EST-16 the box doesn't write the count into the URL", () => {
    const start = app.indexOf("function renderManual(");
    expect(start).toBeGreaterThan(-1);
    const body = app.slice(start, app.indexOf("\n}\n", start));
    expect(body).not.toMatch(/history\.|location\.|\.hash\b|selectTab\(/);
    const wiring = app.split("\n").filter((l) => l.includes("manual-")).join("\n");
    expect(wiring).not.toMatch(/history\.|location\./);
  });
});

// EST-20 (UX-R30) was a phone <details> fold for What if, to keep the one long page short. The
// STUDIO-DS tabs (PR #102) retired that: What if and the token box live in the Electricity tab, so
// neither adds to the Overview, and UX-R5 in check:browser still caps the phone page height.
describe("EST-20 What if and the token box sit in the Electricity tab, not the Overview", () => {
  const panel = (id: string) => {
    const start = html.indexOf(`<section id="${id}" role="tabpanel"`);
    const next = html.indexOf('role="tabpanel"', start + 30);
    return start < 0 ? "" : html.slice(start, next < 0 ? undefined : html.lastIndexOf("<section", next));
  };
  it("EST-20 the cache-read slider and the \"Have a token count?\" section are in #p-electricity", () => {
    const electricity = panel("p-electricity");
    expect(electricity).toContain('id="whatif-cache"');
    expect(electricity).toMatch(/<h2[^>]*>\s*Have a token count\?\s*<\/h2>/);
  });
  // The Overview may name the box in prose (SPEC-CLOUDP's fallback line in #drop points to it);
  // what must not be there is the slider, the box's section or its heading.
  it("EST-20 neither is in the Overview panel", () => {
    const overview = panel("p-overview");
    expect(overview).not.toBe("");
    expect(overview).not.toContain('id="whatif-cache"');
    expect(overview).not.toMatch(/id="(manual|manual-h|manual-tokens)"/);
    expect(overview).not.toMatch(/<h[1-6][^>]*>\s*Have a token count\?\s*<\/h[1-6]>/);
  });
});

// EST-21..23: ux-reviewer fixes on the Electricity tab's What if + "Have a token count?" pair
// (Nov 22, at 1280px). The 1280px alignment and computed sizes are checked in a real browser by
// check:browser EST-24 (scripts/check-no-network.ts).
describe("EST-21 UX-R65 What if gets its own h2, matching the token box", () => {
  const whatif = /<div class="whatif" id="whatif">[\s\S]*?<section class="manual"/.exec(html)?.[0] ?? "";
  it("EST-21 UX-R65 the What if column starts with <h2>What if?</h2>, before the slider", () => {
    expect(whatif).not.toBe("");
    const h2 = /<h2[^>]*>\s*What if\?\s*<\/h2>/.exec(whatif);
    expect(h2, "<h2>What if?</h2> inside #whatif").not.toBeNull();
    expect(h2!.index, "h2 comes before the slider").toBeLessThan(whatif.indexOf('id="whatif-cache"'));
    expect(h2!.index, "h2 comes before the slider label").toBeLessThan(whatif.indexOf('<label for="whatif-cache"'));
  });
  it("EST-21 UX-R65 the slider label reads \"Cache-read cost\" (the \"What if?\" moved to the h2)", () => {
    expect(labelFor("whatif-cache")).toBe("Cache-read cost");
    expect(html).not.toContain("What if? Cache-read cost");
  });
});

describe("EST-22 UX-R66 the hint sits right under the box's heading", () => {
  it("EST-22 UX-R66 #manual-hint comes directly after the \"Have a token count?\" h2, before the inputs", () => {
    const after = /<h2[^>]*>\s*Have a token count\?\s*<\/h2>\s*(<[^>]+>)/.exec(section)?.[1] ?? "";
    expect(after, "first element after the h2").toMatch(/id="manual-hint"/);
    expect(section.indexOf('id="manual-hint"')).toBeLessThan(section.indexOf('id="manual-tokens"'));
  });
});

describe("EST-23 UX-R67 the result wraps evenly", () => {
  it("EST-23 UX-R67 .manual-result has text-wrap: pretty", () => {
    expect(html).toMatch(/\.manual-result\s*\{[^}]*text-wrap\s*:\s*pretty/);
  });
});
