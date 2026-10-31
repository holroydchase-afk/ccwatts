import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultParams,
  estimate,
  linkedInPost,
  receiptSvg,
  rollupRecords,
  samplePaceDays,
  shareLine,
  type PaceDay,
} from "@ccwatts/core";
import { DATA_MARKER, injectData, readSample, type PagePayload } from "../src/inject.js";

// CCW-M4.5: a Pace section on the web page (one page, two modes). Synthetic data only.
// API choices pinned here (for the engineer):
//  - PagePayload gains `pace?: PaceDay[]`; injectData keeps only PaceDay keys for it (drops any
//    zone, timestamps or other fields a caller might pass by mistake).
//  - The playground build embeds sample pace at build time in
//    <script id="ccwatts-sample-pace" type="application/json">: samplePaceDays(<last sample date>).
//  - The section is <section id="pace"> with a SAMPLE pill #pace-pill (class "pill sample"),
//    and an opt-in note #pace-optin that names `ccwatts pace` (shown in dashboard mode with no pace).
//  - read.ts: readLogFiles(files, timeZone?) and readPaste(text, timeZone?) add `pace: PaceDay[]`
//    to an ok result when a zone is given (claudeCodeAdapter.activity + paceDays with
//    defaultPaceOptions(timeZone)). With no zone the result is unchanged (CCW-F8 tests).

const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const template = readFileSync(new URL("../src/template.html", import.meta.url), "utf8");

const PACE_KEYS = ["activeMinutes", "agentMinutes", "date", "firstHour", "lastHour", "lateNightMinutes", "longestStretchMinutes"];
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const BANNED = /burnout|health|score|diagnos/i;

/** The <section id="pace">…</section> block of a page. */
const paceSection = (page: string) => /<section[^>]*id="pace"[^>]*>[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";

describe("CCW-M4.5 payload (PACE-WEB1)", () => {
  const days = samplePaceDays("2026-10-28").slice(-3);

  it("PACE-WEB1 PagePayload carries pace days and injectData embeds them", () => {
    const payload: PagePayload = { mode: "dashboard", generatedAt: "2026-10-28T00:00:00Z", rows: [], pace: days };
    const slot = JSON.parse(DATA_MARKER.exec(injectData(html, payload))?.[2] ?? "{}");
    expect(slot.pace).toEqual(days);
  });

  it("PACE-WEB1 injectData keeps only PaceDay keys: no zone, no times of day", () => {
    const leaky = days.map((d) => ({ ...d, timeZone: "Europe/London", zone: "Europe/London", start: "2026-10-28T09:14:00.000Z", blocks: [{ start: "2026-10-28T09:14:00Z", end: "2026-10-28T10:00:00Z" }] }));
    const out = injectData(html, { mode: "dashboard", generatedAt: null, rows: [], pace: leaky as unknown as PaceDay[] });
    const slot = DATA_MARKER.exec(out)?.[2] ?? "";
    const pace = JSON.parse(slot).pace as Record<string, unknown>[];
    expect(pace).toHaveLength(days.length);
    for (const d of pace) expect(Object.keys(d).sort()).toEqual(PACE_KEYS);
    expect(slot).not.toMatch(/Europe\/London|timeZone|"zone"/);
    expect(slot).not.toMatch(ISO_TIME);
  });
});

describe("CCW-M4.5 playground build (PACE-WEB2)", () => {
  const json = /<script id="ccwatts-sample-pace" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];

  it("PACE-WEB2 has a Pace section with a SAMPLE pill", () => {
    const section = paceSection(html);
    expect(section, "no <section id=\"pace\">").not.toBe("");
    expect(section).toMatch(/<h2[^>]*>Pace<\/h2>/);
    expect(section).toContain("Your work rhythm · opt-in · stays local"); // UX-R44
    expect(section).not.toContain("stays on your device");
    expect(section).toMatch(/<[a-z]+[^>]*id="pace-pill"[^>]*class="[^"]*pill sample[^"]*"|<[a-z]+[^>]*class="[^"]*pill sample[^"]*"[^>]*id="pace-pill"/);
  });

  it("PACE-WEB2 embeds the synthetic sample pace, ending on the energy sample's last day", () => {
    expect(json, "no #ccwatts-sample-pace script").toBeDefined();
    const pace = JSON.parse(json!) as PaceDay[];
    const last = readSample(html).map((r) => r.date).sort().at(-1)!;
    expect(pace).toEqual(samplePaceDays(last));
    expect(json).not.toMatch(ISO_TIME);
  });

  it("PACE-WEB2 uses the CLI's words: range lead, agent-only, days off, gaps and method in the footnote", () => {
    const g = defaultParams.pace.gap_minutes;
    expect(html).toContain("active hours (range ");
    expect(html).toContain("hours on their own.");
    expect(html).toContain("Agents worked another ");
    expect(html).toMatch(/Days off|days off/);
    expect(html).toContain("Agent-only");
    expect(html).toContain(`under ${g.low}/${g.value}/${g.high} min (low/central/high)`);
    expect(html).toContain("Heuristic, not a measurement");
    expect(html).not.toMatch(/rest days?\b/i);
  });

  it("PACE-WEB2 the chart is accessible: role=img with a label, and a visually hidden table", () => {
    const section = paceSection(html);
    expect(section).toMatch(/id="pace-chart"[^>]*role="img"|role="img"[^>]*id="pace-chart"/);
    expect(section).toMatch(/<table[^>]*class="vh"[^>]*id="pace-table"|<table[^>]*id="pace-table"[^>]*class="vh"/);
  });
  it("PACE-WEB7 (UX-R5 budget) the Pace body folds into a <details> on phones and opens on wide screens", () => {
    const section = paceSection(html);
    const more = /<details[^>]*id="pace-more"[^>]*>([\s\S]*?)<\/details>/.exec(section)?.[1] ?? "";
    expect(more).toMatch(/<summary[^>]*>[^<]*chart/i);
    for (const id of ["pace-lead", "pace-legend", "pace-chart", "pace-table", "pace-foot"]) expect(more).toContain(`id="${id}"`);
    expect(app).toMatch(/matchMedia\("\(min-width: 720px\)"\)\.matches\)[^;]*pace-more"\)\.open = true/);
  });
});

