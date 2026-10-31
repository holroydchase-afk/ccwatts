import type { PaceDay, PaceRange, RollupRow } from "@ccwatts/core";

export interface PagePayload {
  mode: "dashboard" | "playground";
  /** ISO timestamp the page was written, or null for the hosted playground. */
  generatedAt: string | null;
  rows: RollupRow[];
  /**
   * Daily pace counts (dashboard only, and only when the user opted in with `ccwatts pace`).
   * Absent means pace is off. Never a zone or a time of day: injectData keeps PaceDay keys only.
   */
  pace?: PaceDay[];
  /** Why pace is left out though pace.jsonl exists: skipped for --path/--no-history, or unreadable (PS-R12/R13). */
  paceOff?: "skipped" | "unreadable";
}

const range = (r: PaceRange): PaceRange => ({ low: r.low, central: r.central, high: r.high });
const hour = (h: number | null) => (typeof h === "number" ? h : null);

/** Only the PaceDay fields, so a caller can't leak a zone, timestamps or blocks into the page by mistake. */
export function paceDayOnly(d: PaceDay): PaceDay {
  return {
    date: String(d.date).slice(0, 10),
    activeMinutes: range(d.activeMinutes),
    agentMinutes: range(d.agentMinutes),
    lateNightMinutes: d.lateNightMinutes,
    longestStretchMinutes: d.longestStretchMinutes,
    firstHour: hour(d.firstHour),
    lastHour: hour(d.lastHour),
  };
}

export const DATA_MARKER = /(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/;

/** JSON that is safe inside a <script> element: no "</script>" or "<!--" can close it early. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Embeds the user's rollups into the built page. Pure: string in, string out. */
export function injectData(html: string, payload: PagePayload): string {
  if (!DATA_MARKER.test(html)) throw new Error("Dashboard template is missing its data slot.");
  const { pace, ...rest } = payload;
  const data: PagePayload = pace ? { ...rest, pace: pace.map(paceDayOnly) } : rest;
  return html.replace(DATA_MARKER, (_m, open: string, _old: string, close: string) => `${open}${safeJson(data)}${close}`);
}

const SAMPLE_MARKER = /<script id="ccwatts-sample" type="application\/json">([\s\S]*?)<\/script>/;

/** The synthetic sample rollups the page ships with (built from fixtures/claude-code/demo.jsonl). */
export function readSample(html: string): RollupRow[] {
  const json = SAMPLE_MARKER.exec(html)?.[1];
  if (!json) throw new Error("Page is missing its sample data.");
  return JSON.parse(json) as RollupRow[];
}
