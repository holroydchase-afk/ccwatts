import type { RollupRow } from "@ccwatts/core";

export interface PagePayload {
  mode: "dashboard" | "playground";
  /** ISO timestamp the page was written, or null for the hosted playground. */
  generatedAt: string | null;
  rows: RollupRow[];
}

export const DATA_MARKER = /(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/;

/** JSON that is safe inside a <script> element: no "</script>" or "<!--" can close it early. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Embeds the user's rollups into the built page. Pure: string in, string out. */
export function injectData(html: string, payload: PagePayload): string {
  if (!DATA_MARKER.test(html)) throw new Error("Dashboard template is missing its data slot.");
  return html.replace(DATA_MARKER, (_m, open: string, _old: string, close: string) => `${open}${safeJson(payload)}${close}`);
}

const SAMPLE_MARKER = /<script id="ccwatts-sample" type="application\/json">([\s\S]*?)<\/script>/;

/** The synthetic sample rollups the page ships with (built from fixtures/claude-code/demo.jsonl). */
export function readSample(html: string): RollupRow[] {
  const json = SAMPLE_MARKER.exec(html)?.[1];
  if (!json) throw new Error("Page is missing its sample data.");
  return JSON.parse(json) as RollupRow[];
}
