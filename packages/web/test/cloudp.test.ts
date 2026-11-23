import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SPEC-CLOUDP: a prompt for Claude Code on the web, in Your logs (#drop). Static checks on the
// template, the built page and the README. Visual order, open/closed per width, the reading font,
// 320px, light/dark and the "Copied" button state are checked in a real browser by
// scripts/check-no-network.ts (npm run check:browser), block "CLOUDP-1/5/6/7".
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");
const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** The Your logs section of the built page. */
const drop = /<section[^>]*id="drop"[^>]*>[\s\S]*?<div class="status" id="drop-status"/.exec(html)?.[0] ?? "";
/** The new disclosure, <details id="cloud"> … </details> (no nested details inside it). */
const cloudIn = (src: string) => /<details[^>]*id="cloud"[^>]*>[\s\S]*?<\/details>/.exec(src)?.[0] ?? "";
const cloud = cloudIn(drop);
/** The prompt's text exactly as the page holds it (the element's content, entities decoded). */
const promptIn = (src: string) => {
  const m = /<(\w+)[^>]*id="cloud-prompt"[^>]*>([\s\S]*?)<\/\1>/.exec(src);
  return m ? decode(m[2].replace(/<[^>]+>/g, "")) : "";
};
const prompt = promptIn(html);
/** The README's fenced code block that holds the prompt. */
const readmePrompt = [...readme.matchAll(/^```[^\n]*\n([\s\S]*?)\n```$/gm)].map((m) => m[1]).find((b) => b.startsWith("Estimate the electricity this Claude Code session")) ?? "";

const SUMMARY = "Use Claude Code on the web? Ask it.";
const INTRO = "Paste this into a Claude Code session at claude.ai/code. Claude runs ccwatts there and replies with that session's electricity, from token counts only. Each web session keeps only its own log. Plain claude.ai chats keep none; use the token count box instead.";
const FALLBACK = "Claude says npm is blocked? Some sessions can't download tools. If your app shows a token total for the session, type it in the \"Have a token count?\" box on this page. Otherwise, run the prompt on a computer with Claude Code.";
const PHONE = "On a phone? Your logs live where Claude Code runs. Use the prompt below in Claude Code on the web.";
const PROMPT = `Estimate the electricity this Claude Code session has used, with ccwatts.

1. Run: npx -y ccwatts@latest
2. Reply in three short lines: the energy range exactly as ccwatts shows it, the method version, and the one comparison it prints.
3. If I ask for a breakdown, run: npx -y ccwatts@latest --by day

Rules: ccwatts reads token counts only. Don't open, read, search or quote the log files or anything from our conversation yourself. Use only what ccwatts prints. If the command fails, tell me the error in one line. Don't guess a number.`;
const README_LINE = "Using Claude Code on the web? Paste this prompt into a session, and Claude runs `npx -y ccwatts@latest` there and replies with that session's range. It counts tokens only, and only that session.";

describe("CLOUDP-1 Your logs has a Claude Code on the web disclosure", () => {
  it("CLOUDP-1 #drop holds <details id=\"cloud\">", () => {
    expect(drop).not.toBe("");
    expect(cloud).not.toBe("");
  });

  it(`CLOUDP-1 its summary reads "${SUMMARY}"`, () => {
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(cloud)?.[1] ?? "";
    expect(text(summary)).toBe(SUMMARY);
  });

  it("CLOUDP-1 it holds the intro, the prompt in #cloud-prompt, a Copy prompt button #copy-cloud and the fallback line", () => {
    expect(text(cloud)).toContain(INTRO);
    expect(cloud).toMatch(/id="cloud-prompt"/);
    const btn = /<button[^>]*id="copy-cloud"[^>]*>([\s\S]*?)<\/button>/.exec(cloud);
    expect(btn).not.toBeNull();
    expect(btn?.[0]).toMatch(/type="button"/);
    expect(text(btn?.[1] ?? "")).toBe("Copy prompt");
    expect(text(cloud)).toContain(FALLBACK);
  });

  it("CLOUDP-1 the fallback line comes after the Copy button", () => {
    const b = cloud.indexOf('id="copy-cloud"');
    const f = text(cloud.slice(b)).indexOf("Claude says npm is blocked?");
    expect(b).toBeGreaterThan(-1);
    expect(f).toBeGreaterThan(-1);
  });

  it("CLOUDP-1 the phone hint is replaced with the new copy", () => {
    const hint = /<p[^>]*id="phone-hint"[^>]*>([\s\S]*?)<\/p>/.exec(drop)?.[1] ?? "";
    expect(text(hint)).toBe(PHONE);
  });
});

describe("CLOUDP-2 the prompt runs ccwatts and never reads content itself", () => {
  it("CLOUDP-2 the prompt is the spec's text", () => {
    expect(prompt).toBe(PROMPT);
  });

  it("CLOUDP-2 has the pinned command and the rules", () => {
    for (const want of ["npx -y ccwatts@latest", "Reply in three short lines", "Don't open, read, search or quote", "Don't guess a number"]) {
      expect(prompt, want).toContain(want);
    }
  });

  it("CLOUDP-2 has no network or raw-log wording", () => {
    expect(prompt).not.toBe("");
    for (const bad of ["curl", "http", "upload", "message.usage", "Read every .jsonl"]) {
      expect(prompt.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
  });
});

describe("CLOUDP-3 README and the page share the prompt byte for byte", () => {
  it("CLOUDP-3 README has the intro line and the prompt in a code block", () => {
    expect(readme).toContain(README_LINE);
    expect(readmePrompt).not.toBe("");
  });

  it("CLOUDP-3 the README prompt and the template prompt are byte-identical", () => {
    const fromTemplate = promptIn(template);
    expect(fromTemplate).not.toBe("");
    expect(Buffer.from(readmePrompt, "utf8").equals(Buffer.from(fromTemplate, "utf8"))).toBe(true);
    expect(fromTemplate).toBe(readmePrompt);
  });
});

describe("CLOUDP-4 the intro says what a web session can and can't count", () => {
  it("CLOUDP-4 the intro mentions \"only its own log\" and the \"token count box\"", () => {
    const intro = text(cloud.slice(cloud.indexOf("</summary>"), cloud.indexOf('id="cloud-prompt"')));
    expect(intro).toContain("only its own log");
    expect(intro).toContain("token count box");
  });
});

describe("CLOUDP-5 the old disclosure is the desktop fallback", () => {
  it("CLOUDP-5 #export's summary reads \"Can't find the folder?\"", () => {
    const exp = /<details[^>]*id="export"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/.exec(drop)?.[1] ?? "";
    expect(text(exp)).toBe("Can't find the folder?");
  });

  it("CLOUDP-5 the old export prompt is kept", () => {
    expect(drop).toMatch(/id="export-prompt"/);
    expect(drop).toMatch(/id="copy-prompt"/);
  });
});

describe("CLOUDP-7 no em-dash in any new string", () => {
  it("CLOUDP-7 the disclosure, the phone hint and the README line have no em-dash", () => {
    expect(cloud).not.toBe("");
    expect(text(cloud)).not.toContain("—");
    expect(text(/<p[^>]*id="phone-hint"[^>]*>([\s\S]*?)<\/p>/.exec(drop)?.[1] ?? "")).not.toContain("—");
    const at = readme.indexOf("Using Claude Code on the web?");
    expect(at).toBeGreaterThan(-1);
    expect(readme.slice(at, readme.indexOf("```", at))).not.toContain("—");
    expect(readmePrompt).not.toContain("—");
  });

  it("CLOUDP-7 the page still ships no request APIs and no storage", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
      expect(html, api).not.toContain(api);
    }
  });
});

describe("CLOUDP-9 the fallback line uses plain spaces", () => {
  // A non-breaking space (U+00A0, or &nbsp; / &#160; / &#xA0;) reads oddly to screen readers and
  // pastes as a non-space. text() folds it into \s, so check the raw markup of the line.
  const NBSP = / |&nbsp;|&#160;|&#x0*a0;/i;
  const fallbackIn = (src: string) => /<p[^>]*>\s*Claude says npm is blocked\?[\s\S]*?<\/p>/.exec(cloudIn(src))?.[0] ?? "";
  it("CLOUDP-9 the fallback line in #drop has no non-breaking space (template and built page)", () => {
    for (const [name, src] of [["template", template], ["built page", drop]] as const) {
      const line = fallbackIn(src);
      expect(line, `${name}: fallback line found`).not.toBe("");
      expect(NBSP.exec(line)?.index, `${name}: U+00A0 in the fallback line`).toBeUndefined();
    }
  });
});
