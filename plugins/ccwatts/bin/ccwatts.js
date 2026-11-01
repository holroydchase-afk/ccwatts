#!/usr/bin/env node

// src/index.ts
import { readFile as readFile3, stat as stat4, writeFile as writeFile3 } from "fs/promises";
import { basename as basename2, resolve } from "path";
import { parseArgs } from "util";

// ../core/src/meta.ts
var APP_NAME = "ccwatts";
var APP_VERSION = "0.1.2";
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
function formatEnergy(range3) {
  const kwh = range3.high >= 1e3;
  const scale = kwh ? 1e3 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${fixed(range3.central / scale)} ${unit}`,
    range: `${fixed(range3.low / scale)} \u2013 ${fixed(range3.high / scale)}`,
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
  const total2 = zeroRange();
  for (const type of TOKEN_TYPES) addRange(total2, energyForTokens(counts[type], tier, type, params));
  return total2;
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
  const total2 = zeroRange();
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
      addRange(total2, energy2);
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
    total: total2,
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
    const ms2 = { h: 36e5, d: 864e5, w: 6048e5 }[unit] * n;
    const word = { h: "hour", d: "day", w: "week" }[unit];
    const start = new Date(now.getTime() - ms2);
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
var blockType = (block) => typeof block === "object" && block !== null ? block.type : void 0;
function isHumanTurn(line) {
  if (line.type !== "user") return false;
  if (line.isMeta === true || line.isSidechain === true || line.isCompactSummary === true) return false;
  if ("toolUseResult" in line) return false;
  const content = line.message?.content;
  if (Array.isArray(content) && content.some((b) => blockType(b) === "tool_result")) return false;
  if ("origin" in line) {
    const origin = line.origin;
    return typeof origin === "object" && origin !== null && origin.kind === "human";
  }
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.length > 0 && content.every((b) => blockType(b) === "text" || blockType(b) === "image");
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
  },
  /** One event per timestamped user or assistant line, sorted by time. Keeps only the time and the human flag. */
  activity(text) {
    const events = [];
    for (const raw of text.replace(/^\uFEFF/, "").split("\n")) {
      if (!raw.includes('"user"') && !raw.includes('"assistant"')) continue;
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof line !== "object" || line === null) continue;
      if (line.type !== "user" && line.type !== "assistant") continue;
      const timestamp = str(line.timestamp);
      if (!timestamp || !validTimestamp(timestamp)) continue;
      events.push({ event: { timestamp, human: isHumanTurn(line) }, ms: Date.parse(timestamp) });
    }
    return events.sort((a, b) => a.ms - b.ms).map((e) => e.event);
  }
};

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
  },
  pace: {
    gap_minutes: {
      value: 20,
      low: 10,
      high: 30,
      unit: "minutes",
      label: "GUESS",
      source: "https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",
      as_of: "2026-10-31",
      note: "Heuristic, not measured: an idle gap longer than this ends a work block. The low gap gives the low active time (more splits), the high gap the high."
    },
    break_minutes: {
      value: 15,
      low: 15,
      high: 15,
      unit: "minutes",
      label: "GUESS",
      source: "https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",
      as_of: "2026-10-31",
      note: "Heuristic, not measured: a pause of at least this long inside a block ends a stretch, for the longest-stretch count."
    },
    late_night: {
      start_hour: 22,
      end_hour: 6
    }
  }
};

// ../core/src/params.ts
var defaultParams = params_default;

// ../core/src/pace.ts
var defaultPaceOptions = (timeZone) => {
  const pace2 = defaultParams.pace;
  return {
    timeZone,
    gapMinutes: { low: pace2.gap_minutes.low, central: pace2.gap_minutes.value, high: pace2.gap_minutes.high },
    breakMinutes: pace2.break_minutes.value,
    lateNight: { startHour: pace2.late_night.start_hour, endHour: pace2.late_night.end_hour }
  };
};
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
function sortedTimes(events) {
  return events.map((e) => ({ ms: Date.parse(e.timestamp), human: e.human })).filter((e) => !Number.isNaN(e.ms)).sort((a, b) => a.ms - b.ms);
}
function groupRuns(times, gapMs) {
  const runs = [];
  for (const t of times) {
    const run = runs[runs.length - 1];
    if (run && t.ms - run[run.length - 1].ms <= gapMs) run.push(t);
    else runs.push([t]);
  }
  return runs;
}
function localClock(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return (ms2) => {
    const p = {};
    for (const part of fmt.formatToParts(ms2)) p[part.type] = part.value;
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second) };
  };
}
function slices(start, end, clock) {
  const out = [];
  const same = (a, b) => a.date === b.date && a.hour === b.hour;
  let t = start;
  while (t < end) {
    const here = clock(t);
    let next = t + HOUR - (here.minute * MINUTE + here.second * 1e3 + (t % 1e3 + 1e3) % 1e3);
    if (next > end) next = end;
    else if (!same(clock(next - 1), here)) {
      let lo = t;
      let hi = next - 1;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (same(clock(mid), here)) lo = mid;
        else hi = mid;
      }
      next = hi;
    }
    out.push({ date: here.date, hour: here.hour, ms: next - t });
    t = next;
  }
  return out;
}
var isLateNight = (hour2, { startHour, endHour }) => startHour <= endHour ? hour2 >= startHour && hour2 < endHour : hour2 >= startHour || hour2 < endHour;
var LEVELS = ["low", "central", "high"];
var CENTRAL = 1;
var toMinutes = (ms2) => Math.round(ms2 / MINUTE / 0.1) / 10;
var asRange = (values) => {
  const [low, central, high] = values.map(toMinutes).sort((a, b) => a - b);
  return { low, central, high };
};
function paceDays(events, options) {
  if (typeof options.timeZone !== "string" || options.timeZone === "") throw new Error("paceDays needs a time zone");
  const clock = localClock(options.timeZone);
  const times = sortedTimes(events);
  const days = /* @__PURE__ */ new Map();
  const dayOf = (date) => {
    let d = days.get(date);
    if (!d) {
      d = { active: [0, 0, 0], agent: [0, 0, 0], lateNight: 0, longestStretch: 0, firstHour: null, lastHour: null };
      days.set(date, d);
    }
    return d;
  };
  for (const i of [0, 1, 2]) {
    for (const block of groupRuns(times, options.gapMinutes[LEVELS[i]] * MINUTE)) {
      const human = block.some((e) => e.human);
      const start = block[0].ms;
      const end = block[block.length - 1].ms;
      for (const s of slices(start, end, clock)) {
        const d = dayOf(s.date);
        (human ? d.active : d.agent)[i] += s.ms;
        if (i !== CENTRAL || !human) continue;
        if (isLateNight(s.hour, options.lateNight)) d.lateNight += s.ms;
        d.firstHour ??= s.hour;
        d.lastHour = s.hour;
      }
      if (i !== CENTRAL || !human) continue;
      for (const stretch of groupRuns(block, options.breakMinutes * MINUTE - 1)) {
        const perDay = /* @__PURE__ */ new Map();
        for (const s of slices(stretch[0].ms, stretch[stretch.length - 1].ms, clock)) {
          perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.ms);
        }
        for (const [date, ms2] of perDay) {
          const d = dayOf(date);
          d.longestStretch = Math.max(d.longestStretch, ms2);
        }
      }
    }
  }
  return [...days.entries()].filter(([, d]) => [...d.active, ...d.agent].some((ms2) => ms2 > 0)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, d]) => ({
    date,
    activeMinutes: asRange(d.active),
    agentMinutes: asRange(d.agent),
    lateNightMinutes: toMinutes(d.lateNight),
    longestStretchMinutes: toMinutes(d.longestStretch),
    firstHour: d.firstHour,
    lastHour: d.lastHour
  }));
}

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

// ../core/src/pace-week.ts
var REST_DAY_MINUTES = 15;
var DAY_MS = 864e5;
var ms = (date) => Date.parse(`${date}T00:00:00Z`);
var iso = (t) => new Date(t).toISOString().slice(0, 10);
var addDays = (date, n) => iso(ms(date) + n * DAY_MS);
var hundredth = (n) => Math.round(n * 100) / 100;
var hours = (r) => ({ low: hundredth(r.low / 60), central: hundredth(r.central / 60), high: hundredth(r.high / 60) });
var isWeekend = (date) => [0, 6].includes(new Date(ms(date)).getUTCDay());
function paceWeeks(days, today, weeks = 4) {
  const current = weekStart(today);
  const out = [];
  for (let k = 0; k < weeks; k++) {
    const start = addDays(current, -7 * k);
    const end = addDays(start, 6) < today ? addDays(start, 6) : today;
    const inWeek = days.filter((d) => d.date >= start && d.date <= end);
    const active = { low: 0, central: 0, high: 0 };
    const agent = { low: 0, central: 0, high: 0 };
    let late = 0;
    let longest = 0;
    let weekend = 0;
    let latest = null;
    let worked = 0;
    for (const d of inWeek) {
      for (const level of ["low", "central", "high"]) {
        active[level] += d.activeMinutes[level];
        agent[level] += d.agentMinutes[level];
      }
      late += d.lateNightMinutes;
      longest = Math.max(longest, d.longestStretchMinutes);
      if (isWeekend(d.date)) weekend += d.activeMinutes.central;
      if (d.lastHour !== null) latest = Math.max(latest ?? 0, d.lastHour);
      if (d.activeMinutes.central >= REST_DAY_MINUTES) worked++;
    }
    const daysCounted = Math.round((ms(end) - ms(start)) / DAY_MS) + 1;
    out.push({
      start,
      activeHours: hours(active),
      agentHours: hours(agent),
      lateNightHours: hundredth(late / 60),
      longestStretchMinutes: longest,
      restDays: daysCounted - worked,
      daysCounted,
      weekendShare: active.central > 0 ? hundredth(weekend / active.central) : 0,
      latestHour: latest
    });
  }
  return out;
}
function paceVersusUsual(thisWeek, priorWeeks) {
  const usual = priorWeeks.filter((w) => w.activeHours.central > 0);
  if (usual.length < 2) return null;
  const mean = (f) => usual.reduce((s, w) => s + f(w), 0) / usual.length;
  return {
    later: thisWeek.lateNightHours > 1 && thisWeek.lateNightHours > 1.25 * mean((w) => w.lateNightHours),
    longer: thisWeek.activeHours.central > 1.25 * mean((w) => w.activeHours.central)
  };
}
function random(date) {
  let s = ms(date) / DAY_MS;
  return () => {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function samplePaceDays(endDate) {
  const first = addDays(weekStart(endDate), -28);
  const lastWeek = weekStart(endDate);
  const days = [];
  for (let date = first; date <= endDate; date = addDays(date, 1)) {
    const rand = random(date);
    const dow = new Date(ms(date)).getUTCDay();
    const week = Math.round((ms(weekStart(date)) - ms(first)) / (7 * DAY_MS));
    if (dow === 0) continue;
    if (dow === 6 && week % 2 === 1) continue;
    const saturday = dow === 6;
    const late = date >= lastWeek ? dow === 1 || dow === 2 : dow === 3;
    const central = saturday ? 60 + Math.round(rand() * 40) : 300 + Math.round(rand() * 120) + (late ? 60 : 0);
    const spread = saturday ? 10 : 25 + Math.round(rand() * 20);
    const agent = saturday ? 0 : 20 + Math.round(rand() * 60);
    const firstHour = saturday ? 10 : 9 + Math.round(rand());
    days.push({
      date,
      activeMinutes: { low: central - spread, central, high: central + spread },
      agentMinutes: { low: Math.round(agent * 0.8), central: agent, high: Math.round(agent * 1.25) },
      lateNightMinutes: !late ? 0 : date >= lastWeek ? 105 + Math.round(rand() * 30) : 45 + Math.round(rand() * 30),
      longestStretchMinutes: saturday ? central - 15 : 70 + Math.round(rand() * 110),
      firstHour,
      lastHour: late ? 23 : saturday ? 12 : 17 + Math.round(rand() * 2)
    });
  }
  return days;
}

// ../core/src/pace-copy.ts
function paceHours(h) {
  if (h === 0) return "0";
  return h >= 10 ? int(h) : (Math.round(h * 10) / 10).toFixed(1);
}
function hm(minutes) {
  const total2 = Math.round(minutes);
  const h = Math.floor(total2 / 60);
  const m = total2 % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var monthDay = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
var clockHour = (h) => h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`;
var paceHoursRange = (r) => `${paceHours(r.low)} \u2013 ${paceHours(r.high)}`;
var paceActiveLead = (r) => `about ${paceHours(r.central)} active hours (range ${paceHoursRange(r)})`;
var PACE_EARLY_WEEK_DAYS = 3;
function paceFocus(weeks) {
  const [now, last] = weeks;
  if (!now || !last || now.daysCounted > PACE_EARLY_WEEK_DAYS) return 0;
  return last.activeHours.high > 0 || last.agentHours.high > 0 ? 1 : 0;
}
function paceLead(weeks, params) {
  const focus = paceFocus(weeks);
  const week = weeks[focus];
  const label = focus === 0 ? "This week so far" : `Week of ${monthDay(week.start)}`;
  const late = clockHour(params.pace.late_night.start_hour);
  const activeDays = week.daysCounted - week.restDays;
  const now = weeks[0];
  const days = `${now.daysCounted} day${now.daysCounted === 1 ? "" : "s"}`;
  return {
    focus,
    lead: `${label}: ${paceActiveLead(week.activeHours)}`,
    rest: `${hm(week.lateNightHours * 60)} past ${late}, longest stretch ${hm(week.longestStretchMinutes)}, active ${activeDays} of ${week.daysCounted} days.`,
    soFar: focus === 0 ? null : now.activeHours.central > 0 ? `This week so far: about ${paceHours(now.activeHours.central)} hours in ${days}.` : "This week so far: no active hours yet.",
    agents: paceAgentsLine(week)
  };
}
function paceAgentsLine(week) {
  return week.agentHours.high > 0 ? `Agents worked another ${paceHoursRange(week.agentHours)} hours on their own.` : null;
}
function paceNotes(params) {
  const g = params.pace.gap_minutes;
  const late = clockHour(params.pace.late_night.start_hour);
  return [
    `Active time counts idle gaps under ${g.low}/${g.value}/${g.high} min (low/central/high) as work.`,
    `Past ${late} and the longest stretch use the ${g.value}-min gap.`,
    `A day off has under ${REST_DAY_MINUTES} active minutes. Agent-only: no turn from you.`,
    `Heuristic, not a measurement \xB7 method v${params.version}`
  ];
}

// ../core/src/pace-history.ts
var PACE_SCHEMA = 1;
var paceMethod = (o) => ({
  gapMinutes: { low: o.gapMinutes.low, central: o.gapMinutes.central, high: o.gapMinutes.high },
  breakMinutes: o.breakMinutes,
  lateNight: { startHour: o.lateNight.startHour, endHour: o.lateNight.endHour }
});
var tenth = (n) => Math.round(n * 10) / 10;
var range = (r) => ({ low: tenth(r.low), central: tenth(r.central), high: tenth(r.high) });
var toRow = (d) => ({
  date: d.date,
  activeMinutes: range(d.activeMinutes),
  agentMinutes: range(d.agentMinutes),
  lateNightMinutes: tenth(d.lateNightMinutes),
  longestStretchMinutes: tenth(d.longestStretchMinutes),
  firstHour: d.firstHour,
  lastHour: d.lastHour
});
var DAY_KEYS = ["activeMinutes", "agentMinutes", "date", "firstHour", "lastHour", "lateNightMinutes", "longestStretchMinutes"].join();
function serializePaceHistory(days, method2) {
  const header2 = JSON.stringify({ schema: PACE_SCHEMA, kind: "daily-pace", method: paceMethod(method2) });
  return [header2, ...days.map((d) => JSON.stringify(toRow(d)))].join("\n") + "\n";
}
function parsePaceHistory(text) {
  let method2 = null;
  const days = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (isHeader(value)) method2 ??= paceMethod(value.method);
    else if (isDay(value)) days.push(toRow(value));
  }
  return { method: method2, days };
}
var isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var okRange = (v) => isObject(v) && okCount(v.low) && okCount(v.central) && okCount(v.high) && v.low <= v.central && v.central <= v.high;
var okHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
function isHeader(v) {
  if (!isObject(v) || v.schema !== PACE_SCHEMA || v.kind !== "daily-pace" || !isObject(v.method)) return false;
  const m = v.method;
  return okRange(m.gapMinutes) && okCount(m.breakMinutes) && isObject(m.lateNight) && okHour(m.lateNight.startHour) && okHour(m.lateNight.endHour);
}
function isDay(v) {
  if (!isObject(v) || Object.keys(v).sort().join() !== DAY_KEYS) return false;
  return okDate(v.date) && okRange(v.activeMinutes) && okRange(v.agentMinutes) && okCount(v.lateNightMinutes) && okCount(v.longestStretchMinutes) && (v.firstHour === null || okHour(v.firstHour)) && (v.lastHour === null || okHour(v.lastHour));
}
var total = (d) => d.activeMinutes.central + d.agentMinutes.central;
function mergePaceHistory(stored, fresh, sameMethod) {
  const days = /* @__PURE__ */ new Map();
  for (const d of stored) {
    const prev = days.get(d.date);
    if (!prev || total(d) > total(prev)) days.set(d.date, d);
  }
  for (const d of fresh) {
    const prev = days.get(d.date);
    if (!sameMethod || !prev || total(d) >= total(prev)) days.set(d.date, d);
  }
  return [...days.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// ../core/src/rollup.ts
function dedupe(records) {
  const byKey = /* @__PURE__ */ new Map();
  for (const record of records) byKey.set(`${record.source}:${record.key}`, record);
  return [...byKey.values()];
}

// ../core/src/nudge.ts
var PERSONAS = [
  {
    id: "coach",
    label: "Calm coach",
    tone: "serious",
    lines: [
      "Strong session. It's {time}, and the next rep belongs to a rested you.",
      "Recovery is part of training. Close the laptop and bank tonight's progress.",
      "You've earned the cooldown. Commit, push, lights out.",
      "Good work today. Leaving the field is part of the game.",
      "Still going at {time}? Note tomorrow's first step and call it a night.",
      "Finish the thought, not the backlog. The rest can wait for daylight.",
      "Pace beats sprint. Tonight's lap is done; tomorrow's starts fresh."
    ]
  },
  {
    id: "researcher",
    label: "Sleep researcher",
    tone: "serious",
    lines: [
      "Observation: it's {time}. The experiment can resume after breakfast.",
      "Field note: subject still typing. Recommend studying the inside of eyelids.",
      "Data point: {time}, screen still bright. Next step: dim it, close it.",
      "Hypothesis: this bug looks easier in the morning. Tomorrow, we test it.",
      "Finding: the bed remains unused. Recommend correcting this tonight.",
      "Log entry: tired eyes read diffs slowly. Tomorrow's review will be quicker.",
      "Method: save, commit, sleep. The results replicate across most nights."
    ]
  },
  {
    id: "stoic",
    label: "Stoic",
    tone: "serious",
    lines: [
      "Consider the hour: {time}. What is in your control is closing the laptop.",
      "The work will be here at dawn. Meet it rested.",
      "Marcus Aurelius wrote about mornings. Those start with going to bed.",
      "Not everything can be finished. Today can. At {time}, today is done.",
      "Rest is not retreat. It is how tomorrow's discipline is made.",
      "The night asks little of you: put down the work and let it be.",
      "The bug is indifferent to your fatigue. Meet it rested."
    ]
  },
  {
    id: "grandma",
    label: "Grandma",
    tone: "funny",
    lines: [
      "Sweetheart, it's {time}. The computer will still be there in the morning.",
      "I'm not saying anything. I'm just saying it's {time}.",
      "Did you eat dinner? Never mind, it's bedtime now. I made up the spare room.",
      "In my day we went to bed when it got dark. It got dark hours ago, dear.",
      "I knitted you a blanket. It works best when you're asleep under it.",
      "Such a hard worker. Now be a good sleeper too. Kisses. Bed.",
      "Your little robot friend can wait, love. Grandma says bed."
    ]
  },
  {
    id: "narrator",
    label: "Nature documentary",
    tone: "funny",
    lines: [
      "At {time}, the developer persists, long after the herd has gone to rest.",
      "Observe: the rare night coder, lit only by the glow of a terminal.",
      "The developer circles the bug once more. Instinct says: return to the nest.",
      "Few creatures stir at {time}. Most of them are owls. You are not an owl.",
      "Remarkable. Even the cursor seems to blink more slowly now.",
      "Soon the developer will begin the great migration: from desk to bed.",
      "In the wild, the well-rested coder outlasts the merge conflict."
    ]
  },
  {
    id: "pirate",
    label: "Pirate",
    tone: "funny",
    lines: [
      "Arr, it be {time}! Drop anchor on that branch and swing into yer hammock.",
      "The tide o' commits can wait till mornin', matey. To yer bunk!",
      "Even Blackbeard slept, ye scallywag. Probably. Bed!",
      "Ship it at dawn, not at {time}. Even pirates wait for daylight.",
      "Batten down the laptop! Yer night watch be over.",
      "X marks the spot, and the spot be yer pillow.",
      "Shiver me timbers, still sailin' at {time}? Furl the sails, sailor."
    ]
  },
  {
    id: "haiku",
    label: "Haiku",
    tone: "funny",
    // Each line is a real 5-7-5 haiku; "/" without spaces keeps it within 75 characters.
    lines: [
      "Moonlight on the keys/the terminal still glowing/save it, then to bed",
      "The bug will wait here/patient as a sleeping cat/so should you, my friend",
      "Commit, push, log off/the stars are on the night shift/go and get some rest",
      "Blue light on your face/even owls have clocked out now/pillow is calling",
      "Just one more, you say/the clock has heard this before/close the lid gently",
      "Late night, cursor blinks/each blink a small, sleepy yawn/follow its advice",
      "Tomorrow's fresh mind/will fix in five minutes what/tonight's took an hour"
    ]
  },
  {
    id: "sergeant",
    label: "Drill sergeant (friendly)",
    tone: "funny",
    lines: [
      "Attention, recruit! It is {time}. Your orders: lights out. Dismissed!",
      "Drop and give me eight... hours. Of sleep. That's an order!",
      "I don't see a bed under you, soldier! Fix that. Double time!",
      "Outstanding work today, private. Now hit the rack like you mean it!",
      "Laptop: closed! Screen: off! Recruit: horizontal! Move, move, move!",
      "At this hour, recruit, the only thing you deploy is a pillow. Hup!",
      "Proud of you, recruit. Prouder if you're asleep in five. Go!"
    ]
  }
];
var DEFAULT_NUDGE_SETTINGS = Object.freeze({ on: false, after: 23, until: 5, persona: "random" });
function clockTime(hour2, minute) {
  const h = hour2 % 12 === 0 ? 12 : hour2 % 12;
  return `${h}:${String(minute).padStart(2, "0")}${hour2 < 12 ? "am" : "pm"}`;
}
function inBedtimeWindow(hour2, after, until) {
  if (after === until) return false;
  return after < until ? hour2 >= after && hour2 < until : hour2 >= after || hour2 < until;
}
function mix(seed, salt) {
  let h = (Math.trunc(seed) ^ salt) >>> 0;
  h = Math.imul(h ^ h >>> 16, 2146121005);
  h = Math.imul(h ^ h >>> 15, 2221713035);
  return (h ^ h >>> 16) >>> 0;
}
var byId = (id) => PERSONAS.find((p) => p.id === id);
function nudgePersona(persona, seed) {
  return byId(persona) ?? PERSONAS[mix(seed, 2654435769) % PERSONAS.length];
}
function personaLine(input) {
  const p = nudgePersona(input.persona, input.seed);
  const raw = p.lines[mix(input.seed, 2246822507) % p.lines.length];
  return raw.replaceAll("{time}", clockTime(input.localHour, input.localMinute));
}
function bedtimeNudge(input) {
  if (!inBedtimeWindow(input.localHour, input.after, input.until)) return null;
  return personaLine(input);
}
var isHour = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
var isPersona = (v) => typeof v === "string" && (v === "random" || byId(v) !== void 0);
function parseNudgeSettings(text) {
  const d = DEFAULT_NUDGE_SETTINGS;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...d };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const o = raw;
  return {
    on: typeof o.on === "boolean" ? o.on : d.on,
    after: isHour(o.after) ? o.after : d.after,
    until: isHour(o.until) ? o.until : d.until,
    persona: isPersona(o.persona) ? o.persona : d.persona
  };
}
function serializeNudgeSettings(s) {
  return `${JSON.stringify({ on: s.on, after: s.after, until: s.until, persona: s.persona }, null, 2)}
`;
}

// src/dashboard.ts
import { spawn } from "child_process";
import { mkdir as mkdir2, writeFile as writeFile2 } from "fs/promises";
import { join as join2 } from "path";

// ../web/src/inject.ts
var range2 = (r) => ({ low: r.low, central: r.central, high: r.high });
var hour = (h) => typeof h === "number" ? h : null;
function paceDayOnly(d) {
  return {
    date: String(d.date).slice(0, 10),
    activeMinutes: range2(d.activeMinutes),
    agentMinutes: range2(d.agentMinutes),
    lateNightMinutes: d.lateNightMinutes,
    longestStretchMinutes: d.longestStretchMinutes,
    firstHour: hour(d.firstHour),
    lastHour: hour(d.lastHour)
  };
}
var DATA_MARKER = /(<script id="ccwatts-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function injectData(html, payload) {
  if (!DATA_MARKER.test(html)) throw new Error("Dashboard template is missing its data slot.");
  const { pace: pace2, ...rest } = payload;
  const data = pace2 ? { ...rest, pace: pace2.map(paceDayOnly) } : rest;
  return html.replace(DATA_MARKER, (_m, open, _old, close) => `${open}${safeJson(data)}${close}`);
}
var SAMPLE_MARKER = /<script id="ccwatts-sample" type="application\/json">([\s\S]*?)<\/script>/;
function readSample(html) {
  const json2 = SAMPLE_MARKER.exec(html)?.[1];
  if (!json2) throw new Error("Page is missing its sample data.");
  return JSON.parse(json2);
}

// ../web/dist/ccwatts.html
var ccwatts_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-eLlWNvguG40z+7w0RCWVZN7HCQMwrzSQvY9qXyq5s9o=\'; style-src \'unsafe-inline\'; img-src data: blob:; base-uri \'none\'; form-action \'none\'">\n<meta name="referrer" content="no-referrer">\n<title>ccwatts</title>\n<meta name="description" content="Estimate the electricity your Claude Code usage consumed, as a sourced range. Runs entirely in your browser.">\n<!-- Link preview for LinkedIn and others. The crawler fetches the image; this page never does. -->\n<meta property="og:type" content="website">\n<meta property="og:title" content="How much electricity does your Claude Code use?">\n<meta property="og:description" content="A sourced kWh range from your own logs. Runs in your browser, and your logs never leave it.">\n<meta property="og:url" content="https://chaseholroyd.com/ccwatts/">\n<meta property="og:image" content="https://chaseholroyd.com/ccwatts/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="ccwatts: how much electricity does your Claude Code use?">\n<meta name="twitter:card" content="summary_large_image">\n<style>\n/* Layout: one reading column; the headline reads like the top of a utility bill, the share card like a till receipt. */\n:root{\n  --bg:#f4f2ea; --surface:#fbfaf6; --ink:#1f2a24; --muted:#5e6b63; --line:#d9ddd3; --accent:#2f6b4f; --accent-ink:#ffffff;\n  --t-cacheRead:#2f6b4f; --t-cacheWrite:#c08a2e; --t-output:#b4553a; --t-input:#4a6fa5;\n  --sample:#8a5a12; --control:#7f8a83; --danger:#a8321f; --agent-op:.38;\n  --sans:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;\n  color-scheme:light;\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; --sample:#e0b56a; --control:#5d7a68; --danger:#ff9a85; --agent-op:.5; color-scheme:dark}}\n:root[data-theme="dark"]{\n  --bg:#10201a; --surface:#16291f; --ink:#e8eee9; --muted:#9fb3a6; --line:#29402f; --accent:#7cc4a0; --accent-ink:#10201a;\n  --t-cacheRead:#7cc4a0; --t-cacheWrite:#e0b56a; --t-output:#e58a6e; --t-input:#8fb2e8; --sample:#e0b56a; --control:#5d7a68; --danger:#ff9a85; --agent-op:.5; color-scheme:dark}\n*{box-sizing:border-box}\n[hidden]{display:none!important}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55}\n.wrap{max-width:960px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:40px}\nheader.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}\na:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}\n.intro{display:flex;flex-direction:column;gap:8px}\nh1{font-size:clamp(26px,5vw,36px);line-height:1.15;margin:0;letter-spacing:-.01em;text-wrap:balance}\n.lede{margin:0;font-size:17px;color:var(--muted);max-width:60ch}\n.brand{font-family:var(--mono);font-weight:700;font-size:18px;letter-spacing:.02em}\n.brand span{color:var(--accent)}\n.pill{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--muted)}\n.pill.sample{border-color:var(--sample);color:var(--sample)}\n.privacy{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:15px}\n.privacy b{color:var(--accent)}\n.hero{display:flex;flex-direction:column;gap:6px}\n.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}\n.big{font-weight:700;font-size:clamp(56px,13vw,112px);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}\n.big small{font-size:.42em;font-weight:500;margin-left:.2em;letter-spacing:0}\n.range{font-size:clamp(18px,3vw,22px);font-variant-numeric:tabular-nums}\n.compare{color:var(--muted);font-size:17px}\n.meta{font-family:var(--mono);font-size:13px;color:var(--muted)}\n/* Reading text (captions, method notes, the post preview) stays in the sans stack; mono is for numbers and code. */\n.note{font-family:var(--sans);font-size:15px;line-height:1.5;color:var(--muted);margin:0}\n.hero-foot{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}\n.jump{display:inline-flex;align-items:center;min-height:44px;font-size:15px}\n.jump::after{content:"\\00a0\u2193"}\n.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\nbutton,.btn{font:inherit;font-size:15px;min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--control);background:var(--surface);color:var(--ink);border-radius:8px;padding:8px 14px;cursor:pointer}\nbutton:hover,.btn:hover{border-color:var(--accent)}\nbutton:focus-visible,.btn:focus-visible,input:focus-visible,.vh:focus-visible+.btn{outline:2px solid var(--accent);outline-offset:2px}\n/* Visually hidden but still focusable, so the styled label stays reachable by keyboard. */\n#hero-meta span{white-space:nowrap}\n.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\nbutton[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n.drop{border:1.5px dashed var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}\n.drop.over{border-color:var(--accent)}\n.drop p{margin:0;color:var(--muted);font-size:14px}\ncode{font-family:var(--mono);font-size:.92em}\nsection{display:flex;flex-direction:column;gap:14px;min-width:0}\nh2{font-size:20px;margin:0;text-wrap:balance}\n.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px}\n.chart{width:100%;height:auto;display:block}\n.chart text{fill:var(--muted);font-family:var(--mono);font-size:11px}\n.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted)}\n.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}\n.rank{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}\n.rank li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:14px}\n.rank .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.rank .val{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);text-align:right}\n.rank .bar{grid-column:1/-1;height:8px;background:var(--line);border-radius:4px;overflow:hidden}\n.rank .bar span{display:block;height:100%;background:var(--accent)}\n.explain{max-width:65ch;margin:0}\n.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}\ntable{border-collapse:collapse;width:100%;font-size:14px;min-width:620px}\nth,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}\nth{font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:500}\ntd.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}\ntr:last-child td{border-bottom:0}\n.label{font-family:var(--mono);font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid currentColor}\na{color:var(--accent)}\na.src{display:inline-flex;align-items:center;min-height:44px}\n.phone-only{display:none}\n@media (max-width:600px){\n  .phone-only{display:block}\n  /* Method table: one card per parameter instead of a sideways scroll. */\n  table{min-width:0}\n  thead{display:none}\n  table,tbody,tr,td{display:block}\n  tr{padding:10px 12px;border-bottom:1px solid var(--line)}\n  tr:last-child{border-bottom:0}\n  td{border:0;padding:2px 0;white-space:normal}\n  td[data-label]:not([data-label="Parameter"])::before{content:attr(data-label) " ";font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:8px}\n  td.num{white-space:normal}\n}\n.card{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block}\n/* On a phone the 1200px card\'s text shrinks under 11px, so it links to the card at full size (UX-R17). */\n.full-size{min-height:44px;line-height:44px;font-size:15px;align-self:flex-start}\n.sharetext{font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;margin:0}\n#post{font-family:var(--sans);font-size:15px;line-height:1.5}\n.status{font-size:14px;color:var(--muted);min-height:1.4em}\n.status:empty{display:none}\n.status.error{color:var(--danger);border-left:3px solid;padding-left:10px}\n/* Disclosures: a 44px tap target with a chevron that turns when open. */\n.disclose{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;font-size:15px;color:var(--ink);list-style:none;border-radius:6px}\n.disclose::-webkit-details-marker{display:none}\n.disclose::before{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);flex:none;margin-right:2px}\ndetails[open]>.disclose::before{transform:rotate(45deg)}\n.disclose:hover{color:var(--accent)}\n.disclose:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\ndetails>*+*{margin-top:10px}\n@media (prefers-reduced-motion:no-preference){.disclose::before{transition:transform .15s ease}}\n.export label{display:block;font-size:14px;color:var(--muted)}\n.export textarea{display:block;font-family:var(--mono);font-size:13px;width:100%;box-sizing:border-box;border:1px solid var(--control);border-radius:8px;padding:10px;background:var(--surface);color:var(--ink)}\nkbd{font-family:var(--mono);font-size:.9em;border:1px solid var(--line);border-radius:4px;padding:0 4px}\n/* "What if?" cache-read slider (M2.6.5): a what-if view, never the published estimate. */\n.whatif{display:flex;flex-direction:column;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;max-width:65ch}\n.whatif-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}\n.whatif-head label{font-weight:700;font-size:16px}\n.whatif output{font-family:var(--mono);font-weight:700;font-size:22px;font-variant-numeric:tabular-nums;color:var(--accent)}\n.whatif input[type=range]{width:100%;height:48px;margin:0;accent-color:var(--accent);cursor:pointer;background:transparent}\n.whatif-scale{display:flex;justify-content:space-between;font-family:var(--mono);font-size:13px;color:var(--muted);margin-top:-8px}\n/* The "published" tick sits where the published value is on the track (thumb is about 16px wide). */\n.whatif-scale{position:relative}\n.whatif-scale .mark{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}\n.whatif-scale .mark::before{content:"";position:absolute;left:50%;top:-6px;height:5px;border-left:1px solid var(--muted)}\n.whatif-note{margin:0;font-size:15px;line-height:1.5;border-left:3px solid var(--sample);padding-left:10px}\n.whatif button{align-self:flex-start}\n#hero-eyebrow .whatif-flag{color:var(--sample)}\n/* Pace (M4.5): work rhythm by week, same visual language as the energy chart. Numbers, never a verdict. */\n.pace-title{display:flex;flex-direction:column;gap:4px}\n@media (max-width:719px){.pace-title .eyebrow{display:none}}\n.pace-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}\n.pace .agent{fill:var(--accent);fill-opacity:var(--agent-op)}\n.legend i.agent{background:var(--accent);opacity:var(--agent-op)}\n.pace-lead{margin:0;font-size:clamp(18px,3vw,22px);line-height:1.4;font-variant-numeric:tabular-nums;max-width:60ch;text-wrap:pretty}\n.pace-lead b{font-weight:700}\n.pace-sofar,.pace-agents{margin:0;font-size:16px;color:var(--muted);font-variant-numeric:tabular-nums}\n.pace .agent.partial{fill-opacity:calc(var(--agent-op) * 0.5)}\n.legend .whisker{width:2px;height:12px;border-radius:0;background:var(--ink);margin-left:4px;margin-right:9px;vertical-align:-2px}\n#pace-chart text.val{fill:var(--ink);font-weight:700}\n.pace-foot{font-size:13px;border-left:3px solid var(--line);padding-left:10px;max-width:72ch}\ntable.vh{min-width:0}\nfooter{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column;gap:6px}\n/* Studio demo bar (DEMO-BAR, pm-tools docs/DEMO-BANNER.md): playground only, in the page\'s own tokens. */\n.demo-bar{--demo-bg:var(--surface);--demo-fg:var(--ink);--demo-muted:var(--muted);--demo-line:var(--line);--demo-badge-bg:transparent;--demo-badge-fg:var(--ink);--demo-font:var(--sans);\n  background:var(--demo-bg);color:var(--demo-fg);border-bottom:1px solid var(--demo-line);font-family:var(--demo-font);font-size:14px;line-height:1.4}\n.demo-bar__row{display:flex;width:100%;box-sizing:border-box;align-items:stretch;max-width:960px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px))}\n.demo-bar__home{flex:none;display:inline-flex;align-items:center;min-height:44px;padding-right:12px;border-right:1px solid var(--demo-line);color:inherit;font-weight:600;text-decoration:none;white-space:nowrap}\n.demo-bar__home:hover{text-decoration:underline;text-underline-offset:3px}\n.demo-bar__toggle{display:flex;align-items:center;gap:10px;flex:1;min-width:0;min-height:44px;margin:0;padding:0 max(16px,env(safe-area-inset-right,0px)) 0 12px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}\n.demo-bar__toggle:hover .demo-bar__more{text-decoration:underline;text-underline-offset:3px}\n.demo-bar a:focus-visible,.demo-bar .demo-bar__toggle:focus-visible{outline:2px solid var(--demo-fg);outline-offset:-4px;border-radius:4px}\n.demo-bar__badge{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--demo-fg);background:var(--demo-badge-bg);color:var(--demo-badge-fg);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:1.3}\n.demo-bar__sum{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--demo-muted)}\n.demo-bar__long{display:none}\n@media (min-width:600px){.demo-bar__long{display:inline}}\n@media (max-width:359px){.demo-bar__sum{display:none}}\n.demo-bar__more{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-weight:600}\n.demo-bar__chev{width:10px;height:10px;transition:transform .15s}\n.demo-bar__toggle[aria-expanded="true"] .demo-bar__chev{transform:rotate(180deg)}\n@media (prefers-reduced-motion:reduce){.demo-bar__chev{transition:none}}\n.demo-bar__panel{max-width:960px;margin:0 auto;padding:4px max(16px,env(safe-area-inset-right,0px)) 16px max(16px,env(safe-area-inset-left,0px))}\n.demo-bar__panel p{margin:0 0 8px;max-width:70ch;font-size:16px;line-height:1.5;text-wrap:pretty}\n.demo-bar__actions{display:flex;flex-wrap:wrap;gap:0 20px;align-items:center}\n.demo-bar__actions a{display:inline-flex;align-items:center;min-height:44px;color:inherit;font-weight:600;text-underline-offset:3px}\n@media (prefers-reduced-motion:no-preference){.rank .bar span{transition:width .3s ease}}\n</style>\n</head>\n<body>\n<section class="demo-bar" id="demo-bar" aria-label="Demo" hidden>\n  <div class="demo-bar__row">\n    <a class="demo-bar__home" id="demo-home" href="#">\u2190 Portfolio</a>\n    <button type="button" class="demo-bar__toggle" id="demo-toggle" aria-expanded="false" aria-controls="demo-panel" aria-label="Demo details">\n      <span class="demo-bar__badge">Demo</span>\n      <span class="demo-bar__sum"><span id="demo-sum-sample">Sample data<span class="demo-bar__long"> \xB7 nothing leaves this browser</span></span><span id="demo-sum-files" hidden>Your files<span class="demo-bar__long"> \xB7 read in this browser only</span></span></span>\n      <span class="demo-bar__more">Details<svg class="demo-bar__chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></span>\n    </button>\n  </div>\n  <div class="demo-bar__panel" id="demo-panel" hidden>\n    <p id="demo-copy-sample">This is the real ccwatts, running on made-up sample data. Nothing you do is saved or sent anywhere; reload to start over.</p>\n    <p id="demo-copy-files" hidden>This is the real ccwatts, now showing the files you picked. They were read in this browser and never uploaded; nothing is saved, so reload to start over.</p>\n    <div class="demo-bar__actions"><a id="demo-back" href="#">\u2190 Chase Holroyd\'s portfolio</a><a id="demo-code" href="#" rel="noopener noreferrer">Code on GitHub</a></div>\n  </div>\n</section>\n<main class="wrap">\n  <header class="top">\n    <div class="brand">cc<span>watts</span></div>\n    <span class="pill" id="source-pill">Loading</span>\n  </header>\n\n  <div class="intro">\n    <h1>How much electricity does your AI coding use?</h1>\n    <p class="lede" id="lede">ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. Try it on your own logs below.</p>\n  </div>\n\n  <div class="privacy" id="privacy"><span aria-hidden="true">\u{1F512}</span><div><b>Your logs never leave this browser.</b> This page makes no network requests. It reads token counts only, never your prompts or code.</div></div>\n\n  <section class="hero">\n    <span class="eyebrow" id="hero-eyebrow">Claude Code electricity</span>\n    <div class="big" id="hero-big">\u2013</div>\n    <div class="range" id="hero-range"></div>\n    <div class="compare" id="hero-compare"></div>\n    <div class="meta" id="hero-meta"></div>\n    <div class="hero-foot">\n      <div class="controls" role="group" aria-label="Time window">\n        <button type="button" data-window="7d" id="w-7d">7 days</button>\n        <button type="button" data-window="30d" id="w-30d">30 days</button>\n        <button type="button" data-window="all" id="w-all">All time</button>\n      </div>\n      <a class="jump" id="jump" href="#drop" hidden>Use your own logs</a>\n    </div>\n  </section>\n\n  <section>\n    <h2>Over time</h2>\n    <div class="legend" id="legend"></div>\n    <svg class="chart" id="chart" viewBox="0 0 720 240" role="img" aria-label="Daily electricity by token type"></svg>\n    <p class="note" id="chart-note"></p>\n  </section>\n\n  <div class="grid2">\n    <section><h2>By model</h2><ul class="rank" id="by-model"></ul></section>\n    <section><h2>By project</h2><ul class="rank" id="by-project"></ul></section>\n  </div>\n\n  <section class="drop" id="drop" hidden>\n    <h2>Try it on your own logs</h2>\n    <p>Claude Code saves logs in <code>~/.claude/projects</code>. Pick that folder, or drop any <code>.jsonl</code> files here. Files are read by this page on your device and never uploaded. On a Mac the folder is hidden: in the picker, press <kbd>\u2318</kbd> <kbd>\u21E7</kbd> <kbd>.</kbd> to show it.</p>\n    <div class="controls">\n      <input type="file" class="vh" id="pick-folder" webkitdirectory multiple>\n      <label class="btn primary" for="pick-folder">Choose folder</label>\n      <input type="file" class="vh" id="pick-files" accept=".jsonl" multiple>\n      <label class="btn" for="pick-files">Choose files</label>\n      <button type="button" id="use-sample">Use sample data</button>\n    </div>\n    <p id="cli-line">Prefer the terminal? Run <code id="cli-cmd">npx ccwatts</code> with Node 20+. Same numbers, plus a history that outlasts Claude Code\'s log cleanup.</p>\n    <p class="phone-only" id="phone-hint">On a phone? Claude Code keeps its logs on the computer it runs on. Open this page there, or use the prompt below if you run Claude Code on the web.</p>\n    <details class="export" id="export">\n      <summary class="disclose">Use Claude Code on the web, or can\'t find the folder?</summary>\n      <p>Paste this prompt into a Claude Code session. It writes a copy of that machine\'s usage with token counts only, and no prompts or code. Then drop the file here, or paste what it prints into the box below.</p>\n      <pre class="sharetext" id="export-prompt">Make a counts-only copy of my Claude Code usage for ccwatts.\n\nRead every .jsonl file under ~/.claude/projects. For each line whose "type" is "assistant" and that has message.usage, write one JSON line containing only:\n- type, timestamp, requestId\n- cwd, reduced to the last folder name (never the full path)\n- message.id and message.model\n- message.usage with input_tokens, cache_creation_input_tokens, cache_read_input_tokens and output_tokens\n\nLeave out everything else, especially message content. Save the lines as ccwatts-usage.jsonl and give me the file to download. If you can\'t offer a download, print the lines in one code block instead.</pre>\n      <div class="controls">\n        <button type="button" id="copy-prompt">Copy prompt</button>\n      </div>\n      <label for="paste-log">Paste the lines it printed</label>\n      <textarea id="paste-log" rows="4" spellcheck="false" placeholder=\'{"type":"assistant", \u2026}\'></textarea>\n      <div class="controls">\n        <button type="button" id="read-paste">Read pasted lines</button>\n      </div>\n    </details>\n    <div class="status" id="drop-status" role="status" aria-live="polite"></div>\n  </section>\n\n  <section>\n    <h2>What drives your number</h2>\n    <p class="explain" id="explain"></p>\n    <div class="whatif" id="whatif">\n      <div class="whatif-head">\n        <label for="whatif-cache">What if? Cache-read cost</label>\n        <output id="whatif-value" for="whatif-cache">10%</output>\n      </div>\n      <p class="note">Cache reads are most of your tokens, and their cost is the least certain assumption. The method uses 10% of the cost of fresh input and tests 1% to 25%. Drag to see your number move.</p>\n      <input type="range" id="whatif-cache" min="0.01" max="0.25" step="0.01" value="0.1" aria-valuetext="10% of fresh input" autocomplete="off">\n      <div class="whatif-scale" aria-hidden="true"><span>1%</span><span class="mark" style="left:calc(37.50% + 2.0px)">published 10%</span><span>25%</span></div>\n      <p class="whatif-note" id="whatif-note" role="status" hidden></p>\n      <button type="button" id="whatif-reset" hidden>Reset</button>\n    </div>\n  </section>\n\n  <section>\n    <h2>Share it</h2>\n    <img class="card" id="card" alt="Electricity receipt card" width="1200" height="627">\n    <a class="phone-only full-size" id="card-full" href="#" target="_blank" rel="noopener noreferrer">Open full size</a>\n    <div class="controls">\n      <button type="button" class="primary" id="save-png">Save PNG for LinkedIn</button>\n      <button type="button" id="save-svg">Save SVG</button>\n      <button type="button" id="copy-line">Copy share line</button>\n      <button type="button" id="copy-post">Copy LinkedIn post</button>\n    </div>\n    <div class="status" id="share-status"></div>\n    <details id="post-box">\n      <summary class="disclose">Show the LinkedIn post</summary>\n      <pre class="sharetext" id="post"></pre>\n    </details>\n  </section>\n\n  <section id="pace" class="pace" aria-labelledby="pace-h">\n    <div class="pace-title">\n      <span class="eyebrow">Your work rhythm \xB7 opt-in \xB7 stays local</span>\n      <div class="pace-head">\n        <h2 id="pace-h">Pace</h2>\n        <span class="pill sample" id="pace-pill">Sample data</span>\n      </div>\n    </div>\n    <!-- UX-R5: on phones the section folds to one line so the page stays short; wide screens open it (app.ts). -->\n    <details id="pace-more">\n      <summary class="disclose">Show your work rhythm and 4-week chart</summary>\n      <div id="pace-body">\n        <p class="pace-lead" id="pace-lead"></p>\n      </div>\n      <p class="pace-sofar" id="pace-sofar" hidden></p>\n      <p class="pace-agents" id="pace-agents"></p>\n      <div class="legend" id="pace-legend" aria-hidden="true"><span><i style="background:var(--accent)"></i>Active hours</span><span><i style="background:var(--t-cacheWrite)"></i>Past 10pm (part of active)</span><span><i class="agent"></i>Agent-only</span><span><i class="whisker"></i>Low \u2013 high range</span></div>\n      <svg class="chart" id="pace-chart" viewBox="0 0 720 230" role="img" aria-label="Active and agent-only hours per week, last 4 weeks"></svg>\n      <table class="vh" id="pace-table"></table>\n      <p class="note pace-foot" id="pace-foot">Active time counts idle gaps under 10/20/30 min (low/central/high) as work. Past 10pm and the longest stretch use the 20-min gap. A day off has under 15 active minutes. Agent-only: no turn from you. Heuristic, not a measurement \xB7 method v0.1.0</p>\n    </details>\n    <p class="note" id="pace-empty" hidden></p>\n    <p class="note" id="pace-skipped" hidden>Pace is skipped with --path or --no-history, which leave pace.jsonl alone. Run <code>ccwatts dashboard</code> without them to see it.</p>\n    <p class="note" id="pace-unreadable" hidden>Couldn\'t read pace.jsonl, so Pace is left out this time. The file is left as it is.</p>\n    <p class="note" id="pace-optin" hidden>Pace is off. Run <code>ccwatts pace</code> once to turn it on: it keeps daily minutes and whole hours in <code>~/.ccwatts/pace.jsonl</code> on this computer, and this page shows it next time.</p>\n  </section>\n\n  <section>\n    <h2>How this is estimated</h2>\n    <p class="explain" id="method-intro"></p>\n    <details id="params-box">\n      <summary class="disclose">Show all parameters and sources</summary>\n      <div class="tablewrap"><table id="params"></table></div>\n    </details>\n  </section>\n\n  <footer>\n    <div id="footer-version"></div>\n    <div>Open source. Read the code and the full methodology on <a id="repo-link" href="#" rel="noopener noreferrer">GitHub</a>.</div>\n    <div>Built by <a id="built-by" href="#" rel="noopener noreferrer">Chase Holroyd</a>.</div>\n  </footer>\n</main>\n<script id="ccwatts-data" type="application/json">{"mode":"playground","generatedAt":null,"rows":[]}</script>\n<script id="ccwatts-sample" type="application/json">[{"date":"2026-09-21","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":47,"tokens":{"input":481,"cacheWrite":224858,"cacheRead":5433921,"output":21302},"outputContext":2453872321},{"date":"2026-09-21","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":17,"tokens":{"input":190,"cacheWrite":86694,"cacheRead":873313,"output":7714},"outputContext":425266546},{"date":"2026-09-22","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":40,"tokens":{"input":393,"cacheWrite":206396,"cacheRead":4259456,"output":20119},"outputContext":2244470466},{"date":"2026-09-23","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":52,"tokens":{"input":503,"cacheWrite":212076,"cacheRead":5914935,"output":28587},"outputContext":3409886608},{"date":"2026-09-24","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":21,"tokens":{"input":190,"cacheWrite":94458,"cacheRead":1218020,"output":10292},"outputContext":590700102},{"date":"2026-09-24","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":95,"tokens":{"input":977,"cacheWrite":439114,"cacheRead":11248882,"output":44237},"outputContext":5490113479},{"date":"2026-09-25","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":19,"tokens":{"input":209,"cacheWrite":93535,"cacheRead":1038543,"output":9584},"outputContext":589452635},{"date":"2026-09-27","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":64,"tokens":{"input":655,"cacheWrite":253381,"cacheRead":7300740,"output":31952},"outputContext":3769121520},{"date":"2026-09-28","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":28,"tokens":{"input":276,"cacheWrite":140541,"cacheRead":2230744,"output":13360},"outputContext":1153747881},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":38,"tokens":{"input":356,"cacheWrite":152315,"cacheRead":3272451,"output":18960},"outputContext":1641654756},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":340,"cacheWrite":134170,"cacheRead":2682489,"output":16997},"outputContext":1568755458},{"date":"2026-09-30","source":"claude-code","model":"claude-sonnet-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":31,"tokens":{"input":353,"cacheWrite":135035,"cacheRead":2371226,"output":16712},"outputContext":1324962703},{"date":"2026-10-01","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":16,"tokens":{"input":138,"cacheWrite":80233,"cacheRead":768856,"output":6943},"outputContext":382418077},{"date":"2026-10-01","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":24,"tokens":{"input":303,"cacheWrite":108412,"cacheRead":1401918,"output":11697},"outputContext":695089914},{"date":"2026-10-02","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":50,"tokens":{"input":467,"cacheWrite":243377,"cacheRead":6114791,"output":24218},"outputContext":3052033764},{"date":"2026-10-02","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":31,"tokens":{"input":291,"cacheWrite":156640,"cacheRead":2602032,"output":14670},"outputContext":1290375171},{"date":"2026-10-03","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":67,"tokens":{"input":677,"cacheWrite":296672,"cacheRead":8900888,"output":33220},"outputContext":4724382924},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":61,"tokens":{"input":601,"cacheWrite":250048,"cacheRead":7595553,"output":29379},"outputContext":3577266281},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":32,"tokens":{"input":349,"cacheWrite":148766,"cacheRead":2857812,"output":18526},"outputContext":1716421621},{"date":"2026-10-06","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":42,"tokens":{"input":371,"cacheWrite":175342,"cacheRead":4217525,"output":20010},"outputContext":2086579461},{"date":"2026-10-07","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":53,"tokens":{"input":519,"cacheWrite":232336,"cacheRead":6626491,"output":26226},"outputContext":3535583255},{"date":"2026-10-07","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":27,"tokens":{"input":299,"cacheWrite":126737,"cacheRead":2032642,"output":15950},"outputContext":1332905565},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":72,"tokens":{"input":805,"cacheWrite":314745,"cacheRead":9938479,"output":36755},"outputContext":5269927123},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":71,"tokens":{"input":823,"cacheWrite":315410,"cacheRead":9639360,"output":33996},"outputContext":4708628928},{"date":"2026-10-08","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":29,"tokens":{"input":288,"cacheWrite":144763,"cacheRead":2133553,"output":18135},"outputContext":1399436901},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":316,"cacheWrite":129817,"cacheRead":2427569,"output":15515},"outputContext":1186325442},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":15,"tokens":{"input":122,"cacheWrite":58466,"cacheRead":581654,"output":7239},"outputContext":307424407},{"date":"2026-10-09","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":52,"tokens":{"input":438,"cacheWrite":243114,"cacheRead":6293294,"output":26306},"outputContext":3344828844},{"date":"2026-10-10","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":66,"tokens":{"input":673,"cacheWrite":273538,"cacheRead":8614195,"output":31043},"outputContext":4430386287},{"date":"2026-10-11","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":71,"tokens":{"input":885,"cacheWrite":325807,"cacheRead":9676339,"output":33624},"outputContext":4753439717},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":16,"tokens":{"input":186,"cacheWrite":90712,"cacheRead":869169,"output":8201},"outputContext":521288313},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":46,"tokens":{"input":504,"cacheWrite":208473,"cacheRead":4885505,"output":22366},"outputContext":2523675175},{"date":"2026-10-13","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":244,"cacheWrite":111650,"cacheRead":1255969,"output":9499},"outputContext":611397728},{"date":"2026-10-13","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":25,"tokens":{"input":221,"cacheWrite":111841,"cacheRead":1586210,"output":11735},"outputContext":798440653},{"date":"2026-10-14","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":43,"tokens":{"input":530,"cacheWrite":183803,"cacheRead":4389683,"output":20586},"outputContext":2203768836},{"date":"2026-10-14","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":59,"tokens":{"input":674,"cacheWrite":217090,"cacheRead":6575361,"output":28579},"outputContext":3253006122},{"date":"2026-10-15","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":74,"tokens":{"input":825,"cacheWrite":309110,"cacheRead":10212638,"output":38706},"outputContext":5535358176},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":265,"cacheWrite":109170,"cacheRead":1296443,"output":8112},"outputContext":599370597},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":31,"tokens":{"input":253,"cacheWrite":156477,"cacheRead":2747706,"output":13093},"outputContext":1311357449},{"date":"2026-10-16","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":28,"tokens":{"input":336,"cacheWrite":130298,"cacheRead":1943815,"output":14701},"outputContext":1081930686},{"date":"2026-10-16","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":48,"tokens":{"input":494,"cacheWrite":215976,"cacheRead":5622539,"output":24681},"outputContext":3062604147},{"date":"2026-10-17","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":56,"tokens":{"input":530,"cacheWrite":237670,"cacheRead":6869143,"output":25467},"outputContext":3159646087},{"date":"2026-10-18","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":38,"tokens":{"input":416,"cacheWrite":162013,"cacheRead":3360821,"output":20262},"outputContext":1907957687},{"date":"2026-10-19","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":97,"tokens":{"input":1108,"cacheWrite":414100,"cacheRead":10652494,"output":48446},"outputContext":5589764863},{"date":"2026-10-19","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":65,"tokens":{"input":708,"cacheWrite":292947,"cacheRead":8732693,"output":35185},"outputContext":4755010745},{"date":"2026-10-20","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":66,"tokens":{"input":726,"cacheWrite":297357,"cacheRead":8882173,"output":32673},"outputContext":4543520242},{"date":"2026-10-20","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":128,"tokens":{"input":1264,"cacheWrite":557853,"cacheRead":16226037,"output":59579},"outputContext":7838321066}]</script>\n<script id="ccwatts-sample-pace" type="application/json">[{"date":"2026-09-21","activeMinutes":{"low":293,"central":336,"high":379},"agentMinutes":{"low":40,"central":50,"high":63},"lateNightMinutes":0,"longestStretchMinutes":83,"firstHour":9,"lastHour":18},{"date":"2026-09-22","activeMinutes":{"low":338,"central":377,"high":416},"agentMinutes":{"low":19,"central":24,"high":30},"lateNightMinutes":0,"longestStretchMinutes":111,"firstHour":9,"lastHour":17},{"date":"2026-09-23","activeMinutes":{"low":347,"central":373,"high":399},"agentMinutes":{"low":49,"central":61,"high":76},"lateNightMinutes":75,"longestStretchMinutes":133,"firstHour":10,"lastHour":23},{"date":"2026-09-24","activeMinutes":{"low":293,"central":331,"high":369},"agentMinutes":{"low":25,"central":31,"high":39},"lateNightMinutes":0,"longestStretchMinutes":152,"firstHour":9,"lastHour":19},{"date":"2026-09-25","activeMinutes":{"low":302,"central":332,"high":362},"agentMinutes":{"low":59,"central":74,"high":93},"lateNightMinutes":0,"longestStretchMinutes":153,"firstHour":9,"lastHour":18},{"date":"2026-09-26","activeMinutes":{"low":63,"central":73,"high":83},"agentMinutes":{"low":0,"central":0,"high":0},"lateNightMinutes":0,"longestStretchMinutes":58,"firstHour":10,"lastHour":12},{"date":"2026-09-28","activeMinutes":{"low":318,"central":350,"high":382},"agentMinutes":{"low":48,"central":60,"high":75},"lateNightMinutes":0,"longestStretchMinutes":110,"firstHour":9,"lastHour":18},{"date":"2026-09-29","activeMinutes":{"low":308,"central":346,"high":384},"agentMinutes":{"low":46,"central":58,"high":73},"lateNightMinutes":0,"longestStretchMinutes":162,"firstHour":10,"lastHour":19},{"date":"2026-09-30","activeMinutes":{"low":392,"central":436,"high":480},"agentMinutes":{"low":37,"central":46,"high":58},"lateNightMinutes":69,"longestStretchMinutes":167,"firstHour":10,"lastHour":23},{"date":"2026-10-01","activeMinutes":{"low":365,"central":395,"high":425},"agentMinutes":{"low":54,"central":68,"high":85},"lateNightMinutes":0,"longestStretchMinutes":122,"firstHour":10,"lastHour":19},{"date":"2026-10-02","activeMinutes":{"low":342,"central":374,"high":406},"agentMinutes":{"low":46,"central":58,"high":73},"lateNightMinutes":0,"longestStretchMinutes":167,"firstHour":10,"lastHour":19},{"date":"2026-10-05","activeMinutes":{"low":298,"central":340,"high":382},"agentMinutes":{"low":32,"central":40,"high":50},"lateNightMinutes":0,"longestStretchMinutes":136,"firstHour":9,"lastHour":18},{"date":"2026-10-06","activeMinutes":{"low":328,"central":359,"high":390},"agentMinutes":{"low":33,"central":41,"high":51},"lateNightMinutes":0,"longestStretchMinutes":171,"firstHour":9,"lastHour":19},{"date":"2026-10-07","activeMinutes":{"low":364,"central":400,"high":436},"agentMinutes":{"low":23,"central":29,"high":36},"lateNightMinutes":50,"longestStretchMinutes":85,"firstHour":9,"lastHour":23},{"date":"2026-10-08","activeMinutes":{"low":322,"central":350,"high":378},"agentMinutes":{"low":29,"central":36,"high":45},"lateNightMinutes":0,"longestStretchMinutes":127,"firstHour":10,"lastHour":17},{"date":"2026-10-09","activeMinutes":{"low":294,"central":321,"high":348},"agentMinutes":{"low":35,"central":44,"high":55},"lateNightMinutes":0,"longestStretchMinutes":90,"firstHour":10,"lastHour":18},{"date":"2026-10-10","activeMinutes":{"low":67,"central":77,"high":87},"agentMinutes":{"low":0,"central":0,"high":0},"lateNightMinutes":0,"longestStretchMinutes":62,"firstHour":10,"lastHour":12},{"date":"2026-10-12","activeMinutes":{"low":308,"central":350,"high":392},"agentMinutes":{"low":29,"central":36,"high":45},"lateNightMinutes":0,"longestStretchMinutes":106,"firstHour":10,"lastHour":17},{"date":"2026-10-13","activeMinutes":{"low":315,"central":346,"high":377},"agentMinutes":{"low":37,"central":46,"high":58},"lateNightMinutes":0,"longestStretchMinutes":174,"firstHour":9,"lastHour":19},{"date":"2026-10-14","activeMinutes":{"low":321,"central":362,"high":403},"agentMinutes":{"low":28,"central":35,"high":44},"lateNightMinutes":72,"longestStretchMinutes":130,"firstHour":10,"lastHour":23},{"date":"2026-10-15","activeMinutes":{"low":381,"central":416,"high":451},"agentMinutes":{"low":59,"central":74,"high":93},"lateNightMinutes":0,"longestStretchMinutes":140,"firstHour":9,"lastHour":18},{"date":"2026-10-16","activeMinutes":{"low":303,"central":330,"high":357},"agentMinutes":{"low":31,"central":39,"high":49},"lateNightMinutes":0,"longestStretchMinutes":179,"firstHour":9,"lastHour":18},{"date":"2026-10-19","activeMinutes":{"low":365,"central":405,"high":445},"agentMinutes":{"low":43,"central":54,"high":68},"lateNightMinutes":128,"longestStretchMinutes":79,"firstHour":9,"lastHour":23},{"date":"2026-10-20","activeMinutes":{"low":345,"central":383,"high":421},"agentMinutes":{"low":61,"central":76,"high":95},"lateNightMinutes":114,"longestStretchMinutes":171,"firstHour":10,"lastHour":23}]</script>\n<script>"use strict";(()=>{var S="ccwatts",Se="0.1.2",F="https://github.com/holroydchase-afk/ccwatts",me="https://chaseholroyd.com/ccwatts/",ge="https://chaseholroyd.com/ccwatts.html";var K={input:"input",cacheWrite:"cache write",cacheRead:"cache read",output:"output"},H=e=>Math.round(e).toLocaleString("en-US");function B(e){return e>=100?H(e):e>=1?(Math.round(e*10)/10).toString():e>=.01?(Math.round(e*100)/100).toString():e===0?"0":e.toPrecision(1)}var Ce=e=>e>=1&&e<100?e.toFixed(1):B(e);function L(e){let t=e.high>=1e3,n=t?1e3:1,o=t?"kWh":"Wh";return{central:`${Ce(e.central/n)} ${o}`,range:`${Ce(e.low/n)} \\u2013 ${Ce(e.high/n)}`,unit:o}}var te=e=>e.replace(/^claude-/,"");var A=["input","cacheWrite","cacheRead","output"];var fe=()=>({low:0,central:0,high:0});function Le(e,t){return e.low+=t.low,e.central+=t.central,e.high+=t.high,e}function st(e,t){let n=e.toLowerCase();for(let[o,r]of Object.entries(t.tiers))if(Array.isArray(r)&&r.some(a=>n.includes(a)))return{tier:o,known:!0};return{tier:String(t.tiers.fallback),known:!1}}function Ut(e,t){let n=e.params[t];if(!n)throw new Error(`Missing parameter "${t}" in params.json`);return n}function Wt(e,t){let n=`output_wh_per_1k.${e}`;switch(t){case"output":return[n];case"input":return[n,"input_vs_output"];case"cacheWrite":return[n,"input_vs_output","cache_write_vs_input"];case"cacheRead":return[n,"input_vs_output","cache_read_vs_input"]}}function Ft(e,t,n){let o=.001,r=0,a=0;for(let s of Wt(t,n)){let i=Ut(e,s);o*=i.value,r+=Math.log(i.high/i.value)**2,a+=Math.log(i.value/i.low)**2}return{whPerToken:o,up:Math.sqrt(r),down:Math.sqrt(a)}}var ot=()=>({input:0,cacheWrite:0,cacheRead:0,output:0});var rt=new WeakMap;function Bt(e,t,n){let o=rt.get(e);o||rt.set(e,o=new Map);let r=`${t}:${n}`,a=o.get(r);return a||o.set(r,a=Ft(e,t,n)),a}function at(e,t,n,o){if(e<=0)return fe();let r=Bt(o,t,n),a=e*r.whPerToken;return{low:a/Math.exp(r.down),central:a,high:a*Math.exp(r.up)}}var Yt=e=>e.slice(0,10);function ye(e,t){let n=fe(),o=ot(),r={model:new Map,type:new Map,day:new Map,project:new Map},a=new Set,s=null,i=null,h=(p,d,y,w,l)=>{let f=r[p].get(d);f||r[p].set(d,f={key:d,energy:fe(),tokens:ot()}),Le(f.energy,y),f.tokens[w]+=l};for(let p of e){let{tier:d,known:y}=st(p.model,t);y||a.add(p.model);let w=Yt(p.timestamp);(s===null||w<s)&&(s=w),(i===null||w>i)&&(i=w);let l=p.project?.name??"(unknown)";for(let f of A){let m=p.tokens[f];if(m<=0)continue;let k=at(m,d,f,t);Le(n,k),o[f]+=m,h("model",p.model,k,f,m),h("type",f,k,f,m),h("day",w,k,f,m),h("project",p.project?`${l}#${p.project.id}`:l,k,f,m)}}let u=p=>[...p.values()].sort((d,y)=>y.energy.central-d.energy.central),b=[...a].map(p=>`Unknown model "${p}": estimated as ${String(t.tiers.fallback)}.`);return{methodVersion:t.version,total:n,tokens:o,responses:e.length,byModel:u(r.model),byType:u(r.type),byDay:[...r.day.values()].sort((p,d)=>p.key.localeCompare(d.key)),byProject:u(r.project),span:s&&i?{from:s,to:i}:null,warnings:b}}var Ne=e=>e.split("#")[0]??e;function zt(e,t){if(t(e)===1)return"charging a phone about once";if(e>=1)return`charging a phone about ${t(e)} times`;let n=Math.round(e*100);return n<1?"under 1% of a phone charge":n>=45&&n<=55?"about half a phone charge":`about ${Math.round(n/10)*10||n}% of a phone charge`}function He(e,t){let n=t.comparisons,o=[],r=s=>s>=10?Math.round(s):Math.round(s*10)/10,a=(s,i,h)=>r(s)===1?`1 ${i}`:`${r(s)} ${h}`;if(n.ev_kwh_per_mile){let s=e/n.ev_kwh_per_mile.value;o.push({id:"ev",amount:s,text:`driving an EV about ${a(s,"mile","miles")}`})}if(n.fridge_kwh_per_day){let s=e/n.fridge_kwh_per_day.value;o.push({id:"fridge",amount:s,text:`running a fridge about ${a(s,"day","days")}`})}if(n.phone_charge_kwh){let s=e/n.phone_charge_kwh.value;o.push({id:"phone",amount:s,text:zt(s,r)})}if(n.us_home_kwh_per_day){let s=e/n.us_home_kwh_per_day.value;o.push({id:"home",amount:s,text:`powering a US home about ${a(s,"day","days")}`})}return o}function z(e,t){let n=He(e,t),o=n.filter(a=>a.amount>=1).slice(0,2),r=[...n].sort((a,s)=>s.amount-a.amount).slice(0,1);return(o.length?o:r).map(a=>a.text).join(" \\xB7 ")}var it=F.replace(/^https:\\/\\//,"");function ct(e){return e==="all time"?"All my Claude Code use so far":e.startsWith("since")?`My Claude Code use ${e}`:`My ${e} of Claude Code`}function lt(e){return e==="all time"?"(Sample data) All of a sample\'s Claude Code use":`(Sample data) ${e[0].toUpperCase()}${e.slice(1)} of Claude Code`}function we({estimate:e,params:t,windowLabel:n,sample:o}){let r=L(e.total),a=z(e.total.central/1e3,t).split(" \\xB7 ")[0];return`${o?lt(n):ct(n)} came to about ${r.central} of electricity (range ${r.range} ${r.unit}), like ${a}. Estimated locally with ${S}, method v${t.version}: ${it}`}function Ae(e){let{estimate:t,params:n,windowLabel:o,sample:r}=e,a=L(t.total),s=t.total.central>0?Math.round((t.byType.find(i=>i.key==="cacheRead")?.energy.central??0)/t.total.central*100):0;return r?[`(Sample data) This is what ${S} shows for a sample developer, not a real measurement. ${lt(o).replace("(Sample data) ","")}: about ${a.central} (range ${a.range} ${a.unit}), like ${z(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${s}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and it runs entirely on your own machine, so no logs leave it.","",`Try it on your own logs: ${me}`,`Code and method: ${F}`].join(`\n`):[`I estimated the electricity behind my AI coding. ${ct(o)}: about ${a.central} (range ${a.range} ${a.unit}), like ${z(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${s>=50?"The surprise: ":""}${s}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.","",`Try it in your browser: ${me}`,`Code and method: ${F}`].join(`\n`)}var D=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");function ne(e,t,n){let o=Math.max(2,n-e.length-t.length-2);return`${e} ${".".repeat(o)} ${t}`}function De({estimate:e,params:t,windowLabel:n,sample:o}){let s=L(e.total),i=e.total.central/1e3,h=z(i,t).split(" \\xB7 "),u=s.unit,b=u==="kWh"?1e3:1,p=712,d=432,y=36,w=[],l="-".repeat(y);w.push({text:"ELECTRICITY RECEIPT",weight:"bold"}),w.push({text:e.span?`${e.span.from} \\u2192 ${e.span.to}`:n,muted:!0}),w.push({text:l,muted:!0});let f=[...A].sort((x,T)=>(e.byType.find(N=>N.key===T)?.energy.central??0)-(e.byType.find(N=>N.key===x)?.energy.central??0));for(let x of f){let T=e.byType.find(N=>N.key===x);w.push({text:ne(K[x],`${B((T?.energy.central??0)/b)} ${u}`,y)})}w.push({text:l,muted:!0}),w.push({text:ne("TOTAL (central)",s.central,y),weight:"bold"}),w.push({text:ne("RANGE",`${s.range} ${u}`,y)}),w.push({text:l,muted:!0});for(let x of e.byModel.slice(0,3)){let T=e.total.central>0?Math.round(x.energy.central/e.total.central*100):0;w.push({text:ne(te(x.key),`${T}%`,y),muted:!0})}w.push({text:ne("responses",H(e.responses),y),muted:!0}),w.push({text:`method v${t.version} \\xB7 counts only`,muted:!0});let m=25,k=46,P=k+44,O=P+w.length*m+6,E=O+70,W=e.byDay.slice(-30),Y=Math.max(...W.map(x=>x.energy.central),1e-9),M=(d-64)/Math.max(W.length,1),ue=W.map((x,T)=>{let N=6+x.energy.central/Y*40;return`<rect x="${(p+32+T*M).toFixed(1)}" y="${(O+46-N).toFixed(1)}" width="${Math.max(1,M-2).toFixed(1)}" height="${N.toFixed(1)}" fill="#1f2a24"/>`}).join(""),ee=[];for(let x=0,T=p+d;T>p;x++,T-=9)ee.push(`${T.toFixed(1)},${E+(x%2?10:0)}`);let pe=`M${p},${k} H${p+d} V${E} L${ee.join(" L")} L${p},${E} Z`,G="ui-monospace, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace",_="\'Helvetica Neue\', Helvetica, Arial, sans-serif",de=w.map((x,T)=>{let N=P+T*m,nt=T<2||x.text.startsWith("method");return`<text x="${nt?p+d/2:p+30}" y="${N}" font-family="${G}" font-size="16.5" ${nt?\'text-anchor="middle"\':""} font-weight="${x.weight??"normal"}" fill="${x.muted?"#5e6b63":"#1f2a24"}">${D(x.text)}</text>`}).join(`\n    `),he=s.central.split(" ");return`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627" role="img" aria-label="${D(we({estimate:e,params:t,windowLabel:n,sample:o}))}">\n  <rect width="1200" height="627" fill="#12251c"/>\n  <rect x="0" y="621" width="1200" height="6" fill="#7cc4a0"/>\n  <text x="64" y="104" font-family="${G}" font-size="20" letter-spacing="2" fill="#7cc4a0">${o?\'<tspan fill="#e0b56a">SAMPLE DATA \\xB7 </tspan>\':""}CLAUDE CODE \\xB7 ${D(n.toUpperCase())}</text>\n  <text x="60" y="262" font-family="${_}" font-size="148" font-weight="700" fill="#f4f1e8">${D(he[0]??"")}<tspan font-size="64" font-weight="500" dx="14">${D(he[1]??"")}</tspan></text>\n  <text x="64" y="318" font-family="${_}" font-size="28" fill="#cfe3d6">of electricity, range ${D(s.range)} ${u}</text>\n  ${h.map((x,T)=>`<text x="64" y="${384+T*38}" font-family="${_}" font-size="26" fill="#f4f1e8">\\u2248 ${D(x)}</text>`).join(`\n  `)}\n  <text x="64" y="520" font-family="${_}" font-size="20" fill="${o?"#e0b56a":"#9fb8a8"}">${o?"Sample data, not a real measurement.":"Estimated on my laptop. No logs left it."}</text>\n  <text x="64" y="552" font-family="${G}" font-size="17" fill="#7cc4a0">${D(S)} \\xB7 method v${D(t.version)}</text>\n  <text x="64" y="578" font-family="${G}" font-size="17" fill="#7cc4a0">${D(it)}</text>\n  <path d="${pe}" fill="#f7f5ef"/>\n  <g>\n    ${de}\n  </g>\n  ${ue}\n</svg>\n`}var Jt=/[\\u0000-\\u001f\\u007f-\\u009f\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;function q(e,t=64){let n=e.replace(Jt,"");if(n.length<=t)return n;let o="";for(let r of n){if(o.length+r.length>t-1)break;o+=r}return`${o}\\u2026`}function Gt(e){let t=0xcbf29ce484222325n,n=0x100000001b3n;for(let o=0;o<e.length;o++)t^=BigInt(e.charCodeAt(o)),t=t*n&0xffffffffffffffffn;return t.toString(16).padStart(16,"0")}function Ie(e){let t=e.replace(/[\\\\/]+$/,""),n=t.split(/[\\\\/]/).pop()||t,o=t===""?"(root)":q(n)||"(unnamed)";return{id:Gt(t),name:o}}var ut=1e9,be=(e,t=!1)=>e===null&&t?null:typeof e!="number"||e<=0?0:Number.isInteger(e)&&e<=ut?e:null,pt=e=>/^\\d{4}-\\d{2}-\\d{2}/.test(e)&&!Number.isNaN(Date.parse(e)),V=e=>typeof e=="string"&&e!==""?e:null;function Kt(e){if(e.type!=="assistant")return null;let t=e.message,n=t?.usage,o=V(t?.model),r=V(e.timestamp),a=V(t?.id);if(!n||!o||!r||!a||!pt(r)||o==="<synthetic>")return null;let s=be(n.input_tokens,!0),i=be(n.cache_creation_input_tokens),h=be(n.cache_read_input_tokens),u=be(n.output_tokens,!0);if(s===null||i===null||h===null||u===null)return null;let b=V(e.cwd);return{source:"claude-code",key:`${a}:${V(e.requestId)??""}`,timestamp:r,model:q(o)||"(unnamed)",project:b?Ie(b):null,tokens:{input:s,cacheWrite:i,cacheRead:h,output:u}}}var je=e=>typeof e=="object"&&e!==null?e.type:void 0;function qt(e){if(e.type!=="user"||e.isMeta===!0||e.isSidechain===!0||e.isCompactSummary===!0||"toolUseResult"in e)return!1;let t=e.message?.content;if(Array.isArray(t)&&t.some(n=>je(n)==="tool_result"))return!1;if("origin"in e){let n=e.origin;return typeof n=="object"&&n!==null&&n.kind==="human"}return typeof t=="string"?!0:Array.isArray(t)&&t.length>0&&t.every(n=>je(n)==="text"||je(n)==="image")}var Z={id:"claude-code",parse(e){let t=new Map;for(let n of e.replace(/^\\uFEFF/,"").split(`\n`)){if(!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}let r=Kt(o);r&&t.set(r.key,r)}return[...t.values()]},activity(e){let t=[];for(let n of e.replace(/^\\uFEFF/,"").split(`\n`)){if(!n.includes(\'"user"\')&&!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}if(typeof o!="object"||o===null||o.type!=="user"&&o.type!=="assistant")continue;let r=V(o.timestamp);!r||!pt(r)||t.push({event:{timestamp:r,human:qt(o)},ms:Date.parse(r)})}return t.sort((n,o)=>n.ms-o.ms).map(n=>n.event)}};var dt={version:"0.1.0",as_of:"2026-10-21",license:"CC BY 4.0",boundary:"comprehensive: accelerators, host CPU and memory, idle capacity, and data-center overhead (PUE)",interval:"low and high are each parameter\'s plausible bounds, treated as a ~90% interval",params:{"output_wh_per_1k.opus":{value:1.2,low:.4,high:3,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models."},"output_wh_per_1k.sonnet":{value:.6,low:.25,high:1.5,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://arxiv.org/abs/2508.15734",as_of:"2026-10-21",note:"Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google\'s measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k."},"output_wh_per_1k.haiku":{value:.25,low:.08,high:.6,unit:"Wh per 1k output tokens",label:"GUESS",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute."},input_vs_output:{value:.3,low:.15,high:.5,unit:"ratio",label:"MODELED",source:"https://www.anthropic.com/pricing",as_of:"2026-10-21",note:"Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3."},cache_write_vs_input:{value:1,low:.8,high:1.25,unit:"ratio",label:"MODELED",source:"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",as_of:"2026-10-21",note:"Writing to the cache means processing the tokens fresh, then storing the result. Priced at 1.25x input."},cache_read_vs_input:{value:.1,low:.01,high:.25,unit:"ratio",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather\'s central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input."}},tiers:{opus:["opus"],sonnet:["sonnet"],haiku:["haiku"],fallback:"sonnet"},comparisons:{ev_kwh_per_mile:{value:.3,unit:"kWh per mile",label:"MEASURED",source:"https://www.fueleconomy.gov/feg/evsbs.shtml",as_of:"2026-10-21",note:"Typical EV uses 25-35 kWh per 100 miles (EPA)."},fridge_kwh_per_day:{value:1.5,unit:"kWh per day",label:"MEASURED",source:"https://www.energystar.gov/products/refrigerators",as_of:"2026-10-21",note:"A typical US refrigerator uses about 400-600 kWh a year."},us_home_kwh_per_day:{value:29,unit:"kWh per day",label:"MEASURED",source:"https://www.eia.gov/tools/faqs/faq.php?id=97&t=3",as_of:"2026-10-21",note:"Average US household used about 10,800 kWh in a year (EIA)."},phone_charge_kwh:{value:.019,unit:"kWh per smartphone charge",label:"MEASURED",source:"https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",as_of:"2026-10-21",note:"EPA\'s figure for fully charging one smartphone."}},pace:{gap_minutes:{value:20,low:10,high:30,unit:"minutes",label:"GUESS",source:"https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",as_of:"2026-10-31",note:"Heuristic, not measured: an idle gap longer than this ends a work block. The low gap gives the low active time (more splits), the high gap the high."},break_minutes:{value:15,low:15,high:15,unit:"minutes",label:"GUESS",source:"https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",as_of:"2026-10-31",note:"Heuristic, not measured: a pause of at least this long inside a block ends a stretch, for the longest-stretch count."},late_night:{start_hour:22,end_hour:6}}};var $=dt;function Oe(e,t,n={}){let o={...e.params};for(let[r,a]of Object.entries(t)){let s=e.params[r];if(!s)throw new Error(`Unknown parameter "${r}"`);if(!Number.isFinite(a)||a<=0)throw new Error(`Parameter "${r}" must be a positive number, got ${a}`);let i=a/s.value;o[r]=n.pin?{...s,value:a,low:a,high:a}:{...s,value:a,low:s.low*i,high:s.high*i}}return{...e,params:o}}var We=e=>{let t=$.pace;return{timeZone:e,gapMinutes:{low:t.gap_minutes.low,central:t.gap_minutes.value,high:t.gap_minutes.high},breakMinutes:t.break_minutes.value,lateNight:{startHour:t.late_night.start_hour,endHour:t.late_night.end_hour}}},oe=6e4,Zt=60*oe;function Xt(e){return e.map(t=>({ms:Date.parse(t.timestamp),human:t.human})).filter(t=>!Number.isNaN(t.ms)).sort((t,n)=>t.ms-n.ms)}function ht(e,t){let n=[];for(let o of e){let r=n[n.length-1];r&&o.ms-r[r.length-1].ms<=t?r.push(o):n.push([o])}return n}function Qt(e){let t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});return n=>{let o={};for(let r of t.formatToParts(n))o[r.type]=r.value;return{date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour)%24,minute:Number(o.minute),second:Number(o.second)}}}function mt(e,t,n){let o=[],r=(s,i)=>s.date===i.date&&s.hour===i.hour,a=e;for(;a<t;){let s=n(a),i=a+Zt-(s.minute*oe+s.second*1e3+(a%1e3+1e3)%1e3);if(i>t)i=t;else if(!r(n(i-1),s)){let h=a,u=i-1;for(;u-h>1;){let b=Math.floor((h+u)/2);r(n(b),s)?h=b:u=b}i=u}o.push({date:s.date,hour:s.hour,ms:i-a}),a=i}return o}var en=(e,{startHour:t,endHour:n})=>t<=n?e>=t&&e<n:e>=t||e<n,tn=["low","central","high"],gt=1,Ue=e=>Math.round(e/oe/.1)/10,ft=e=>{let[t,n,o]=e.map(Ue).sort((r,a)=>r-a);return{low:t,central:n,high:o}};function Fe(e,t){if(typeof t.timeZone!="string"||t.timeZone==="")throw new Error("paceDays needs a time zone");let n=Qt(t.timeZone),o=Xt(e),r=new Map,a=s=>{let i=r.get(s);return i||(i={active:[0,0,0],agent:[0,0,0],lateNight:0,longestStretch:0,firstHour:null,lastHour:null},r.set(s,i)),i};for(let s of[0,1,2])for(let i of ht(o,t.gapMinutes[tn[s]]*oe)){let h=i.some(p=>p.human),u=i[0].ms,b=i[i.length-1].ms;for(let p of mt(u,b,n)){let d=a(p.date);(h?d.active:d.agent)[s]+=p.ms,!(s!==gt||!h)&&(en(p.hour,t.lateNight)&&(d.lateNight+=p.ms),d.firstHour??(d.firstHour=p.hour),d.lastHour=p.hour)}if(!(s!==gt||!h))for(let p of ht(i,t.breakMinutes*oe-1)){let d=new Map;for(let y of mt(p[0].ms,p[p.length-1].ms,n))d.set(y.date,(d.get(y.date)??0)+y.ms);for(let[y,w]of d){let l=a(y);l.longestStretch=Math.max(l.longestStretch,w)}}}return[...r.entries()].filter(([,s])=>[...s.active,...s.agent].some(i=>i>0)).sort(([s],[i])=>s<i?-1:s>i?1:0).map(([s,i])=>({date:s,activeMinutes:ft(i.active),agentMinutes:ft(i.agent),lateNightMinutes:Ue(i.lateNight),longestStretchMinutes:Ue(i.longestStretch),firstHour:i.firstHour,lastHour:i.lastHour}))}var ke=e=>`${e.date}|${e.source}|${e.model}|${e.projectId??""}`;var yt=e=>e.output*(e.input+e.cacheWrite+e.cacheRead);function Be(e){let t=new Map;for(let n of e){let o={date:n.timestamp.slice(0,10),source:n.source,model:n.model,projectId:n.project?.id??null,projectName:n.project?.name??null},r=ke(o),a=t.get(r);a||t.set(r,a={...o,responses:0,tokens:{input:0,cacheWrite:0,cacheRead:0,output:0},outputContext:0}),a.responses+=1;for(let s of A)a.tokens[s]+=n.tokens[s];a.outputContext+=yt(n.tokens)}return nn([...t.values()])}function nn(e){return e.sort((t,n)=>ke(t).localeCompare(ke(n)))}function xe(e){return e.map(t=>({source:t.source,key:ke(t),timestamp:`${t.date}T00:00:00.000Z`,model:t.model,project:t.projectId?{id:t.projectId,name:t.projectName??"(unknown)"}:null,tokens:{...t.tokens}}))}function Ye(e){let t=new Date(`${e}T00:00:00Z`),n=(t.getUTCDay()+6)%7;return t.setUTCDate(t.getUTCDate()-n),t.toISOString().slice(0,10)}var Je=15,bt=864e5,$e=e=>Date.parse(`${e}T00:00:00Z`),on=e=>new Date(e).toISOString().slice(0,10),ze=(e,t)=>on($e(e)+t*bt),re=e=>Math.round(e*100)/100,wt=e=>({low:re(e.low/60),central:re(e.central/60),high:re(e.high/60)}),rn=e=>[0,6].includes(new Date($e(e)).getUTCDay());function Ge(e,t,n=4){let o=Ye(t),r=[];for(let a=0;a<n;a++){let s=ze(o,-7*a),i=ze(s,6)<t?ze(s,6):t,h=e.filter(m=>m.date>=s&&m.date<=i),u={low:0,central:0,high:0},b={low:0,central:0,high:0},p=0,d=0,y=0,w=null,l=0;for(let m of h){for(let k of["low","central","high"])u[k]+=m.activeMinutes[k],b[k]+=m.agentMinutes[k];p+=m.lateNightMinutes,d=Math.max(d,m.longestStretchMinutes),rn(m.date)&&(y+=m.activeMinutes.central),m.lastHour!==null&&(w=Math.max(w??0,m.lastHour)),m.activeMinutes.central>=Je&&l++}let f=Math.round(($e(i)-$e(s))/bt)+1;r.push({start:s,activeHours:wt(u),agentHours:wt(b),lateNightHours:re(p/60),longestStretchMinutes:d,restDays:f-l,daysCounted:f,weekendShare:u.central>0?re(y/u.central):0,latestHour:w})}return r}function I(e){return e===0?"0":e>=10?H(e):(Math.round(e*10)/10).toFixed(1)}function U(e){let t=Math.round(e),n=Math.floor(t/60),o=t%60;return n===0?`${o}m`:o===0?`${n}h`:`${n}h ${o}m`}var sn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],se=e=>`${sn[Number(e.slice(5,7))-1]} ${Number(e.slice(8,10))}`,ve=e=>e===0?"midnight":e===12?"noon":e<12?`${e}am`:`${e-12}pm`,j=e=>`${I(e.low)} \\u2013 ${I(e.high)}`,kt=e=>`about ${I(e.central)} active hours (range ${j(e)})`,xt=3;function $t(e){let[t,n]=e;return!t||!n||t.daysCounted>xt?0:n.activeHours.high>0||n.agentHours.high>0?1:0}function Ke(e,t){let n=$t(e),o=e[n],r=n===0?"This week so far":`Week of ${se(o.start)}`,a=ve(t.pace.late_night.start_hour),s=o.daysCounted-o.restDays,i=e[0],h=`${i.daysCounted} day${i.daysCounted===1?"":"s"}`;return{focus:n,lead:`${r}: ${kt(o.activeHours)}`,rest:`${U(o.lateNightHours*60)} past ${a}, longest stretch ${U(o.longestStretchMinutes)}, active ${s} of ${o.daysCounted} days.`,soFar:n===0?null:i.activeHours.central>0?`This week so far: about ${I(i.activeHours.central)} hours in ${h}.`:"This week so far: no active hours yet.",agents:vt(o)}}function vt(e){return e.agentHours.high>0?`Agents worked another ${j(e.agentHours)} hours on their own.`:null}var lo=["activeMinutes","agentMinutes","date","firstHour","lastHour","lateNightMinutes","longestStretchMinutes"].join();function qe(e){let t=new Map;for(let n of e)t.set(`${n.source}:${n.key}`,n);return[...t.values()]}var an=Object.freeze({on:!1,after:23,until:5,persona:"random"});function Mt(e,t){if(!t)return e;let n=e.texts.flatMap(o=>Z.activity?.(o)??[]);return{...e,pace:Fe(n,We(t))}}var cn="No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";async function Tt(e,t){let n=[...e].filter(r=>r.name.endsWith(".jsonl"));if(!n.length)return{ok:!1,status:cn};let o=[];for(let r of n)try{o.push(await r.text())}catch{return{ok:!1,status:"Couldn\'t read one of those files. Try again, or pick the files instead of the folder."}}return Mt({ok:!0,texts:o,what:`${n.length} file${n.length===1?"":"s"}`},t)}var ln="Paste the lines first.";function Rt(e){return e==="pasted text"?"We couldn\'t find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.":`We couldn\'t find any Claude Code usage in ${e==="1 file"?"that file":"those files"}. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.`}function Pt(e,t){return e.trim()?Mt({ok:!0,texts:[e],what:"pasted text"},t):{ok:!1,status:ln}}var c=e=>document.getElementById(e),g=e=>e.replace(/[&<>"\']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"})[t]);function tt(e,t){try{return JSON.parse(c(e).textContent??"")}catch{return t}}var R=tt("ccwatts-data",{mode:"playground",generatedAt:null,rows:[]}),Lt=tt("ccwatts-sample",[]),Nt=tt("ccwatts-sample-pace",[]),v={rows:R.mode==="dashboard"&&R.rows.length?R.rows:Lt,source:R.mode==="dashboard"&&R.rows.length?"history":"sample",window:"30d"},C=R.mode==="dashboard"?{days:R.pace??null,source:"history",off:R.paceOff}:{days:Nt,source:"sample"},un={"7d":"last 7 days","30d":"last 30 days",all:"all time"};function pn(e,t){if(t==="all"||e.length===0)return e;let n=t==="7d"?7:30,o=e.reduce((s,i)=>i.date>s?i.date:s,"0000-00-00"),r=v.source==="history"?Date.now():Date.parse(`${o}T00:00:00Z`)+864e5,a=new Date(r-n*864e5).toISOString().slice(0,10);return e.filter(s=>s.date>=a)}var ce="cache_read_vs_input",_e=$.params[ce].value,J=$,Q=()=>J!==$,X=e=>`${Math.round(e*100)}%`;function Et(e,t=$){let n=ye(xe(e),t);return n.responses=e.reduce((o,r)=>o+r.responses,0),n}function dn(e,t){let n=L(e.total),[o,r]=n.central.split(" ");c("hero-eyebrow").innerHTML=`Claude Code electricity \\xB7 ${g(t)}${Q()?` \\xB7 <span class="whatif-flag">what-if: cache reads ${X(J.params[ce].value)} \\xB7 not published</span>`:""}`,c("hero-big").innerHTML=e.responses?`${g(o??"")}<small>${g(r??"")}</small>`:"\\u2013";let a=Q()?`, with cache reads fixed at ${X(J.params[ce].value)} and every other assumption at its bounds.`:", from the bounds on every assumption.";c("hero-range").textContent=e.responses?`Plausible range ${n.range} ${n.unit}${a}`:"No usage in this window.",c("hero-compare").textContent=e.responses?`That\'s like ${z(e.total.central/1e3,$).replace(" \\xB7 ",", or ")}.`:"";let s=A.reduce((h,u)=>h+e.tokens[u],0),i=[`${H(e.responses)} responses`,`${H(s)} tokens`,...e.span?[e.span.from===e.span.to?e.span.from:`${e.span.from} to ${e.span.to}`]:[],`method v${$.version}`];c("hero-meta").innerHTML=i.map(h=>`<span>${g(h)}</span>`).join(" \\xB7 ");for(let h of["7d","30d","all"])c(`w-${h}`).setAttribute("aria-pressed",String(v.window===h))}function Ht(e){let t=c("chart"),n=Math.round(Math.min(720,Math.max(320,t.getBoundingClientRect().width||720))),o=240;t.setAttribute("viewBox",`0 0 ${n} ${o}`);let r={l:44,r:8,t:22,b:28},a=e.byDay;if(c("legend").innerHTML=["cacheRead","cacheWrite","output","input"].map(l=>`<span><i style="background:var(--t-${l})"></i>${K[l]}</span>`).join(""),!a.length){t.innerHTML=`<text x="${n/2}" y="${o/2}" text-anchor="middle">No usage in this window</text>`,c("chart-note").textContent="";return}let s=L(e.total),i=s.unit==="kWh"?1e3:1,h=Math.max(...a.map(l=>l.energy.central))/i,u=At(h/3),b=Math.max(u*Math.ceil(h/u),u),p=l=>r.t+(o-r.t-r.b)*(1-l/b),d=(n-r.l-r.r)/a.length,y=[];for(let l=0;l<=b+1e-9;l+=u)y.push(`<line x1="${r.l}" x2="${n-r.r}" y1="${p(l)}" y2="${p(l)}" stroke="var(--line)" stroke-width="1"/>`),y.push(`<text x="${r.l-6}" y="${p(l)+4}" text-anchor="end">${B(l)}</text>`);y.push(`<text x="0" y="10">${g(s.unit)} per day</text>`),a.forEach((l,f)=>{let m=0,k=r.l+f*d+d*.12,P=Math.max(1,d*.76);for(let O of["cacheRead","cacheWrite","output","input"]){let E=hn(l,O);if(E<=0)continue;let W=m/i;m+=E;let Y=m/i;y.push(`<rect x="${k.toFixed(1)}" y="${p(Y).toFixed(1)}" width="${P.toFixed(1)}" height="${Math.max(.5,p(W)-p(Y)).toFixed(1)}" fill="var(--t-${O})"><title>${g(l.key)} ${g(K[O])} ${B(E/i)} ${g(s.unit)}</title></rect>`)}});let w=a.length===1?[0]:[0,Math.floor((a.length-1)/2),a.length-1];for(let l of new Set(w)){let f=l===0?"start":l===a.length-1?"end":"middle",m=l===0?r.l:l===a.length-1?n-r.r:r.l+(l+.5)*d;y.push(`<text x="${m}" y="${o-8}" text-anchor="${f}">${g(a[l].key.slice(5))}</text>`)}t.innerHTML=y.join(""),c("chart-note").textContent=`Bars show the central estimate per day. The total for this window is ${s.central}, with a range of ${s.range} ${s.unit}.`}function hn(e,t){return Re.get(e.key)?.[t]??0}var Re=new Map;function mn(e,t){Re=new Map;for(let n of e){let o=ye(xe([n]),t),r=Re.get(n.date);r||Re.set(n.date,r={input:0,cacheWrite:0,cacheRead:0,output:0});for(let a of o.byType)r[a.key]+=a.energy.central}}function At(e){if(e<=0)return 1;let t=10**Math.floor(Math.log10(e)),n=e/t;return(n<=1?1:n<=2?2:n<=5?5:10)*t}function _t(e,t,n,o){let r=Math.max(...t.map(s=>s.energy.central),1e-9),a=t.slice(0,6);c(e).innerHTML=a.length?a.map(s=>{let i=L(s.energy),h=o.total.central?Math.round(s.energy.central/o.total.central*100):0;return`<li><span class="name" title="${g(n(s.key))}">${g(n(s.key))}</span><span class="val">${g(i.central)} \\xB7 ${h}%</span><span class="bar"><span style="width:${(s.energy.central/r*100).toFixed(1)}%"></span></span><span class="val" style="grid-column:1/-1;text-align:left">range ${g(i.range)} ${g(i.unit)}</span></li>`}).join(""):\'<li><span class="name">No usage in this window</span></li>\'}function gn(e){let t=r=>e.total.central?Math.round((e.byType.find(a=>a.key===r)?.energy.central??0)/e.total.central*100):0,n=A.reduce((r,a)=>r+e.tokens[a],0),o=n?Math.round(e.tokens.cacheRead/n*100):0;c("explain").textContent=e.responses?`Each time Claude Code takes a step, it re-reads the conversation so far. Most of that comes from a cache, which is cheap per token but happens constantly. Here, cache reads were ${o}% of tokens and about ${t("cacheRead")}% of the electricity. Writing new context into the cache was ${t("cacheWrite")}%, and the text the model wrote back was ${t("output")}%. Long sessions grow the context the agent re-reads, so starting fresh sessions for new tasks is the simplest way to lower your number.`:"Load some usage to see what drives it."}function fn(){let e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}var Pe=ve($.pace.late_night.start_hour),yn={sample:"Sample data",history:"Your history",files:"Your files"},ae=[];function wn(){let e=C.days,t=e===null,n=C.source==="history"?fn():(e??[]).reduce((u,b)=>b.date>u?b.date:u,"0000-00-00"),o=e&&e.length?Ge(e,n,4):[],r=o.some(u=>u.activeHours.high>0||u.agentHours.high>0);ae=r?o:[];let a=c("pace-pill");a.hidden=t,a.textContent=yn[C.source],a.classList.toggle("sample",C.source==="sample"),c("pace-optin").hidden=!t||!!C.off,c("pace-skipped").hidden=!t||C.off!=="skipped",c("pace-unreadable").hidden=!t||C.off!=="unreadable";for(let u of["pace-body","pace-more"])c(u).toggleAttribute("hidden",!r);let s=c("pace-empty");if(s.hidden=t||r,s.textContent=C.source==="files"?"No pace for these files: they hold no timed turns to count.":"No active time in the last 4 weeks yet. Pace fills in as you use Claude Code.",!r){c("pace-chart").innerHTML="",c("pace-table").innerHTML="";return}let i=Ke(o,$);c("pace-lead").innerHTML=`<b>${g(Me(i.lead))}</b>, ${g(Me(i.rest))}`,c("pace-sofar").textContent=i.soFar?Me(i.soFar):"",c("pace-sofar").hidden=!i.soFar,c("pace-agents").textContent=i.agents?Me(i.agents):"",c("pace-agents").hidden=!i.agents,Xe(o);let h=o.map((u,b)=>`<tr><td>${g(Ze(u,b))}</td><td>${g(j(u.activeHours))}</td><td>${g(U(u.lateNightHours*60))}</td><td>${g(U(u.longestStretchMinutes))}</td><td>${u.restDays}</td><td>${g(j(u.agentHours))}</td></tr>`).join("");c("pace-table").innerHTML=`<caption>Pace by week, newest first</caption><thead><tr><th>Week of</th><th>Active (h)</th><th>Past ${g(Pe)}</th><th>Longest</th><th>Days off</th><th>Agent-only (h)</th></tr></thead><tbody>${h}</tbody>`}var Me=e=>e.replace(/(\\d+h) (\\d+m)/g,"$1\\xA0$2").replace(/(\\d) \u2013 (\\d)/g,"$1\\xA0\\u2013\\xA0$2"),Ze=(e,t)=>t===0?`${se(e.start)} (so far)`:se(e.start);function Xe(e){let t=c("pace-chart"),n=Math.round(Math.min(720,Math.max(320,t.getBoundingClientRect().width||720))),o=230;t.setAttribute("viewBox",`0 0 ${n} ${o}`);let r={l:36,r:8,t:26,b:40},a=[...e].reverse(),s=Math.max(...a.map(l=>Math.max(l.activeHours.high,l.agentHours.high)),1),i=At(s/3),h=Math.max(i*Math.ceil(s/i),i),u=l=>r.t+(o-r.t-r.b)*(1-l/h),b=(n-r.l-r.r)/a.length,p=[];for(let l=0;l<=h+1e-9;l+=i)p.push(`<line x1="${r.l}" x2="${n-r.r}" y1="${u(l)}" y2="${u(l)}" stroke="var(--line)" stroke-width="1"/>`),p.push(`<text x="${r.l-6}" y="${u(l)+4}" text-anchor="end">${B(l)}</text>`);p.push(\'<text x="0" y="10">hours per week, starting Monday</text>\');let d=l=>l.toFixed(1),y=(l,f,m,k)=>{if(m<=f)return"";let P=5;return`<path d="M${d(l)} ${d(u(f))}V${d(u(m))}M${d(l-P)} ${d(u(m))}H${d(l+P)}M${d(l-P)} ${d(u(f))}H${d(l+P)}" stroke="${k}" stroke-width="1.5" fill="none"/>`};a.forEach((l,f)=>{let m=Ze(l,a.length-1-f),k=Math.min(56,b*.36),P=Math.min(48,b*.26),O=Math.max(4,b*.04),E=r.l+f*b+(b-k-O-P)/2,W=E+k+O,Y=u(0),M=l.activeHours,ue=Math.min(l.lateNightHours,M.central),ee=l===e[0],pe=ee?\' fill-opacity="0.5"\':"",G=`Week of ${m}: about ${I(M.central)} active hours (range ${j(M)}), ${U(l.lateNightHours*60)} past ${Pe}`;M.central>0&&(p.push(`<rect x="${d(E)}" y="${d(u(M.central))}" width="${d(k)}" height="${d(Math.max(.5,Y-u(M.central)))}" rx="2" fill="var(--accent)"${pe}><title>${g(G)}</title></rect>`),ue>0&&p.push(`<rect x="${d(E)}" y="${d(u(M.central))}" width="${d(k)}" height="${d(Math.max(1.5,u(M.central-ue)-u(M.central)))}" rx="2" fill="var(--t-cacheWrite)"${pe}><title>${g(`${U(l.lateNightHours*60)} past ${Pe}`)}</title></rect>`)),p.push(y(E+k/2,M.low,M.high,"var(--ink)")),M.high>0&&p.push(`<text class="val" x="${d(E+k/2)}" y="${d(u(M.high)-7)}" text-anchor="middle">${g(I(M.central))}h</text>`);let _=l.agentHours;_.central>0&&(p.push(`<rect x="${d(W)}" y="${d(u(_.central))}" width="${d(P)}" height="${d(Math.max(.5,Y-u(_.central)))}" rx="2" class="agent${ee?" partial":""}"><title>${g(`Agents on their own: about ${I(_.central)} hours (range ${j(_)})`)}</title></rect>`),p.push(y(W+P/2,_.low,_.high,"var(--muted)")));let de=r.l+(f+.5)*b,[he,x]=m.split(" (");p.push(`<text x="${d(de)}" y="${o-22}" text-anchor="middle">${g(he)}</text>`),x&&p.push(`<text x="${d(de)}" y="${o-8}" text-anchor="middle">${g(x.replace(")",""))}</text>`)}),t.innerHTML=p.join("");let w=e.map((l,f)=>`week of ${Ze(l,f)}: about ${I(l.activeHours.central)} active hours (range ${j(l.activeHours)}), ${U(l.lateNightHours*60)} past ${Pe}, agent-only ${j(l.agentHours)} hours`).join("; ");t.setAttribute("aria-label",`Pace for the last ${e.length} weeks, newest first: ${w}.`)}var Ee="",Te="",Dt="",Qe="";function bn(e,t){let n={estimate:e,params:$,windowLabel:t,sample:v.source==="sample"};Ee=De(n),Dt=we(n),Qe=Ae(n),c("card").src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(Ee)}`,Te&&URL.revokeObjectURL(Te),Te=URL.createObjectURL(new Blob([Ee],{type:"image/svg+xml"})),c("card-full").href=Te,c("post").textContent=Qe,c("share-status").textContent=v.source==="sample"?"This card shows sample data. Load your own logs to make yours.":""}function kn(e){try{return new URL(e).hostname.replace(/^www\\./,"")}catch{return"source"}}function xn(){c("method-intro").textContent=`Energy = tokens \\xD7 energy per token, by model family and token type. Each parameter below has a low and high bound, and they combine into the range you see. The boundary is ${$.boundary}. Labels say how solid each number is: MODELED is derived from published figures, GUESS is a best estimate with wide bounds. Method v${$.version}, parameters as of ${$.as_of}, licensed ${$.license}.`;let e=Object.entries($.params).map(([t,n])=>`<tr><td data-label="Parameter"><code>${g(t)}</code><div class="note">${g(n.note)}</div></td><td class="num" data-label="Value">${n.value}</td><td class="num" data-label="Range">${n.low} \\u2013 ${n.high}</td><td data-label="Unit">${g(n.unit)}</td><td data-label="Label"><span class="label">${g(n.label)}</span></td><td data-label="Source"><a class="src" href="${g(n.source)}" rel="noopener noreferrer">${g(kn(n.source))}</a></td></tr>`).join("");c("params").innerHTML=`<thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead><tbody>${e}</tbody>`}var $n={sample:"ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. Try it on your own logs below.",files:"ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You\'re looking at the files you loaded.",history:"ccwatts estimates the electricity behind your Claude Code use from the token counts in its local logs, as a range with every assumption sourced."},et=null;function le(e=!0){let t=pn(v.rows,v.window);mn(t,J);let n=Et(t),o=Q()?Et(t,J):n;et=o;let r=un[v.window],a=c("source-pill");a.textContent=v.source==="sample"?"Sample data":v.source==="history"?"Your history":"Your files",a.classList.toggle("sample",v.source==="sample"),a.hidden=R.mode==="playground";let s=v.source!=="sample";c("demo-sum-sample").hidden=s,c("demo-copy-sample").hidden=s,c("demo-sum-files").hidden=!s,c("demo-copy-files").hidden=!s,c("lede").textContent=$n[v.source],dn(o,r),Ht(o),_t("by-model",o.byModel,te,o),_t("by-project",o.byProject,Ne,o),gn(o),vn(o,n),e&&bn(n,r),wn()}function vn(e,t){let n=J.params[ce].value;c("whatif-cache").setAttribute("aria-valuetext",`${X(n)} of fresh input`),c("whatif-value").textContent=X(n);let r=c("whatif-note");if(r.hidden=!Q(),c("whatif-reset").hidden=!Q(),!Q())return void(r.textContent="");let a=L(e.total),s=L(t.total),i=e.responses?` ${a.central} (range ${a.range} ${a.unit}). Published: ${s.central} (range ${s.range} ${s.unit}).`:" Not the published estimate.";r.textContent=`What-if at ${X(n)}:${i} The share card keeps ${X(_e)}. Method v${$.version}.`}function St(e){J=Math.abs(e-_e)<1e-9?$:Oe($,{[ce]:e},{pin:!0}),le(!1)}function ie(e,t=!1){let n=c("drop-status");n.textContent=e,n.classList.toggle("error",t),t&&n.scrollIntoView({block:"nearest"})}function It(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||void 0}catch{return}}async function Ct(e){ie("Reading files on this device\\u2026"),jt(await Tt(e,It()))}function jt(e){if(!e.ok)return ie(e.status,!0);let t=[];for(let o of e.texts)t.push(...Z.parse(o));let n=Be(qe(t));if(!n.length)return ie(Rt(e.what),!0);v.rows=n,v.source="files",v.window="all",C.days=e.pace??[],C.source="files",ie(`Read ${H(t.length)} responses from ${e.what}. Nothing was uploaded.`),le()}function Ot(e,t){let n=document.createElement("a");n.href=URL.createObjectURL(t),n.download=e,document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(n.href),1e3)}async function Ve(e,t,n="share-status",o="post"){let r=c(n);r.classList.remove("error");try{await navigator.clipboard.writeText(e),r.textContent=`Copied the ${t}.`}catch{let a=c(o).closest("details");a&&(a.open=!0);let s=document.createRange();s.selectNodeContents(c(o)),getSelection()?.removeAllRanges(),getSelection()?.addRange(s),r.textContent=`Couldn\'t reach the clipboard. The ${o==="post"?"post text":t} is selected so you can copy it.`}}function Mn(){let e=new Image;e.onload=()=>{let t=document.createElement("canvas");t.width=1200,t.height=627,t.getContext("2d").drawImage(e,0,0,1200,627),t.toBlob(n=>n&&Ot(`${S}-receipt.png`,n),"image/png")},e.src=c("card").src}function Tn(){for(let r of["7d","30d","all"])c(`w-${r}`).addEventListener("click",()=>{v.window=r,le()});if(c("save-png").addEventListener("click",Mn),c("save-svg").addEventListener("click",()=>Ot(`${S}-receipt.svg`,new Blob([Ee],{type:"image/svg+xml"}))),c("copy-line").addEventListener("click",()=>{Ve(Dt,"share line")}),c("copy-post").addEventListener("click",()=>{Ve(Qe,"LinkedIn post")}),R.mode==="playground"){let r=c("drop");r.hidden=!1,c("copy-prompt").addEventListener("click",()=>{Ve(c("export-prompt").textContent??"","prompt","drop-status","export-prompt")}),c("read-paste").addEventListener("click",()=>{jt(Pt(c("paste-log").value,It()))});for(let s of["pick-folder","pick-files"])c(s).addEventListener("change",i=>{let h=i.target.files;h&&Ct(h)});c("use-sample").addEventListener("click",()=>{v.rows=Lt,v.source="sample",v.window="30d",C.days=Nt,C.source="sample",ie(""),le()});let a=s=>i=>{i.preventDefault(),r.classList.toggle("over",s)};r.addEventListener("dragover",a(!0)),r.addEventListener("dragleave",a(!1)),r.addEventListener("drop",s=>{a(!1)(s),s.dataTransfer?.files&&Ct(s.dataTransfer.files)})}c("pace-more").addEventListener("toggle",()=>{c("pace-more").open&&ae.length&&Xe(ae)});let e=0,t=c("chart").getBoundingClientRect().width;window.addEventListener("resize",()=>{clearTimeout(e),e=window.setTimeout(()=>{let r=c("chart").getBoundingClientRect().width;et&&Math.round(r)!==Math.round(t)&&(Ht(et),ae.length&&Xe(ae)),t=r},150)});let n=c("whatif-cache");n.addEventListener("input",()=>St(Number(n.value))),c("whatif-reset").addEventListener("click",()=>{n.value=String(_e),St(_e),n.focus()}),c("repo-link").href=F,c("cli-cmd").textContent=`npx ${S}`,c("built-by").href=ge,R.mode==="playground"&&(Rn(),c("jump").hidden=!1);let o=R.generatedAt?` \\xB7 written ${R.generatedAt.slice(0,16).replace("T"," ")} UTC`:"";c("footer-version").textContent=`${S} v${Se} \\xB7 method v${$.version}${o}. Electricity only, not carbon or water.`,document.title=R.mode==="dashboard"?`${S} dashboard`:`${S} playground`}function Rn(){let e=c("demo-bar"),t=c("demo-toggle"),n=c("demo-panel");for(let r of["demo-home","demo-back"])c(r).href=ge;c("demo-code").href=F;let o=r=>{t.setAttribute("aria-expanded",String(r)),n.hidden=!r};t.addEventListener("click",()=>o(n.hidden)),e.addEventListener("keydown",r=>{r.key==="Escape"&&!n.hidden&&(o(!1),t.focus())}),e.hidden=!1}matchMedia("(min-width: 720px)").matches&&(c("pace-more").open=!0);Tn();xn();le();})();</script>\n</body>\n</html>\n';

// src/store.ts
import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
function dataDir() {
  return process.env[`${APP_NAME.toUpperCase()}_HOME`] ?? join(homedir(), `.${APP_NAME}`);
}
var historyPath = (dir = dataDir()) => join(dir, "history.jsonl");
var pacePath = (dir = dataDir()) => join(dir, "pace.jsonl");
var nudgePath = (dir = dataDir()) => join(dir, "nudge.json");
var NUDGE_MAX_BYTES = 4096;
async function readHistory(dir = dataDir()) {
  try {
    return parseHistory(await readFile(historyPath(dir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp`;
  await unlink(tmp).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await writeFile(tmp, text, { mode: 384, flag: "wx" });
  await rename(tmp, path);
}
async function writeHistory(rows, dir = dataDir()) {
  await writeAtomic(historyPath(dir), serializeHistory(rows));
}
async function readPaceHistory(dir = dataDir()) {
  try {
    return parsePaceHistory(await readFile(pacePath(dir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function writePaceHistory(days, method2, dir = dataDir()) {
  await writeAtomic(pacePath(dir), serializePaceHistory(days, method2));
}
async function readNudgeSettings(dir = dataDir()) {
  try {
    if ((await stat(nudgePath(dir))).size > NUDGE_MAX_BYTES) return { ...DEFAULT_NUDGE_SETTINGS };
    return parseNudgeSettings(await readFile(nudgePath(dir), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULT_NUDGE_SETTINGS };
    throw error;
  }
}
async function writeNudgeSettings(settings, dir = dataDir()) {
  await writeAtomic(nudgePath(dir), serializeNudgeSettings(settings));
}

// src/dashboard.ts
function opaqueProjectIds(rows) {
  const labels = /* @__PURE__ */ new Map();
  return rows.map((r) => {
    if (r.projectId === null) return r;
    let label = labels.get(r.projectId);
    if (!label) labels.set(r.projectId, label = String(labels.size + 1));
    return { ...r, projectId: label };
  });
}
async function writeDashboard(rows, dir = dataDir(), pace2, paceOff) {
  await mkdir2(dir, { recursive: true });
  const path = join2(dir, "dashboard.html");
  const payload = { mode: "dashboard", generatedAt: (/* @__PURE__ */ new Date()).toISOString(), rows: opaqueProjectIds(rows), ...pace2 ? { pace: pace2 } : paceOff ? { paceOff } : {} };
  const html = injectData(ccwatts_default, payload);
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
function percent(part, total2) {
  if (!(total2 > 0)) return "0%";
  const p = Math.round(part / total2 * 100);
  return p === 0 && part > 0 ? "<1%" : `${p}%`;
}
function shares(rows, total2, label, max = 4) {
  const shown = rows.slice(0, max).map((r) => `${clip(label(r.key))} ${percent(r.energy.central, total2)}`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${percent(rest, total2)}`);
  return shown.join("   ");
}
var LABEL_MAX = 40;
function clip(label, max = LABEL_MAX) {
  const chars = [...label];
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}\u2026`;
}
function styles(on = false) {
  const wrap2 = (open, close) => (s) => on && s ? `\x1B[${open}m${s}\x1B[${close}m` : s;
  return { bold: wrap2("1", "22"), dim: wrap2("2", "22"), yellow: wrap2("33", "39") };
}
function header(params, window) {
  return `${APP_NAME} v${APP_VERSION} \xB7 method v${params.version} \xB7 ${window.label}`;
}
function summary(e, params, window, sample = false, opts = {}) {
  if (e.responses === 0) return `${header(params, window)}

  No Claude Code usage found in this window. Try --since all.`;
  const { bold, dim } = styles(opts.color);
  const total2 = energy(e.total);
  const kwh = e.total.central / 1e3;
  const compare = everyday(kwh, params);
  const top = e.byProject[0];
  const lines = [
    header(params, window),
    "",
    `  Electricity   ${bold(total2.central)}   ${dim(`(range ${total2.range})`)}`,
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
  const gutter = o.gutter ?? "   ";
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const left = (i) => (o.align?.[i] ?? (i < alignLeft ? "left" : "right")) === "left";
  const line = (cells, styled) => indent + cells.map((c, i) => {
    const padded = left(i) ? c.padEnd(widths[i]) : c.padStart(widths[i]);
    return styled && o.dimCols?.includes(i) ? dim(padded) : padded;
  }).join(gutter).trimEnd();
  return [line(head, false), dim(indent + widths.map((w) => "-".repeat(w)).join(gutter)), ...rows.map((r) => line(r, true))].join("\n");
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
  const total2 = energy(e.total);
  const lines = [
    header(params, window),
    "",
    table(["week", unit, "range", "trend"], rows, 1, { align: ["left", "right", "right", "left"], dimCols: [2], color: opts.color }),
    "",
    `  Trend         ${sparkline(weeks.map((w) => w.central))}`,
    `  Total         ${bold(total2.central)}   ${dim(`(range ${total2.range})`)}`,
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
function paceShareLine(week) {
  return week.activeHours.high > 0 ? `Pace this week: ${paceActiveLead(week.activeHours)}.` : "Pace this week: no active hours yet.";
}
function wrap(text, indent = "  ", width = 80) {
  const glue = "\0";
  const kept = text.replace(/(\d+h) (\d+m)/g, `$1${glue}$2`).replace(/ – /g, `${glue}\u2013${glue}`);
  const lines = [];
  let line = "";
  for (const word of kept.split(" ")) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.map((l) => l.replaceAll(glue, " "));
}
var spanOf = (values, show) => {
  const lo = show(Math.min(...values));
  const hi = show(Math.max(...values));
  return lo === hi ? lo : `${lo} to ${hi}`;
};
function pace(view, params, opts = {}) {
  const { bold, dim } = styles(opts.color);
  if (!view.weeks.length) return "";
  const late = clockHour(params.pace.late_night.start_hour);
  const { focus, lead: Lead, rest, soFar, agents } = paceLead(view.weeks, params);
  const week = view.weeks[focus];
  const earlier = view.weeks.slice(focus + 1);
  const prose = wrap(`${Lead}, ${rest}`);
  prose[0] = prose[0].replace(Lead, bold(Lead));
  const partial = focus === 0 ? " (partial)" : "";
  const lines = [`${APP_NAME} v${APP_VERSION} \xB7 method v${params.version} \xB7 pace, week of ${monthDay(week.start)}${partial}`, "", ...prose];
  if (soFar) lines.push(...wrap(soFar));
  if (agents) lines.push(...wrap(agents));
  const usual = earlier.filter((w) => w.activeHours.central > 0);
  if (view.versus && usual.length >= 2) {
    const n = usual.length === earlier.length ? `${usual.length}` : `${usual.length} of ${earlier.length}`;
    const among = focus === 0 ? `your last ${n} weeks` : `the ${n} weeks before`;
    if (view.versus.longer) {
      const span = spanOf(usual.map((w) => w.activeHours.central), paceHours);
      lines.push(...wrap(`Active hours: about ${paceHours(week.activeHours.central)}, vs ${span} in ${among}.`));
    }
    if (view.versus.later) {
      const span = spanOf(usual.map((w) => w.lateNightHours * 60), hm);
      lines.push(...wrap(`Past ${late}: ${hm(week.lateNightHours * 60)}, vs ${span} in ${among}.`));
    }
  }
  const rows = view.weeks.map((w, i) => [
    i === 0 ? `${monthDay(w.start)} (partial)` : monthDay(w.start),
    paceHoursRange(w.activeHours),
    hm(w.lateNightHours * 60),
    hm(w.longestStretchMinutes),
    String(w.restDays),
    paceHoursRange(w.agentHours)
  ]);
  lines.push(
    "",
    table(["Week of", "Active (h)", `Past ${late}`, "Longest", "Days off", "Agent-only (h)"], rows, 1, { dimCols: [5], color: opts.color, gutter: "  " }),
    "",
    ...paceNotes(params).map((note) => dim(`  ${note}`))
  );
  if (view.savedTo) lines.push(...[...wrap(`Saved to ${view.savedTo} (daily minutes and whole hours only).`), "  Delete it any time."].map((l) => dim(l)));
  return lines.join("\n");
}
function paceJson(view, params, sample) {
  const g = params.pace.gap_minutes;
  const gapMinutes = { low: g.low, central: g.value, high: g.high };
  return JSON.stringify(
    {
      app: APP_NAME,
      version: APP_VERSION,
      method: {
        version: params.version,
        gapMinutes,
        breakMinutes: params.pace.break_minutes.value,
        lateNight: { startHour: params.pace.late_night.start_hour, endHour: params.pace.late_night.end_hour }
      },
      unit: "hours",
      sample,
      versusUsual: view.versus,
      weeks: view.weeks
    },
    null,
    2
  );
}
function paceCsv(days) {
  const head = [
    "date",
    "active_low_min",
    "active_central_min",
    "active_high_min",
    "agent_low_min",
    "agent_central_min",
    "agent_high_min",
    "late_night_min",
    "longest_stretch_min",
    "first_hour",
    "last_hour"
  ];
  const body = days.map((d) => [
    d.date,
    d.activeMinutes.low,
    d.activeMinutes.central,
    d.activeMinutes.high,
    d.agentMinutes.low,
    d.agentMinutes.central,
    d.agentMinutes.high,
    d.lateNightMinutes,
    d.longestStretchMinutes,
    d.firstHour ?? "",
    d.lastHour ?? ""
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\n");
}

// src/nudge.ts
var MOON = "\u{1F319}";
var SAMPLE_HOUR = 1;
var SAMPLE_MINUTE = 14;
function nudgeNow(env = process.env) {
  const forced = env.NODE_ENV === "test" ? env[`${APP_NAME.toUpperCase()}_NOW`] : void 0;
  const d = forced ? new Date(forced) : /* @__PURE__ */ new Date();
  return Number.isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
}
function moment(now) {
  const days = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
  return { localHour: now.getHours(), localMinute: now.getMinutes(), seed: days * 24 + now.getHours() };
}
async function statusNudge(now = nudgeNow()) {
  try {
    const s = await readNudgeSettings();
    if (!s.on) return null;
    const line = bedtimeNudge({ ...moment(now), after: s.after, until: s.until, persona: s.persona });
    return line ? `${MOON} ${line}` : null;
  } catch {
    return null;
  }
}
var hourLabel = (h) => clockTime(h, 0).replace(":00", "");
var PERSONA_IDS = () => [...PERSONAS.map((p) => p.id), "random"].join(", ");
var ID_WIDTH = Math.max(...PERSONAS.map((p) => p.id.length));
function checkPersona(id) {
  if (id === "random" || PERSONAS.some((p) => p.id === id)) return id;
  throw new Error(`Unknown persona "${id}". Pick one of: ${PERSONA_IDS()}.`);
}
function checkHour(flag, value) {
  const n = Number(value);
  if (!/^\d{1,2}$/.test(value) || n > 23) throw new Error(`${flag} takes an hour from 0 to 23 (24-hour clock), for example ${flag} 23.`);
  return n;
}
function sampleMoment(now, after = DEFAULT_NUDGE_SETTINGS.after, until = DEFAULT_NUDGE_SETTINGS.until) {
  const m = moment(now);
  return inBedtimeWindow(m.localHour, after, until) ? m : { ...m, localHour: SAMPLE_HOUR, localMinute: SAMPLE_MINUTE };
}
function example(now, s) {
  const at = sampleMoment(now, s.after, s.until);
  return [`For example, at ${clockTime(at.localHour, at.localMinute)}:`, "", `  ${MOON} ${personaLine({ ...at, persona: s.persona })}`];
}
function preview(now, only) {
  const at = sampleMoment(now);
  const list = only && only !== "random" ? PERSONAS.filter((p) => p.id === only) : PERSONAS;
  const rows = list.map((p, i) => `  ${MOON} ${p.id.padEnd(ID_WIDTH)}  ${personaLine({ ...at, persona: p.id, seed: at.seed * PERSONAS.length + i })}`);
  return [`How each persona sounds at ${clockTime(at.localHour, at.localMinute)}:`, "", ...rows].join("\n");
}
var describe = (s) => `${s.persona === "random" ? "a random persona each hour" : s.persona}, from ${hourLabel(s.after)} to ${hourLabel(s.until)}`;
async function runNudge(args) {
  const now = nudgeNow();
  const persona = args.persona === void 0 ? void 0 : checkPersona(args.persona);
  const after = args.after === void 0 ? void 0 : checkHour("--after", args.after);
  const until = args.until === void 0 ? void 0 : checkHour("--until", args.until);
  if (args.preview) return preview(now, persona);
  if (args.action === "on" || args.action === "off") {
    const current = await readNudgeSettings();
    const next = {
      on: args.action === "on",
      after: after ?? current.after,
      until: until ?? current.until,
      persona: persona ?? current.persona
    };
    if (next.after === next.until) throw new Error(`--after and --until can't be the same hour. Try: ${APP_NAME} nudge on --after 23 --until 5`);
    await writeNudgeSettings(next);
    if (!next.on) return `Bedtime nudge off. The status line is back to energy only.`;
    return [
      `Bedtime nudge on: ${describe(next)}.`,
      `It shows under the ${APP_NAME} status line: set it up with /${APP_NAME}:statusline in the plugin, or see "Status line" in the README.`,
      "",
      ...example(now, next),
      "",
      `Turn it off with: ${APP_NAME} nudge off`
    ].join("\n");
  }
  if (args.action !== void 0) throw new Error(`Unknown nudge action "${args.action}". Use: ${APP_NAME} nudge on, ${APP_NAME} nudge off or ${APP_NAME} nudge --preview.`);
  const s = await readNudgeSettings();
  if (s.on) return [`Bedtime nudge is on: ${describe(s)}. Turn it off with: ${APP_NAME} nudge off`, "", ...example(now, s), "", `See them all: ${APP_NAME} nudge --preview`].join("\n");
  return [`Bedtime nudge is off. Turn it on with: ${APP_NAME} nudge on --persona <id> (default: random)`, "", preview(now)].join("\n");
}

// src/usage.ts
import { stat as stat3 } from "fs/promises";
import { basename } from "path";

// src/logs.ts
import { readdir, readFile as readFile2, stat as stat2 } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
function defaultLogRoots() {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.split(",").map((dir) => join3(dir.trim(), "projects"));
  if (fromEnv?.length) return fromEnv;
  return [join3(homedir2(), ".claude", "projects"), join3(homedir2(), ".config", "claude", "projects")];
}
async function findJsonl(dir) {
  if (dir.endsWith(".jsonl") && (await stat2(dir).catch(() => null))?.isFile()) return [dir];
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
        const text = await readFile2(f, "utf8");
        return { records: claudeCodeAdapter.parse(text), activity: claudeCodeAdapter.activity?.(text) ?? [] };
      } catch (error) {
        unreadable.push(reason(error));
        return { records: [], activity: [] };
      }
    })
  );
  return {
    roots,
    files: files.length,
    records: dedupe(parsed.flatMap((p) => p.records)),
    activity: parsed.flatMap((p) => p.activity),
    unreadable
  };
}
function unreadableNote(reasons) {
  if (!reasons.length) return null;
  const n = reasons.length;
  return `${n} log file${n === 1 ? "" : "s"} couldn't be read (${[...new Set(reasons)].sort().join(", ")}).`;
}