describe("CCW-M4.5 opt-in note (PACE-WEB3, page side)", () => {
  it("PACE-WEB3 the page carries the opt-in note naming `ccwatts pace`", () => {
    const section = paceSection(html);
    expect(section).toMatch(/id="pace-optin"[^>]*>[\s\S]*ccwatts pace/);
  });
});

describe("CCW-M4.5 share outputs never include pace (PACE-WEB4)", () => {
  const rows = readSample(html);

  it("PACE-WEB4 share line, post and card carry no pace, even if pace is passed along", () => {
    const e = estimate(rollupRecords(rows), defaultParams);
    const input = { estimate: e, params: defaultParams, windowLabel: "last 30 days", sample: true, pace: samplePaceDays("2026-10-28") };
    for (const out of [shareLine(input), linkedInPost(input), receiptSvg(input)]) {
      expect(out).not.toMatch(/\bpace\b|active hours|on their own|past 10pm|days off/i);
    }
  });

  it("PACE-WEB4 app.ts builds share outputs without touching pace", () => {
    const body = /function renderShare\([\s\S]*?\n\}/.exec(app)?.[0] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toMatch(/pace/i);
    // The section exists (so this guard is about real code, not an empty page).
    expect(app).toMatch(/pace/i);
  });
});

describe("CCW-M4.5 no diagnosis words (PACE-WEB5)", () => {
  it("PACE-WEB5 the Pace section, its script and the built page say no burnout/health/score/diagnos", () => {
    const section = paceSection(template);
    expect(section, "no <section id=\"pace\"> in template.html").not.toBe("");
    expect(section).not.toMatch(BANNED);
    expect(app).not.toMatch(BANNED);
    expect(html).not.toMatch(BANNED);
  });
});

// ---------------------------------------------------------------------------------------------
// PACE-WEB6: dropped files and pasted lines also give pace days, counted in the zone the page
// passes in (the browser's, via Intl, in app.ts). Nothing leaves the browser.
// ---------------------------------------------------------------------------------------------
type LogFile = { name: string; text(): Promise<string> };
type ReadOk = { ok: true; texts: string[]; what: string; pace?: PaceDay[] };
type ReadResult = ReadOk | { ok: false; status: string };
const load = async () =>
  (await import("../src/read.js" as string)) as {
    readLogFiles: (files: Iterable<LogFile>, timeZone?: string) => Promise<ReadResult>;
    readPaste: (text: string, timeZone?: string) => ReadResult;
  };

/** A typed turn at 23:00Z, then replies every 5 minutes to 23:30Z on Oct 20. Empty content, made-up path. */
function syntheticLog(): string {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 23, m)).toISOString();
  const lines = [JSON.stringify({ type: "user", timestamp: at(0), cwd: "/home/dev/code/alpha", message: { role: "user", content: "" } })];
  for (let i = 1; i <= 6; i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: at(i * 5),
        cwd: "/home/dev/code/alpha",
        requestId: `req_W${i}`,
        message: { id: `msg_W${i}`, model: "claude-opus-4-6", role: "assistant", content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 500, output_tokens: 20 } },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

