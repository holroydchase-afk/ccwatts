#!/usr/bin/env node

// src/index.ts
import { readFile as readFile3, writeFile as writeFile3 } from "fs/promises";
import { resolve } from "path";
import { parseArgs } from "util";

// ../core/src/meta.ts
var APP_NAME = "ccwatts";
var APP_VERSION = "0.1.0";
var REPO_URL = "https://github.com/holroydchase-afk/ccwatts";
var PLAYGROUND_URL = "https://chaseholroyd.com/ccwatts/";

// ../core/src/format.ts
var TYPE_LABELS = {
  input: "input",
  cacheWrite: "cache write",
  cacheRead: "cache read",
  output: "output"
};
var int = (n) => Math.round(n).toLocaleString("en-US");
function num(n) {
  if (n >= 100) return int(n);
  if (n >= 1) return (Math.round(n * 10) / 10).toString();
  if (n >= 0.01) return (Math.round(n * 100) / 100).toString();
  return n === 0 ? "0" : n.toPrecision(1);
}
function formatEnergy(range) {
  const kwh = range.central >= 1e3;
  const scale = kwh ? 1e3 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${num(range.central / scale)} ${unit}`,
    range: `${num(range.low / scale)} \u2013 ${num(range.high / scale)}`,
    unit
  };
}
var shortModel = (model) => model.replace(/^claude-/, "");

// ../core/src/types.ts
var TOKEN_TYPES = ["input", "cacheWrite", "cacheRead", "output"];

// ../core/src/energy.ts
var zeroRange = () => ({ low: 0, central: 0, high: 0 });
function addRange(into, from) {
  into.low += from.low;
  into.central += from.central;
  into.high += from.high;
  return into;
}
function tierFor(model, params) {
  const id = model.toLowerCase();
  for (const [tier, patterns] of Object.entries(params.tiers)) {
    if (Array.isArray(patterns) && patterns.some((p) => id.includes(p))) return { tier, known: true };
  }
  return { tier: String(params.tiers.fallback), known: false };
}
function param(params, id) {
  const p = params.params[id];
  if (!p) throw new Error(`Missing parameter "${id}" in params.json`);
  return p;
}
function chain(tier, type) {
  const output = `output_wh_per_1k.${tier}`;
  switch (type) {
    case "output":
      return [output];
    case "input":
      return [output, "input_vs_output"];
    case "cacheWrite":
      return [output, "input_vs_output", "cache_write_vs_input"];
    case "cacheRead":
      return [output, "input_vs_output", "cache_read_vs_input"];
  }
}
function factor(params, tier, type) {
  let wh = 1 / 1e3;
  let up2 = 0;
  let down2 = 0;
  for (const id of chain(tier, type)) {
    const p = param(params, id);
    wh *= p.value;
    up2 += Math.log(p.high / p.value) ** 2;
    down2 += Math.log(p.value / p.low) ** 2;
  }
  return { whPerToken: wh, up: Math.sqrt(up2), down: Math.sqrt(down2) };
}
var empty = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
function energyForCounts(counts, tier, params) {
  const total = zeroRange();
  for (const type of TOKEN_TYPES) addRange(total, energyForTokens(counts[type], tier, type, params));
  return total;
}
var factorCache = /* @__PURE__ */ new WeakMap();
function cachedFactor(params, tier, type) {
  let byKey = factorCache.get(params);
  if (!byKey) factorCache.set(params, byKey = /* @__PURE__ */ new Map());
  const key = `${tier}:${type}`;
  let f = byKey.get(key);
  if (!f) byKey.set(key, f = factor(params, tier, type));
  return f;
}
function energyForTokens(tokens, tier, type, params) {
  if (tokens <= 0) return zeroRange();
  const f = cachedFactor(params, tier, type);
  const central = tokens * f.whPerToken;
  return { low: central / Math.exp(f.down), central, high: central * Math.exp(f.up) };
}
var day = (timestamp) => timestamp.slice(0, 10);
function estimate(records, params) {
  const total = zeroRange();
  const tokens = empty();
  const groups = {
    model: /* @__PURE__ */ new Map(),
    type: /* @__PURE__ */ new Map(),
    day: /* @__PURE__ */ new Map(),
    project: /* @__PURE__ */ new Map()
  };
  const unknownModels = /* @__PURE__ */ new Set();
  let from = null;
  let to = null;
  const bump = (dim, key, energy2, type, count) => {
    let row2 = groups[dim].get(key);
    if (!row2) groups[dim].set(key, row2 = { key, energy: zeroRange(), tokens: empty() });
    addRange(row2.energy, energy2);
    row2.tokens[type] += count;
  };
  for (const record of records) {
    const { tier, known } = tierFor(record.model, params);
    if (!known) unknownModels.add(record.model);
    const d = day(record.timestamp);
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
    const project = record.project?.name ?? "(unknown)";
    for (const type of TOKEN_TYPES) {
      const count = record.tokens[type];
      if (count <= 0) continue;
      const energy2 = energyForTokens(count, tier, type, params);
      addRange(total, energy2);
      tokens[type] += count;
      bump("model", record.model, energy2, type, count);
      bump("type", type, energy2, type, count);
      bump("day", d, energy2, type, count);
      bump("project", record.project ? `${project}#${record.project.id}` : project, energy2, type, count);
    }
  }
  const byEnergy = (rows) => [...rows.values()].sort((a, b) => b.energy.central - a.energy.central);
  const warnings = [...unknownModels].map(
    (m) => `Unknown model "${m}": estimated as ${String(params.tiers.fallback)}.`
  );
  return {
    methodVersion: params.version,
    total,
    tokens,
    responses: records.length,
    byModel: byEnergy(groups.model),
    byType: byEnergy(groups.type),
    byDay: [...groups.day.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byProject: byEnergy(groups.project),
    span: from && to ? { from, to } : null,
    warnings
  };
}
var projectName = (key) => key.split("#")[0] ?? key;
function since(records, isoStart) {
  return records.filter((r) => r.timestamp >= isoStart);
}
function comparisons(kwh, params) {
  const c = params.comparisons;
  const out = [];
  const round = (n) => n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  if (c.ev_kwh_per_mile) {
    const miles = kwh / c.ev_kwh_per_mile.value;
    out.push({ id: "ev", amount: miles, text: `driving an EV about ${round(miles)} miles` });
  }
  if (c.fridge_kwh_per_day) {
    const days = kwh / c.fridge_kwh_per_day.value;
    out.push({ id: "fridge", amount: days, text: `running a fridge about ${round(days)} days` });
  }
  if (c.phone_charge_kwh) {
    const charges = kwh / c.phone_charge_kwh.value;
    out.push({ id: "phone", amount: charges, text: `charging a phone about ${round(charges)} times` });
  }
  if (c.us_home_kwh_per_day) {
    const days = kwh / c.us_home_kwh_per_day.value;
    out.push({ id: "home", amount: days, text: `powering a US home about ${round(days)} days` });
  }
  return out;
}

