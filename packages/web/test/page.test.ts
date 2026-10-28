import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, defaultParams, rollup, claudeCodeAdapter, PLAYGROUND_URL, PORTFOLIO_URL } from "@ccwatts/core";
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

describe("link preview", () => {
  it("points crawlers at the hosted image, and the page itself loads nothing", () => {
    expect(html).toContain(`<meta property="og:image" content="${PLAYGROUND_URL}og.png">`);
    expect(html).not.toContain("__PLAYGROUND_URL__");
    // The only absolute URLs outside the script are in meta tags, which browsers don't fetch.
    const outsideMeta = html.replace(/<meta [^>]*>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    expect(outsideMeta).not.toMatch(/https?:\/\//);
  });
});

describe("first screen (recruiter-ready RR-1, RR-3)", () => {
  it("says what ccwatts is in one heading and a plain lede", () => {
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html.match(/<main[ >]/g)?.length).toBe(1);
    expect(html).toContain("How much electricity does your AI coding use?");
    expect(html).toMatch(/id="lede"[^>]*>[^<]*AI coding agent/);
  });

  it("links back to the portfolio, from the header and the footer", () => {
    expect(PORTFOLIO_URL).toBe("https://chaseholroyd.com/ccwatts.html");
    expect(html).toContain('id="back-link"');
    expect(html).toContain('id="built-by"');
    // The href is set by the script (like the repo link), so the page source holds no absolute URLs outside meta tags.
    expect(html).toContain(PORTFOLIO_URL);
  });
});

describe("CLI on npm (recruiter-ready RR-22)", () => {
  it("tells visitors the same tool runs in a terminal with npx", () => {
    expect(html).toMatch(/id="cli-line"[^>]*>[^<]*Prefer the terminal\?/);
    expect(html).toContain('id="cli-cmd"');
    expect(html).toContain("`npx ${");
    expect(html).toContain("Node 20+");
  });
});

describe("accessibility (recruiter-ready RR-5, RR-6, RR-9, RR-12)", () => {
  it("keeps the file pickers in the tab order (visually hidden, not hidden)", () => {
    for (const id of ["pick-folder", "pick-files"]) {
      const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(tag, id).not.toMatch(/\shidden[\s>]/);
      expect(tag, id).toContain('class="vh"');
    }
  });

  it("gives buttons a 44px minimum height and the sample pill readable amber", () => {
    expect(html).toMatch(/button,\.btn\{[^}]*min-height:44px/);
    expect(html).toContain(".pill.sample{border-color:var(--sample);color:var(--sample)}");
    expect(html).toContain("--sample:#8a5a12");
  });
});

describe("method labels explained (recruiter-ready RR-18)", () => {
  it("says what MODELED and GUESS mean", () => {
    expect(html).toContain("MODELED is derived from published figures");
    expect(html).toContain("GUESS is a best estimate with wide bounds");
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

describe("export prompt for Claude Code on the web", () => {
  const prompt = /<pre[^>]*id="export-prompt"[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "";

  it("asks for counts only, with no content and no full paths", () => {
    expect(prompt).toContain("Leave out everything else, especially message content");
    expect(prompt).toContain("never the full path");
    for (const field of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens", "message.id", "requestId"]) {
      expect(prompt, field).toContain(field);
    }
  });

  it("gives a copy button and a paste box", () => {
    expect(html).toContain('id="copy-prompt"');
    expect(html).toMatch(/<textarea[^>]*id="paste-log"/);
    expect(html).toContain('id="read-paste"');
  });

  it("produces lines the adapter reads, even pasted inside a code fence", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-22T18:26:13.104Z",
      requestId: "req_1",
      cwd: "ccwatts",
      message: { id: "msg_1", model: "claude-opus-4-6", usage: { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000, output_tokens: 50 } },
    });
    const records = claudeCodeAdapter.parse(["```json", line, "```"].join("\n"));
    expect(records).toHaveLength(1);
    expect(records[0]!.tokens).toEqual({ input: 2, cacheWrite: 300, cacheRead: 4000, output: 50 });
    expect(records[0]!.project?.name).toBe("ccwatts");
  });
});

// ---------------------------------------------------------------------------------------------
// UI polish (CCW-M2.6.3, docs/reviews/2026-10-28-release-plan.md). Layout and computed-style
// checks that need a real browser (UX-R4 fonts, UX-R5 phone height, UX-R2 error states, the
// one-day span) are in scripts/check-no-network.mjs, run with `npm run check:browser`.
// ---------------------------------------------------------------------------------------------
const tag = (re: RegExp) => re.exec(html)?.[0] ?? "";
const at = (s: string) => html.indexOf(s);

describe("UX-R1 errors are announced where they happen", () => {
  it("UX-R1: #drop-status is a polite live status region", () => {
    const status = tag(/<[a-z]+[^>]*id="drop-status"[^>]*>/);
    expect(status).toContain('role="status"');
    expect(status).toContain('aria-live="polite"');
  });

  it("UX-R1: the hero is not a live region (it re-renders on every toggle)", () => {
    const hero = tag(/<section[^>]*class="hero"[^>]*>/);
    expect(hero).not.toBe("");
    expect(hero).not.toContain("aria-live");
  });
});

describe("UX-R2 error styling", () => {
  it("UX-R2: the page has an .error style and the empty-paste copy", () => {
    expect(html).toMatch(/\.error\{[^}]+\}|\.status\.error\{[^}]+\}/);
    expect(html).toContain("Paste the lines first.");
    expect(html).toContain("We couldn't find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.");
    expect(html).not.toContain("had no Claude Code usage in them");
  });
});

describe("UX-R3 the result stays with its chart", () => {
  it("UX-R3: 'Try it on your own logs' comes after the chart and the By model / By project lists", () => {
    const drop = at('id="drop"');
    expect(drop).toBeGreaterThan(0);
    for (const id of ['id="chart"', 'id="by-model"', 'id="by-project"']) expect(drop, id).toBeGreaterThan(at(id));
  });

  it("UX-R3: the hero links to it with 'Use your own logs'", () => {
    const hero = /<section[^>]*class="hero"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    expect(hero).toMatch(/<a[^>]*href="#drop"[^>]*>\s*Use your own logs\s*<\/a>/);
  });

  it("UX-R3: the 7 days / 30 days / All time toggle is one labeled group", () => {
    const groups = html.match(/<[a-z]+[^>]*role="group"[^>]*>(?:(?!<\/div>)[\s\S])*data-window="7d"/g) ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatch(/aria-label="[^"]+"/);
    for (const w of ["7d", "30d", "all"]) expect(html.match(new RegExp(`data-window="${w}"`, "g"))).toHaveLength(1);
  });
});

describe("UX-R5 method details fold away", () => {
  it("UX-R5: the method parameter table sits inside a <details>", () => {
    const before = html.slice(0, at('id="params"'));
    const opened = (before.match(/<details[ >]/g) ?? []).length;
    const closed = (before.match(/<\/details>/g) ?? []).length;
    expect(opened - closed).toBe(1);
  });
});

describe("UX-R11 one version everywhere", () => {
  it("UX-R11: the footer shows the CLI package version, from the single APP_VERSION constant", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../cli/package.json", import.meta.url), "utf8"));
    expect(APP_VERSION).toBe(pkg.version);
    expect(html).toContain(pkg.version);
    const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(app).toMatch(/footer-version[\s\S]{0,200}APP_VERSION/);
    expect(html).not.toMatch(/v0\.1(?![.\d])/);
  });
});

describe("UX-R13 the Claude Code on the web summary is styled", () => {
  it("UX-R13: its <summary> has a class with a 44px minimum height", () => {
    const m = /<summary class="([\w-]+)[^"]*"[^>]*>\s*Use Claude Code on the web/.exec(html);
    expect(m, "summary has a class").not.toBeNull();
    expect(html).toMatch(new RegExp(`\\.${m![1]}\\{[^}]*min-height:44px`));
  });
});