describe("CCW-M4.5 dropped files give pace too (PACE-WEB6)", () => {
  const file = (name: string, text: string): LogFile => ({ name, text: async () => text });

  it("PACE-WEB6 readLogFiles with a zone returns pace days counted in that zone", async () => {
    const { readLogFiles } = await load();
    const tokyo = await readLogFiles([file("a.jsonl", syntheticLog())], "Asia/Tokyo");
    const ny = await readLogFiles([file("a.jsonl", syntheticLog())], "America/New_York");
    expect(tokyo.ok && ny.ok).toBe(true);
    if (!tokyo.ok || !ny.ok) return;
    expect(tokyo.pace?.map((d) => d.date)).toEqual(["2026-10-21"]);
    expect(ny.pace?.map((d) => d.date)).toEqual(["2026-10-20"]);
    expect(tokyo.pace![0]!.activeMinutes.central).toBe(30);
    expect(tokyo.pace![0]!.firstHour).toBe(8);
    expect(ny.pace![0]!.firstHour).toBe(19);
  });

  it("PACE-WEB6 pace from files holds PaceDay keys only: no zone, no times", async () => {
    const { readLogFiles } = await load();
    const r = await readLogFiles([file("a.jsonl", syntheticLog())], "Asia/Tokyo");
    if (!r.ok) throw new Error(r.status);
    expect(r.pace).toBeDefined();
    for (const d of r.pace!) expect(Object.keys(d).sort()).toEqual(PACE_KEYS);
    expect(JSON.stringify(r.pace)).not.toMatch(ISO_TIME);
    expect(JSON.stringify(r.pace)).not.toContain("Tokyo");
  });

  it("PACE-WEB6 pasted lines give pace days too", async () => {
    const { readPaste } = await load();
    const r = readPaste(syntheticLog(), "UTC");
    if (!r.ok) throw new Error(r.status);
    expect(r.pace?.map((d) => d.date)).toEqual(["2026-10-20"]);
  });

  it("PACE-WEB6 with no zone the result is unchanged (no pace key)", async () => {
    const { readLogFiles } = await load();
    const r = await readLogFiles([file("a.jsonl", syntheticLog())]);
    if (!r.ok) throw new Error(r.status);
    expect("pace" in r).toBe(false);
  });

  it("PACE-WEB6 app.ts passes the browser's zone to the reader", () => {
    expect(app).toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  });
});

// ---------------------------------------------------------------------------------------------
// M4.5 review fixes: UX-R40..R44 (copy, chart) and PS-R12/R13 (notes when pace is left out).
// The page has no DOM test harness, so these pin the built page and app.ts source.
// ---------------------------------------------------------------------------------------------
describe("CCW-M4.5 lead and second line (UX-R40, UX-R41)", () => {
  it("UX-R40 the page has a quieter 'so far' line between the lead and the agents line", () => {
    const section = paceSection(template);
    const lead = section.indexOf('id="pace-lead"');
    const soFar = section.indexOf('id="pace-sofar"');
    const agents = section.indexOf('id="pace-agents"');
    expect(soFar, "no #pace-sofar").toBeGreaterThan(lead);
    expect(agents).toBeGreaterThan(soFar);
    expect(template).toMatch(/\.pace-sofar[^{]*\{[^}]*color:var\(--muted\)/);
  });

  it("UX-R40/R41 app.ts takes the lead from core's paceLead (same words as the CLI)", () => {
    expect(app).toMatch(/paceLead\(/);
    expect(app).not.toMatch(/paceWeekLine\(/);
    expect(app).toMatch(/\$\("pace-sofar"\)/);
    expect(html).toContain("This week so far: ");
    expect(html).toContain("Week of ");
    expect(html).toContain(" hours in ");
  });

  it("UX-R40 the partial week's bars are drawn at 0.5 fill opacity", () => {
    expect(app).toMatch(/daysCounted < 7/);
    expect(app).toMatch(/fill-opacity="0\.5"/);
    expect(template).toMatch(/\.pace \.agent\.partial\{[^}]*fill-opacity:calc\(var\(--agent-op\) \* 0\.5\)/);
  });
});

describe("CCW-M4.5 footnote, axis, eyebrow (UX-R42, UX-R43, UX-R44)", () => {
  it("UX-R42 the footnote says 'the longest stretch'", () => {
    expect(paceSection(html)).toContain("Past 10pm and the longest stretch use the 20-min gap.");
  });
  it("UX-R43 the axis caption says when a week starts", () => {
    expect(app).toContain(">hours per week, starting Monday</text>");
  });
});

describe("CCW-M4.5 notes when pace is left out (PS-R12, PS-R13)", () => {
  it("PS-R12 the page has a note for pace skipped with --path or --no-history", () => {
    expect(paceSection(html)).toMatch(/<p[^>]*id="pace-skipped"[^>]*hidden[^>]*>[^<]*skipped with --path or --no-history/);
  });
  it("PS-R13 the page has a note for an unreadable pace.jsonl, and app.ts picks notes from payload.paceOff", () => {
    expect(paceSection(html)).toMatch(/<p[^>]*id="pace-unreadable"[^>]*hidden[^>]*>[^<]*Couldn.t read/);
    expect(app).toMatch(/paceOff/);
  });
  it("PS-R13 PagePayload carries paceOff through injectData", () => {
    const payload = { mode: "dashboard", generatedAt: null, rows: [], paceOff: "skipped" } as PagePayload;
    const slot = JSON.parse(DATA_MARKER.exec(injectData(html, payload))?.[2] ?? "{}");
    expect(slot.paceOff).toBe("skipped");
    expect(slot.pace).toBeUndefined();
  });
});