// ../core/src/receipt.ts
function everyday(kwh, params) {
  const all = comparisons(kwh, params);
  const big = all.filter((c) => c.amount >= 1).slice(0, 2);
  const fallback = [...all].sort((a, b) => b.amount - a.amount).slice(0, 1);
  return (big.length ? big : fallback).map((c) => c.text).join(" \xB7 ");
}
var repoShort = REPO_URL.replace(/^https:\/\//, "");
function whose(windowLabel) {
  if (windowLabel === "all time") return "All my Claude Code use so far";
  if (windowLabel.startsWith("since")) return `My Claude Code use ${windowLabel}`;
  return `My ${windowLabel} of Claude Code`;
}
function shareLine({ estimate: e, params, windowLabel }) {
  const t = formatEnergy(e.total);
  const first = everyday(e.total.central / 1e3, params).split(" \xB7 ")[0];
  return `${whose(windowLabel)} used about ${t.central} of electricity (range ${t.range} ${t.unit}), roughly ${first}. Estimated locally with ${APP_NAME}, method v${params.version}: ${repoShort}`;
}
function linkedInPost(input) {
  const { estimate: e, params, windowLabel } = input;
  const t = formatEnergy(e.total);
  const cacheShare = e.total.central > 0 ? Math.round((e.byType.find((r) => r.key === "cacheRead")?.energy.central ?? 0) / e.total.central * 100) : 0;
  return [
    `I measured the electricity behind my AI coding. ${whose(windowLabel)}: about ${t.central} (range ${t.range} ${t.unit}), roughly ${everyday(e.total.central / 1e3, params)}.`,
    "",
    `The surprise: ${cacheShare}% of it came from the agent re-reading context it had already seen.`,
    "",
    `It's a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.`,
    "",
    `Try it in your browser: ${PLAYGROUND_URL}`,
    `Code and method: ${REPO_URL}`
  ].join("\n");
}
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function row(left, right, width) {
  const dots = Math.max(2, width - left.length - right.length - 2);
  return `${left} ${".".repeat(dots)} ${right}`;
}
function receiptSvg({ estimate: e, params, windowLabel }) {
  const W = 1200;
  const H = 627;
  const t = formatEnergy(e.total);
  const kwh = e.total.central / 1e3;
  const compare = everyday(kwh, params).split(" \xB7 ");
  const unit = t.unit;
  const scale = unit === "kWh" ? 1e3 : 1;
  const slipX = 712;
  const slipW = 432;
  const cols = 36;
  const items = [];
  const dash = "-".repeat(cols);
  items.push({ text: "ELECTRICITY RECEIPT", weight: "bold" });
  items.push({ text: e.span ? `${e.span.from} \u2192 ${e.span.to}` : windowLabel, muted: true });
  items.push({ text: dash, muted: true });
  const types = [...TOKEN_TYPES].sort(
    (a, b) => (e.byType.find((r) => r.key === b)?.energy.central ?? 0) - (e.byType.find((r) => r.key === a)?.energy.central ?? 0)
  );
  for (const type of types) {
    const r = e.byType.find((x) => x.key === type);
    items.push({ text: row(TYPE_LABELS[type], `${num((r?.energy.central ?? 0) / scale)} ${unit}`, cols) });
  }
  items.push({ text: dash, muted: true });
  items.push({ text: row("TOTAL (central)", t.central, cols), weight: "bold" });
  items.push({ text: row("RANGE", `${t.range} ${unit}`, cols) });
  items.push({ text: dash, muted: true });
  for (const m of e.byModel.slice(0, 3)) {
    const pct = e.total.central > 0 ? Math.round(m.energy.central / e.total.central * 100) : 0;
    items.push({ text: row(shortModel(m.key), `${pct}%`, cols), muted: true });
  }
  items.push({ text: row("responses", int(e.responses), cols), muted: true });
  items.push({ text: `method v${params.version} \xB7 counts only`, muted: true });
  const lineH = 25;
  const slipTop = 46;
  const textTop = slipTop + 44;
  const barcodeY = textTop + items.length * lineH + 6;
  const slipBottom = barcodeY + 70;
  const days = e.byDay.slice(-30);
  const maxDay = Math.max(...days.map((d) => d.energy.central), 1e-9);
  const barW = (slipW - 64) / Math.max(days.length, 1);
  const barcode = days.map((d, i) => {
    const h = 6 + d.energy.central / maxDay * 40;
    return `<rect x="${(slipX + 32 + i * barW).toFixed(1)}" y="${(barcodeY + 46 - h).toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="#1f2a24"/>`;
  }).join("");
  const teeth = [];
  for (let i = 0, x = slipX + slipW; x > slipX; i++, x -= 9) teeth.push(`${x.toFixed(1)},${slipBottom + (i % 2 ? 10 : 0)}`);
  const slipPath = `M${slipX},${slipTop} H${slipX + slipW} V${slipBottom} L${teeth.join(" L")} L${slipX},${slipBottom} Z`;
  const mono = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
  const sans = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const slipText = items.map((it, i) => {
    const y = textTop + i * lineH;
    const centered = i < 2 || it.text.startsWith("method");
    const x = centered ? slipX + slipW / 2 : slipX + 30;
    return `<text x="${x}" y="${y}" font-family="${mono}" font-size="16.5" ${centered ? 'text-anchor="middle"' : ""} font-weight="${it.weight ?? "normal"}" fill="${it.muted ? "#5e6b63" : "#1f2a24"}">${esc(it.text)}</text>`;
  }).join("\n    ");
  const headline = t.central.split(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(shareLine({ estimate: e, params, windowLabel }))}">
  <rect width="${W}" height="${H}" fill="#12251c"/>
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#7cc4a0"/>
  <text x="64" y="104" font-family="${mono}" font-size="20" letter-spacing="2" fill="#7cc4a0">CLAUDE CODE \xB7 ${esc(windowLabel.toUpperCase())}</text>
  <text x="60" y="262" font-family="${sans}" font-size="148" font-weight="700" fill="#f4f1e8">${esc(headline[0] ?? "")}<tspan font-size="64" font-weight="500" dx="14">${esc(headline[1] ?? "")}</tspan></text>
  <text x="64" y="318" font-family="${sans}" font-size="28" fill="#cfe3d6">of electricity, range ${esc(t.range)} ${unit}</text>
  ${compare.map((c, i) => `<text x="64" y="${384 + i * 38}" font-family="${sans}" font-size="26" fill="#f4f1e8">\u2248 ${esc(c)}</text>`).join("\n  ")}
  <text x="64" y="520" font-family="${sans}" font-size="20" fill="#9fb8a8">Estimated on my laptop. No logs left it.</text>
  <text x="64" y="552" font-family="${mono}" font-size="17" fill="#7cc4a0">${esc(APP_NAME)} \xB7 method v${esc(params.version)}</text>
  <text x="64" y="578" font-family="${mono}" font-size="17" fill="#7cc4a0">${esc(repoShort)}</text>
  <path d="${slipPath}" fill="#f7f5ef"/>
  <g>
    ${slipText}
  </g>
  ${barcode}
</svg>
`;
}

// ../core/src/window.ts
function parseSince(input, now) {
  const value = input.trim().toLowerCase();
  if (value === "all") return { start: null, label: "all time" };
  const rel = /^(\d+)\s*([hdw])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms = { h: 36e5, d: 864e5, w: 6048e5 }[unit] * n;
    const word = { h: "hour", d: "day", w: "week" }[unit];
    return { start: new Date(now.getTime() - ms).toISOString(), label: `last ${n} ${word}${n === 1 ? "" : "s"}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) {
    return { start: `${value}T00:00:00.000Z`, label: `since ${value}` };
  }
  throw new Error(`Can't read --since "${input}". Use 7d, 12h, 4w, a date like 2026-10-01, or all.`);
}

// ../core/src/project.ts
function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = hash * prime & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
function projectRef(cwd) {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).pop() || trimmed;
  return { id: fnv1a64(trimmed), name };
}

// ../core/src/adapters/claude-code.ts
var num2 = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
var str = (value) => typeof value === "string" && value !== "" ? value : null;
function toRecord(line) {
  if (line.type !== "assistant") return null;
  const message = line.message;
  const usage = message?.usage;
  const model = str(message?.model);
  const timestamp = str(line.timestamp);
  const messageId = str(message?.id);
  if (!usage || !model || !timestamp || !messageId) return null;
  if (model === "<synthetic>") return null;
  const cwd = str(line.cwd);
  return {
    source: "claude-code",
    key: `${messageId}:${str(line.requestId) ?? ""}`,
    timestamp,
    model,
    project: cwd ? projectRef(cwd) : null,
    tokens: {
      input: num2(usage.input_tokens),
      cacheWrite: num2(usage.cache_creation_input_tokens),
      cacheRead: num2(usage.cache_read_input_tokens),
      output: num2(usage.output_tokens)
    }
  };
}
var claudeCodeAdapter = {
  id: "claude-code",
  parse(text) {
    const byKey = /* @__PURE__ */ new Map();
    for (const raw of text.split("\n")) {
      if (!raw.includes('"assistant"')) continue;
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      const record = toRecord(line);
      if (record) byKey.set(record.key, record);
    }
    return [...byKey.values()];
  }
};

// ../core/src/rollup.ts
function dedupe(records) {
  const byKey = /* @__PURE__ */ new Map();
  for (const record of records) byKey.set(`${record.source}:${record.key}`, record);
  return [...byKey.values()];
}

// ../../methodology/params.json
var params_default = {
  version: "0.1.0",
  as_of: "2026-10-21",
  license: "CC BY 4.0",
  boundary: "comprehensive: accelerators, host CPU and memory, idle capacity, and data-center overhead (PUE)",
  interval: "low and high are each parameter's plausible bounds, treated as a ~90% interval",
  params: {
    "output_wh_per_1k.opus": {
      value: 1.2,
      low: 0.4,
      high: 3,
      unit: "Wh per 1k output tokens",
      label: "MODELED",
      source: "https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",
      as_of: "2026-10-21",
      note: "Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models."
    },
    "output_wh_per_1k.sonnet": {
      value: 0.6,
      low: 0.25,
      high: 1.5,
      unit: "Wh per 1k output tokens",
      label: "MODELED",
      source: "https://arxiv.org/abs/2508.15734",
      as_of: "2026-10-21",
      note: "Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google's measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k."
    },
    "output_wh_per_1k.haiku": {
      value: 0.25,
      low: 0.08,
      high: 0.6,
      unit: "Wh per 1k output tokens",
      label: "GUESS",
      source: "https://www.anthropic.com/pricing",
      as_of: "2026-10-21",
      note: "Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute."
    },
    input_vs_output: {
      value: 0.3,
      low: 0.15,
      high: 0.5,
      unit: "ratio",
      label: "MODELED",
      source: "https://www.anthropic.com/pricing",
      as_of: "2026-10-21",
      note: "Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3."
    },
    cache_write_vs_input: {
      value: 1,
      low: 0.8,
      high: 1.25,
      unit: "ratio",
      label: "MODELED",
      source: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
      as_of: "2026-10-21",
      note: "Writing to the cache means processing the tokens fresh, then storing the result. Priced at 1.25x input."
    },
    cache_read_vs_input: {
      value: 0.1,
      low: 0.01,
      high: 0.25,
      unit: "ratio",
      label: "MODELED",
      source: "https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",
      as_of: "2026-10-21",
      note: "The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather's central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input."
    }
  },
  tiers: {
    opus: [
      "opus"
    ],
    sonnet: [
      "sonnet"
    ],
    haiku: [
      "haiku"
    ],
    fallback: "sonnet"
  },
  comparisons: {
    ev_kwh_per_mile: {
      value: 0.3,
      unit: "kWh per mile",
      label: "MEASURED",
      source: "https://www.fueleconomy.gov/feg/evsbs.shtml",
      as_of: "2026-10-21",
      note: "Typical EV uses 25-35 kWh per 100 miles (EPA)."
    },
    fridge_kwh_per_day: {
      value: 1.5,
      unit: "kWh per day",
      label: "MEASURED",
      source: "https://www.energystar.gov/products/refrigerators",
      as_of: "2026-10-21",
      note: "A typical US refrigerator uses about 400-600 kWh a year."
    },
    us_home_kwh_per_day: {
      value: 29,
      unit: "kWh per day",
      label: "MEASURED",
      source: "https://www.eia.gov/tools/faqs/faq.php?id=97&t=3",
      as_of: "2026-10-21",
      note: "Average US household used about 10,800 kWh in a year (EIA)."
    },
    phone_charge_kwh: {
      value: 0.019,
      unit: "kWh per smartphone charge",
      label: "MEASURED",
      source: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",
      as_of: "2026-10-21",
      note: "EPA's figure for fully charging one smartphone."
    }
  }
};