// src/usage.ts
async function loadUsage(options) {
  const demo = Boolean(options.demo);
  if (options.path && !demo && !await stat3(options.path).catch(() => null)) {
    throw new Error(`"${basename(options.path)}" doesn't exist. Check the folder or file given to --path.`);
  }
  const logs = demo ? { roots: [], files: 0, records: [], activity: [], unreadable: [] } : await loadLogs(options.path ? [options.path] : defaultLogRoots());
  const sample = demo ? sampleRows() : [];
  const now = demo ? /* @__PURE__ */ new Date(`${sample.map((r) => r.date).sort().at(-1)}T23:59:59Z`) : /* @__PURE__ */ new Date();
  const { kept, future } = dropFuture(logs.records, now);
  logs.records = kept;
  const activity = dropFuture(logs.activity, now).kept;
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
  const { days: pace2, saved: paceSaved, store: paceStore } = await loadPace(activity, options, demo);
  return { rows, pace: pace2, paceSaved, paceStore, records: logs.records, roots: logs.roots, files: logs.files, now, sample: demo, notes };
}
async function loadPace(activity, options, demo) {
  if (demo) return { days: [], saved: false, store: "none" };
  const keep = !options.noHistory && !options.path;
  const result = await loadPaceDays(activity, options, keep);
  if (keep) return result;
  return { ...result, store: await stat3(pacePath()).catch(() => null) ? "skipped" : "none" };
}
async function loadPaceDays(activity, options, keep) {
  let stored = null;
  let readFailed = false;
  if (keep) {
    stored = await readPaceHistory().catch((error) => {
      const why = reason(error);
      console.error(`Couldn't read pace history (${why}). Using current logs only.`);
      readFailed = true;
      return null;
    });
  }
  const store = readFailed ? "unreadable" : stored ? "read" : "none";
  if (!options.pace && !stored) return { days: [], saved: false, store };
  const paceOptions = defaultPaceOptions(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const fresh = paceDays(activity, paceOptions);
  if (!keep || readFailed || options.pace === "count" && !stored) return { days: fresh, saved: false, store };
  const method2 = paceMethod(paceOptions);
  const days = mergePaceHistory(stored?.days ?? [], fresh, JSON.stringify(stored?.method) === JSON.stringify(method2));
  let saved = false;
  if (activity.length > 0) {
    saved = await writePaceHistory(days, method2).then(
      () => true,
      (error) => {
        const why = reason(error);
        console.error(`Couldn't save pace history (${why}). Continuing without it.`);
        return false;
      }
    );
  }
  return { days, saved, store };
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
  pace              Work rhythm: active hours, time past 10pm, days off (opt-in)
  receipt           Share line, LinkedIn post text and a 1200\xD7627 card (SVG)
  statusline        One line for the Claude Code status line (JSON on stdin)
  nudge             Bedtime nudge under the status line, in a persona (opt-in)
  mcp               MCP server on stdio, so Claude Code can ask about its energy
  help              Show this help

Options:
  --since <when>    7d, 12h, 4w, 2026-10-01 or all (default 30d; history: all)
  --by <dim>        Breakdown table: model, day, project or type
  --json            Machine-readable output, same numbers, in Wh
  --method          Parameters, sources and method version
  --export csv      With history or pace: daily rows as CSV on stdout
  --out <file>      With receipt: card file (default ./${APP_NAME}-receipt.svg)
  --share-pace      With receipt: add one line with this week's active hours
  --demo            Try it on synthetic sample data (no logs needed)
  --path <dir>      Estimate just this folder or .jsonl file (history untouched)
  --no-open         With dashboard: write the file but don't open it
  --no-history      Don't read or update ~/.${APP_NAME}/history.jsonl
  --persona <id>    With nudge on: coach, researcher, stoic, grandma, narrator,
                    pirate, haiku, sergeant or random (default random)
  --after <hour>    With nudge on: start hour, 24-hour clock (default 23 = 11pm)
  --until <hour>    With nudge on: end hour, 24-hour clock (default 5 = 5am)
  --preview         With nudge: show a line from each persona, change nothing
  -v, --version     Show the version
  -h, --help        Show this help

Logs elsewhere? Set CLAUDE_CONFIG_DIR, as Claude Code does, to keep history.

Pace is opt-in and local: running ${APP_NAME} pace starts ~/.${APP_NAME}/pace.jsonl
(daily minutes and whole hours only). Delete it any time. receipt never shares
pace unless you add --share-pace.

The bedtime nudge is off until you run ${APP_NAME} nudge on. Late at night it adds
a short line under the status line suggesting bed. ${APP_NAME} nudge off stops it.`;
var MCP_HELP = `Usage: ${APP_NAME} mcp [--path <dir>] [--demo] [--no-history]

Runs an MCP server on stdio, so Claude Code can ask about its own energy use.
Claude Code starts it for you; you don't run it by hand. To add it:

  ${MCP_ADD}

Tools: energy_summary, energy_by_project, energy_weekly, methodology.
Reads local logs only. No port, no network.`;
var PLAYGROUND = PLAYGROUND_URL;
var NUDGE_FLAGS = ["persona", "after", "until", "preview", "help"];
var DIMS = ["model", "day", "project", "type"];
var COMMANDS = ["summary", "history", "pace", "receipt", "dashboard", "statusline", "nudge", "mcp", "help"];
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
      "share-pace": { type: "boolean" },
      persona: { type: "string" },
      after: { type: "string" },
      until: { type: "string" },
      preview: { type: "boolean" },
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
  if (command === "statusline") {
    const [energy2, moon] = await Promise.all([sessionLine(values.path), statusNudge()]);
    return void console.log(moon ? `${energy2}
${moon}` : energy2);
  }
  const nudgeOnly = [values.persona, values.after, values.until, values.preview].some((v) => v !== void 0);
  if (nudgeOnly && command !== "nudge") throw new Error(`--persona, --after, --until and --preview work with ${APP_NAME} nudge. Try: ${APP_NAME} nudge --preview`);
  if (command === "nudge") {
    const other = Object.keys(values).filter((k) => values[k] !== void 0 && !NUDGE_FLAGS.includes(k));
    if (other.length > 0) throw new Error(`${APP_NAME} nudge takes only --persona, --after, --until and --preview, not --${other[0]}. Try: ${APP_NAME} nudge --preview`);
    if (positionals.length > 2) throw new Error(`${APP_NAME} nudge takes one action: on or off.`);
    return void console.log(await runNudge({ action: positionals[1], persona: values.persona, after: values.after, until: values.until, preview: values.preview }));
  }
  if (command === "mcp") return runMcp({ path: values.path, demo: values.demo, noHistory: values["no-history"] });
  const by = values.by;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);
  if (values.export && values.export !== "csv") throw new Error(`--export supports csv only`);
  if (values.export && command !== "history" && command !== "pace") throw new Error(`--export works with ${APP_NAME} history. Try: ${APP_NAME} history --export csv`);
  if (values["share-pace"] && command !== "receipt") throw new Error(`--share-pace works with ${APP_NAME} receipt.`);
  const demo = Boolean(values.demo);
  if (demo && (command === "receipt" || command === "dashboard")) {
    console.error(
      `${command} is for your own usage, so it doesn't run on sample data. The playground shows the sample ${command === "receipt" ? "card" : "dashboard"}: ${PLAYGROUND}`
    );
    process.exitCode = 1;
    return;
  }
  if (command === "pace" && demo) {
    const today = localToday();
    return void printPace(samplePaceDays(today), today, { json: values.json, csv: Boolean(values.export), sample: true, savedTo: null });
  }
  const paceMode = command === "pace" ? true : values["share-pace"] ? "count" : false;
  const usage = await loadUsage({ path: values.path, demo, noHistory: values["no-history"], pace: paceMode });
  const { rows } = usage;
  const window = parseSince(values.since ?? (command === "history" || demo ? "all" : "30d"), usage.now);
  if (rows.length === 0) {
    const oneFile = usage.files === 1 && values.path !== void 0 && Boolean((await stat4(values.path).catch(() => null))?.isFile());
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
    console.log(`No Claude Code logs yet. Try ${APP_NAME}${command === "pace" ? " pace" : ""} --demo, or point at a folder with --path <dir>.`);
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
  if (command === "pace") {
    noteToStderr();
    const savedTo = usage.paceSaved ? paceFileLabel() : null;
    return void printPace(usage.pace, localToday(), { json: values.json, csv: Boolean(values.export), sample: false, savedTo });
  }
  if (command === "dashboard") {
    noteToStderr();
    const paceOn = usage.pace.length > 0 || usage.paceStore === "read";
    const paceOff = !paceOn && (usage.paceStore === "skipped" || usage.paceStore === "unreadable") ? usage.paceStore : void 0;
    const path = await writeDashboard(rows, void 0, paceOn ? usage.pace : void 0, paceOff);
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
    const paceLine = values["share-pace"] ? paceShareLine(paceWeeks(usage.pace, localToday(), 1)[0]) : null;
    let post = linkedInPost(input);
    if (paceLine) {
      const cut = post.indexOf("\n\n");
      post = cut < 0 ? `${post}

${paceLine}` : `${post.slice(0, cut)}

${paceLine}${post.slice(cut)}`;
    }
    console.log(shareLine(input));
    if (paceLine) console.log(paceLine);
    console.log(`
Card written to ${out} (1200\xD7627, LinkedIn size). Open ${APP_NAME} dashboard to save it as PNG.`);
    console.log(`
Ready-to-paste post:

${post}`);
    return;
  }
  if (values.json) return void console.log(json(est, params, window, demo));
  if (label) process.stdout.write(label);
  if (by) noteToStderr();
  if (by) console.log(breakdown(est, params, window, by, opts));
  else console.log(summary(est, params, window, demo, opts));
}
function localToday(now = /* @__PURE__ */ new Date()) {
  const p = {};
  for (const part of new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}
function paceFileLabel() {
  return process.env[`${APP_NAME.toUpperCase()}_HOME`] ? `$${APP_NAME.toUpperCase()}_HOME/pace.jsonl` : `~/.${APP_NAME}/pace.jsonl`;
}
function printPace(days, today, o) {
  if (o.csv) return void console.log(paceCsv(days));
  const weeks = paceWeeks(days, today, 4);
  const f = paceFocus(weeks);
  const view = { weeks, versus: paceVersusUsual(weeks[f], weeks.slice(f + 1)), today, savedTo: o.savedTo };
  if (o.json) return void console.log(paceJson(view, defaultParams, o.sample));
  const color = useColor();
  if (o.sample) process.stdout.write(`${styles(color).yellow("Sample data (synthetic), not your usage.")}

`);
  console.log(pace(view, defaultParams, { color }));
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
