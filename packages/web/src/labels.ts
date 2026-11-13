// Window labels for the hero and the share card. Sample data is a fixed synthetic month, so its
// windows say "sample" instead of "last N days", which would read as stale once the dates age.
export type WindowId = "7d" | "30d" | "all";
export type DataSource = "history" | "sample" | "files";

const OWN: Record<WindowId, string> = { "7d": "last 7 days", "30d": "last 30 days", all: "all time" };
const SAMPLE: Record<WindowId, string> = { "7d": "a sample week", "30d": "a sample month", all: "all sample data" };

export function windowLabel(window: WindowId, source: DataSource): string {
  return (source === "sample" ? SAMPLE : OWN)[window];
}
