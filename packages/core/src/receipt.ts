import { comparisons, type Estimate } from "./energy.js";
import { formatEnergy, int, num, shortModel, TYPE_LABELS } from "./format.js";
import { APP_NAME, PLAYGROUND_URL, REPO_URL } from "./meta.js";
import type { Params } from "./params.js";
import { TOKEN_TYPES, type TokenType } from "./types.js";

export interface ReceiptInput {
  estimate: Estimate;
  params: Params;
  /** e.g. "last 30 days" */
  windowLabel: string;
}

/** Up to two everyday comparisons big enough to picture (at least 1 of the thing), else the largest. */
export function everyday(kwh: number, params: Params): string {
  const all = comparisons(kwh, params);
  const big = all.filter((c) => c.amount >= 1).slice(0, 2);
  const fallback = [...all].sort((a, b) => b.amount - a.amount).slice(0, 1);
  return (big.length ? big : fallback).map((c) => c.text).join(" · ");
}

const repoShort = REPO_URL.replace(/^https:\/\//, "");

/** "My last 30 days of Claude Code", "All my Claude Code use so far", "My Claude Code use since 2026-10-01". */
function whose(windowLabel: string): string {
  if (windowLabel === "all time") return "All my Claude Code use so far";
  if (windowLabel.startsWith("since")) return `My Claude Code use ${windowLabel}`;
  return `My ${windowLabel} of Claude Code`;
}

/** One line to paste anywhere. Central value first, range right after, method version always. */
export function shareLine({ estimate: e, params, windowLabel }: ReceiptInput): string {
  const t = formatEnergy(e.total);
  const first = everyday(e.total.central / 1000, params).split(" · ")[0];
  return `${whose(windowLabel)} used about ${t.central} of electricity (range ${t.range} ${t.unit}), roughly ${first}. Estimated locally with ${APP_NAME}, method v${params.version}: ${repoShort}`;
}

/** A short ready-to-paste LinkedIn post. Plain words, no hype, sources linked. */
export function linkedInPost(input: ReceiptInput): string {
  const { estimate: e, params, windowLabel } = input;
  const t = formatEnergy(e.total);
  const cacheShare = e.total.central > 0 ? Math.round(((e.byType.find((r) => r.key === "cacheRead")?.energy.central ?? 0) / e.total.central) * 100) : 0;
  return [
    `I measured the electricity behind my AI coding. ${whose(windowLabel)}: about ${t.central} (range ${t.range} ${t.unit}), roughly ${everyday(e.total.central / 1000, params)}.`,
    "",
    `The surprise: ${cacheShare}% of it came from the agent re-reading context it had already seen.`,
    "",
    `It's a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.`,
    "",
    `Try it in your browser: ${PLAYGROUND_URL}`,
    `Code and method: ${REPO_URL}`,
  ].join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Left/right justified receipt row padded with dots, at a fixed character width. */
function row(left: string, right: string, width: number): string {
  const dots = Math.max(2, width - left.length - right.length - 2);
  return `${left} ${".".repeat(dots)} ${right}`;
}

/**
 * The share card: 1200×627 (LinkedIn's link and image size). Pure string, no fonts or images
 * fetched, so it renders the same offline and in the browser.
 */
export function receiptSvg({ estimate: e, params, windowLabel }: ReceiptInput): string {
  const W = 1200;
  const H = 627;
  const t = formatEnergy(e.total);
  const kwh = e.total.central / 1000;
  const compare = everyday(kwh, params).split(" · ");
  const unit = t.unit;
  const scale = unit === "kWh" ? 1000 : 1;

  // Receipt slip on the right.
  const slipX = 712;
  const slipW = 432;
  const cols = 36;
  const items: { text: string; weight?: "bold"; size?: number; muted?: boolean }[] = [];
  const dash = "-".repeat(cols);
  items.push({ text: "ELECTRICITY RECEIPT", weight: "bold" });
  items.push({ text: e.span ? `${e.span.from} → ${e.span.to}` : windowLabel, muted: true });
  items.push({ text: dash, muted: true });
  const types = [...TOKEN_TYPES].sort(
    (a, b) => (e.byType.find((r) => r.key === b)?.energy.central ?? 0) - (e.byType.find((r) => r.key === a)?.energy.central ?? 0),
  );
  for (const type of types) {
    const r = e.byType.find((x) => x.key === type);
    items.push({ text: row(TYPE_LABELS[type as TokenType], `${num((r?.energy.central ?? 0) / scale)} ${unit}`, cols) });
  }
  items.push({ text: dash, muted: true });
  items.push({ text: row("TOTAL (central)", t.central, cols), weight: "bold" });
  items.push({ text: row("RANGE", `${t.range} ${unit}`, cols) });
  items.push({ text: dash, muted: true });
  for (const m of e.byModel.slice(0, 3)) {
    const pct = e.total.central > 0 ? Math.round((m.energy.central / e.total.central) * 100) : 0;
    items.push({ text: row(shortModel(m.key), `${pct}%`, cols), muted: true });
  }
  items.push({ text: row("responses", int(e.responses), cols), muted: true });
  items.push({ text: `method v${params.version} · counts only`, muted: true });

  const lineH = 25;
  const slipTop = 46;
  const textTop = slipTop + 44;
  const barcodeY = textTop + items.length * lineH + 6;
  const slipBottom = barcodeY + 70;

  const days = e.byDay.slice(-30);
  const maxDay = Math.max(...days.map((d) => d.energy.central), 1e-9);
  const barW = (slipW - 64) / Math.max(days.length, 1);
  const barcode = days
    .map((d, i) => {
      const h = 6 + (d.energy.central / maxDay) * 40;
      return `<rect x="${(slipX + 32 + i * barW).toFixed(1)}" y="${(barcodeY + 46 - h).toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#1f2a24"/>`;
    })
    .join("");

  // Torn bottom edge: zigzag from the right corner back to the left.
  const teeth: string[] = [];
  for (let i = 0, x = slipX + slipW; x > slipX; i++, x -= 9) teeth.push(`${x.toFixed(1)},${slipBottom + (i % 2 ? 10 : 0)}`);
  const slipPath = `M${slipX},${slipTop} H${slipX + slipW} V${slipBottom} L${teeth.join(" L")} L${slipX},${slipBottom} Z`;

  const mono = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
  const sans = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const slipText = items
    .map((it, i) => {
      const y = textTop + i * lineH;
      const centered = i < 2 || it.text.startsWith("method");
      const x = centered ? slipX + slipW / 2 : slipX + 30;
      return `<text x="${x}" y="${y}" font-family="${mono}" font-size="16.5" ${centered ? 'text-anchor="middle"' : ""} font-weight="${it.weight ?? "normal"}" fill="${it.muted ? "#5e6b63" : "#1f2a24"}">${esc(it.text)}</text>`;
    })
    .join("\n    ");

  const headline = t.central.split(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(shareLine({ estimate: e, params, windowLabel }))}">
  <rect width="${W}" height="${H}" fill="#12251c"/>
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#7cc4a0"/>
  <text x="64" y="104" font-family="${mono}" font-size="20" letter-spacing="2" fill="#7cc4a0">CLAUDE CODE · ${esc(windowLabel.toUpperCase())}</text>
  <text x="60" y="262" font-family="${sans}" font-size="148" font-weight="700" fill="#f4f1e8">${esc(headline[0] ?? "")}<tspan font-size="64" font-weight="500" dx="14">${esc(headline[1] ?? "")}</tspan></text>
  <text x="64" y="318" font-family="${sans}" font-size="28" fill="#cfe3d6">of electricity, range ${esc(t.range)} ${unit}</text>
  ${compare.map((c, i) => `<text x="64" y="${384 + i * 38}" font-family="${sans}" font-size="26" fill="#f4f1e8">≈ ${esc(c)}</text>`).join("\n  ")}
  <text x="64" y="520" font-family="${sans}" font-size="20" fill="#9fb8a8">Estimated on my laptop. No logs left it.</text>
  <text x="64" y="552" font-family="${mono}" font-size="17" fill="#7cc4a0">${esc(APP_NAME)} · method v${esc(params.version)}</text>
  <text x="64" y="578" font-family="${mono}" font-size="17" fill="#7cc4a0">${esc(repoShort)}</text>
  <path d="${slipPath}" fill="#f7f5ef"/>
  <g>
    ${slipText}
  </g>
  ${barcode}
</svg>
`;
}
