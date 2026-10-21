import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultParams, rollup, claudeCodeAdapter } from "@ccwatts/core";
import { DATA_MARKER, injectData, safeJson } from "../src/inject.js";

// Built by `npm test` (node packages/web/build.mjs) before vitest runs.
const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

describe("playground page: no network", () => {
  it("has a CSP that blocks every request type by default", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/connect-src|https?:/);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  });

  it("ships no code that can make a request", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts", "navigator.serviceWorker"]) {
      expect(html, api).not.toContain(api);
    }
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)="https?:/);
  });

  it("says so on the page", () => {
    expect(html).toContain("Your logs never leave this browser.");
  });

  it("embeds sample rollups (counts only) and the current method version", () => {
    expect(html).toContain('id="ccwatts-sample"');
    expect(html).not.toContain("/home/demo");
    expect(html.includes(`version:"${defaultParams.version}"`) || html.includes(`"version":"${defaultParams.version}"`)).toBe(true);
  });
});

describe("injectData", () => {
  it("replaces the data slot and can't be broken out of", () => {
    const rows = rollup(claudeCodeAdapter.parse(readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8")));
    rows[0]!.projectName = "</script><script>alert(1)</script>";
    const out = injectData(html, { mode: "dashboard", generatedAt: "2026-10-21T00:00:00Z", rows });
    const slot = DATA_MARKER.exec(out)?.[2] ?? "";
    expect(slot).not.toContain("</script>");
    expect(JSON.parse(slot).rows[0].projectName).toBe(rows[0]!.projectName);
    expect(safeJson("<!--")).toBe('"\\u003c!--"');
  });
});
