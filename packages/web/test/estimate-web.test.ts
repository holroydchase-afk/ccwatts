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

  it("EST-16 the box doesn't write the count into the URL", () => {
    expect(app).not.toMatch(/history\.(push|replace)State|location\.(hash|search)\s*=/);
  });
});

describe("EST-20 UX-R30 the What if box folds away on phones", () => {
  it("EST-20 UX-R30 the cache-read slider sits in a <details> summarised \"What if cache reads cost more or less?\"", () => {
    const details = [...html.matchAll(/<details[^>]*>[\s\S]*?<\/details>/g)].map((m) => m[0]).find((d) => d.includes('id="whatif-cache"')) ?? "";
    expect(details).not.toBe("");
    expect(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(details)?.[1]?.replace(/<[^>]+>/g, "").trim()).toBe("What if cache reads cost more or less?");
    expect(details).not.toMatch(/<details[^>]*\sopen[\s>=]/); // closed in the HTML; the script opens it on wide screens
  });
});
