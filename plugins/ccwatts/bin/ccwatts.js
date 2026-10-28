#!/usr/bin/env node

// src/index.ts
import { readFile as readFile3, stat as stat3, writeFile as writeFile3 } from "fs/promises";
import { basename as basename2, resolve } from "path";
import { parseArgs } from "util";

// ../core/src/meta.ts
var APP_NAME = "ccwatts";
var APP_VERSION = "0.1.1";
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
var fixed = (n) => n >= 1 && n < 100 ? n.toFixed(1) : num(n);
function formatEnergy(range) {
  const kwh = range.high >= 1e3;
  const scale = kwh ? 1e3 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${fixed(range.central / scale)} ${unit}`,
    range: `${fixed(range.low / scale)} \u2013 ${fixed(range.high / scale)}`,
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
  const bump = (dim, key, energy2, type, count2) => {
    let row2 = groups[dim].get(key);
    if (!row2) groups[dim].set(key, row2 = { key, energy: zeroRange(), tokens: empty() });
    addRange(row2.energy, energy2);
    row2.tokens[type] += count2;
  };
  for (const record of records) {
    const { tier, known } = tierFor(record.model, params);
    if (!known) unknownModels.add(record.model);
    const d = day(record.timestamp);
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
    const project = record.project?.name ?? "(unknown)";
    for (const type of TOKEN_TYPES) {
      const count2 = record.tokens[type];
      if (count2 <= 0) continue;
      const energy2 = energyForTokens(count2, tier, type, params);
      addRange(total, energy2);
      tokens[type] += count2;
      bump("model", record.model, energy2, type, count2);
      bump("type", type, energy2, type, count2);
      bump("day", d, energy2, type, count2);
      bump("project", record.project ? `${project}#${record.project.id}` : project, energy2, type, count2);
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
function phoneText(charges, round) {
  if (round(charges) === 1) return "charging a phone about once";
  if (charges >= 1) return `charging a phone about ${round(charges)} times`;
  const pct = Math.round(charges * 100);
  if (pct < 1) return "under 1% of a phone charge";
  if (pct >= 45 && pct <= 55) return "about half a phone charge";
  return `about ${Math.round(pct / 10) * 10 || pct}% of a phone charge`;
}
function comparisons(kwh, params) {
  const c = params.comparisons;
  const out = [];
  const round = (n) => n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  const count2 = (n, one, many) => round(n) === 1 ? `1 ${one}` : `${round(n)} ${many}`;
  if (c.ev_kwh_per_mile) {
    const miles = kwh / c.ev_kwh_per_mile.value;
    out.push({ id: "ev", amount: miles, text: `driving an EV about ${count2(miles, "mile", "miles")}` });
  }
  if (c.fridge_kwh_per_day) {
    const days = kwh / c.fridge_kwh_per_day.value;
    out.push({ id: "fridge", amount: days, text: `running a fridge about ${count2(days, "day", "days")}` });
  }
  if (c.phone_charge_kwh) {
    const charges = kwh / c.phone_charge_kwh.value;
    out.push({ id: "phone", amount: charges, text: phoneText(charges, round) });
  }
  if (c.us_home_kwh_per_day) {
    const days = kwh / c.us_home_kwh_per_day.value;
    out.push({ id: "home", amount: days, text: `powering a US home about ${count2(days, "day", "days")}` });
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
function sampleWhose(windowLabel) {
  return windowLabel === "all time" ? "(Sample data) All of a sample's Claude Code use" : `(Sample data) ${windowLabel[0].toUpperCase()}${windowLabel.slice(1)} of Claude Code`;
}
function shareLine({ estimate: e, params, windowLabel, sample }) {
  const t = formatEnergy(e.total);
  const first = everyday(e.total.central / 1e3, params).split(" \xB7 ")[0];
  return `${sample ? sampleWhose(windowLabel) : whose(windowLabel)} came to about ${t.central} of electricity (range ${t.range} ${t.unit}), like ${first}. Estimated locally with ${APP_NAME}, method v${params.version}: ${repoShort}`;
}
function linkedInPost(input) {
  const { estimate: e, params, windowLabel, sample } = input;
  const t = formatEnergy(e.total);
  const cacheShare = e.total.central > 0 ? Math.round((e.byType.find((r) => r.key === "cacheRead")?.energy.central ?? 0) / e.total.central * 100) : 0;
  if (sample) {
    return [
      `(Sample data) This is what ${APP_NAME} shows for a sample developer, not a real measurement. ${sampleWhose(windowLabel).replace("(Sample data) ", "")}: about ${t.central} (range ${t.range} ${t.unit}), like ${everyday(e.total.central / 1e3, params).replace(" \xB7 ", " or ")}.`,
      "",
      `${cacheShare}% of it came from the agent re-reading context it had already seen.`,
      "",
      `It's a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and it runs entirely on your own machine, so no logs leave it.`,
      "",
      `Try it on your own logs: ${PLAYGROUND_URL}`,
      `Code and method: ${REPO_URL}`
    ].join("\n");
  }
  return [
    `I estimated the electricity behind my AI coding. ${whose(windowLabel)}: about ${t.central} (range ${t.range} ${t.unit}), like ${everyday(e.total.central / 1e3, params).replace(" \xB7 ", " or ")}.`,
    "",
    `${cacheShare >= 50 ? "The surprise: " : ""}${cacheShare}% of it came from the agent re-reading context it had already seen.`,
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
function receiptSvg({ estimate: e, params, windowLabel, sample }) {
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(shareLine({ estimate: e, params, windowLabel, sample }))}">
  <rect width="${W}" height="${H}" fill="#12251c"/>
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#7cc4a0"/>
  <text x="64" y="104" font-family="${mono}" font-size="20" letter-spacing="2" fill="#7cc4a0">${sample ? '<tspan fill="#e0b56a">SAMPLE DATA \xB7 </tspan>' : ""}CLAUDE CODE \xB7 ${esc(windowLabel.toUpperCase())}</text>
  <text x="60" y="262" font-family="${sans}" font-size="148" font-weight="700" fill="#f4f1e8">${esc(headline[0] ?? "")}<tspan font-size="64" font-weight="500" dx="14">${esc(headline[1] ?? "")}</tspan></text>
  <text x="64" y="318" font-family="${sans}" font-size="28" fill="#cfe3d6">of electricity, range ${esc(t.range)} ${unit}</text>
  ${compare.map((c, i) => `<text x="64" y="${384 + i * 38}" font-family="${sans}" font-size="26" fill="#f4f1e8">\u2248 ${esc(c)}</text>`).join("\n  ")}
  <text x="64" y="520" font-family="${sans}" font-size="20" fill="${sample ? "#e0b56a" : "#9fb8a8"}">${sample ? "Sample data, not a real measurement." : "Estimated on my laptop. No logs left it."}</text>
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
  const bad = () => new Error(`Can't read --since "${input}". Use 7d, 12h, 4w, a date like 2026-10-01, or all.`);
  const value = input.trim().toLowerCase();
  if (value === "all") return { start: null, label: "all time" };
  const rel = /^(\d+)\s*([hdw])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms = { h: 36e5, d: 864e5, w: 6048e5 }[unit] * n;
    const word = { h: "hour", d: "day", w: "week" }[unit];
    const start = new Date(now.getTime() - ms);
    if (Number.isNaN(start.getTime())) throw bad();
    return { start: start.toISOString(), label: `last ${n} ${word}${n === 1 ? "" : "s"}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) {
    return { start: `${value}T00:00:00.000Z`, label: `since ${value}` };
  }
  throw bad();
}
var FUTURE_SLACK_MS = 864e5;
function dropFuture(records, now) {
  const limit = now.getTime() + FUTURE_SLACK_MS;
  const kept = records.filter((r) => !(Date.parse(r.timestamp) > limit));
  return { kept, future: records.length - kept.length };
}
var futureNote = (n) => `Ignored ${n} response${n === 1 ? "" : "s"} dated in the future.`;

// ../core/src/sanitize.ts
var UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
var NAME_MAX = 64;
function safeName(value, max = NAME_MAX) {
  const clean = value.replace(UNSAFE, "");
  if (clean.length <= max) return clean;
  let out = "";
  for (const ch of clean) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}\u2026`;
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
  const base = trimmed.split(/[\\/]/).pop() || trimmed;
  const name = trimmed === "" ? "(root)" : safeName(base) || "(unnamed)";
  return { id: fnv1a64(trimmed), name };
}

// ../core/src/adapters/claude-code.ts
var MAX_TOKENS_PER_RESPONSE = 1e9;
var count = (value, required = false) => {
  if (value === null && required) return null;
  if (typeof value !== "number" || value <= 0) return 0;
  return Number.isInteger(value) && value <= MAX_TOKENS_PER_RESPONSE ? value : null;
};
var validTimestamp = (value) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
var str = (value) => typeof value === "string" && value !== "" ? value : null;
function toRecord(line) {
  if (line.type !== "assistant") return null;
  const message = line.message;
  const usage = message?.usage;
  const model = str(message?.model);
  const timestamp = str(line.timestamp);
  const messageId = str(message?.id);
  if (!usage || !model || !timestamp || !messageId) return null;
  if (!validTimestamp(timestamp)) return null;
  if (model === "<synthetic>") return null;
  const input = count(usage.input_tokens, true);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const output = count(usage.output_tokens, true);
  if (input === null || cacheWrite === null || cacheRead === null || output === null) return null;
  const cwd = str(line.cwd);
  return {
    source: "claude-code",
    key: `${messageId}:${str(line.requestId) ?? ""}`,
    timestamp,
    model: safeName(model) || "(unnamed)",
    project: cwd ? projectRef(cwd) : null,
    tokens: { input, cacheWrite, cacheRead, output }
  };
}
var claudeCodeAdapter = {
  id: "claude-code",
  parse(text) {
    const byKey = /* @__PURE__ */ new Map();
    for (const raw of text.replace(/^\uFEFF/, "").split("\n")) {
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
var outputContext = (t) => t.output * (t.input + t.cacheWrite + t.cacheRead);
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
    if (!row2) rows.set(key, row2 = { ...base, responses: 0, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, outputContext: 0 });
    row2.responses += 1;
    for (const t of TOKEN_TYPES) row2.tokens[t] += r.tokens[t];
    row2.outputContext += outputContext(r.tokens);
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
    if (!prev || sum(row2.tokens) > sum(prev.tokens) || sum(row2.tokens) === sum(prev.tokens) && moreComplete(row2, prev)) {
      rows.set(key, row2);
    }
  }
  return sortRows([...rows.values()]);
}
var moreComplete = (row2, prev) => row2.responses > prev.responses || row2.responses === prev.responses && row2.outputContext !== void 0 && prev.outputContext === void 0;
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
    if (isRow(value)) {
      value.model = safeName(value.model) || "(unnamed)";
      if (typeof value.projectName === "string") value.projectName = safeName(value.projectName) || "(unnamed)";
      rows.push(value);
    }
  }
  return rows;
}
var okCount = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
var okDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
function isRow(v) {
  if (!v || typeof v !== "object") return false;
  const r = v;
  return okDate(r.date) && typeof r.model === "string" && typeof r.source === "string" && (r.projectId === void 0 || r.projectId === null || typeof r.projectId === "string") && (r.projectName === void 0 || r.projectName === null || typeof r.projectName === "string") && okCount(r.responses) && !!r.tokens && typeof r.tokens === "object" && TOKEN_TYPES.every((t) => okCount(r.tokens[t])) && (r.outputContext === void 0 || okCount(r.outputContext));
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
var SAMPLE_MARKER = /<script id="ccwatts-sample" type="application\/json">([\s\S]*?)<\/script>/;
function readSample(html) {
  const json2 = SAMPLE_MARKER.exec(html)?.[1];
  if (!json2) throw new Error("Page is missing its sample data.");
  return JSON.parse(json2);
}

// ../web/dist/ccwatts.html
var ccwatts_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-CIDWhpUcQvHVQlxupSsnMng3RnQpd+WyQVXq7d2K+JE=\'; style-src \'unsafe-inline\'; img-src data: blob:; base-uri \'none\'; form-action \'none\'">\n<meta name="referrer" content="no-referrer">\n<title>ccwatts</title>\n<meta name="description" content="Estimate the electricity your Claude Code usage consumed, as a sourced range. Runs entirely in your browser.">\n<!-- Link preview for LinkedIn and others. The crawler fetches the image; this page never does. -->\n<meta property="og:type" content="website">\n<meta property="og:title" content="How much electricity does your Claude Code use?">\n<meta property="og:description" content="A sourced kWh range from your own logs. Runs in your browser, and your logs never leave it.">\n<meta property="og:url" content="https://chaseholroyd.com/ccwatts/">\n<meta property="og:image" content="https://chaseholroyd.com/ccwatts/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="ccwatts: how much electricity does your Claude Code use?">\n<meta name="twitter:card" content="summary_large_image">\n<style>\n/* Layout: one reading column; the headline reads like the top of a utility bill, the share card like a till receipt. */\n:root{\n  --bg:#f4f2ea; --surface:#fbfaf6; --ink:#1f2a24; --muted:#5e6b63; --line:#d9ddd3; --accent:#2f6b4f; --accent-ink:#ffffff;\n  --t-cacheRead:#2f6b4f; --t-cacheWrite:#c08a2e; --t-output:#b4553a; --t-input:#4a6fa5;\n  --sample:#8a5a12; --control:#7f8a83; --danger:#a8321f;\n  --sans:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;\n  color-scheme:light;\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; --sample:#e0b56a; --control:#5d7a68; --danger:#ff9a85; color-scheme:dark}}\n:root[data-theme="dark"]{\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; --sample:#e0b56a; --control:#5d7a68; --danger:#ff9a85; color-scheme:dark}\n*{box-sizing:border-box}\n[hidden]{display:none!important}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55}\n.wrap{max-width:960px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:40px}\nheader.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}\n.back{font-size:15px;display:inline-flex;align-items:center;min-height:44px;text-decoration:none;color:var(--muted);align-self:flex-start;margin-block:-12px -28px}\n.back:hover{color:var(--accent);text-decoration:underline}\na:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}\n.intro{display:flex;flex-direction:column;gap:8px}\nh1{font-size:clamp(26px,5vw,36px);line-height:1.15;margin:0;letter-spacing:-.01em;text-wrap:balance}\n.lede{margin:0;font-size:17px;color:var(--muted);max-width:60ch}\n.brand{font-family:var(--mono);font-weight:700;font-size:18px;letter-spacing:.02em}\n.brand span{color:var(--accent)}\n.pill{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--muted)}\n.pill.sample{border-color:var(--sample);color:var(--sample)}\n.privacy{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:15px}\n.privacy b{color:var(--accent)}\n.hero{display:flex;flex-direction:column;gap:6px}\n.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}\n.big{font-weight:700;font-size:clamp(56px,13vw,112px);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}\n.big small{font-size:.42em;font-weight:500;margin-left:.2em;letter-spacing:0}\n.range{font-size:clamp(18px,3vw,22px);font-variant-numeric:tabular-nums}\n.compare{color:var(--muted);font-size:17px}\n.meta{font-family:var(--mono);font-size:13px;color:var(--muted)}\n/* Reading text (captions, method notes, the post preview) stays in the sans stack; mono is for numbers and code. */\n.note{font-family:var(--sans);font-size:15px;line-height:1.5;color:var(--muted);margin:0}\n.hero-foot{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}\n.jump{display:inline-flex;align-items:center;min-height:44px;font-size:15px}\n.jump::after{content:"\\00a0\u2193"}\n.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\nbutton,.btn{font:inherit;font-size:15px;min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--control);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 14px;cursor:pointer}\nbutton:hover,.btn:hover{border-color:var(--accent)}\nbutton:focus-visible,.btn:focus-visible,input:focus-visible,.vh:focus-visible+.btn{outline:2px solid var(--accent);outline-offset:2px}\n/* Visually hidden but still focusable, so the styled label stays reachable by keyboard. */\n#hero-meta span{white-space:nowrap}\n.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\nbutton[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.drop{border:1.5px dashed var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}\n.drop.over{border-color:var(--accent)}\n.drop p{margin:0;color:var(--muted);font-size:14px}\ncode{font-family:var(--mono);font-size:.92em}\nsection{display:flex;flex-direction:column;gap:14px;min-width:0}\nh2{font-size:20px;margin:0;text-wrap:balance}\n.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px}\n.chart{width:100%;height:auto;display:block}\n.chart text{fill:var(--muted);font-family:var(--mono);font-size:11px}\n.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted)}\n.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}\n.rank{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}\n.rank li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:14px}\n.rank .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.rank .val{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);text-align:right}\n.rank .bar{grid-column:1/-1;height:8px;background:var(--line);border-radius:4px;overflow:hidden}\n.rank .bar span{display:block;height:100%;background:var(--accent)}\n.explain{max-width:65ch;margin:0}\n.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}\ntable{border-collapse:collapse;width:100%;font-size:14px;min-width:620px}\nth,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}\nth{font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:500}\ntd.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}\ntr:last-child td{border-bottom:0}\n.label{font-family:var(--mono);font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid currentColor}\na{color:var(--accent)}\na.src{display:inline-flex;align-items:center;min-height:44px}\n.phone-only{display:none}\n@media (max-width:600px){\n  .phone-only{display:block}\n  /* Method table: one card per parameter instead of a sideways scroll. */\n  table{min-width:0}\n  thead{display:none}\n  table,tbody,tr,td{display:block}\n  tr{padding:10px 12px;border-bottom:1px solid var(--line)}\n  tr:last-child{border-bottom:0}\n  td{border:0;padding:2px 0;white-space:normal}\n  td[data-label]:not([data-label="Parameter"])::before{content:attr(data-label) " ";font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:8px}\n  td.num{white-space:normal}\n}\n.card{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block}\n/* On a phone the 1200px card\'s text shrinks under 11px, so it links to the card at full size (UX-R17). */\n.full-size{min-height:44px;line-height:44px;font-size:15px;align-self:flex-start}\n.sharetext{font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;margin:0}\n#post{font-family:var(--sans);font-size:15px;line-height:1.5}\n.status{font-size:14px;color:var(--muted);min-height:1.4em}\n.status:empty{display:none}\n.status.error{color:var(--danger);border-left:3px solid;padding-left:10px}\n/* Disclosures: a 44px tap target with a chevron that turns when open. */\n.disclose{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;font-size:15px;color:var(--ink);list-style:none;border-radius:6px}\n.disclose::-webkit-details-marker{display:none}\n.disclose::before{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);flex:none;margin-right:2px}\ndetails[open]>.disclose::before{transform:rotate(45deg)}\n.disclose:hover{color:var(--accent)}\n.disclose:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\ndetails>*+*{margin-top:10px}\n@media (prefers-reduced-motion:no-preference){.disclose::before{transition:transform .15s ease}}\n.export label{display:block;font-size:14px;color:var(--muted)}\n.export textarea{display:block;font-family:var(--mono);font-size:13px;width:100%;box-sizing:border-box;border:1px solid var(--control);border-radius:8px;padding:10px;background:var(--surface);color:var(--ink)}\nkbd{font-family:var(--mono);font-size:.85em;border:1px solid var(--line);border-radius:4px;padding:0 4px}\nfooter{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column;gap:6px}\n@media (prefers-reduced-motion:no-preference){.rank .bar span{transition:width .3s ease}}\n</style>\n</head>\n<body>\n<main class="wrap">\n  <a class="back" id="back-link" href="#" hidden>\u2190 Chase Holroyd\'s portfolio</a>\n  <header class="top">\n    <div class="brand">cc<span>watts</span></div>\n    <span class="pill" id="source-pill">Loading</span>\n  </header>\n\n  <div class="intro">\n    <h1>How much electricity does your AI coding use?</h1>\n    <p class="lede" id="lede">ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You\'re looking at sample data; try your own logs below.</p>\n  </div>\n\n  <div class="privacy" id="privacy"><span aria-hidden="true">\u{1F512}</span><div><b>Your logs never leave this browser.</b> This page makes no network requests. It reads token counts only, never your prompts or code.</div></div>\n\n  <section class="hero">\n    <span class="eyebrow" id="hero-eyebrow">Claude Code electricity</span>\n    <div class="big" id="hero-big">\u2013</div>\n    <div class="range" id="hero-range"></div>\n    <div class="compare" id="hero-compare"></div>\n    <div class="meta" id="hero-meta"></div>\n    <div class="hero-foot">\n      <div class="controls" role="group" aria-label="Time window">\n        <button type="button" data-window="7d" id="w-7d">7 days</button>\n        <button type="button" data-window="30d" id="w-30d">30 days</button>\n        <button type="button" data-window="all" id="w-all">All time</button>\n      </div>\n      <a class="jump" id="jump" href="#drop" hidden>Use your own logs</a>\n    </div>\n  </section>\n\n  <section>\n    <h2>Over time</h2>\n    <div class="legend" id="legend"></div>\n    <svg class="chart" id="chart" viewBox="0 0 720 240" role="img" aria-label="Daily electricity by token type"></svg>\n    <p class="note" id="chart-note"></p>\n  </section>\n\n  <div class="grid2">\n    <section><h2>By model</h2><ul class="rank" id="by-model"></ul></section>\n    <section><h2>By project</h2><ul class="rank" id="by-project"></ul></section>\n  </div>\n\n  <section class="drop" id="drop" hidden>\n    <h2>Try it on your own logs</h2>\n    <p>Claude Code saves logs in <code>~/.claude/projects</code>. Pick that folder, or drop any <code>.jsonl</code> files here. Files are read by this page on your device and never uploaded. On a Mac the folder is hidden: in the picker, press <kbd>\u2318</kbd> <kbd>\u21E7</kbd> <kbd>.</kbd> to show it.</p>\n    <div class="controls">\n      <input type="file" class="vh" id="pick-folder" webkitdirectory multiple>\n      <label class="btn primary" for="pick-folder">Choose folder</label>\n      <input type="file" class="vh" id="pick-files" accept=".jsonl" multiple>\n      <label class="btn" for="pick-files">Choose files</label>\n      <button type="button" id="use-sample">Use sample data</button>\n    </div>\n    <p id="cli-line">Prefer the terminal? Run <code id="cli-cmd">npx ccwatts</code> with Node 20+. Same numbers, plus a history that outlasts Claude Code\'s log cleanup.</p>\n    <p class="phone-only" id="phone-hint">On a phone? Claude Code keeps its logs on the computer it runs on. Open this page there, or use the prompt below if you run Claude Code on the web.</p>\n    <details class="export" id="export">\n      <summary class="disclose">Use Claude Code on the web, or can\'t find the folder?</summary>\n      <p>Paste this prompt into a Claude Code session. It writes a copy of that machine\'s usage with token counts only, and no prompts or code. Then drop the file here, or paste what it prints into the box below.</p>\n      <pre class="sharetext" id="export-prompt">Make a counts-only copy of my Claude Code usage for ccwatts.\n\nRead every .jsonl file under ~/.claude/projects. For each line whose "type" is "assistant" and that has message.usage, write one JSON line containing only:\n- type, timestamp, requestId\n- cwd, reduced to the last folder name (never the full path)\n- message.id and message.model\n- message.usage with input_tokens, cache_creation_input_tokens, cache_read_input_tokens and output_tokens\n\nLeave out everything else, especially message content. Save the lines as ccwatts-usage.jsonl and give me the file to download. If you can\'t offer a download, print the lines in one code block instead.</pre>\n      <div class="controls">\n        <button type="button" id="copy-prompt">Copy prompt</button>\n      </div>\n      <label for="paste-log">Paste the lines it printed</label>\n      <textarea id="paste-log" rows="4" spellcheck="false" placeholder=\'{"type":"assistant", \u2026}\'></textarea>\n      <div class="controls">\n        <button type="button" id="read-paste">Read pasted lines</button>\n      </div>\n    </details>\n    <div class="status" id="drop-status" role="status" aria-live="polite"></div>\n  </section>\n\n  <section>\n    <h2>What drives your number</h2>\n    <p class="explain" id="explain"></p>\n  </section>\n\n  <section>\n    <h2>Share it</h2>\n    <img class="card" id="card" alt="Electricity receipt card" width="1200" height="627">\n    <a class="phone-only full-size" id="card-full" href="#" target="_blank" rel="noopener noreferrer">Open full size</a>\n    <div class="controls">\n      <button type="button" class="primary" id="save-png">Save PNG for LinkedIn</button>\n      <button type="button" id="save-svg">Save SVG</button>\n      <button type="button" id="copy-line">Copy share line</button>\n      <button type="button" id="copy-post">Copy LinkedIn post</button>\n    </div>\n    <div class="status" id="share-status"></div>\n    <details id="post-box">\n      <summary class="disclose">Show the LinkedIn post</summary>\n      <pre class="sharetext" id="post"></pre>\n    </details>\n  </section>\n\n  <section>\n    <h2>How this is estimated</h2>\n    <p class="explain" id="method-intro"></p>\n    <details id="params-box">\n      <summary class="disclose">Show all parameters and sources</summary>\n      <div class="tablewrap"><table id="params"></table></div>\n    </details>\n  </section>\n\n  <footer>\n    <div id="footer-version"></div>\n    <div>Open source. Read the code and the full methodology on <a id="repo-link" href="#" rel="noopener noreferrer">GitHub</a>.</div>\n    <div>Built by <a id="built-by" href="#" rel="noopener noreferrer">Chase Holroyd</a>.</div>\n  </footer>\n</main>\n<script id="ccwatts-data" type="application/json">{"mode":"playground","generatedAt":null,"rows":[]}</script>\n<script id="ccwatts-sample" type="application/json">[{"date":"2026-09-21","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":47,"tokens":{"input":481,"cacheWrite":224858,"cacheRead":5433921,"output":21302},"outputContext":2453872321},{"date":"2026-09-21","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":17,"tokens":{"input":190,"cacheWrite":86694,"cacheRead":873313,"output":7714},"outputContext":425266546},{"date":"2026-09-22","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":40,"tokens":{"input":393,"cacheWrite":206396,"cacheRead":4259456,"output":20119},"outputContext":2244470466},{"date":"2026-09-23","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":52,"tokens":{"input":503,"cacheWrite":212076,"cacheRead":5914935,"output":28587},"outputContext":3409886608},{"date":"2026-09-24","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":21,"tokens":{"input":190,"cacheWrite":94458,"cacheRead":1218020,"output":10292},"outputContext":590700102},{"date":"2026-09-24","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":95,"tokens":{"input":977,"cacheWrite":439114,"cacheRead":11248882,"output":44237},"outputContext":5490113479},{"date":"2026-09-25","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":19,"tokens":{"input":209,"cacheWrite":93535,"cacheRead":1038543,"output":9584},"outputContext":589452635},{"date":"2026-09-27","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":64,"tokens":{"input":655,"cacheWrite":253381,"cacheRead":7300740,"output":31952},"outputContext":3769121520},{"date":"2026-09-28","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":28,"tokens":{"input":276,"cacheWrite":140541,"cacheRead":2230744,"output":13360},"outputContext":1153747881},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":38,"tokens":{"input":356,"cacheWrite":152315,"cacheRead":3272451,"output":18960},"outputContext":1641654756},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":340,"cacheWrite":134170,"cacheRead":2682489,"output":16997},"outputContext":1568755458},{"date":"2026-09-30","source":"claude-code","model":"claude-sonnet-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":31,"tokens":{"input":353,"cacheWrite":135035,"cacheRead":2371226,"output":16712},"outputContext":1324962703},{"date":"2026-10-01","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":16,"tokens":{"input":138,"cacheWrite":80233,"cacheRead":768856,"output":6943},"outputContext":382418077},{"date":"2026-10-01","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":24,"tokens":{"input":303,"cacheWrite":108412,"cacheRead":1401918,"output":11697},"outputContext":695089914},{"date":"2026-10-02","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":50,"tokens":{"input":467,"cacheWrite":243377,"cacheRead":6114791,"output":24218},"outputContext":3052033764},{"date":"2026-10-02","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":31,"tokens":{"input":291,"cacheWrite":156640,"cacheRead":2602032,"output":14670},"outputContext":1290375171},{"date":"2026-10-03","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":67,"tokens":{"input":677,"cacheWrite":296672,"cacheRead":8900888,"output":33220},"outputContext":4724382924},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":61,"tokens":{"input":601,"cacheWrite":250048,"cacheRead":7595553,"output":29379},"outputContext":3577266281},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":32,"tokens":{"input":349,"cacheWrite":148766,"cacheRead":2857812,"output":18526},"outputContext":1716421621},{"date":"2026-10-06","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":42,"tokens":{"input":371,"cacheWrite":175342,"cacheRead":4217525,"output":20010},"outputContext":2086579461},{"date":"2026-10-07","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":53,"tokens":{"input":519,"cacheWrite":232336,"cacheRead":6626491,"output":26226},"outputContext":3535583255},{"date":"2026-10-07","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":27,"tokens":{"input":299,"cacheWrite":126737,"cacheRead":2032642,"output":15950},"outputContext":1332905565},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":72,"tokens":{"input":805,"cacheWrite":314745,"cacheRead":9938479,"output":36755},"outputContext":5269927123},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":71,"tokens":{"input":823,"cacheWrite":315410,"cacheRead":9639360,"output":33996},"outputContext":4708628928},{"date":"2026-10-08","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":29,"tokens":{"input":288,"cacheWrite":144763,"cacheRead":2133553,"output":18135},"outputContext":1399436901},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":316,"cacheWrite":129817,"cacheRead":2427569,"output":15515},"outputContext":1186325442},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":15,"tokens":{"input":122,"cacheWrite":58466,"cacheRead":581654,"output":7239},"outputContext":307424407},{"date":"2026-10-09","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":52,"tokens":{"input":438,"cacheWrite":243114,"cacheRead":6293294,"output":26306},"outputContext":3344828844},{"date":"2026-10-10","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":66,"tokens":{"input":673,"cacheWrite":273538,"cacheRead":8614195,"output":31043},"outputContext":4430386287},{"date":"2026-10-11","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":71,"tokens":{"input":885,"cacheWrite":325807,"cacheRead":9676339,"output":33624},"outputContext":4753439717},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":16,"tokens":{"input":186,"cacheWrite":90712,"cacheRead":869169,"output":8201},"outputContext":521288313},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":46,"tokens":{"input":504,"cacheWrite":208473,"cacheRead":4885505,"output":22366},"outputContext":2523675175},{"date":"2026-10-13","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":244,"cacheWrite":111650,"cacheRead":1255969,"output":9499},"outputContext":611397728},{"date":"2026-10-13","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":25,"tokens":{"input":221,"cacheWrite":111841,"cacheRead":1586210,"output":11735},"outputContext":798440653},{"date":"2026-10-14","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":43,"tokens":{"input":530,"cacheWrite":183803,"cacheRead":4389683,"output":20586},"outputContext":2203768836},{"date":"2026-10-14","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":59,"tokens":{"input":674,"cacheWrite":217090,"cacheRead":6575361,"output":28579},"outputContext":3253006122},{"date":"2026-10-15","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":74,"tokens":{"input":825,"cacheWrite":309110,"cacheRead":10212638,"output":38706},"outputContext":5535358176},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":265,"cacheWrite":109170,"cacheRead":1296443,"output":8112},"outputContext":599370597},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":31,"tokens":{"input":253,"cacheWrite":156477,"cacheRead":2747706,"output":13093},"outputContext":1311357449},{"date":"2026-10-16","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":28,"tokens":{"input":336,"cacheWrite":130298,"cacheRead":1943815,"output":14701},"outputContext":1081930686},{"date":"2026-10-16","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":48,"tokens":{"input":494,"cacheWrite":215976,"cacheRead":5622539,"output":24681},"outputContext":3062604147},{"date":"2026-10-17","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":56,"tokens":{"input":530,"cacheWrite":237670,"cacheRead":6869143,"output":25467},"outputContext":3159646087},{"date":"2026-10-18","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":38,"tokens":{"input":416,"cacheWrite":162013,"cacheRead":3360821,"output":20262},"outputContext":1907957687},{"date":"2026-10-19","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":97,"tokens":{"input":1108,"cacheWrite":414100,"cacheRead":10652494,"output":48446},"outputContext":5589764863},{"date":"2026-10-19","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":65,"tokens":{"input":708,"cacheWrite":292947,"cacheRead":8732693,"output":35185},"outputContext":4755010745},{"date":"2026-10-20","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":66,"tokens":{"input":726,"cacheWrite":297357,"cacheRead":8882173,"output":32673},"outputContext":4543520242},{"date":"2026-10-20","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":128,"tokens":{"input":1264,"cacheWrite":557853,"cacheRead":16226037,"output":59579},"outputContext":7838321066}]</script>\n<script>"use strict";(()=>{var R="ccwatts",ae="0.1.1",A="https://github.com/holroydchase-afk/ccwatts",V="https://chaseholroyd.com/ccwatts/",G="https://chaseholroyd.com/ccwatts.html";var I={input:"input",cacheWrite:"cache write",cacheRead:"cache read",output:"output"},S=e=>Math.round(e).toLocaleString("en-US");function j(e){return e>=100?S(e):e>=1?(Math.round(e*10)/10).toString():e>=.01?(Math.round(e*100)/100).toString():e===0?"0":e.toPrecision(1)}var ie=e=>e>=1&&e<100?e.toFixed(1):j(e);function L(e){let t=e.high>=1e3,n=t?1e3:1,o=t?"kWh":"Wh";return{central:`${ie(e.central/n)} ${o}`,range:`${ie(e.low/n)} \\u2013 ${ie(e.high/n)}`,unit:o}}var D=e=>e.replace(/^claude-/,"");var _=["input","cacheWrite","cacheRead","output"];var J=()=>({low:0,central:0,high:0});function ce(e,t){return e.low+=t.low,e.central+=t.central,e.high+=t.high,e}function _e(e,t){let n=e.toLowerCase();for(let[o,r]of Object.entries(t.tiers))if(Array.isArray(r)&&r.some(s=>n.includes(s)))return{tier:o,known:!0};return{tier:String(t.tiers.fallback),known:!1}}function Ve(e,t){let n=e.params[t];if(!n)throw new Error(`Missing parameter "${t}" in params.json`);return n}function Ge(e,t){let n=`output_wh_per_1k.${e}`;switch(t){case"output":return[n];case"input":return[n,"input_vs_output"];case"cacheWrite":return[n,"input_vs_output","cache_write_vs_input"];case"cacheRead":return[n,"input_vs_output","cache_read_vs_input"]}}function Je(e,t,n){let o=.001,r=0,s=0;for(let a of Ge(t,n)){let c=Ve(e,a);o*=c.value,r+=Math.log(c.high/c.value)**2,s+=Math.log(c.value/c.low)**2}return{whPerToken:o,up:Math.sqrt(r),down:Math.sqrt(s)}}var Te=()=>({input:0,cacheWrite:0,cacheRead:0,output:0});var Ee=new WeakMap;function Ze(e,t,n){let o=Ee.get(e);o||Ee.set(e,o=new Map);let r=`${t}:${n}`,s=o.get(r);return s||o.set(r,s=Je(e,t,n)),s}function ve(e,t,n,o){if(e<=0)return J();let r=Ze(o,t,n),s=e*r.whPerToken;return{low:s/Math.exp(r.down),central:s,high:s*Math.exp(r.up)}}var Xe=e=>e.slice(0,10);function Z(e,t){let n=J(),o=Te(),r={model:new Map,type:new Map,day:new Map,project:new Map},s=new Set,a=null,c=null,y=(l,m,h,p,u)=>{let g=r[l].get(m);g||r[l].set(m,g={key:m,energy:J(),tokens:Te()}),ce(g.energy,h),g.tokens[p]+=u};for(let l of e){let{tier:m,known:h}=_e(l.model,t);h||s.add(l.model);let p=Xe(l.timestamp);(a===null||p<a)&&(a=p),(c===null||p>c)&&(c=p);let u=l.project?.name??"(unknown)";for(let g of _){let x=l.tokens[g];if(x<=0)continue;let T=ve(x,m,g,t);ce(n,T),o[g]+=x,y("model",l.model,T,g,x),y("type",g,T,g,x),y("day",p,T,g,x),y("project",l.project?`${u}#${l.project.id}`:u,T,g,x)}}let k=l=>[...l.values()].sort((m,h)=>h.energy.central-m.energy.central),M=[...s].map(l=>`Unknown model "${l}": estimated as ${String(t.tiers.fallback)}.`);return{methodVersion:t.version,total:n,tokens:o,responses:e.length,byModel:k(r.model),byType:k(r.type),byDay:[...r.day.values()].sort((l,m)=>l.key.localeCompare(m.key)),byProject:k(r.project),span:a&&c?{from:a,to:c}:null,warnings:M}}var le=e=>e.split("#")[0]??e;function Qe(e,t){if(t(e)===1)return"charging a phone about once";if(e>=1)return`charging a phone about ${t(e)} times`;let n=Math.round(e*100);return n<1?"under 1% of a phone charge":n>=45&&n<=55?"about half a phone charge":`about ${Math.round(n/10)*10||n}% of a phone charge`}function ue(e,t){let n=t.comparisons,o=[],r=a=>a>=10?Math.round(a):Math.round(a*10)/10,s=(a,c,y)=>r(a)===1?`1 ${c}`:`${r(a)} ${y}`;if(n.ev_kwh_per_mile){let a=e/n.ev_kwh_per_mile.value;o.push({id:"ev",amount:a,text:`driving an EV about ${s(a,"mile","miles")}`})}if(n.fridge_kwh_per_day){let a=e/n.fridge_kwh_per_day.value;o.push({id:"fridge",amount:a,text:`running a fridge about ${s(a,"day","days")}`})}if(n.phone_charge_kwh){let a=e/n.phone_charge_kwh.value;o.push({id:"phone",amount:a,text:Qe(a,r)})}if(n.us_home_kwh_per_day){let a=e/n.us_home_kwh_per_day.value;o.push({id:"home",amount:a,text:`powering a US home about ${s(a,"day","days")}`})}return o}function U(e,t){let n=ue(e,t),o=n.filter(s=>s.amount>=1).slice(0,2),r=[...n].sort((s,a)=>a.amount-s.amount).slice(0,1);return(o.length?o:r).map(s=>s.text).join(" \\xB7 ")}var Ce=A.replace(/^https:\\/\\//,"");function Me(e){return e==="all time"?"All my Claude Code use so far":e.startsWith("since")?`My Claude Code use ${e}`:`My ${e} of Claude Code`}function Le(e){return e==="all time"?"(Sample data) All of a sample\'s Claude Code use":`(Sample data) ${e[0].toUpperCase()}${e.slice(1)} of Claude Code`}function X({estimate:e,params:t,windowLabel:n,sample:o}){let r=L(e.total),s=U(e.total.central/1e3,t).split(" \\xB7 ")[0];return`${o?Le(n):Me(n)} came to about ${r.central} of electricity (range ${r.range} ${r.unit}), like ${s}. Estimated locally with ${R}, method v${t.version}: ${Ce}`}function pe(e){let{estimate:t,params:n,windowLabel:o,sample:r}=e,s=L(t.total),a=t.total.central>0?Math.round((t.byType.find(c=>c.key==="cacheRead")?.energy.central??0)/t.total.central*100):0;return r?[`(Sample data) This is what ${R} shows for a sample developer, not a real measurement. ${Le(o).replace("(Sample data) ","")}: about ${s.central} (range ${s.range} ${s.unit}), like ${U(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${a}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and it runs entirely on your own machine, so no logs leave it.","",`Try it on your own logs: ${V}`,`Code and method: ${A}`].join(`\n`):[`I estimated the electricity behind my AI coding. ${Me(o)}: about ${s.central} (range ${s.range} ${s.unit}), like ${U(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${a>=50?"The surprise: ":""}${a}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.","",`Try it in your browser: ${V}`,`Code and method: ${A}`].join(`\n`)}var v=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");function F(e,t,n){let o=Math.max(2,n-e.length-t.length-2);return`${e} ${".".repeat(o)} ${t}`}function de({estimate:e,params:t,windowLabel:n,sample:o}){let a=L(e.total),c=e.total.central/1e3,y=U(c,t).split(" \\xB7 "),k=a.unit,M=k==="kWh"?1e3:1,l=712,m=432,h=36,p=[],u="-".repeat(h);p.push({text:"ELECTRICITY RECEIPT",weight:"bold"}),p.push({text:e.span?`${e.span.from} \\u2192 ${e.span.to}`:n,muted:!0}),p.push({text:u,muted:!0});let g=[..._].sort((d,b)=>(e.byType.find(E=>E.key===b)?.energy.central??0)-(e.byType.find(E=>E.key===d)?.energy.central??0));for(let d of g){let b=e.byType.find(E=>E.key===d);p.push({text:F(I[d],`${j((b?.energy.central??0)/M)} ${k}`,h)})}p.push({text:u,muted:!0}),p.push({text:F("TOTAL (central)",a.central,h),weight:"bold"}),p.push({text:F("RANGE",`${a.range} ${k}`,h)}),p.push({text:u,muted:!0});for(let d of e.byModel.slice(0,3)){let b=e.total.central>0?Math.round(d.energy.central/e.total.central*100):0;p.push({text:F(D(d.key),`${b}%`,h),muted:!0})}p.push({text:F("responses",S(e.responses),h),muted:!0}),p.push({text:`method v${t.version} \\xB7 counts only`,muted:!0});let x=25,T=46,Y=T+44,N=Y+p.length*x+6,P=N+70,O=e.byDay.slice(-30),z=Math.max(...O.map(d=>d.energy.central),1e-9),xe=(m-64)/Math.max(O.length,1),ze=O.map((d,b)=>{let E=6+d.energy.central/z*40;return`<rect x="${(l+32+b*xe).toFixed(1)}" y="${(N+46-E).toFixed(1)}" width="${Math.max(1,xe-2).toFixed(1)}" height="${E.toFixed(1)}" fill="#1f2a24"/>`}).join(""),be=[];for(let d=0,b=l+m;b>l;d++,b-=9)be.push(`${b.toFixed(1)},${P+(d%2?10:0)}`);let Ke=`M${l},${T} H${l+m} V${P} L${be.join(" L")} L${l},${P} Z`,K="ui-monospace, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace",q="\'Helvetica Neue\', Helvetica, Arial, sans-serif",qe=p.map((d,b)=>{let E=Y+b*x,Re=b<2||d.text.startsWith("method");return`<text x="${Re?l+m/2:l+30}" y="${E}" font-family="${K}" font-size="16.5" ${Re?\'text-anchor="middle"\':""} font-weight="${d.weight??"normal"}" fill="${d.muted?"#5e6b63":"#1f2a24"}">${v(d.text)}</text>`}).join(`\n    `),$e=a.central.split(" ");return`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627" role="img" aria-label="${v(X({estimate:e,params:t,windowLabel:n,sample:o}))}">\n  <rect width="1200" height="627" fill="#12251c"/>\n  <rect x="0" y="621" width="1200" height="6" fill="#7cc4a0"/>\n  <text x="64" y="104" font-family="${K}" font-size="20" letter-spacing="2" fill="#7cc4a0">${o?\'<tspan fill="#e0b56a">SAMPLE DATA \\xB7 </tspan>\':""}CLAUDE CODE \\xB7 ${v(n.toUpperCase())}</text>\n  <text x="60" y="262" font-family="${q}" font-size="148" font-weight="700" fill="#f4f1e8">${v($e[0]??"")}<tspan font-size="64" font-weight="500" dx="14">${v($e[1]??"")}</tspan></text>\n  <text x="64" y="318" font-family="${q}" font-size="28" fill="#cfe3d6">of electricity, range ${v(a.range)} ${k}</text>\n  ${y.map((d,b)=>`<text x="64" y="${384+b*38}" font-family="${q}" font-size="26" fill="#f4f1e8">\\u2248 ${v(d)}</text>`).join(`\n  `)}\n  <text x="64" y="520" font-family="${q}" font-size="20" fill="${o?"#e0b56a":"#9fb8a8"}">${o?"Sample data, not a real measurement.":"Estimated on my laptop. No logs left it."}</text>\n  <text x="64" y="552" font-family="${K}" font-size="17" fill="#7cc4a0">${v(R)} \\xB7 method v${v(t.version)}</text>\n  <text x="64" y="578" font-family="${K}" font-size="17" fill="#7cc4a0">${v(Ce)}</text>\n  <path d="${Ke}" fill="#f7f5ef"/>\n  <g>\n    ${qe}\n  </g>\n  ${ze}\n</svg>\n`}var et=/[\\u0000-\\u001f\\u007f-\\u009f\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;function W(e,t=64){let n=e.replace(et,"");if(n.length<=t)return n;let o="";for(let r of n){if(o.length+r.length>t-1)break;o+=r}return`${o}\\u2026`}function tt(e){let t=0xcbf29ce484222325n,n=0x100000001b3n;for(let o=0;o<e.length;o++)t^=BigInt(e.charCodeAt(o)),t=t*n&0xffffffffffffffffn;return t.toString(16).padStart(16,"0")}function me(e){let t=e.replace(/[\\\\/]+$/,""),n=t.split(/[\\\\/]/).pop()||t,o=t===""?"(root)":W(n)||"(unnamed)";return{id:tt(t),name:o}}var Se=1e9,Q=(e,t=!1)=>e===null&&t?null:typeof e!="number"||e<=0?0:Number.isInteger(e)&&e<=Se?e:null,nt=e=>/^\\d{4}-\\d{2}-\\d{2}/.test(e)&&!Number.isNaN(Date.parse(e)),H=e=>typeof e=="string"&&e!==""?e:null;function ot(e){if(e.type!=="assistant")return null;let t=e.message,n=t?.usage,o=H(t?.model),r=H(e.timestamp),s=H(t?.id);if(!n||!o||!r||!s||!nt(r)||o==="<synthetic>")return null;let a=Q(n.input_tokens,!0),c=Q(n.cache_creation_input_tokens),y=Q(n.cache_read_input_tokens),k=Q(n.output_tokens,!0);if(a===null||c===null||y===null||k===null)return null;let M=H(e.cwd);return{source:"claude-code",key:`${s}:${H(e.requestId)??""}`,timestamp:r,model:W(o)||"(unnamed)",project:M?me(M):null,tokens:{input:a,cacheWrite:c,cacheRead:y,output:k}}}var he={id:"claude-code",parse(e){let t=new Map;for(let n of e.replace(/^\\uFEFF/,"").split(`\n`)){if(!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}let r=ot(o);r&&t.set(r.key,r)}return[...t.values()]}};function ge(e){let t=new Map;for(let n of e)t.set(`${n.source}:${n.key}`,n);return[...t.values()]}var Pe={version:"0.1.0",as_of:"2026-10-21",license:"CC BY 4.0",boundary:"comprehensive: accelerators, host CPU and memory, idle capacity, and data-center overhead (PUE)",interval:"low and high are each parameter\'s plausible bounds, treated as a ~90% interval",params:{"output_wh_per_1k.opus":{value:1.2,low:.4,high:3,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models."},"output_wh_per_1k.sonnet":{value:.6,low:.25,high:1.5,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://arxiv.org/abs/2508.15734",as_of:"2026-10-21",note:"Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google\'s measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k."},"output_wh_per_1k.haiku":{value:.25,low:.08,high:.6,unit:"Wh per 1k output tokens",label:"GUESS",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute."},input_vs_output:{value:.3,low:.15,high:.5,unit:"ratio",label:"MODELED",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3."},cache_write_vs_input:{value:1,low:.8,high:1.25,unit:"ratio",label:"MODELED",source:"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",as_of:"2026-10-21",note:"Writing to the cache means processing the tokens fresh, then storing the result. Priced at 1.25x input."},cache_read_vs_input:{value:.1,low:.01,high:.25,unit:"ratio",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather\'s central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input."}},tiers:{opus:["opus"],sonnet:["sonnet"],haiku:["haiku"],fallback:"sonnet"},comparisons:{ev_kwh_per_mile:{value:.3,unit:"kWh per mile",label:"MEASURED",source:"https://www.fueleconomy.gov/feg/evsbs.shtml",as_of:"2026-10-21",note:"Typical EV uses 25-35 kWh per 100 miles (EPA)."},fridge_kwh_per_day:{value:1.5,unit:"kWh per day",label:"MEASURED",source:"https://www.energystar.gov/products/refrigerators",as_of:"2026-10-21",note:"A typical US refrigerator uses about 400-600 kWh a year."},us_home_kwh_per_day:{value:29,unit:"kWh per day",label:"MEASURED",source:"https://www.eia.gov/tools/faqs/faq.php?id=97&t=3",as_of:"2026-10-21",note:"Average US household used about 10,800 kWh in a year (EIA)."},phone_charge_kwh:{value:.019,unit:"kWh per smartphone charge",label:"MEASURED",source:"https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",as_of:"2026-10-21",note:"EPA\'s figure for fully charging one smartphone."}}};var $=Pe;var ee=e=>`${e.date}|${e.source}|${e.model}|${e.projectId??""}`;var Ae=e=>e.output*(e.input+e.cacheWrite+e.cacheRead);function fe(e){let t=new Map;for(let n of e){let o={date:n.timestamp.slice(0,10),source:n.source,model:n.model,projectId:n.project?.id??null,projectName:n.project?.name??null},r=ee(o),s=t.get(r);s||t.set(r,s={...o,responses:0,tokens:{input:0,cacheWrite:0,cacheRead:0,output:0},outputContext:0}),s.responses+=1;for(let a of _)s.tokens[a]+=n.tokens[a];s.outputContext+=Ae(n.tokens)}return st([...t.values()])}function st(e){return e.sort((t,n)=>ee(t).localeCompare(ee(n)))}function te(e){return e.map(t=>({source:t.source,key:ee(t),timestamp:`${t.date}T00:00:00.000Z`,model:t.model,project:t.projectId?{id:t.projectId,name:t.projectName??"(unknown)"}:null,tokens:{...t.tokens}}))}var at="No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";async function je(e){let t=[...e].filter(o=>o.name.endsWith(".jsonl"));if(!t.length)return{ok:!1,status:at};let n=[];for(let o of t)try{n.push(await o.text())}catch{return{ok:!1,status:"Couldn\'t read one of those files. Try again, or pick the files instead of the folder."}}return{ok:!0,texts:n,what:`${t.length} file${t.length===1?"":"s"}`}}var it="Paste the lines first.";function Ue(e){return e==="pasted text"?"We couldn\'t find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.":`We couldn\'t find any Claude Code usage in ${e==="1 file"?"that file":"those files"}. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.`}function Ne(e){return e.trim()?{ok:!0,texts:[e],what:"pasted text"}:{ok:!1,status:it}}var i=e=>document.getElementById(e),f=e=>e.replace(/[&<>"\']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"})[t]);function Oe(e,t){try{return JSON.parse(i(e).textContent??"")}catch{return t}}var C=Oe("ccwatts-data",{mode:"playground",generatedAt:null,rows:[]}),De=Oe("ccwatts-sample",[]),w={rows:C.mode==="dashboard"&&C.rows.length?C.rows:De,source:C.mode==="dashboard"&&C.rows.length?"history":"sample",window:"30d"},ct={"7d":"last 7 days","30d":"last 30 days",all:"all time"};function lt(e,t){if(t==="all"||e.length===0)return e;let n=t==="7d"?7:30,o=e.reduce((a,c)=>c.date>a?c.date:a,"0000-00-00"),r=w.source==="history"?Date.now():Date.parse(`${o}T00:00:00Z`)+864e5,s=new Date(r-n*864e5).toISOString().slice(0,10);return e.filter(a=>a.date>=s)}function ut(e){let t=Z(te(e),$);return t.responses=e.reduce((n,o)=>n+o.responses,0),t}function pt(e,t){let n=L(e.total),[o,r]=n.central.split(" ");i("hero-eyebrow").textContent=`Claude Code electricity \\xB7 ${t}`,i("hero-big").innerHTML=e.responses?`${f(o??"")}<small>${f(r??"")}</small>`:"\\u2013",i("hero-range").textContent=e.responses?`Plausible range ${n.range} ${n.unit}, from the bounds on every assumption.`:"No usage in this window.",i("hero-compare").textContent=e.responses?`That\'s like ${U(e.total.central/1e3,$).replace(" \\xB7 ",", or ")}.`:"";let s=_.reduce((c,y)=>c+e.tokens[y],0),a=[`${S(e.responses)} responses`,`${S(s)} tokens`,...e.span?[e.span.from===e.span.to?e.span.from:`${e.span.from} to ${e.span.to}`]:[],`method v${$.version}`];i("hero-meta").innerHTML=a.map(c=>`<span>${f(c)}</span>`).join(" \\xB7 ");for(let c of["7d","30d","all"])i(`w-${c}`).setAttribute("aria-pressed",String(w.window===c))}function Fe(e){let t=i("chart"),n=Math.round(Math.min(720,Math.max(320,t.getBoundingClientRect().width||720))),o=240;t.setAttribute("viewBox",`0 0 ${n} ${o}`);let r={l:44,r:8,t:22,b:28},s=e.byDay;if(i("legend").innerHTML=["cacheRead","cacheWrite","output","input"].map(u=>`<span><i style="background:var(--t-${u})"></i>${I[u]}</span>`).join(""),!s.length){t.innerHTML=`<text x="${n/2}" y="${o/2}" text-anchor="middle">No usage in this window</text>`,i("chart-note").textContent="";return}let a=L(e.total),c=a.unit==="kWh"?1e3:1,y=Math.max(...s.map(u=>u.energy.central))/c,k=ht(y/3),M=Math.max(k*Math.ceil(y/k),k),l=u=>r.t+(o-r.t-r.b)*(1-u/M),m=(n-r.l-r.r)/s.length,h=[];for(let u=0;u<=M+1e-9;u+=k)h.push(`<line x1="${r.l}" x2="${n-r.r}" y1="${l(u)}" y2="${l(u)}" stroke="var(--line)" stroke-width="1"/>`),h.push(`<text x="${r.l-6}" y="${l(u)+4}" text-anchor="end">${j(u)}</text>`);h.push(`<text x="0" y="10">${f(a.unit)} per day</text>`),s.forEach((u,g)=>{let x=0,T=r.l+g*m+m*.12,Y=Math.max(1,m*.76);for(let N of["cacheRead","cacheWrite","output","input"]){let P=dt(u,N);if(P<=0)continue;let O=x/c;x+=P;let z=x/c;h.push(`<rect x="${T.toFixed(1)}" y="${l(z).toFixed(1)}" width="${Y.toFixed(1)}" height="${Math.max(.5,l(O)-l(z)).toFixed(1)}" fill="var(--t-${N})"><title>${f(u.key)} ${f(I[N])} ${j(P/c)} ${f(a.unit)}</title></rect>`)}});let p=s.length===1?[0]:[0,Math.floor((s.length-1)/2),s.length-1];for(let u of new Set(p)){let g=u===0?"start":u===s.length-1?"end":"middle",x=u===0?r.l:u===s.length-1?n-r.r:r.l+(u+.5)*m;h.push(`<text x="${x}" y="${o-8}" text-anchor="${g}">${f(s[u].key.slice(5))}</text>`)}t.innerHTML=h.join(""),i("chart-note").textContent=`Bars show the central estimate per day. The total for this window is ${a.central}, with a range of ${a.range} ${a.unit}.`}function dt(e,t){return oe.get(e.key)?.[t]??0}var oe=new Map;function mt(e){oe=new Map;for(let t of e){let n=Z(te([t]),$),o=oe.get(t.date);o||oe.set(t.date,o={input:0,cacheWrite:0,cacheRead:0,output:0});for(let r of n.byType)o[r.key]+=r.energy.central}}function ht(e){if(e<=0)return 1;let t=10**Math.floor(Math.log10(e)),n=e/t;return(n<=1?1:n<=2?2:n<=5?5:10)*t}function Ie(e,t,n,o){let r=Math.max(...t.map(a=>a.energy.central),1e-9),s=t.slice(0,6);i(e).innerHTML=s.length?s.map(a=>{let c=L(a.energy),y=o.total.central?Math.round(a.energy.central/o.total.central*100):0;return`<li><span class="name" title="${f(n(a.key))}">${f(n(a.key))}</span><span class="val">${f(c.central)} \\xB7 ${y}%</span><span class="bar"><span style="width:${(a.energy.central/r*100).toFixed(1)}%"></span></span><span class="val" style="grid-column:1/-1;text-align:left">range ${f(c.range)} ${f(c.unit)}</span></li>`}).join(""):\'<li><span class="name">No usage in this window</span></li>\'}function gt(e){let t=r=>e.total.central?Math.round((e.byType.find(s=>s.key===r)?.energy.central??0)/e.total.central*100):0,n=_.reduce((r,s)=>r+e.tokens[s],0),o=n?Math.round(e.tokens.cacheRead/n*100):0;i("explain").textContent=e.responses?`Each time Claude Code takes a step, it re-reads the conversation so far. Most of that comes from a cache, which is cheap per token but happens constantly. Here, cache reads were ${o}% of tokens and about ${t("cacheRead")}% of the electricity. Writing new context into the cache was ${t("cacheWrite")}%, and the text the model wrote back was ${t("output")}%. Long sessions grow the context the agent re-reads, so starting fresh sessions for new tasks is the simplest way to lower your number.`:"Load some usage to see what drives it."}var re="",ne="",He="",we="";function ft(e,t){let n={estimate:e,params:$,windowLabel:t,sample:w.source==="sample"};re=de(n),He=X(n),we=pe(n),i("card").src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(re)}`,ne&&URL.revokeObjectURL(ne),ne=URL.createObjectURL(new Blob([re],{type:"image/svg+xml"})),i("card-full").href=ne,i("post").textContent=we,i("share-status").textContent=w.source==="sample"?"This card shows sample data. Load your own logs to make yours.":""}function yt(e){try{return new URL(e).hostname.replace(/^www\\./,"")}catch{return"source"}}function wt(){i("method-intro").textContent=`Energy = tokens \\xD7 energy per token, by model family and token type. Each parameter below has a low and high bound, and they combine into the range you see. The boundary is ${$.boundary}. Labels say how solid each number is: MODELED is derived from published figures, GUESS is a best estimate with wide bounds. Method v${$.version}, parameters as of ${$.as_of}, licensed ${$.license}.`;let e=Object.entries($.params).map(([t,n])=>`<tr><td data-label="Parameter"><code>${f(t)}</code><div class="note">${f(n.note)}</div></td><td class="num" data-label="Value">${n.value}</td><td class="num" data-label="Range">${n.low} \\u2013 ${n.high}</td><td data-label="Unit">${f(n.unit)}</td><td data-label="Label"><span class="label">${f(n.label)}</span></td><td data-label="Source"><a class="src" href="${f(n.source)}" rel="noopener noreferrer">${f(yt(n.source))}</a></td></tr>`).join("");i("params").innerHTML=`<thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead><tbody>${e}</tbody>`}var kt={sample:"ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You\'re looking at sample data; try your own logs below.",files:"ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You\'re looking at the files you loaded; nothing was uploaded.",history:"ccwatts estimates the electricity behind your Claude Code use from the token counts in its local logs, as a range with every assumption sourced."},ke=null;function se(){let e=lt(w.rows,w.window);mt(e);let t=ut(e);ke=t;let n=ct[w.window],o=i("source-pill");o.textContent=w.source==="sample"?"Sample data":w.source==="history"?"Your history":"Your files",o.classList.toggle("sample",w.source==="sample"),i("lede").textContent=kt[w.source],pt(t,n),Fe(t),Ie("by-model",t.byModel,D,t),Ie("by-project",t.byProject,le,t),gt(t),ft(t,n)}function B(e,t=!1){let n=i("drop-status");n.textContent=e,n.classList.toggle("error",t),t&&n.scrollIntoView({block:"nearest"})}async function We(e){B("Reading files on this device\\u2026"),Be(await je(e))}function Be(e){if(!e.ok)return B(e.status,!0);let t=[];for(let o of e.texts)t.push(...he.parse(o));let n=fe(ge(t));if(!n.length)return B(Ue(e.what),!0);w.rows=n,w.source="files",w.window="all",B(`Read ${S(t.length)} responses from ${e.what}. Nothing was uploaded.`),se()}function Ye(e,t){let n=document.createElement("a");n.href=URL.createObjectURL(t),n.download=e,document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(n.href),1e3)}async function ye(e,t,n="share-status",o="post"){let r=i(n);r.classList.remove("error");try{await navigator.clipboard.writeText(e),r.textContent=`Copied the ${t}.`}catch{let s=i(o).closest("details");s&&(s.open=!0);let a=document.createRange();a.selectNodeContents(i(o)),getSelection()?.removeAllRanges(),getSelection()?.addRange(a),r.textContent=`Couldn\'t reach the clipboard. The ${o==="post"?"post text":t} is selected so you can copy it.`}}function xt(){let e=new Image;e.onload=()=>{let t=document.createElement("canvas");t.width=1200,t.height=627,t.getContext("2d").drawImage(e,0,0,1200,627),t.toBlob(n=>n&&Ye(`${R}-receipt.png`,n),"image/png")},e.src=i("card").src}function bt(){for(let o of["7d","30d","all"])i(`w-${o}`).addEventListener("click",()=>{w.window=o,se()});if(i("save-png").addEventListener("click",xt),i("save-svg").addEventListener("click",()=>Ye(`${R}-receipt.svg`,new Blob([re],{type:"image/svg+xml"}))),i("copy-line").addEventListener("click",()=>{ye(He,"share line")}),i("copy-post").addEventListener("click",()=>{ye(we,"LinkedIn post")}),C.mode==="playground"){let o=i("drop");o.hidden=!1,i("copy-prompt").addEventListener("click",()=>{ye(i("export-prompt").textContent??"","prompt","drop-status","export-prompt")}),i("read-paste").addEventListener("click",()=>{Be(Ne(i("paste-log").value))});for(let s of["pick-folder","pick-files"])i(s).addEventListener("change",a=>{let c=a.target.files;c&&We(c)});i("use-sample").addEventListener("click",()=>{w.rows=De,w.source="sample",w.window="30d",B(""),se()});let r=s=>a=>{a.preventDefault(),o.classList.toggle("over",s)};o.addEventListener("dragover",r(!0)),o.addEventListener("dragleave",r(!1)),o.addEventListener("drop",s=>{r(!1)(s),s.dataTransfer?.files&&We(s.dataTransfer.files)})}let e=0,t=i("chart").getBoundingClientRect().width;if(window.addEventListener("resize",()=>{clearTimeout(e),e=window.setTimeout(()=>{let o=i("chart").getBoundingClientRect().width;ke&&Math.round(o)!==Math.round(t)&&Fe(ke),t=o},150)}),i("repo-link").href=A,i("cli-cmd").textContent=`npx ${R}`,i("built-by").href=G,C.mode==="playground"){let o=i("back-link");o.href=G,o.hidden=!1,i("jump").hidden=!1}let n=C.generatedAt?` \\xB7 written ${C.generatedAt.slice(0,16).replace("T"," ")} UTC`:"";i("footer-version").textContent=`${R} v${ae} \\xB7 method v${$.version}${n}. Electricity only, not carbon or water.`,document.title=C.mode==="dashboard"?`${R} dashboard`:`${R} playground`}bt();wt();se();})();</script>\n</body>\n</html>\n';

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
var sampleRows = () => readSample(ccwatts_default);

// src/errors.ts
function reason(error) {
  const code = error?.code;
  if (typeof code === "string") return code;
  if (error instanceof Error) return error.name;
  return "unknown error";
}
var ABSOLUTE_PATH = /(?<=^|[\s'"`(\[])(?:[A-Za-z]:)?(?:[\\/][^\s'"`\\/)\]]+){2,}[\\/]?/g;
var QUOTED_PATH = /(['"`])((?:[A-Za-z]:)?[\\/][^'"`]*)\1/g;
var lastPart = (path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
function errorLine(error) {
  if (error instanceof Error)
    return error.message.replace(/https?:\S+/g, "(link removed)").replace(QUOTED_PATH, (_m, q, path) => `${q}${lastPart(path)}${q}`).replace(ABSOLUTE_PATH, lastPart);
  return "Something went wrong.";
}

// src/render.ts
var energy = formatEnergy;
var totalTokens2 = (t) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);
function percent(part, total) {
  if (!(total > 0)) return "0%";
  const p = Math.round(part / total * 100);
  return p === 0 && part > 0 ? "<1%" : `${p}%`;
}
function shares(rows, total, label, max = 4) {
  const shown = rows.slice(0, max).map((r) => `${clip(label(r.key))} ${percent(r.energy.central, total)}`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${percent(rest, total)}`);
  return shown.join("   ");
}
var LABEL_MAX = 40;
function clip(label, max = LABEL_MAX) {
  const chars = [...label];
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}\u2026`;
}
function styles(on = false) {
  const wrap = (open, close) => (s) => on && s ? `\x1B[${open}m${s}\x1B[${close}m` : s;
  return { bold: wrap("1", "22"), dim: wrap("2", "22"), yellow: wrap("33", "39") };
}
function header(params, window) {
  return `${APP_NAME} v${APP_VERSION} \xB7 method v${params.version} \xB7 ${window.label}`;
}
function summary(e, params, window, sample = false, opts = {}) {
  if (e.responses === 0) return `${header(params, window)}

  No Claude Code usage found in this window. Try --since all.`;
  const { bold, dim } = styles(opts.color);
  const total = energy(e.total);
  const kwh = e.total.central / 1e3;
  const compare = everyday(kwh, params);
  const top = e.byProject[0];
  const lines = [
    header(params, window),
    "",
    `  Electricity   ${bold(total.central)}   ${dim(`(range ${total.range})`)}`,
    `  \u2248 ${compare}`,
    "",
    `  By model      ${shares(e.byModel, e.total.central, shortModel, 3)}`,
    `  By type       ${shares(e.byType, e.total.central, (k) => TYPE_LABELS[k])}`
  ];
  if (top) {
    const t = energy(top.energy);
    lines.push(`  Top project   ${clip(projectName(top.key))}   ${t.central} ${dim(`(range ${t.range})`)}`);
  }
  const span = !e.span ? "" : e.span.from === e.span.to ? ` \xB7 ${e.span.from}` : ` \xB7 ${e.span.from} to ${e.span.to}`;
  lines.push(`  Based on      ${int(e.responses)} response${e.responses === 1 ? "" : "s"}, ${int(totalTokens2(e.tokens))} tokens${span}`);
  for (const w of e.warnings) lines.push(`  Note          ${w}`);
  const next = sample ? `Your own usage: ${APP_NAME}` : `Share: ${APP_NAME} receipt`;
  lines.push("", dim(`  How this is estimated: ${APP_NAME} --method   \xB7   ${next}`));
  return lines.join("\n");
}
function table(head, rows, alignLeft = 1, o = {}) {
  const { dim } = styles(o.color);
  const indent = o.indent ?? "  ";
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const left = (i) => (o.align?.[i] ?? (i < alignLeft ? "left" : "right")) === "left";
  const line = (cells, styled) => indent + cells.map((c, i) => {
    const padded = left(i) ? c.padEnd(widths[i]) : c.padStart(widths[i]);
    return styled && o.dimCols?.includes(i) ? dim(padded) : padded;
  }).join("   ").trimEnd();
  return [line(head, false), dim(indent + widths.map((w) => "-".repeat(w)).join("   ")), ...rows.map((r) => line(r, true))].join("\n");
}
var DIM_ROWS = { model: "byModel", type: "byType", day: "byDay", project: "byProject" };
function breakdown(e, params, window, dim, opts = {}) {
  const rows = e[DIM_ROWS[dim]];
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1e3 : 1;
  const label = (key) => dim === "type" ? TYPE_LABELS[key] : dim === "project" ? clip(projectName(key)) : dim === "model" ? clip(shortModel(key)) : key;
  const body = rows.map((r) => [
    label(r.key),
    int(totalTokens2(r.tokens)),
    num(r.energy.central / scale),
    `${num(r.energy.low / scale)} \u2013 ${num(r.energy.high / scale)}`,
    percent(r.energy.central, e.total.central)
  ]);
  const t = energy(e.total);
  body.push(["total", int(totalTokens2(e.tokens)), num(e.total.central / scale), t.range, "100%"]);
  return [header(params, window), "", table([dim, "tokens", unit, "range", "share"], body, 1, { dimCols: [3], color: opts.color })].join("\n");
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
  lines.push(table(["parameter", "value", "range", "unit", "label"], rows, 1, { indent: "" }));
  lines.push("", "Sources:");
  for (const [id, p] of Object.entries(params.params)) lines.push(`  ${id}: ${p.source}`);
  lines.push("", "Comparisons (central value only):");
  for (const [id, c] of Object.entries(params.comparisons)) lines.push(`  ${id}: ${c.value} ${c.unit} \xB7 ${c.source}`);
  lines.push("", `Full write-up: ${REPO_URL}/blob/main/METHODOLOGY.md`);
  return lines.join("\n");
}
function json(e, params, window, sample = false) {
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
      ...sample ? { sample: true } : {},
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
function jsonError(error, message) {
  return JSON.stringify({ app: APP_NAME, version: APP_VERSION, error, message }, null, 2);
}
var BARS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
function sparkline(values) {
  const max = Math.max(...values, 0);
  return values.map((v) => max === 0 ? BARS[0] : BARS[Math.min(7, Math.round(v / max * 7))]).join("");
}
function history(e, params, window, storedDays, opts = {}) {
  if (e.responses === 0) return `${header(params, window)}

  No history yet. Run ${APP_NAME} once to start recording.`;
  const { bold, dim } = styles(opts.color);
  const weeks = weekly(e.byDay);
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1e3 : 1;
  const current = weekStart((opts.now ?? /* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  const partial = (start) => start === current;
  const tag = (start) => partial(start) ? `${start} (partial)` : start;
  const peak = Math.max(...weeks.map((x) => x.central), 1e-9);
  const rows = weeks.map((w) => [
    `week of ${tag(w.start)}`,
    num(w.central / scale),
    `${num(w.low / scale)} \u2013 ${num(w.high / scale)}`,
    "\u2588".repeat(Math.round(w.central / peak * 20))
  ]);
  const active = weeks.filter((w) => w.central > 0);
  const complete = active.filter((w) => !partial(w.start));
  const pool = complete.length ? complete : active;
  const best = pool.reduce((a, b) => b.central < a.central ? b : a, pool[0]);
  const worst = active.reduce((a, b) => b.central > a.central ? b : a, active[0]);
  const total = energy(e.total);
  const lines = [
    header(params, window),
    "",
    table(["week", unit, "range", "trend"], rows, 1, { align: ["left", "right", "right", "left"], dimCols: [2], color: opts.color }),
    "",
    `  Trend         ${sparkline(weeks.map((w) => w.central))}`,
    `  Total         ${bold(total.central)}   ${dim(`(range ${total.range})`)}`,
    // With one week of use, "lightest" and "heaviest" would name the same week.
    ...active.length > 1 && best !== worst ? [
      `  Lightest week ${tag(best.start)}   ${energy(best).central} ${dim(`(range ${energy(best).range})`)}`,
      `  Heaviest week ${tag(worst.start)}   ${energy(worst).central} ${dim(`(range ${energy(worst).range})`)}`
    ] : [],
    `  Recorded      ${storedDays} day${storedDays === 1 ? "" : "s"}, kept in your local history even after Claude Code deletes old logs`,
    "",
    dim(`  Energy is recalculated from stored token counts with method v${params.version}.`)
  ];
  return lines.join("\n");
}
var csvCell = (v) => {
  if (typeof v === "number") return String(v);
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
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

// src/usage.ts
import { stat as stat2 } from "fs/promises";
import { basename } from "path";

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
  const unreadable = [];
  const parsed = await Promise.all(
    files.map(async (f) => {
      try {
        return claudeCodeAdapter.parse(await readFile2(f, "utf8"));
      } catch (error) {
        unreadable.push(reason(error));
        return [];
      }
    })
  );
  return { roots, files: files.length, records: dedupe(parsed.flat()), unreadable };
}
function unreadableNote(reasons) {
  if (!reasons.length) return null;
  const n = reasons.length;
  return `${n} log file${n === 1 ? "" : "s"} couldn't be read (${[...new Set(reasons)].sort().join(", ")}).`;
}

// src/usage.ts
async function loadUsage(options) {
  const demo = Boolean(options.demo);
  if (options.path && !demo && !await stat2(options.path).catch(() => null)) {
    throw new Error(`"${basename(options.path)}" doesn't exist. Check the folder or file given to --path.`);
  }
  const logs = demo ? { roots: [], files: 0, records: [], unreadable: [] } : await loadLogs(options.path ? [options.path] : defaultLogRoots());
  const sample = demo ? sampleRows() : [];
  const now = demo ? /* @__PURE__ */ new Date(`${sample.map((r) => r.date).sort().at(-1)}T23:59:59Z`) : /* @__PURE__ */ new Date();
  const { kept, future } = dropFuture(logs.records, now);
  logs.records = kept;
  const notes = [unreadableNote(logs.unreadable), future ? futureNote(future) : null].filter((n) => n !== null);
  let rows = demo ? sample : rollup(logs.records);
  if (!options.noHistory && !options.path && !demo) {
    const stored = await readHistory().catch((error) => {
      const why = reason(error);
      console.error(`Couldn't read history (${why}). Using current logs only.`);
      return [];
    });
    rows = mergeHistory(stored, rows);
    if (logs.records.length > 0) {
      await writeHistory(rows).catch((error) => {
        const why = reason(error);
        console.error(`Couldn't save history (${why}). Continuing without it.`);
      });
    }
  }
  return { rows, records: logs.records, roots: logs.roots, files: logs.files, now, sample: demo, notes };
}
var rowsIn = (rows, window) => window.start ? rows.filter((r) => r.date >= window.start.slice(0, 10)) : [...rows];
function estimateWindow(usage, window, params) {
  const hourly = Boolean(window.start && window.label.includes("hour"));
  const inWindow = rowsIn(usage.rows, window);
  const e = estimate(hourly ? since(usage.records, window.start) : rollupRecords(inWindow), params);
  if (!hourly) e.responses = inWindow.reduce((n, r) => n + r.responses, 0);
  e.warnings.push(...usage.notes ?? []);
  return e;
}

// src/index.ts
function useColor(env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== void 0 && env.FORCE_COLOR !== "") return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return isTTY;
}
var MCP_ADD = `claude mcp add ${APP_NAME} -- npx -y ${APP_NAME} mcp`;
var HELP = `Usage: ${APP_NAME} [command] [options]

Estimates the electricity your Claude Code usage consumed, as a range.
Reads local logs only. Nothing leaves your machine.

Commands:
  (none)            Summary for the time window
  history           Weekly trend, all-time total, best and worst weeks
  dashboard         Write an offline HTML dashboard of your history and open it
  receipt           Share line, LinkedIn post text and a 1200\xD7627 card (SVG)
  statusline        One line for the Claude Code status line (reads its JSON on stdin)
  mcp               MCP server on stdio, so Claude Code can ask about its own energy use
  help              Show this help

Options:
  --since <when>    7d, 12h, 4w, 2026-10-01 or all (default 30d; history defaults to all)
  --by <dim>        Breakdown table: model, day, project or type
  --json            Machine-readable output, same numbers, in Wh
  --method          Parameters, sources and method version
  --export csv      With history: daily rows as CSV on stdout
  --out <file>      With receipt: where to write the card (default ./${APP_NAME}-receipt.svg)
  --demo            Try it on synthetic sample data (no logs needed)
  --path <dir>      Estimate just this folder or .jsonl file (history is left alone)
  --no-open         With dashboard: write the file but don't open it
  --no-history      Don't read or update ~/.${APP_NAME}/history.jsonl
  -v, --version     Show the version
  -h, --help        Show this help

Logs somewhere else? Set CLAUDE_CONFIG_DIR, as Claude Code does, to keep your history.`;
var MCP_HELP = `Usage: ${APP_NAME} mcp [--path <dir>] [--demo] [--no-history]

Runs an MCP server on stdio, so Claude Code can ask about its own energy use.
Claude Code starts it for you; you don't run it by hand. To add it:

  ${MCP_ADD}

Tools: energy_summary, energy_by_project, energy_weekly, methodology.
Reads local logs only. No port, no network.`;
var PLAYGROUND = PLAYGROUND_URL;
var DIMS = ["model", "day", "project", "type"];
var COMMANDS = ["summary", "history", "receipt", "dashboard", "statusline", "mcp", "help"];
function plainArgError(error) {
  const code = error.code;
  const message = error instanceof Error ? error.message : "";
  const option = message.match(/'(-{1,2}[\w-]+)/)?.[1];
  const help = `Run ${APP_NAME} --help to see the options.`;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return new Error(`Unknown option "${option}". ${help}`);
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") return new Error(`${option} needs a value. ${help}`);
  return void 0;
}
async function main() {
  const { values, positionals } = parseArgsPlain({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      by: { type: "string" },
      json: { type: "boolean" },
      method: { type: "boolean" },
      export: { type: "string" },
      out: { type: "string" },
      path: { type: "string" },
      demo: { type: "boolean" },
      "no-history": { type: "boolean" },
      "no-open": { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" }
    }
  });
  if (positionals[0] === "help") return void console.log(HELP);
  if (values.help) return void console.log(positionals[0] === "mcp" ? MCP_HELP : HELP);
  if (values.version) return void console.log(`${APP_NAME} ${APP_VERSION}`);
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
  if (command === "mcp") return runMcp({ path: values.path, demo: values.demo, noHistory: values["no-history"] });
  const by = values.by;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);
  if (values.export && values.export !== "csv") throw new Error(`--export supports csv only`);
  if (values.export && command !== "history") throw new Error(`--export works with ${APP_NAME} history. Try: ${APP_NAME} history --export csv`);
  const demo = Boolean(values.demo);
  if (demo && (command === "receipt" || command === "dashboard")) {
    console.error(
      `${command} is for your own usage, so it doesn't run on sample data. The playground shows the sample ${command === "receipt" ? "card" : "dashboard"}: ${PLAYGROUND}`
    );
    process.exitCode = 1;
    return;
  }
  const usage = await loadUsage({ path: values.path, demo, noHistory: values["no-history"] });
  const { rows } = usage;
  const window = parseSince(values.since ?? (command === "history" || demo ? "all" : "30d"), usage.now);
  if (rows.length === 0) {
    const oneFile = usage.files === 1 && values.path !== void 0 && Boolean((await stat3(values.path).catch(() => null))?.isFile());
    const where = values.path ? ` in ${basename2(values.path)}` : "";
    const found = oneFile ? `${basename2(values.path)} has no Claude Code usage.` : `Found ${usage.files} .jsonl file${usage.files === 1 ? "" : "s"}${where}, but no Claude Code usage in ${usage.files === 1 ? "it" : "them"}.`;
    if (values.json) {
      console.log(usage.files > 0 ? jsonError("no_usage", found) : jsonError("no_logs", "No Claude Code logs found."));
      process.exitCode = 1;
      return;
    }
    if (usage.files > 0) {
      console.log(found);
      for (const note of usage.notes) console.log(note);
      console.log(`Claude Code keeps its logs in ~/.claude/projects. Point ${APP_NAME} there, or at one session file, with --path.`);
      return;
    }
    const { dim } = styles(useColor());
    console.log(`No Claude Code logs yet. Try ${APP_NAME} --demo, or point at a folder with --path <dir>.`);
    console.log("");
    console.log("Looked in:");
    for (const r of usage.roots) console.log(dim(`  ${r}`));
    console.log("");
    console.log(`Or try it in your browser: ${PLAYGROUND}`);
    return;
  }
  const noteToStderr = () => {
    for (const note of usage.notes) console.error(`Note: ${note}`);
  };
  if (command === "dashboard") {
    noteToStderr();
    const path = await writeDashboard(rows);
    console.log(`Dashboard written to ${path}. It works offline and makes no network requests.`);
    if (!values["no-open"]) openFile(path);
    return;
  }
  const inWindow = rowsIn(rows, window);
  const est = estimateWindow(usage, window, params);
  const opts = { color: !values.json && !values.export && useColor(), now: usage.now };
  const label = demo && !values.json && !values.export ? `${styles(opts.color).yellow("Sample data (synthetic), not your usage.")}

` : "";
  if (command === "history") {
    if (!values.json) noteToStderr();
    if (values.export) return void console.log(historyCsv(inWindow, params));
    if (values.json) return void console.log(json(est, params, window, demo));
    if (label) process.stdout.write(label);
    return void console.log(history(est, params, window, new Set(rows.map((r) => r.date)).size, opts));
  }
  if (command === "receipt") {
    const input = { estimate: est, params, windowLabel: window.label };
    const out = resolve(values.out ?? `${APP_NAME}-receipt.svg`);
    try {
      await writeFile3(out, receiptSvg(input));
    } catch (error) {
      const why = reason(error);
      const hint = why === "ENOENT" ? " The folder doesn't exist; create it first or pick another." : "";
      throw new Error(`Couldn't write the card to --out ${basename2(out)} (${why}).${hint}`);
    }
    noteToStderr();
    console.log(shareLine(input));
    console.log(`
Card written to ${out} (1200\xD7627, LinkedIn size). Open ${APP_NAME} dashboard to save it as PNG.`);
    console.log(`
Ready-to-paste post:

${linkedInPost(input)}`);
    return;
  }
  if (values.json) return void console.log(json(est, params, window, demo));
  if (label) process.stdout.write(label);
  if (by) noteToStderr();
  if (by) console.log(breakdown(est, params, window, by, opts));
  else console.log(summary(est, params, window, demo, opts));
}
function parseArgsPlain(config) {
  try {
    return parseArgs(config);
  } catch (error) {
    throw plainArgError(error) ?? error;
  }
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
async function runMcp(options) {
  const file = new URL("./mcp.js", import.meta.url).href;
  let mod;
  try {
    mod = await import(file);
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    throw new Error(`This copy of ${APP_NAME} doesn't include the MCP server. Use the npm package: claude mcp add ${APP_NAME} -- npx ${APP_NAME} mcp`);
  }
  if (process.stdin.isTTY) console.error(`${APP_NAME} mcp is an MCP server for Claude Code, waiting on stdin (Ctrl+C to stop). Add it with: ${MCP_ADD}`);
  await mod.serveStdio(options);
}
async function readStdin() {
  if (process.stdin.isTTY) return "{}";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text || "{}";
}
main().catch((error) => {
  const line = errorLine(error);
  console.error(line);
  process.exitCode = 1;
});