// ../core/src/params.ts
var defaultParams = params_default;

// ../core/src/history.ts
var HISTORY_SCHEMA = 1;
var rowKey = (r) => `${r.date}|${r.source}|${r.model}|${r.projectId ?? ""}`;
var sum = (t) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);
function rollup(records) {
  const rows = /* @__PURE__ */ new Map();
  for (const r of records) {
    const base = {
      date: r.timestamp.slice(0, 10),
      source: r.source,
      model: r.model,
      projectId: r.project?.id ?? null,
      projectName: r.project?.name ?? null
    };
    const key = rowKey(base);
    let row2 = rows.get(key);
    if (!row2) rows.set(key, row2 = { ...base, responses: 0, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } });
    row2.responses += 1;
    for (const t of TOKEN_TYPES) row2.tokens[t] += r.tokens[t];
  }
  return sortRows([...rows.values()]);
}
function sortRows(rows) {
  return rows.sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
}
function mergeHistory(stored, fresh) {
  const rows = /* @__PURE__ */ new Map();
  for (const row2 of [...stored, ...fresh]) {
    const key = rowKey(row2);
    const prev = rows.get(key);
    if (!prev || sum(row2.tokens) > sum(prev.tokens) || sum(row2.tokens) === sum(prev.tokens) && row2.responses > prev.responses) {
      rows.set(key, row2);
    }
  }
  return sortRows([...rows.values()]);
}
function rollupRecords(rows) {
  return rows.map((r) => ({
    source: r.source,
    key: rowKey(r),
    timestamp: `${r.date}T00:00:00.000Z`,
    model: r.model,
    project: r.projectId ? { id: r.projectId, name: r.projectName ?? "(unknown)" } : null,
    tokens: { ...r.tokens }
  }));
}
function serializeHistory(rows) {
  const header2 = JSON.stringify({ schema: HISTORY_SCHEMA, kind: "daily-rollups", note: "Token counts only. Energy is recomputed on read." });
  return [header2, ...rows.map((r) => JSON.stringify(r))].join("\n") + "\n";
}
function parseHistory(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRow(value)) rows.push(value);
  }
  return rows;
}
function isRow(v) {
  if (!v || typeof v !== "object") return false;
  const r = v;
  return typeof r.date === "string" && typeof r.model === "string" && typeof r.source === "string" && typeof r.responses === "number" && !!r.tokens && TOKEN_TYPES.every((t) => typeof r.tokens[t] === "number");
}
function weekStart(date) {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
function weekly(days) {
  const weeks = /* @__PURE__ */ new Map();
  for (const d of days) {
    const start = weekStart(d.key);
    let w = weeks.get(start);
    if (!w) weeks.set(start, w = { start, low: 0, central: 0, high: 0, tokens: 0 });
    w.low += d.energy.low;
    w.central += d.energy.central;
    w.high += d.energy.high;
    w.tokens += sum(d.tokens);
  }
  const sorted = [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (sorted.length < 2) return sorted;
  const filled = [];
  const cursor = /* @__PURE__ */ new Date(`${sorted[0].start}T00:00:00Z`);
  const last = sorted[sorted.length - 1].start;
  while (cursor.toISOString().slice(0, 10) <= last) {
    const start = cursor.toISOString().slice(0, 10);
    filled.push(weeks.get(start) ?? { start, low: 0, central: 0, high: 0, tokens: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return filled;
}

// src/dashboard.ts
import { spawn } from "child_process";
import { mkdir as mkdir2, writeFile as writeFile2 } from "fs/promises";
import { join as join2 } from "path";

// ../web/src/inject.ts
var DATA_MARKER = /(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function injectData(html, payload) {
  if (!DATA_MARKER.test(html)) throw new Error("Dashboard template is missing its data slot.");
  return html.replace(DATA_MARKER, (_m, open, _old, close) => `${open}${safeJson(payload)}${close}`);
}

// ../web/dist/ccwatts.html
var ccwatts_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-xpSXkwkqKllB79K8jSX8xFJFB84UuHvUczjsTbn0Cus=\'; style-src \'unsafe-inline\'; img-src data: blob:; base-uri \'none\'; form-action \'none\'">\n<meta name="referrer" content="no-referrer">\n<title>ccwatts</title>\n<meta name="description" content="Estimate the electricity your Claude Code usage consumed, as a sourced range. Runs entirely in your browser.">\n<!-- Link preview for LinkedIn and others. The crawler fetches the image; this page never does. -->\n<meta property="og:type" content="website">\n<meta property="og:title" content="How much electricity does your Claude Code use?">\n<meta property="og:description" content="A sourced kWh range from your own logs. Runs in your browser, and your logs never leave it.">\n<meta property="og:url" content="https://chaseholroyd.com/ccwatts/">\n<meta property="og:image" content="https://chaseholroyd.com/ccwatts/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="ccwatts: how much electricity does your Claude Code use?">\n<meta name="twitter:card" content="summary_large_image">\n<style>\n/* Layout: one reading column; the headline reads like the top of a utility bill, the share card like a till receipt. */\n:root{\n  --bg:#f4f2ea; --surface:#fbfaf6; --ink:#1f2a24; --muted:#5e6b63; --line:#d9ddd3; --accent:#2f6b4f; --accent-ink:#ffffff;\n  --t-cacheRead:#2f6b4f; --t-cacheWrite:#c08a2e; --t-output:#b4553a; --t-input:#4a6fa5;\n  --sans:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;\n  color-scheme:light;\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; color-scheme:dark}}\n:root[data-theme="dark"]{\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; color-scheme:dark}\n*{box-sizing:border-box}\n[hidden]{display:none!important}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55}\n.wrap{max-width:960px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:40px}\nheader.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}\n.brand{font-family:var(--mono);font-weight:700;font-size:18px;letter-spacing:.02em}\n.brand span{color:var(--accent)}\n.pill{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--muted)}\n.pill.sample{border-color:var(--t-cacheWrite);color:var(--t-cacheWrite)}\n.privacy{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:15px}\n.privacy b{color:var(--accent)}\n.hero{display:flex;flex-direction:column;gap:6px}\n.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}\n.big{font-weight:700;font-size:clamp(56px,13vw,112px);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}\n.big small{font-size:.42em;font-weight:500;margin-left:.2em;letter-spacing:0}\n.range{font-size:clamp(18px,3vw,22px)}\n.compare{color:var(--muted);font-size:17px}\n.meta{font-family:var(--mono);font-size:13px;color:var(--muted)}\n.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\nbutton,.btn{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 12px;cursor:pointer}\nbutton:hover,.btn:hover{border-color:var(--accent)}\nbutton:focus-visible,.btn:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\nbutton[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.drop{border:1.5px dashed var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}\n.drop.over{border-color:var(--accent)}\n.drop p{margin:0;color:var(--muted);font-size:14px}\ncode{font-family:var(--mono);font-size:.92em}\nsection{display:flex;flex-direction:column;gap:14px;min-width:0}\nh2{font-size:20px;margin:0;text-wrap:balance}\n.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px}\n.chart{width:100%;height:auto;display:block}\n.chart text{fill:var(--muted);font-family:var(--mono);font-size:11px}\n.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted)}\n.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}\n.rank{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}\n.rank li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:14px}\n.rank .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.rank .val{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);text-align:right}\n.rank .bar{grid-column:1/-1;height:8px;background:var(--line);border-radius:4px;overflow:hidden}\n.rank .bar span{display:block;height:100%;background:var(--accent)}\n.explain{max-width:65ch;margin:0}\n.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}\ntable{border-collapse:collapse;width:100%;font-size:14px;min-width:620px}\nth,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}\nth{font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:500}\ntd.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}\ntr:last-child td{border-bottom:0}\n.label{font-family:var(--mono);font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid currentColor}\na{color:var(--accent)}\n.card{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block}\n.sharetext{font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;margin:0}\n.status{font-size:14px;color:var(--muted);min-height:1.4em}\nfooter{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column;gap:6px}\n@media (prefers-reduced-motion:no-preference){.rank .bar span{transition:width .3s ease}}\n</style>\n</head>\n<body>\n<div class="wrap">\n  <header class="top">\n    <div class="brand">cc<span>watts</span></div>\n    <span class="pill" id="source-pill">Loading</span>\n  </header>\n\n  <div class="privacy" id="privacy"><span aria-hidden="true">\u{1F512}</span><div><b>Your logs never leave this browser.</b> This page makes no network requests. It reads token counts only, never your prompts or code.</div></div>\n\n  <section class="hero" aria-live="polite">\n    <span class="eyebrow" id="hero-eyebrow">Claude Code electricity</span>\n    <div class="big" id="hero-big">\u2013</div>\n    <div class="range" id="hero-range"></div>\n    <div class="compare" id="hero-compare"></div>\n    <div class="meta" id="hero-meta"></div>\n    <div class="controls" role="group" aria-label="Time window">\n      <button type="button" data-window="7d" id="w-7d">7 days</button>\n      <button type="button" data-window="30d" id="w-30d">30 days</button>\n      <button type="button" data-window="all" id="w-all">All time</button>\n    </div>\n  </section>\n\n  <section class="drop" id="drop" hidden>\n    <h2>Try it on your own logs</h2>\n    <p>Claude Code saves logs in <code>~/.claude/projects</code>. Pick that folder, or drop any <code>.jsonl</code> files here. Files are read by this page on your device and never uploaded.</p>\n    <div class="controls">\n      <label class="btn primary" for="pick-folder">Choose folder</label>\n      <input type="file" id="pick-folder" webkitdirectory multiple hidden>\n      <label class="btn" for="pick-files">Choose files</label>\n      <input type="file" id="pick-files" accept=".jsonl" multiple hidden>\n      <button type="button" id="use-sample">Use sample data</button>\n    </div>\n    <div class="status" id="drop-status"></div>\n  </section>\n\n  <section>\n    <h2>Over time</h2>\n    <div class="legend" id="legend"></div>\n    <svg class="chart" id="chart" viewBox="0 0 720 240" role="img" aria-label="Daily electricity by token type"></svg>\n    <p class="meta" id="chart-note"></p>\n  </section>\n\n  <div class="grid2">\n    <section><h2>By model</h2><ul class="rank" id="by-model"></ul></section>\n    <section><h2>By project</h2><ul class="rank" id="by-project"></ul></section>\n  </div>\n\n  <section>\n    <h2>What drives your number</h2>\n    <p class="explain" id="explain"></p>\n  </section>\n\n  <section>\n    <h2>Share it</h2>\n    <img class="card" id="card" alt="Electricity receipt card" width="1200" height="627">\n    <div class="controls">\n      <button type="button" class="primary" id="save-png">Save PNG for LinkedIn</button>\n      <button type="button" id="save-svg">Save SVG</button>\n      <button type="button" id="copy-line">Copy share line</button>\n      <button type="button" id="copy-post">Copy LinkedIn post</button>\n    </div>\n    <div class="status" id="share-status"></div>\n    <pre class="sharetext" id="post"></pre>\n  </section>\n\n  <section>\n    <h2>How this is estimated</h2>\n    <p class="explain" id="method-intro"></p>\n    <div class="tablewrap"><table id="params"></table></div>\n  </section>\n\n  <footer>\n    <div id="footer-version"></div>\n    <div>Open source. Read the code and the full methodology on <a id="repo-link" href="#" rel="noopener noreferrer">GitHub</a>.</div>\n  </footer>\n</div>\n<script id="ccwatts-data" type="application/json">{"mode":"playground","generatedAt":null,"rows":[]}</script>\n<script id="ccwatts-sample" type="application/json">[{"date":"2026-09-21","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":47,"tokens":{"input":481,"cacheWrite":224858,"cacheRead":5433921,"output":21302}},{"date":"2026-09-21","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":17,"tokens":{"input":190,"cacheWrite":86694,"cacheRead":873313,"output":7714}},{"date":"2026-09-22","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":40,"tokens":{"input":393,"cacheWrite":206396,"cacheRead":4259456,"output":20119}},{"date":"2026-09-23","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":52,"tokens":{"input":503,"cacheWrite":212076,"cacheRead":5914935,"output":28587}},{"date":"2026-09-24","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":21,"tokens":{"input":190,"cacheWrite":94458,"cacheRead":1218020,"output":10292}},{"date":"2026-09-24","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":95,"tokens":{"input":977,"cacheWrite":439114,"cacheRead":11248882,"output":44237}},{"date":"2026-09-25","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":19,"tokens":{"input":209,"cacheWrite":93535,"cacheRead":1038543,"output":9584}},{"date":"2026-09-27","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":64,"tokens":{"input":655,"cacheWrite":253381,"cacheRead":7300740,"output":31952}},{"date":"2026-09-28","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":28,"tokens":{"input":276,"cacheWrite":140541,"cacheRead":2230744,"output":13360}},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":38,"tokens":{"input":356,"cacheWrite":152315,"cacheRead":3272451,"output":18960}},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":340,"cacheWrite":134170,"cacheRead":2682489,"output":16997}},{"date":"2026-09-30","source":"claude-code","model":"claude-sonnet-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":31,"tokens":{"input":353,"cacheWrite":135035,"cacheRead":2371226,"output":16712}},{"date":"2026-10-01","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":16,"tokens":{"input":138,"cacheWrite":80233,"cacheRead":768856,"output":6943}},{"date":"2026-10-01","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":24,"tokens":{"input":303,"cacheWrite":108412,"cacheRead":1401918,"output":11697}},{"date":"2026-10-02","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":50,"tokens":{"input":467,"cacheWrite":243377,"cacheRead":6114791,"output":24218}},{"date":"2026-10-02","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":31,"tokens":{"input":291,"cacheWrite":156640,"cacheRead":2602032,"output":14670}},{"date":"2026-10-03","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":67,"tokens":{"input":677,"cacheWrite":296672,"cacheRead":8900888,"output":33220}},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":61,"tokens":{"input":601,"cacheWrite":250048,"cacheRead":7595553,"output":29379}},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":32,"tokens":{"input":349,"cacheWrite":148766,"cacheRead":2857812,"output":18526}},{"date":"2026-10-06","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":42,"tokens":{"input":371,"cacheWrite":175342,"cacheRead":4217525,"output":20010}},{"date":"2026-10-07","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":53,"tokens":{"input":519,"cacheWrite":232336,"cacheRead":6626491,"output":26226}},{"date":"2026-10-07","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":27,"tokens":{"input":299,"cacheWrite":126737,"cacheRead":2032642,"output":15950}},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":72,"tokens":{"input":805,"cacheWrite":314745,"cacheRead":9938479,"output":36755}},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":71,"tokens":{"input":823,"cacheWrite":315410,"cacheRead":9639360,"output":33996}},{"date":"2026-10-08","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":29,"tokens":{"input":288,"cacheWrite":144763,"cacheRead":2133553,"output":18135}},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":316,"cacheWrite":129817,"cacheRead":2427569,"output":15515}},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":15,"tokens":{"input":122,"cacheWrite":58466,"cacheRead":581654,"output":7239}},{"date":"2026-10-09","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":52,"tokens":{"input":438,"cacheWrite":243114,"cacheRead":6293294,"output":26306}},{"date":"2026-10-10","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":66,"tokens":{"input":673,"cacheWrite":273538,"cacheRead":8614195,"output":31043}},{"date":"2026-10-11","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":71,"tokens":{"input":885,"cacheWrite":325807,"cacheRead":9676339,"output":33624}},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":16,"tokens":{"input":186,"cacheWrite":90712,"cacheRead":869169,"output":8201}},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":46,"tokens":{"input":504,"cacheWrite":208473,"cacheRead":4885505,"output":22366}},{"date":"2026-10-13","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":244,"cacheWrite":111650,"cacheRead":1255969,"output":9499}},{"date":"2026-10-13","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":25,"tokens":{"input":221,"cacheWrite":111841,"cacheRead":1586210,"output":11735}},{"date":"2026-10-14","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":43,"tokens":{"input":530,"cacheWrite":183803,"cacheRead":4389683,"output":20586}},{"date":"2026-10-14","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":59,"tokens":{"input":674,"cacheWrite":217090,"cacheRead":6575361,"output":28579}},{"date":"2026-10-15","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":74,"tokens":{"input":825,"cacheWrite":309110,"cacheRead":10212638,"output":38706}},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":265,"cacheWrite":109170,"cacheRead":1296443,"output":8112}},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":31,"tokens":{"input":253,"cacheWrite":156477,"cacheRead":2747706,"output":13093}},{"date":"2026-10-16","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":28,"tokens":{"input":336,"cacheWrite":130298,"cacheRead":1943815,"output":14701}},{"date":"2026-10-16","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":48,"tokens":{"input":494,"cacheWrite":215976,"cacheRead":5622539,"output":24681}},{"date":"2026-10-17","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":56,"tokens":{"input":530,"cacheWrite":237670,"cacheRead":6869143,"output":25467}},{"date":"2026-10-18","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":38,"tokens":{"input":416,"cacheWrite":162013,"cacheRead":3360821,"output":20262}},{"date":"2026-10-19","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":97,"tokens":{"input":1108,"cacheWrite":414100,"cacheRead":10652494,"output":48446}},{"date":"2026-10-19","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":65,"tokens":{"input":708,"cacheWrite":292947,"cacheRead":8732693,"output":35185}},{"date":"2026-10-20","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":66,"tokens":{"input":726,"cacheWrite":297357,"cacheRead":8882173,"output":32673}},{"date":"2026-10-20","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":128,"tokens":{"input":1264,"cacheWrite":557853,"cacheRead":16226037,"output":59579}}]</script>\n<script>"use strict";(()=>{var v="ccwatts",ee="0.1.0",U="https://github.com/holroydchase-afk/ccwatts",te="https://chaseholroyd.com/ccwatts/";var W={input:"input",cacheWrite:"cache write",cacheRead:"cache read",output:"output"},S=e=>Math.round(e).toLocaleString("en-US");function M(e){return e>=100?S(e):e>=1?(Math.round(e*10)/10).toString():e>=.01?(Math.round(e*100)/100).toString():e===0?"0":e.toPrecision(1)}function L(e){let t=e.central>=1e3,n=t?1e3:1,o=t?"kWh":"Wh";return{central:`${M(e.central/n)} ${o}`,range:`${M(e.low/n)} \\u2013 ${M(e.high/n)}`,unit:o}}var N=e=>e.replace(/^claude-/,"");var E=["input","cacheWrite","cacheRead","output"];var z=()=>({low:0,central:0,high:0});function ne(e,t){return e.low+=t.low,e.central+=t.central,e.high+=t.high,e}function we(e,t){let n=e.toLowerCase();for(let[o,s]of Object.entries(t.tiers))if(Array.isArray(s)&&s.some(r=>n.includes(r)))return{tier:o,known:!0};return{tier:String(t.tiers.fallback),known:!1}}function je(e,t){let n=e.params[t];if(!n)throw new Error(`Missing parameter "${t}" in params.json`);return n}function Ae(e,t){let n=`output_wh_per_1k.${e}`;switch(t){case"output":return[n];case"input":return[n,"input_vs_output"];case"cacheWrite":return[n,"input_vs_output","cache_write_vs_input"];case"cacheRead":return[n,"input_vs_output","cache_read_vs_input"]}}function Ue(e,t,n){let o=.001,s=0,r=0;for(let a of Ae(t,n)){let c=je(e,a);o*=c.value,s+=Math.log(c.high/c.value)**2,r+=Math.log(c.value/c.low)**2}return{whPerToken:o,up:Math.sqrt(s),down:Math.sqrt(r)}}var fe=()=>({input:0,cacheWrite:0,cacheRead:0,output:0});var ye=new WeakMap;function We(e,t,n){let o=ye.get(e);o||ye.set(e,o=new Map);let s=`${t}:${n}`,r=o.get(s);return r||o.set(s,r=Ue(e,t,n)),r}function ke(e,t,n,o){if(e<=0)return z();let s=We(o,t,n),r=e*s.whPerToken;return{low:r/Math.exp(s.down),central:r,high:r*Math.exp(s.up)}}var Ie=e=>e.slice(0,10);function q(e,t){let n=z(),o=fe(),s={model:new Map,type:new Map,day:new Map,project:new Map},r=new Set,a=null,c=null,g=(u,d,p,x,l)=>{let m=s[u].get(d);m||s[u].set(d,m={key:d,energy:z(),tokens:fe()}),ne(m.energy,p),m.tokens[x]+=l};for(let u of e){let{tier:d,known:p}=we(u.model,t);p||r.add(u.model);let x=Ie(u.timestamp);(a===null||x<a)&&(a=x),(c===null||x>c)&&(c=x);let l=u.project?.name??"(unknown)";for(let m of E){let f=u.tokens[m];if(f<=0)continue;let T=ke(f,d,m,t);ne(n,T),o[m]+=f,g("model",u.model,T,m,f),g("type",m,T,m,f),g("day",x,T,m,f),g("project",u.project?`${l}#${u.project.id}`:l,T,m,f)}}let R=u=>[...u.values()].sort((d,p)=>p.energy.central-d.energy.central),k=[...r].map(u=>`Unknown model "${u}": estimated as ${String(t.tiers.fallback)}.`);return{methodVersion:t.version,total:n,tokens:o,responses:e.length,byModel:R(s.model),byType:R(s.type),byDay:[...s.day.values()].sort((u,d)=>u.key.localeCompare(d.key)),byProject:R(s.project),span:a&&c?{from:a,to:c}:null,warnings:k}}var oe=e=>e.split("#")[0]??e;function re(e,t){let n=t.comparisons,o=[],s=r=>r>=10?Math.round(r):Math.round(r*10)/10;if(n.ev_kwh_per_mile){let r=e/n.ev_kwh_per_mile.value;o.push({id:"ev",amount:r,text:`driving an EV about ${s(r)} miles`})}if(n.fridge_kwh_per_day){let r=e/n.fridge_kwh_per_day.value;o.push({id:"fridge",amount:r,text:`running a fridge about ${s(r)} days`})}if(n.phone_charge_kwh){let r=e/n.phone_charge_kwh.value;o.push({id:"phone",amount:r,text:`charging a phone about ${s(r)} times`})}if(n.us_home_kwh_per_day){let r=e/n.us_home_kwh_per_day.value;o.push({id:"home",amount:r,text:`powering a US home about ${s(r)} days`})}return o}function I(e,t){let n=re(e,t),o=n.filter(r=>r.amount>=1).slice(0,2),s=[...n].sort((r,a)=>a.amount-r.amount).slice(0,1);return(o.length?o:s).map(r=>r.text).join(" \\xB7 ")}var xe=U.replace(/^https:\\/\\//,"");function $e(e){return e==="all time"?"All my Claude Code use so far":e.startsWith("since")?`My Claude Code use ${e}`:`My ${e} of Claude Code`}function K({estimate:e,params:t,windowLabel:n}){let o=L(e.total),s=I(e.total.central/1e3,t).split(" \\xB7 ")[0];return`${$e(n)} used about ${o.central} of electricity (range ${o.range} ${o.unit}), roughly ${s}. Estimated locally with ${v}, method v${t.version}: ${xe}`}function se(e){let{estimate:t,params:n,windowLabel:o}=e,s=L(t.total),r=t.total.central>0?Math.round((t.byType.find(a=>a.key==="cacheRead")?.energy.central??0)/t.total.central*100):0;return[`I measured the electricity behind my AI coding. ${$e(o)}: about ${s.central} (range ${s.range} ${s.unit}), roughly ${I(t.total.central/1e3,n)}.`,"",`The surprise: ${r}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.","",`Try it in your browser: ${te}`,`Code and method: ${U}`].join(`\n`)}var C=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");function O(e,t,n){let o=Math.max(2,n-e.length-t.length-2);return`${e} ${".".repeat(o)} ${t}`}function ae({estimate:e,params:t,windowLabel:n}){let r=L(e.total),a=e.total.central/1e3,c=I(a,t).split(" \\xB7 "),g=r.unit,R=g==="kWh"?1e3:1,k=712,u=432,d=36,p=[],x="-".repeat(d);p.push({text:"ELECTRICITY RECEIPT",weight:"bold"}),p.push({text:e.span?`${e.span.from} \\u2192 ${e.span.to}`:n,muted:!0}),p.push({text:x,muted:!0});let l=[...E].sort((h,y)=>(e.byType.find(_=>_.key===y)?.energy.central??0)-(e.byType.find(_=>_.key===h)?.energy.central??0));for(let h of l){let y=e.byType.find(_=>_.key===h);p.push({text:O(W[h],`${M((y?.energy.central??0)/R)} ${g}`,d)})}p.push({text:x,muted:!0}),p.push({text:O("TOTAL (central)",r.central,d),weight:"bold"}),p.push({text:O("RANGE",`${r.range} ${g}`,d)}),p.push({text:x,muted:!0});for(let h of e.byModel.slice(0,3)){let y=e.total.central>0?Math.round(h.energy.central/e.total.central*100):0;p.push({text:O(N(h.key),`${y}%`,d),muted:!0})}p.push({text:O("responses",S(e.responses),d),muted:!0}),p.push({text:`method v${t.version} \\xB7 counts only`,muted:!0});let m=25,f=46,T=f+44,B=T+p.length*m+6,j=B+70,A=e.byDay.slice(-30),X=Math.max(...A.map(h=>h.energy.central),1e-9),D=(u-64)/Math.max(A.length,1),Le=A.map((h,y)=>{let _=6+h.energy.central/X*40;return`<rect x="${(k+32+y*D).toFixed(1)}" y="${(B+46-_).toFixed(1)}" width="${Math.max(1,D-2).toFixed(1)}" height="${_.toFixed(1)}" fill="#1f2a24"/>`}).join(""),he=[];for(let h=0,y=k+u;y>k;h++,y-=9)he.push(`${y.toFixed(1)},${j+(h%2?10:0)}`);let Pe=`M${k},${f} H${k+u} V${j} L${he.join(" L")} L${k},${j} Z`,F="ui-monospace, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace",Y="\'Helvetica Neue\', Helvetica, Arial, sans-serif",Se=p.map((h,y)=>{let _=T+y*m,ge=y<2||h.text.startsWith("method");return`<text x="${ge?k+u/2:k+30}" y="${_}" font-family="${F}" font-size="16.5" ${ge?\'text-anchor="middle"\':""} font-weight="${h.weight??"normal"}" fill="${h.muted?"#5e6b63":"#1f2a24"}">${C(h.text)}</text>`}).join(`\n    `),me=r.central.split(" ");return`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627" role="img" aria-label="${C(K({estimate:e,params:t,windowLabel:n}))}">\n  <rect width="1200" height="627" fill="#12251c"/>\n  <rect x="0" y="621" width="1200" height="6" fill="#7cc4a0"/>\n  <text x="64" y="104" font-family="${F}" font-size="20" letter-spacing="2" fill="#7cc4a0">CLAUDE CODE \\xB7 ${C(n.toUpperCase())}</text>\n  <text x="60" y="262" font-family="${Y}" font-size="148" font-weight="700" fill="#f4f1e8">${C(me[0]??"")}<tspan font-size="64" font-weight="500" dx="14">${C(me[1]??"")}</tspan></text>\n  <text x="64" y="318" font-family="${Y}" font-size="28" fill="#cfe3d6">of electricity, range ${C(r.range)} ${g}</text>\n  ${c.map((h,y)=>`<text x="64" y="${384+y*38}" font-family="${Y}" font-size="26" fill="#f4f1e8">\\u2248 ${C(h)}</text>`).join(`\n  `)}\n  <text x="64" y="520" font-family="${Y}" font-size="20" fill="#9fb8a8">Estimated on my laptop. No logs left it.</text>\n  <text x="64" y="552" font-family="${F}" font-size="17" fill="#7cc4a0">${C(v)} \\xB7 method v${C(t.version)}</text>\n  <text x="64" y="578" font-family="${F}" font-size="17" fill="#7cc4a0">${C(xe)}</text>\n  <path d="${Pe}" fill="#f7f5ef"/>\n  <g>\n    ${Se}\n  </g>\n  ${Le}\n</svg>\n`}function De(e){let t=0xcbf29ce484222325n,n=0x100000001b3n;for(let o=0;o<e.length;o++)t^=BigInt(e.charCodeAt(o)),t=t*n&0xffffffffffffffffn;return t.toString(16).padStart(16,"0")}function ie(e){let t=e.replace(/[\\\\/]+$/,""),n=t.split(/[\\\\/]/).pop()||t;return{id:De(t),name:n}}var V=e=>typeof e=="number"&&Number.isFinite(e)&&e>0?e:0,H=e=>typeof e=="string"&&e!==""?e:null;function Ne(e){if(e.type!=="assistant")return null;let t=e.message,n=t?.usage,o=H(t?.model),s=H(e.timestamp),r=H(t?.id);if(!n||!o||!s||!r||o==="<synthetic>")return null;let a=H(e.cwd);return{source:"claude-code",key:`${r}:${H(e.requestId)??""}`,timestamp:s,model:o,project:a?ie(a):null,tokens:{input:V(n.input_tokens),cacheWrite:V(n.cache_creation_input_tokens),cacheRead:V(n.cache_read_input_tokens),output:V(n.output_tokens)}}}var ce={id:"claude-code",parse(e){let t=new Map;for(let n of e.split(`\n`)){if(!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}let s=Ne(o);s&&t.set(s.key,s)}return[...t.values()]}};function le(e){let t=new Map;for(let n of e)t.set(`${n.source}:${n.key}`,n);return[...t.values()]}var be={version:"0.1.0",as_of:"2026-10-21",license:"CC BY 4.0",boundary:"comprehensive: accelerators, host CPU and memory, idle capacity, and data-center overhead (PUE)",interval:"low and high are each parameter\'s plausible bounds, treated as a ~90% interval",params:{"output_wh_per_1k.opus":{value:1.2,low:.4,high:3,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models."},"output_wh_per_1k.sonnet":{value:.6,low:.25,high:1.5,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://arxiv.org/abs/2508.15734",as_of:"2026-10-21",note:"Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google\'s measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k."},"output_wh_per_1k.haiku":{value:.25,low:.08,high:.6,unit:"Wh per 1k output tokens",label:"GUESS",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute."},input_vs_output:{value:.3,low:.15,high:.5,unit:"ratio",label:"MODELED",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3."},cache_write_vs_input:{value:1,low:.8,high:1.25,unit:"ratio",label:"MODELED",source:"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",as_of:"2026-10-21",note:"Writing to the cache means processing the tokens fresh, then storing the result. Priced at 1.25x input."},cache_read_vs_input:{value:.1,low:.01,high:.25,unit:"ratio",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather\'s central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input."}},tiers:{opus:["opus"],sonnet:["sonnet"],haiku:["haiku"],fallback:"sonnet"},comparisons:{ev_kwh_per_mile:{value:.3,unit:"kWh per mile",label:"MEASURED",source:"https://www.fueleconomy.gov/feg/evsbs.shtml",as_of:"2026-10-21",note:"Typical EV uses 25-35 kWh per 100 miles (EPA)."},fridge_kwh_per_day:{value:1.5,unit:"kWh per day",label:"MEASURED",source:"https://www.energystar.gov/products/refrigerators",as_of:"2026-10-21",note:"A typical US refrigerator uses about 400-600 kWh a year."},us_home_kwh_per_day:{value:29,unit:"kWh per day",label:"MEASURED",source:"https://www.eia.gov/tools/faqs/faq.php?id=97&t=3",as_of:"2026-10-21",note:"Average US household used about 10,800 kWh in a year (EIA)."},phone_charge_kwh:{value:.019,unit:"kWh per smartphone charge",label:"MEASURED",source:"https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",as_of:"2026-10-21",note:"EPA\'s figure for fully charging one smartphone."}}};var $=be;var G=e=>`${e.date}|${e.source}|${e.model}|${e.projectId??""}`;function ue(e){let t=new Map;for(let n of e){let o={date:n.timestamp.slice(0,10),source:n.source,model:n.model,projectId:n.project?.id??null,projectName:n.project?.name??null},s=G(o),r=t.get(s);r||t.set(s,r={...o,responses:0,tokens:{input:0,cacheWrite:0,cacheRead:0,output:0}}),r.responses+=1;for(let a of E)r.tokens[a]+=n.tokens[a]}return He([...t.values()])}function He(e){return e.sort((t,n)=>G(t).localeCompare(G(n)))}function J(e){return e.map(t=>({source:t.source,key:G(t),timestamp:`${t.date}T00:00:00.000Z`,model:t.model,project:t.projectId?{id:t.projectId,name:t.projectName??"(unknown)"}:null,tokens:{...t.tokens}}))}var i=e=>document.getElementById(e),b=e=>e.replace(/[&<>"\']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"})[t]);function ve(e,t){try{return JSON.parse(i(e).textContent??"")}catch{return t}}var P=ve("ccwatts-data",{mode:"playground",generatedAt:null,rows:[]}),Ee=ve("ccwatts-sample",[]),w={rows:P.mode==="dashboard"&&P.rows.length?P.rows:Ee,source:P.mode==="dashboard"&&P.rows.length?"history":"sample",window:"30d"},Be={"7d":"last 7 days","30d":"last 30 days",all:"all time"};function Fe(e,t){if(t==="all"||e.length===0)return e;let n=t==="7d"?7:30,o=e.reduce((a,c)=>c.date>a?c.date:a,"0000-00-00"),s=w.source==="history"?Date.now():Date.parse(`${o}T00:00:00Z`)+864e5,r=new Date(s-n*864e5).toISOString().slice(0,10);return e.filter(a=>a.date>=r)}function Ye(e){let t=q(J(e),$);return t.responses=e.reduce((n,o)=>n+o.responses,0),t}function ze(e,t){let n=L(e.total),[o,s]=n.central.split(" ");i("hero-eyebrow").textContent=`Claude Code electricity \\xB7 ${t}`,i("hero-big").innerHTML=e.responses?`${b(o??"")}<small>${b(s??"")}</small>`:"\\u2013",i("hero-range").textContent=e.responses?`Plausible range ${n.range} ${n.unit}, from the bounds on every assumption.`:"No usage in this window.",i("hero-compare").textContent=e.responses?`About the same as ${I(e.total.central/1e3,$).replace(" \\xB7 ",", or ")}.`:"";let r=e.span?` \\xB7 ${e.span.from} to ${e.span.to}`:"",a=E.reduce((c,g)=>c+e.tokens[g],0);i("hero-meta").textContent=`${S(e.responses)} responses \\xB7 ${S(a)} tokens${r} \\xB7 method v${$.version}`;for(let c of["7d","30d","all"])i(`w-${c}`).setAttribute("aria-pressed",String(w.window===c))}function qe(e){let t=i("chart"),n=720,o=240,s={l:44,r:8,t:22,b:28},r=e.byDay;if(i("legend").innerHTML=["cacheRead","cacheWrite","output","input"].map(l=>`<span><i style="background:var(--t-${l})"></i>${W[l]}</span>`).join(""),!r.length){t.innerHTML=`<text x="${n/2}" y="${o/2}" text-anchor="middle">No usage in this window</text>`,i("chart-note").textContent="";return}let a=L(e.total),c=a.unit==="kWh"?1e3:1,g=Math.max(...r.map(l=>l.energy.central))/c,R=Ge(g/3),k=Math.max(R*Math.ceil(g/R),R),u=l=>s.t+(o-s.t-s.b)*(1-l/k),d=(n-s.l-s.r)/r.length,p=[];for(let l=0;l<=k+1e-9;l+=R)p.push(`<line x1="${s.l}" x2="${n-s.r}" y1="${u(l)}" y2="${u(l)}" stroke="var(--line)" stroke-width="1"/>`),p.push(`<text x="${s.l-6}" y="${u(l)+4}" text-anchor="end">${M(l)}</text>`);p.push(`<text x="0" y="10">${a.unit} per day</text>`),r.forEach((l,m)=>{let f=0,T=s.l+m*d+d*.12,B=Math.max(1,d*.76);for(let j of["cacheRead","cacheWrite","output","input"]){let A=Ke(l,j);if(A<=0)continue;let X=f/c;f+=A;let D=f/c;p.push(`<rect x="${T.toFixed(1)}" y="${u(D).toFixed(1)}" width="${B.toFixed(1)}" height="${Math.max(.5,u(X)-u(D)).toFixed(1)}" fill="var(--t-${j})"><title>${l.key} ${W[j]} ${M(A/c)} ${a.unit}</title></rect>`)}});let x=r.length===1?[0]:[0,Math.floor((r.length-1)/2),r.length-1];for(let l of new Set(x)){let m=l===0?"start":l===r.length-1?"end":"middle",f=l===0?s.l:l===r.length-1?n-s.r:s.l+(l+.5)*d;p.push(`<text x="${f}" y="${o-8}" text-anchor="${m}">${r[l].key.slice(5)}</text>`)}t.innerHTML=p.join(""),i("chart-note").textContent=`Bars show the central estimate per day. The total for this window is ${a.central}, with a range of ${a.range} ${a.unit}.`}function Ke(e,t){return Z.get(e.key)?.[t]??0}var Z=new Map;function Ve(e){Z=new Map;for(let t of e){let n=q(J([t]),$),o=Z.get(t.date);o||Z.set(t.date,o={input:0,cacheWrite:0,cacheRead:0,output:0});for(let s of n.byType)o[s.key]+=s.energy.central}}function Ge(e){if(e<=0)return 1;let t=10**Math.floor(Math.log10(e)),n=e/t;return(n<=1?1:n<=2?2:n<=5?5:10)*t}function Re(e,t,n,o){let s=Math.max(...t.map(a=>a.energy.central),1e-9),r=t.slice(0,6);i(e).innerHTML=r.length?r.map(a=>{let c=L(a.energy),g=o.total.central?Math.round(a.energy.central/o.total.central*100):0;return`<li><span class="name" title="${b(n(a.key))}">${b(n(a.key))}</span><span class="val">${b(c.central)} \\xB7 ${g}%</span><span class="bar"><span style="width:${(a.energy.central/s*100).toFixed(1)}%"></span></span><span class="val" style="grid-column:1/-1;text-align:left">range ${b(c.range)} ${b(c.unit)}</span></li>`}).join(""):\'<li><span class="name">No usage in this window</span></li>\'}function Je(e){let t=s=>e.total.central?Math.round((e.byType.find(r=>r.key===s)?.energy.central??0)/e.total.central*100):0,n=E.reduce((s,r)=>s+e.tokens[r],0),o=n?Math.round(e.tokens.cacheRead/n*100):0;i("explain").textContent=e.responses?`Each time Claude Code takes a step, it re-reads the conversation so far. Most of that comes from a cache, which is cheap per token but happens constantly. Here, cache reads were ${o}% of tokens and about ${t("cacheRead")}% of the electricity. Writing new context into the cache was ${t("cacheWrite")}%, and the text the model wrote back was ${t("output")}%. Long sessions grow the context the agent re-reads, so starting fresh sessions for new tasks is the simplest way to lower your number.`:"Load some usage to see what drives it."}var pe="",Ce="",de="";function Ze(e,t){let n={estimate:e,params:$,windowLabel:t};pe=ae(n),Ce=K(n),de=se(n),i("card").src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pe)}`,i("post").textContent=de,i("share-status").textContent=w.source==="sample"?"This card shows sample data. Load your own logs to make yours.":""}function Qe(){i("method-intro").textContent=`Energy = tokens \\xD7 energy per token, by model family and token type. Each parameter below has a low and high bound, and they combine into the range you see. The boundary is ${$.boundary}. Method v${$.version}, parameters as of ${$.as_of}, licensed ${$.license}.`;let e=Object.entries($.params).map(([t,n])=>`<tr><td><code>${b(t)}</code><div class="meta">${b(n.note)}</div></td><td class="num">${n.value}</td><td class="num">${n.low} \\u2013 ${n.high}</td><td>${b(n.unit)}</td><td><span class="label">${b(n.label)}</span></td><td><a href="${b(n.source)}" rel="noopener noreferrer">source</a></td></tr>`).join("");i("params").innerHTML=`<thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead><tbody>${e}</tbody>`}function Q(){let e=Fe(w.rows,w.window);Ve(e);let t=Ye(e),n=Be[w.window],o=i("source-pill");o.textContent=w.source==="sample"?"Sample data":w.source==="history"?"Your history":"Your files",o.classList.toggle("sample",w.source==="sample"),ze(t,n),qe(t),Re("by-model",t.byModel,N,t),Re("by-project",t.byProject,oe,t),Je(t),Ze(t,n)}async function Te(e){let t=[...e].filter(r=>r.name.endsWith(".jsonl")),n=i("drop-status");if(!t.length){n.textContent="No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";return}n.textContent=`Reading ${t.length} file${t.length===1?"":"s"} on this device\\u2026`;let o=[];for(let r of t)o.push(...ce.parse(await r.text()));let s=ue(le(o));if(!s.length){n.textContent="Those files had no Claude Code usage in them.";return}w.rows=s,w.source="files",w.window="all",n.textContent=`Read ${S(o.length)} responses from ${t.length} file${t.length===1?"":"s"}. Nothing was uploaded.`,Q()}function Me(e,t){let n=document.createElement("a");n.href=URL.createObjectURL(t),n.download=e,document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(n.href),1e3)}async function _e(e,t){let n=i("share-status");try{await navigator.clipboard.writeText(e),n.textContent=`Copied the ${t}.`}catch{let o=document.createRange();o.selectNodeContents(i("post")),getSelection()?.removeAllRanges(),getSelection()?.addRange(o),n.textContent="Couldn\'t reach the clipboard. The post text is selected so you can copy it."}}function Xe(){let e=new Image;e.onload=()=>{let t=document.createElement("canvas");t.width=1200,t.height=627,t.getContext("2d").drawImage(e,0,0,1200,627),t.toBlob(n=>n&&Me(`${v}-receipt.png`,n),"image/png")},e.src=i("card").src}function et(){for(let t of["7d","30d","all"])i(`w-${t}`).addEventListener("click",()=>{w.window=t,Q()});if(i("save-png").addEventListener("click",Xe),i("save-svg").addEventListener("click",()=>Me(`${v}-receipt.svg`,new Blob([pe],{type:"image/svg+xml"}))),i("copy-line").addEventListener("click",()=>{_e(Ce,"share line")}),i("copy-post").addEventListener("click",()=>{_e(de,"LinkedIn post")}),P.mode==="playground"){let t=i("drop");t.hidden=!1;for(let o of["pick-folder","pick-files"])i(o).addEventListener("change",s=>{let r=s.target.files;r&&Te(r)});i("use-sample").addEventListener("click",()=>{w.rows=Ee,w.source="sample",w.window="30d",i("drop-status").textContent="",Q()});let n=o=>s=>{s.preventDefault(),t.classList.toggle("over",o)};t.addEventListener("dragover",n(!0)),t.addEventListener("dragleave",n(!1)),t.addEventListener("drop",o=>{n(!1)(o),o.dataTransfer?.files&&Te(o.dataTransfer.files)})}i("repo-link").href=U;let e=P.generatedAt?` \\xB7 written ${P.generatedAt.slice(0,16).replace("T"," ")} UTC`:"";i("footer-version").textContent=`${v} v${ee} \\xB7 method v${$.version}${e}. Electricity only, not carbon or water.`,document.title=P.mode==="dashboard"?`${v} dashboard`:`${v} playground`}et();Qe();Q();})();</script>\n</body>\n</html>\n';

// src/store.ts
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function dataDir() {
  return process.env[`${APP_NAME.toUpperCase()}_HOME`] ?? join(homedir(), `.${APP_NAME}`);
}
var historyPath = (dir = dataDir()) => join(dir, "history.jsonl");
async function readHistory(dir = dataDir()) {
  try {
    return parseHistory(await readFile(historyPath(dir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function writeHistory(rows, dir = dataDir()) {
  await mkdir(dir, { recursive: true });
  const tmp = `${historyPath(dir)}.tmp`;
  await writeFile(tmp, serializeHistory(rows), { mode: 384 });
  await rename(tmp, historyPath(dir));
}

// src/dashboard.ts
async function writeDashboard(rows, dir = dataDir()) {
  await mkdir2(dir, { recursive: true });
  const path = join2(dir, "dashboard.html");
  const html = injectData(ccwatts_default, { mode: "dashboard", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), rows });
  await writeFile2(path, html, { mode: 384 });
  return path;
}
function openFile(path) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {
    }).unref();
  } catch {
  }
}

// src/logs.ts
import { readdir, readFile as readFile2, stat } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
function defaultLogRoots() {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.split(",").map((dir) => join3(dir.trim(), "projects"));
  if (fromEnv?.length) return fromEnv;
  return [join3(homedir2(), ".claude", "projects"), join3(homedir2(), ".config", "claude", "projects")];
}
async function findJsonl(dir) {
  if (dir.endsWith(".jsonl") && (await stat(dir).catch(() => null))?.isFile()) return [dir];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join3(e.parentPath, e.name));
}
async function loadLogs(roots) {
  const files = (await Promise.all(roots.map(findJsonl))).flat();
  const parsed = await Promise.all(files.map(async (f) => claudeCodeAdapter.parse(await readFile2(f, "utf8"))));
  return { roots, files: files.length, records: dedupe(parsed.flat()) };
}

// src/render.ts
var energy = formatEnergy;
var totalTokens2 = (t) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);
function shares(rows, total, label, max = 4) {
  const pct = (r) => total > 0 ? Math.round(r.energy.central / total * 100) : 0;
  const shown = rows.slice(0, max).map((r) => `${label(r.key)} ${pct(r)}%`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${Math.round(rest / total * 100)}%`);
  return shown.join("   ");
}
function header(params, window) {
  return `${APP_NAME} v${APP_VERSION} \xB7 method v${params.version} \xB7 ${window.label}`;
}
function summary(e, params, window) {
  if (e.responses === 0) return `${header(params, window)}

  No Claude Code usage found in this window. Try --since all.`;
  const total = energy(e.total);
  const kwh = e.total.central / 1e3;
  const compare = everyday(kwh, params);
  const top = e.byProject[0];
  const lines = [
    header(params, window),
    "",
    `  Electricity   ${total.central}   (range ${total.range})`,
    `  \u2248 ${compare}`,
    "",
    `  By model      ${shares(e.byModel, e.total.central, shortModel, 3)}`,
    `  By type       ${shares(e.byType, e.total.central, (k) => TYPE_LABELS[k])}`
  ];
  if (top) {
    const t = energy(top.energy);
    lines.push(`  Top project   ${projectName(top.key)}   ${t.central} (range ${t.range})`);
  }
  const span = e.span ? ` \xB7 ${e.span.from} to ${e.span.to}` : "";
  lines.push(`  Based on      ${int(e.responses)} responses, ${int(totalTokens2(e.tokens))} tokens${span}`);
  for (const w of e.warnings) lines.push(`  Note          ${w}`);
  lines.push("", `  How this is estimated: ${APP_NAME} --method   \xB7   Share: ${APP_NAME} receipt`);
  return lines.join("\n");
}
function table(head, rows, alignLeft = 1) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => i < alignLeft ? c.padEnd(widths[i]) : c.padStart(widths[i])).join("   ").trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("   "), ...rows.map(line)].join("\n");
}
var DIM_ROWS = { model: "byModel", type: "byType", day: "byDay", project: "byProject" };
function breakdown(e, params, window, dim) {
  const rows = e[DIM_ROWS[dim]];
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1e3 : 1;
  const label = (key) => dim === "type" ? TYPE_LABELS[key] : dim === "project" ? projectName(key) : dim === "model" ? shortModel(key) : key;
  const body = rows.map((r) => [
    label(r.key),
    int(totalTokens2(r.tokens)),
    num(r.energy.central / scale),
    `${num(r.energy.low / scale)} \u2013 ${num(r.energy.high / scale)}`,
    e.total.central > 0 ? `${Math.round(r.energy.central / e.total.central * 100)}%` : "0%"
  ]);
  const t = energy(e.total);
  body.push(["total", int(totalTokens2(e.tokens)), num(e.total.central / scale), t.range, "100%"]);
  return [header(params, window), "", table([dim, "tokens", unit, "range", "share"], body)].join("\n");
}
function method(params) {
  const lines = [
    `${APP_NAME} method v${params.version} \xB7 parameters as of ${params.as_of} \xB7 ${params.license}`,
    "",
    `Boundary: ${params.boundary}.`,
    `Ranges: ${params.interval}; spreads combine root-sum-of-squares on a log scale.`,
    ""
  ];
  const rows = Object.entries(params.params).map(([id, p]) => [id, `${p.value}`, `${p.low} \u2013 ${p.high}`, p.unit, p.label]);
  lines.push(table(["parameter", "value", "range", "unit", "label"], rows, 1));
  lines.push("", "Sources:");
  for (const [id, p] of Object.entries(params.params)) lines.push(`  ${id}: ${p.source}`);
  lines.push("", "Comparisons (central value only):");
  for (const [id, c] of Object.entries(params.comparisons)) lines.push(`  ${id}: ${c.value} ${c.unit} \xB7 ${c.source}`);
  lines.push("", "Full write-up: METHODOLOGY.md");
  return lines.join("\n");
}
function json(e, params, window) {
  const rows = (list, dim) => list.map((r) => ({
    key: dim === "project" ? projectName(r.key) : r.key,
    ...dim === "project" ? { projectId: r.key.split("#")[1] ?? null } : {},
    wh: r.energy,
    tokens: r.tokens
  }));
  return JSON.stringify(
    {
      app: APP_NAME,
      version: APP_VERSION,
      methodVersion: params.version,
      unit: "Wh",
      window,
      span: e.span,
      responses: e.responses,
      tokens: e.tokens,
      wh: e.total,
      comparisons: comparisons(e.total.central / 1e3, params).map(({ id, amount }) => ({ id, amount })),
      byModel: rows(e.byModel, "model"),
      byType: rows(e.byType, "type"),
      byDay: rows(e.byDay, "day"),
      byProject: rows(e.byProject, "project"),
      warnings: e.warnings
    },
    null,
    2
  );
}
var BARS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
function sparkline(values) {
  const max = Math.max(...values, 0);
  return values.map((v) => max === 0 ? BARS[0] : BARS[Math.min(7, Math.round(v / max * 7))]).join("");
}
function history(e, params, window, storedDays) {
  if (e.responses === 0) return `${header(params, window)}

  No history yet. Run ${APP_NAME} once to start recording.`;
  const weeks = weekly(e.byDay);
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1e3 : 1;
  const rows = weeks.map((w) => [
    `week of ${w.start}`,
    num(w.central / scale),
    `${num(w.low / scale)} \u2013 ${num(w.high / scale)}`,
    "\u2588".repeat(Math.round(w.central / Math.max(...weeks.map((x) => x.central), 1e-9) * 20))
  ]);
  const active = weeks.filter((w) => w.central > 0);
  const best = active.reduce((a, b) => b.central < a.central ? b : a, active[0]);
  const worst = active.reduce((a, b) => b.central > a.central ? b : a, active[0]);
  const total = energy(e.total);
  const lines = [
    header(params, window),
    "",
    table(["week", unit, "range", ""], rows),
    "",
    `  Trend         ${sparkline(weeks.map((w) => w.central))}`,
    `  Total         ${total.central}   (range ${total.range})`,
    `  Lightest week ${best.start}   ${energy(best).central} (range ${energy(best).range})`,
    `  Heaviest week ${worst.start}   ${energy(worst).central} (range ${energy(worst).range})`,
    `  Recorded      ${storedDays} days, kept in your local history even after Claude Code deletes old logs`,
    "",
    `  Energy is recalculated from stored token counts with method v${params.version}.`
  ];
  return lines.join("\n");
}
var csvCell = (v) => typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
function historyCsv(rows, params) {
  const head = ["date", "model", "project", "responses", "input", "cache_write", "cache_read", "output", "wh_low", "wh_central", "wh_high", "method_version"];
  const round = (n) => Math.round(n * 1e3) / 1e3;
  const body = rows.map((r) => {
    const wh = energyForCounts(r.tokens, tierFor(r.model, params).tier, params);
    return [r.date, r.model, r.projectName ?? "", r.responses, r.tokens.input, r.tokens.cacheWrite, r.tokens.cacheRead, r.tokens.output, round(wh.low), round(wh.central), round(wh.high), params.version];
  });
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\n");
}
function statusLine(e, params) {
  if (e.responses === 0) return `\u26A1 ${APP_NAME}: no usage yet this session`;
  const t = formatEnergy(e.total);
  return `\u26A1 ~${t.central} this session (range ${t.range}) \xB7 method v${params.version}`;
}

// src/index.ts
var HELP = `Usage: ${APP_NAME} [command] [options]

Estimates the electricity your Claude Code usage consumed, as a range.
Reads local logs only. Nothing leaves your machine.

Commands:
  (none)            Summary for the time window
  history           Weekly trend, all-time total, best and worst weeks
  dashboard         Write an offline HTML dashboard of your history and open it
  receipt           Share line, LinkedIn post text and a 1200\xD7627 card (SVG)
  statusline        One line for the Claude Code status line (reads its JSON on stdin)

Options:
  --since <when>    7d, 12h, 4w, 2026-10-01 or all (default 30d; history defaults to all)
  --by <dim>        Breakdown table: model, day, project or type
  --json            Machine-readable output, same numbers, in Wh
  --method          Parameters, sources and method version
  --export csv      With history: daily rows as CSV on stdout
  --out <file>      With receipt: where to write the card (default ./${APP_NAME}-receipt.svg)
  --path <dir>      Read logs from this folder instead
  --no-open         With dashboard: write the file but don't open it
  --no-history      Don't read or update ~/.${APP_NAME}/history.jsonl
  -h, --help        Show this help`;
var DIMS = ["model", "day", "project", "type"];
var COMMANDS = ["summary", "history", "receipt", "dashboard", "statusline"];
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      by: { type: "string" },
      json: { type: "boolean" },
      method: { type: "boolean" },
      export: { type: "string" },
      out: { type: "string" },
      path: { type: "string" },
      "no-history": { type: "boolean" },
      "no-open": { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });
  if (values.help) return void console.log(HELP);
  const params = defaultParams;
  if (values.method) return void console.log(method(params));
  const command = positionals[0] ?? "summary";
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command "${command}".

${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (command === "statusline") return void console.log(await sessionLine(values.path));
  const by = values.by;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);
  if (values.export && values.export !== "csv") throw new Error(`--export supports csv only`);
  const window = parseSince(values.since ?? (command === "history" ? "all" : "30d"), /* @__PURE__ */ new Date());
  const logs = await loadLogs(values.path ? [values.path] : defaultLogRoots());
  let rows = rollup(logs.records);
  if (!values["no-history"]) {
    const stored = await readHistory().catch((error) => {
      console.error(`Couldn't read history (${error instanceof Error ? error.message : String(error)}). Using current logs only.`);
      return [];
    });
    rows = mergeHistory(stored, rows);
    if (logs.records.length > 0) {
      await writeHistory(rows).catch(
        (error) => console.error(`Couldn't save history (${error instanceof Error ? error.message : String(error)}). Continuing without it.`)
      );
    }
  }
  if (rows.length === 0) {
    console.log(`No Claude Code logs found. Looked in:
${logs.roots.map((r) => `  ${r}`).join("\n")}`);
    console.log(`Point ${APP_NAME} at another folder with --path <dir>.`);
    return;
  }
  if (command === "dashboard") {
    const path = await writeDashboard(rows);
    console.log(`Dashboard written to ${path}. It works offline and makes no network requests.`);
    if (!values["no-open"]) openFile(path);
    return;
  }
  const inWindow = window.start ? rows.filter((r) => r.date >= window.start.slice(0, 10)) : rows;
  const records = window.start && window.label.includes("hour") ? since(logs.records, window.start) : rollupRecords(inWindow);
  const e = estimate(records, params);
  if (!(window.start && window.label.includes("hour"))) {
    e.responses = inWindow.reduce((n, r) => n + r.responses, 0);
  }
  if (command === "history") {
    if (values.export) return void console.log(historyCsv(inWindow, params));
    if (values.json) return void console.log(json(e, params, window));
    return void console.log(history(e, params, window, new Set(rows.map((r) => r.date)).size));
  }
  if (command === "receipt") {
    const input = { estimate: e, params, windowLabel: window.label };
    const out = resolve(values.out ?? `${APP_NAME}-receipt.svg`);
    await writeFile3(out, receiptSvg(input));
    console.log(shareLine(input));
    console.log(`
Card written to ${out} (1200\xD7627, LinkedIn size). Open ${APP_NAME} dashboard to save it as PNG.`);
    console.log(`
Ready-to-paste post:

${linkedInPost(input)}`);
    return;
  }
  if (values.json) console.log(json(e, params, window));
  else if (by) console.log(breakdown(e, params, window, by));
  else console.log(summary(e, params, window));
}
async function sessionLine(path) {
  try {
    const file = path ?? JSON.parse(await readStdin()).transcript_path;
    if (!file) return `\u26A1 ${APP_NAME}: waiting for the first response`;
    const records = dedupe(claudeCodeAdapter.parse(await readFile3(file, "utf8")));
    return statusLine(estimate(records, defaultParams), defaultParams);
  } catch {
    return `\u26A1 ${APP_NAME}: no estimate yet`;
  }
}
async function readStdin() {
  if (process.stdin.isTTY) return "{}";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text || "{}";
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
