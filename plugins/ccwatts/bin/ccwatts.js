#!/usr/bin/env node

// src/index.ts
import { readFile as readFile3, stat as stat4, writeFile as writeFile3 } from "fs/promises";
import { basename as basename2, resolve } from "path";
import { parseArgs } from "util";

// ../core/src/meta.ts
var APP_NAME = "ccwatts";
var APP_VERSION = "0.2.0";
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
  const isRoot = trimmed === "" || /^[A-Za-z]:$/.test(trimmed);
  const name = isRoot ? "(root)" : safeName(base) || "(unnamed)";
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
  version: "0.1.2",
  as_of: "2026-11-18",
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
      note: "Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models. Fable and Mythos models (a class above Opus in Anthropic's lineup, no public size or energy figures) are priced at this tier, the largest ccwatts has; treat it as a floor, not a measurement."
    },
    "output_wh_per_1k.sonnet": {
      value: 0.6,
      low: 0.25,
      high: 1.5,
      unit: "Wh per 1k output tokens",
      label: "MODELED",
      source: "https://arxiv.org/abs/2508.15734",
      as_of: "2026-11-10",
      note: "Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google's measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k. Epoch AI's bottom-up estimate (https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) of about 0.3 Wh for a 500-output-token GPT-4o query supports the central value. Jegham et al. (How Hungry is AI?, https://arxiv.org/abs/2505.09598) put Claude 3.7 Sonnet at 0.95 Wh for 100 input + 300 output tokens, about 3.1 Wh per 1k output with input near 0.03x output. That is above this high bound, but it pairs with a much lower input ratio, so agentic totals land close to ours (see METHODOLOGY.md, How ccwatts compares)."
    },
    "output_wh_per_1k.haiku": {
      value: 0.25,
      low: 0.08,
      high: 0.6,
      unit: "Wh per 1k output tokens",
      label: "GUESS",
      source: "https://www.anthropic.com/pricing",
      as_of: "2026-11-10",
      note: "Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute. Jegham et al. (https://arxiv.org/abs/2505.09598) put Claude 3.5 Haiku at about the same energy per prompt as Sonnet, one more reason this stays a GUESS."
    },
    input_vs_output: {
      value: 0.3,
      low: 0.15,
      high: 0.5,
      unit: "ratio",
      label: "MODELED",
      source: "https://www.anthropic.com/pricing",
      as_of: "2026-11-10",
      note: "Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3. Epoch AI's estimate that 10k input tokens add about 2 Wh to a GPT-4o query (https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) gives about 0.35x. A fit to Jegham et al.'s three Claude 3.7 Sonnet prompt sizes (https://arxiv.org/abs/2505.09598) gives about 0.03x, below this low bound; it comes paired with a higher output value (see output_wh_per_1k.sonnet)."
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
      as_of: "2026-11-10",
      note: "The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather's central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input. Six other open-source Claude Code estimators checked on 2026-11-10 use 0.08-0.1, inside these bounds."
    }
  },
  tiers: {
    opus: [
      "opus",
      "fable",
      "mythos"
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
  },
  token_mix: {
    typical_claude_code: {
      label: "MEASURED",
      source: "Counts-only copies of 6 of the maintainer's Claude Code sessions, Oct-Nov 2026; light and heavy are the lowest and highest observed shares.",
      as_of: "2026-11-19",
      note: "Shares of a token total, for estimating from a total when the split is unknown. Observed: cache read 89.0-96.9%, cache write 2.6-10.6%, output 0.21-0.50%, fresh input about 0%. Central is the estimate; low uses the light mix, high the heavy mix.",
      central: { input: 1e-3, cacheWrite: 0.04, cacheRead: 0.955, output: 4e-3 },
      light: { input: 0, cacheWrite: 0.026, cacheRead: 0.972, output: 2e-3 },
      heavy: { input: 1e-3, cacheWrite: 0.106, cacheRead: 0.888, output: 5e-3 }
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

// ../core/src/manual.ts
var MAX_TOKEN_COUNT = 1e13;
var MIX_GUESSED = "Wide range: the mix of token types is guessed.";
var SUFFIX = { "": 1, k: 1e3, m: 1e6, b: 1e9 };
function parseTokenCount(text) {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*([kmb]?)(?:\s*tokens?)?$/i.exec(text.trim());
  if (!m || m[1] === void 0 && m[2] === void 0) return null;
  const n = Number(`${(m[1] ?? "0").replace(/,/g, "")}${m[2] ?? ""}`) * SUFFIX[m[3].toLowerCase()];
  const count2 = Math.round(n);
  if (!Number.isFinite(count2) || count2 <= 0 || count2 > MAX_TOKEN_COUNT) return null;
  return count2;
}
function split(total2, shares2) {
  const exact = TOKEN_TYPES.map((k) => total2 * shares2[k]);
  const out = Object.fromEntries(TOKEN_TYPES.map((k, i) => [k, Math.floor(exact[i])]));
  let left = total2 - TOKEN_TYPES.reduce((s, k) => s + out[k], 0);
  const order = TOKEN_TYPES.map((k, i) => ({ k, r: exact[i] - out[k] })).sort((a, b) => b.r - a.r);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i].k]++;
  return out;
}
var whole = (n) => n !== void 0 && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
function estimateFromTotal(input, params) {
  const { tier, known } = tierFor(input.model, params);
  const warnings = known ? [] : [`Unknown model "${input.model}": estimated as ${String(params.tiers.fallback)}.`];
  const base = { methodVersion: params.version, model: input.model, tier, knownModel: known, warnings };
  const total2 = whole(input.tokens);
  if (input.mix && TOKEN_TYPES.some((k) => input.mix[k] !== void 0)) {
    const tokens2 = Object.fromEntries(TOKEN_TYPES.map((k) => [k, whole(input.mix[k])]));
    const given = TOKEN_TYPES.reduce((s, k) => s + tokens2[k], 0);
    if (total2 > given) tokens2.cacheRead += total2 - given;
    return { ...base, tokens: tokens2, total: energyForCounts(tokens2, tier, params), mixAssumed: false };
  }
  const mix2 = params.token_mix.typical_claude_code;
  const tokens = split(total2, mix2.central);
  const range3 = {
    low: energyForCounts(split(total2, mix2.light), tier, params).low,
    central: energyForCounts(tokens, tier, params).central,
    high: energyForCounts(split(total2, mix2.heavy), tier, params).high
  };
  return { ...base, tokens, total: range3, mixAssumed: true };
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
var ccwatts_default = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-8GD/pzZzFEoASHqP0eYGCODpKimJMUwKjvFTj6OAR/A=\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; base-uri \'none\'; form-action \'none\'">\n<meta name="referrer" content="no-referrer">\n<title>ccwatts</title>\n<meta name="description" content="Estimate the electricity your Claude Code usage consumed, as a sourced range. Runs entirely in your browser.">\n<!-- Link preview for LinkedIn and others. The crawler fetches the image; this page never does. -->\n<meta property="og:type" content="website">\n<meta property="og:title" content="How much electricity does your Claude Code use?">\n<meta property="og:description" content="A sourced kWh range from your own logs. Runs in your browser, and your logs never leave it.">\n<meta property="og:url" content="https://chaseholroyd.com/ccwatts/">\n<meta property="og:image" content="https://chaseholroyd.com/ccwatts/og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="ccwatts: how much electricity does your Claude Code use?">\n<meta name="twitter:card" content="summary_large_image">\n<style>\n/* Studio design system (hearth docs/design/STUDIO-CORE.md, tokens.json, Chase Nov 21): Paper theme,\n   Atkinson Hyperlegible Next, type 17/22 body, 22/28 title, 28/34 display, 34 large title; space\n   4/8/12/16/24/32; corners 4/12/pill; 48px tap targets. The accent marks only what you can tap. */\n@font-face{font-family:"Atkinson Hyperlegible Next";src:url(data:font/woff2;base64,d09GMgABAAAAAICIABUAAAABL0QAAIAPAAIAQgAAAAAAAAAAAAAAAAAAAAAAAAAAGoQ3G4GnQhyHID9IVkFSh2E/TVZBUjsGYD9TVEFUgRwnJgCEfC9cEQgK+XTgQDCCikABNgIkA4dgC4NyAAQgBYZ6ByAMB1sxH1EiG7LBtdRtCHC6un5tzpYLuPO7bVBI1sKNnM0OxG6HEhKktxn/f0ZSOcTU9yQFs/EHSmZWJRiaodA6DNchOBCNNtSISVmS0nb6nl5tJSP9eNEcCRVusGgQL29UhZmCt+4KKVtpaYTHqxXEeE4Qg9omtnDKOdAYd/CAQGL/ToJvYWE9NEGwxEdXZWRwxqfYy+0Cfcu/d4ofih/OyBps+KIed/hPKE7tGk2IxVkJsjJPvhJxxAEJlSPDnIvAuIWPWp6p13/CTd+/IwkE0YqnVKgr9c2ZmUr/593su4EgGiSIhqDBgkuBQgVaSuvj8syh7YrJ5579NrNxY9qZQhiiOWsqmlIlQkxsNyYbQhRCQtBiVlGHE87qL62fVKk6NXrmbc/0ClerVzk6erk+sUEswGsQC5JgtvWVN8Q0b/siYntie2JBLOD9k836fEXQKBwN7izeHhBnzpw6dhL9luYgd5YdIHt5CISNVUUU7ff/Vs8eeKR+yCJJBr4h1hGGQAFJVBEKAGX2/+b69w5gZoKbTRbeEj3+RPmtVD1VlXOT/aqkvlJFVnWVCMJVdkhnvT8GkUGyeAQjIgtsWca1FwJAXZPs86VsUnGbVB/xaA+X6SinNiPZhRmryLiQSCEnJfz12PrKB68AcpEMYfvy8zrT90WmQwgy7Gk77CcH1g4jrwEkGWVm6SxHBrEFcwu1kJfJy8vkZcT0aXCIHWI/sfl0Wj9OeIHgJQdETfe7Ij5f1/4KaQEDZtkWD6BGQJYR/r8/aI93/pMMg517zge5AgFAgIEH3CRhvg3wjyn4522rer8Ea6DHVkWD9KK4YPbC8IJoI/Wb3m2DgrKvAkGt6SX5An5TwhAWAI09ZTf3E6MqZI2uLesQF/DKQ+sMuS4vv6CRr0MCGgD4/79WZvvODdFLBV1aTTqEloQioeIiXKWqc6rf3PygqqkQdbhmEnYES6zW7biscAHA41coFH7drl0hFQordv51pqv+3Smxj50UEva9V4do2FpeacZl+v7fqr4ku5Z0l1amVmcHZIekoJywHdC5l/euQKwS6yiAvLXdujZTXicaFho7TN06z5kKPIx7739qSa3d1ZX0zkJoKQWF5wWwvzMnj2xJW5ucUjqS5n8VS5avlUZAKAyAgeCn+4K8LM/oCgz8/zunXXrzB6/d8ZN1AiYlUTL27ATg36dpeX0f/b8Eht0Cex0+Hb/zoyMc6j6BdMyXi++faHKJDlwDUCh0T4I43FqwpZr63ZLKIDeTPbG5mc4ch/uGeHN43Zotf4obIDq1pE0c++Y5ztUhhOOeXD6cDB+fOv/nzoog4zC2FhahgGUcqurV//Tf55+1fdxHSpszdPwc2hzGY8QnIqInshiiIdJGxFdizPi2mbPt+7vn/60LsnMudM4PgguDYBAEwSAYBIPBIAi+xbLJ7EIQb7LimCA5tX18+3l0GJua+9wjPVYhNitxUSz7SiCcBX9sBhYR0ZEbRB4s2qLVUm/tTLdrqmsJ4An1GJD9xuDitjfkR1/wRTHkZxwEescB5AwVWUUQHscoahYUD0CUMXx/lclkgxzOMMCA9tnHmRB3WH3pL7AgCwGEUIMHNvqRQNSrzRQUKKEQ/7eqQkg2dgQfMCseTSQwRHUhAgICmMNYlr1sGayFaGxgnXxO1Y+IMh/GIIQrxKDeUSGCZLlfntzunc6GZwd2cVm6uCReXoFXZStn/asr7PDtxtU90U1wuqDVBf62ZPUiqZfZHULNPG5bohXGrbNuatqZbS9LDxnSaQ53Y9lNlCu5Gwl3gXti7WLDI/IRIZ8Tn1NfsIBJqnRCKGQ4XIE1H1FIuHOZ83lj8tYWK1pUqqh14WOR9LBXw/VTa/1KrK9ouSHlhpcbWZaibMPoim2sho01Gy+GzSUZr8Xkrtua99u3zAMM2jBA3NWOuzsxDDAMdVWUpTsrUlqzanO9XlurZ6spyJoKuhCFG9ibj/dnZ/7Mr8kWrx3z4rDdHvy2z0evmplMiYIIQBYhjX3AQf4oKLy4c1U9KLyiUUcTKIQCcI1RLr+wbcqJMNp7CWviQdvfWI3T6V7fIiK4+Tq9/K2x3YISKpUh7zqEnhuCBcknYFoYIqJYVMyQxgE3Hk/GZPcLcB5uA5DVQqpoCajtXrlWTKXByBQR8/uJLZmWH1hEVaCwMqs8MSYuKWWa21VnHq58y3FrUVUQlxMLj+sIhhjdU2rV1vcA5t1hx40GI+RUUaBI6cXVEo5zAQ2bo/Q4+32K8wG0l2TGnovsefO4kDvYM/kwvvcAjM24Zi8mcfZ/zP6X19EOwxzjsVfhMfniPhxrP659qEvbBI7sPjz24LY/BI6vxFj7NW9ISCkb99iRMX6UBrlNNdn/y7ZjL+WWwNeHsxs3IvKxXVs2ruZTuWTceSi6B6jRjfqDCQoA1BUSMMV0pfYaBf8Zzma/rW3xEx6EHrWGXsPYb7E56m3ftRh9g1c272ejViZWIgshHtMK1YlqBcYe8xNmg3M4N1GNyxJgX/kacJS/8B9gLCTdTdNLhC83us+V/bQAY+9glOAzBUKnGUrO1HAhVYuINfrN2J6gEMiOFnyM+QMcsIevPd9j1hfvCJyAIVajqo3kv7pVdnE5veOjt3AwRYZA/NBm2jcLVhoRQh8/qI/i92rBIE++hdVnYoTXkOFX5Lu9x1/8iWfJW8au63/+iN8t4lcO1kZ5OEMPUmGCRxGSOvpDUyB96HNW66W5rs9zTH+2nk7zr6MDbTT1fYacaKJacpbLByllGDfssg7mDw4Cf6sA7ByHmVT79Mo11ae9fNyM62yjo5CoL4q62T6dIyBMJt5RK+U2h1sJJlxxzqHMxrmAq/6CJT8Y14ndwcJg5ru553ECEt8dNTbh+RiEr8U4MVEE+Mr1NQKHgJoTSQBk5e7iHc2yTt1rjDrLf/0/P9n8YPSyTMpTcnjPEnqLtTdB8fNCRAgt3Tu+jVzKUReR32I/V6X1dvWTheDipDFFX4O54c24TcUM/y5CQWfB+Pie5Xq9XgMClr5m7g1eT/Ka7omHOLfPOh4uPuEndeXDvEZ9zif0tsI8x7+InTB1tfMdEHdTW6D9iJ24jM9Yxpv895PRokVajOYA/K0C7uU3SXg5414RLvZmfuatPoP5AB7aZxsxc54CV1+LhPg0egfzVTWqz4PgeQMG4R6/yUk3VSfN32zAUVbl5LyTj4t93+g07vM++WaEz3sxCrQ1nq9TO0rJhm+mfOYO/8T5q2/uYP6LFsu6EnfkMiaR1G1ywv7cKD9zB3NMEnj+UJhssiCblgwLSdocYAUpjzGUBEA7P5lYqedaYT+xmDQ0kftUhvlEL9VA6iX/wP2wvzXs7Ztpo4g0YYOolouQRY04bgMkMLIlQCM7WVLaa70n3TSUvwm60wiWqrLmjcND0N6vs3oTdqNq6HYv617857qkV4TV09ex3FzyFo/eRwqqyLbzKRdQ2Owp/G7uWkSVkVnSba3kIfRLxsnCDD3A2XGZjXpWXBXE0tJHVsCx7YIdNw6Fbog1SF9dXgEUDuTrGz5lN/964jk4GqvbNUII6DT/KeSYcTByBh1XHdXjhh/6mNh215xhCaze0lAduysoKHow5YNMV7DxjpqQAy0S/Awoag3BtaUiVdvZHKYLNWV40G8NAjVbC0ap109dxOzKS3mVHQOhrDzgO847BDiidLw2B1tKdwBpayuZExRhO1eG5RNf4BMneqjQGOMPZwH+c1WSd6WOQF3x0x8uFkSt34r4Z81+jiWp8KTVDjmyw6wO1uSRKLloTlGV5F9lx4iOlLLusakR/L4SrNhV96AfTdoUceMKnN78ity8E3hfh/kgxgCOtE81OafqOov2MjPadv58SNggMSu1b3SMofxNAXQwKHp3sCkEKPKfFTvu3hskTSrKDLXtx8FtOWQR7K0zhZ0QvDFdmBUY1rsIsBzCq9zCEXs1wm2ZzOGPHig+E6DkPrEiHUhcE3AxGWhBEC3xY/3FbPnKyzRt1beZok3+LSJIjxA8Z+Qtnyl1QSDrCd/gLS+0Dgd+Lje5j6UeiuruQWkTfKfcnDH32QHfBxqpQo6OUx70I3J5iv/3yVAuTYjXIDdyx5iUGvA8loPGce0oj6ID/PaXHH9LaGxDv9MFcdEaArQUKJyFcX1wWm3mhvip5Tm1Ld8sKU6921mQ4KNLwgYDvjjnAmFbmrI6OkNPTvCro1/Ad1APlwr5wxaiBneWPZDIIULCABsVdXikqDjxBGfC+4jBgmjPrPiizgMLUCPbZmpPgO7A7gzojwm9L+MXwS6zBY6e8OfTOhlixLLnr9hpSnaqUS9okOh3Azgdm7FLi+xT3+0gs5U+DtT5icKff/1XHD7uL1cn566PzH+aN8mH0/gRAViZWw3lWUM9ZZNm3b1dojIWB2E2nz1FN0JdpI1GwpiP/OpD8zQ+RMSPmxWNAsbw14c5LKqboC4hkHYSNDblSShTw2+X2/Kl3v7aBYWoX3EHWxuYKr95ilfuCF4LA86FvUKPYSIFT7jPG3aHhH1ro57Wu67FH8WIKX9SSgZKAPfFlWedHA9pOGkRTLSxIXJrBQbeJjdHwhSB117Ukbt/RRasWLM1K6sw9YlaczDo3s3I7s7DJ2xS3eJH7rwWF66PV4OFgMdWmCj/Ujc9t6SGskgoZ1krFYklXSTCDzkeN/MkdxV0ZHcDwIWOboPfb/u6Ej8Q6A//Z5je5bfEIFaPD4Ss4s3/VVrTh3W3fgJ7v30Myt4IXpgTr9vq7Xz1pc2X4xtBzxOO98KW7zmmN3H8BPefk4UKdqJussGmg/gVhBU92j/QrQRzk/EkzvhSttgdx/0NbgHhP1eOJ3Yrr7mqXH+1G0C+SSm3JdyziYgES4/XN3/h/mnLIzVRHvwp/zU+7hZ/ZHCEJd7Ryn2td5wZdOF8dGo5ctfKTBuyhK+vzvH4zwN8tJ4X6fUHku+3jxA/lmL5X0+8jL6GGHXm6k1r6Dcl4JdBEjVqhspXrnMLwMMVZf6tYAcYXwY/6fUV1HM9Q+NNFVBkiHGk3AjeMajx/I0Ktx3TiyuMMcF2rDszFauqAlQeF2IXz5P7JE3nN+tejeZaqL3FRuhilZu8uzWm6mHL5P1ts8IAuyefYL0NJtqcT0bSdQt/LFS5cCKgJ584ggJAA/rmAMrNKhfJd6Q3MRsEtdEkYkjndcOrqgiMrUAy9OtTqdNJedR2OxgJyeyCVLU7ZTCRS9LiA2KUa+T5XlMhbgKsLkNriows4nY7hRnQuSAFEFhXREbhQiGysbtTpw8JAGQDKAAl2b3rTj5QjArBxk6GZO/53FLuqz1hTqxOvgvoWKjvDiXhsPvXWXHY+RvRxPFwGI3DzAusw7iRk7Z2b80RsuwHuBMhQfcMevT0MQJRBASXjFAU14vmFpbkpWXTTSW6a7CPObN3uwVZT903vQcFkArc7wwYGgPKmdjK3wOVn4AFiCgIiVmJXKXBhsxRiYZ0Z2Xmq7EEJRoYTm8JoIb+9JSNZQVWZCSz2YIprM2aSI8ALhVQvSBWwBhxDtahTCdbMo51FSaDemYwVjEStChVTLNcRIGglm7U0cqqlNiK7izJKPBAVJRIaIImYhirMBMeEaOFmwFCYPJYFvYAJfIRk1AmkO7wKhhxJ+SImCSD1UARgSwNKSGhnRjIUoPBA4iSwVCpWUYrjzBYRUAjY2CEBfILmAPTJAsrkZURYIHLkKcEzcpF3T4Sd7KcBDDjJhk2iGwRW/0lFgLa09Ym00twaXLxvTV4eP7gOsmXvbYZhvfx/Mca+MqZy2waJRZtsbOmyfmyJv15Xaefea3z41Qz/aBKAYt4YVq1Z+7lM4RVPNkpHDYoeKUPeTeEk2IyPz9Om9ZzhpvtJ//jGjzHSko/hvBBJ1lXTF9/O2SJ4CvEwmpR3gytMbb3nnS5MxiEe2LhQVmPduW2WSZyMOGaGZIpCnTVsCohKB0FsGduCuZnbXsDPeUpXO1edtQ3VB2iGPsNGuxdGWBNP4vl0wcD84qYbVszy2PG5QejhOg6fRZgyKSBoo7L1hCrixlaJtBjnRds7dc4vzhZX5bky1LXzE4JyVanMGL/H6fOIg5vmWeQwYYYYazxJphoksmmmm6m2eaYa575FlhokcWWWGqZdTbb5Z469RpkNWrSrEWUv2zwOMqaf4Emjrm7D+RCNjHX4lNhZh83ZqYxc00yz9Tmm2SBqS00lUUmWGwqSyTo5GKMxXQ2m9Yus/ivFfu/FTlnhc6b5rGpnli+S0Yum+K566IAqxgZkpPhIisd2qimBzU5Mw1m9gnjZolbTmQWRUoUJelPgdru8u6f+0GcQl7if1m6KSxmEVUqLGA+5d0artR4hyHSi9HcADRIUgE8Iq4Wa7AJs1iPQUyjng1Yn4VsyniqEXAjAsgWxhdrMU+NX8bTJgtfNQZv39McVJze3xYVK+8fGXn6cFtq0FF+uH3pBNtOOyHiSxf9bBEljEiK0uztLi+t4uYu9OQd5XPPbegA5g/cfhg4/9svJwD/Fc35BhARMPFcmavbKptA5TVNnY1g6vWdLe2g5QZx6CooieoysNSQkVOkTB3VP4SekeLjLmqKd7gxpi2rsjQPmX9ZK1EthjS9FpNG51VEryEvkaQ/8govdArsstsee91TOwB/3wgvCB9WGTPiyi13r/H3t2rTrkNu4Drcm4RCGdjoWbCM6l6W+ealqO9eifrhtQiVkUZkhif0IewnFY3cG8rQis9wR526wADVUH/IlwFB7ldtEA1ks448MNdQMl+kVXgI9SDtnL1yyqbNq4yv5a6Mj0Vt8AicXs+4omRIMedGBl9w4z2yXxSvIRK+7vUI/P5vkExae/CMkb7Bohe0YMqszbnxl+32GN3ZQKW3mfWUXureC/YYv6Y3FHd5YS9I9CXP754W0db6UegKM5B+BZkJqxL6aWjjT3x0+bxr3nv8l2l/vvv/4fKT0Xx/qvZi/dxLCtNVoL7Gk13nq6+bvNczLTdKG2+GMrfsnjslVXcjuXtW/4Ng+QCZPWD0DPhTA8mpD33Jh/7UI3fJY0fkCYv7RAs9MTqf2INPbYHBKTlKXr4zffntt559xz5nRK8+X7z65hsfseLr3fL125PXH61ef/Wtj4PszW7y9nS+t528uYj2HuZ7H2/ufbK199mXP9369qdb3/n0q/IyNN/dT9+9O3v3/uLdR6t3n2y9vxu+/92Tq7r78e7849vVx3enn07E529Vn28H+5f0/Vv+/l1v/2FxcMM5uJccPEwPeOXuoK+Uo1eHJ7PDi+TV0eH95Gjq+yvo6G7o/h9HR/ei47PS8TuTk9LcLdOT29yT272TO4KTu6OTh4and0WnDwzODrOzm92zW53zgi8vCOc3ovObjAtAq+vVi/uzyyvw6opyfZjfzHS1SKrD/OYCf7vM7g9s8Ca9zQa3HkAiAACpHcqE2sOs8ThvX5BTp96ZN1YFEGIYjjDASAtfg7FWvQ7tzP8Ahbb1NXGlmhd0DJqeyYlXuIgRUNa6zBotaHaf1VBn9qGcQjRfq/IWOtG83bmrVTyyrZW8sotXqqjGp7NWLm5V9ey+J7fyCHCwstNzOMCMPZ4XLVWtwXE1Qs0WhdTW1AQgFmWMzM8rKL+uIUPgj8mfM02bJBt0YxdwSQAJqkrmNTMUgY6aTWTpqxjvMlS8ORE8WXt1ajTHZCIJXnMqvZC9Gei4/jyDdTNfOWNw9tSwcRL/3IhgHNmaylRokgGJyYnrtnDzVgIz8CSqqh8ygAcwvtd3bWsHAOh2VaUolZJOAPdAfX4Z1V/mJ1W5ZR0B2KNVE0BZ0ZXpLNoMBf+tgeAYayT/Q497glO6b9qMD/z/CuDf0BzXQiPpDzZXSrDWY10O2OjGQDDWzRfXdgwBwG8W9MAho0FMjChJFeElnevKNgQnFVtR1J05gIXTRGDvSm0Y6Kt4+Mhqnj9JFzNXFIHWaQAEErZJbTSyXvUeN4aJ/FUF5mPj4P0kHq4DGCebvERkaLX8taWwQLkLSHnTPlsV03WK6zy7ze4qAur6irfir9iVUCVOyVAKlbWBdrvF7mYvZW9WnAAogtK+aL3tiU9EwdjrKZ6Kr6LMns6mK9Yl/hXlJv/XPY7m/5/r9rA/8wIPz3w482Grh+seah6Mvr/y/pL7fZgnpgBU9sh+/4GexG+mBzN6z0nxq6V7AH0tstQ4W53wvGWmmmasXQaaaIA1BhnsgH32G245oiHTMbDCqagZmJgRLKw8fPzoKa9kVPqvk/ZJE8xy3N2uG2UMzMktICgkLC4lrVSZcjXqTFWvUZN2HTp1mW6L9WY45jKLbbbdFjtssMo1L+ntdUe97I5XHRb64YYXjHTXIX30+eKzr0YQMJxERaSmZYExkdPT0NKRCORkY0dx+DaHqJCwiBSvkyyyckrMiuwc/Dy8fGILzL+bS0ZeVk6VCu9rqk2zFq261aLgOZxxafbY605zbLTJGId8Ae/YHYkNj5pGvcDFhA4F35jYRlKi9zJsj4anMeAfbUGNmN7BiUIyzSgBwdsNiTjwk8IB1zWZXgTcrwHgdwDsaV8VrEtICmGaAxamxEZoZwOqLlDLKY/dApSvNhJqzspgWmGwDYoQEiF20fWgSQktBBVGY4BnpW8F61IOLdwWq3F+EaqHOAdUeCcrXYjLW5A+q/XaBRLG0shlQZoCdZ6bkq+FgAwLfn+i5NMtWclcyjJrpo33WebsxrnCSW/TdGijUepNYsoyjW7qXHln7Cy6cqb0s6eSXyZDUy7iSsbO76peOo6iXWpKV7q5i8+vyr57sEwVeps6l0iXwWJUmoz515BxvNlonRRLiju9kK6dz+/EvUnPGRLjdeqEuFFLepXujb54UnHH+xtE3WGCpZfXtay5VMp42sFBbPiYz9PI2fHNiK2nTo3TtExjzs3gomMR30cM8OIQec/kdFIBodk+raMuQjePcfjVCYJVNgqGfb9yjzwHuPjQggAwEJCENNmayX4rDJMQAvtkzglSHB67iYuIsCSrp5YuQQ/9r+BxXlOkaGsR7ypCaBNeVDy0UDKcnKZas/Rtk6PqjFk13Nyt6wstqmJTPs1ZbiEIXrJ/AWcSEAm++08Q8CKxmRplmqIOSewPQfhlwcYa2OFHZiS0DFIdwG8oG5bJPjIDBiP7CS0gH4OMXqUrYGSW+k03mmyEvLLucsptsgWw7LNkUnrmb9L+NMrwvbjv+5s+8OWBiyfqgAS2GP/sxCPiiH7v8KzDN/eLd27qhlsjdhdbf7fJ27/J8g1wEAu/jYNKyvRnhAwT+NXfsMBLJWAuzKlNUqjwL2Cj0rI4xXiBqWRL5EsInQOO36FL56R21KLU9xhYXNNmUbSPkgfegt9u+Q0PKjmY6v8JLjNiGbL5jO4V0v5hSaSM5OzYLDWnpJKdwia7Up0WDMa7AbTgltVr/OfEvG5fxvsuUt11CqaClQNSLWTx2CbutwVGG7Igb26XwbtuWaAyffftWffZKFsA6cgtHWEiHogHLcdyz4MTp/r8GPTe74eC/GwUH2L9jSOgD+sAwc8YmS+K/uPwBYwLZcNEm6U472/d9WqRqdTNJvtWgrLDlhHP/ALZXGobxBFd1yJ4y+w/ajJeyz/3CGU+2ap0PAXtMtSCj7MSLzUyw6rC9YQo5x1dokt/qc8XxDKyefB6cOsSdpbBQdHK3agYZM4UvReMNIohEKm6HE0Enry2XLNIJXUN2Ht3ET/7Qi4zsMkSjVv8JxeEZeXcN7A+OcxRu+cbr/lLg8RJGw6ZoSafZ60/efhYo1+L2oKUxpcKqfN1UwdBHq/XbvlIBPt+e8e7iS2UHVelvhyil5L+3IEImHJLQ3yU7bycyIax/XiY8Xk4ar4QW1se1Z4LbxXZjtBVA83jfBUwVWF6TW/RpbT80P2fOdM3w6or3NR2UfT5Iwi1u09/S37K4+2gyjWpX0XbRSXpYZ5UO7qc1pax476CnW1P4khyePpAj0J8ayXw3okwpl1e6PgPJVgChrRaDmpCkjIYL9PNC+faHiWtJHn5ldYF7NSS4/3RjWPje11uganzLhSP6Of1CYBoWFLwXBGOPfUk7hr/LhfaM6kkHOtOhA/o7vf1A9hJb89dDhzeRQep99bA6+cgZgltI0OKMLZFh1MhQz2bRjcfOvjmsuSM7ahV+XL7ysP7GpoCCCkwaGRsWeuLEVkmT+L7Xh4htAyQ7nDvEpBIk2ub2RLniFY7JTLo7UIeUqxJ/5axKBPkIo2M9PI3fhGkX2McLeAiU0GQIGPAtpAYc4KcqrWKWVkEh/Ed0N2fwR8HshRkHHfB4SrjnuVxZZsJ3cte7DvjGldLeB5ZY3an4ev7kOQnyYl8yOID97Z4Qqlzac6D+LsVMdJzNYvaMBUgrvEOSuMdRzlHjTQhIONzpl2tCLCCVhdfJY6XBBkC8m0kNuT9F7Q8F6B2Ww3z2kP4QHssIqq1uBHeAircdyPmWXsLlBvCV5tw8OLpgB07LcpivJQrwCZJ6uMKVH9U9XyXs04RJzaGbnTivoOENPsKQKeYWvIfsMKO9XmKEd3/AVWLXHydFYHZXVb2j/32y6ixc6/SkRV84ym8tMq/ZIY8rM6vdwNR1JE3QSh9NbLrF8qC4ac4obHNzw+Zz0dUJtAmM27aJUmdVqie6uS75oJvxiAzhWwjYJKTyPDkM8TL0AL32771MT6T1Yk8QV4kI8MsvP5ALkJWh/mRErfg8WeRoVdaxR6jf1woW8ApUGbNN9OYPqJ3hHEb1VHZvCt01odFZp08pBqW3qk26PD4Bdd0NFRyMhjHfoWuhLtxT7o5k/e2iza0B1ik1AvAH77/KHpmjsKv8m939xkV7eQiaWHRYPwkaxS8jQo284FHlXmrTCSkyu8/xHlcaQEhl6HeDlVt9obNDFQoXpR99fY78RUx7bFX9lzf8u/LGVsdZvNlPp/JD/meRRpeNVq6odVNqa8LeU3pFljPrDbIOXNclpkZc7IxCFOzCVZ1QV0bfwstePqO7K06HdbJqnqSoZxr4qWyAiDxjgTKRsnBwBcXyIg6Dh8fUdMK22dz16dbzqL7F8SDSSPPbZc42tIEWeWh53ni+2e6wCHwXJnzd3s880qTkWLOl1Jex1Gz47rYdhXXXUJJfhmzChmjw5TPXN+ZxyLaoK07Hon1D73udanOo+p1Um5fXSDwMRQJfOa+ke8Sew+9f9tRNV+zYxvvFFD+Jvt28QbAPxepLoyHlrKvE8Y3BlRrskwFSSaEBYFHL9GV8OYhRr8HDpkaw1eM0LJDVhhY0QIhTtHCAN5lg4Egm81g1DjOY963tXIsCIjmuEzxWAxtvoQT8Z+Z95Iv88NzR+ie+60uNrW7bl3kg7klXbcpjHLCffvSLTctS7/Cuic0HK3Wfa4T9oPOih+YnnhEIr3+s5CN2zi2i3sj2cy7UI6IhHtfYnAhwaPLwJBe/QJjOrrkYuE2BX3yfQq/Lbksmvx693xgV5uCY+I2whjF6MA3ysEgOFE67i7Ix+knbf/+UVz3e0+lYr2439DQx7/0TgL5+dzAWgL5VAGFUnCKTFgTrOa3dKjDXsVgrmIxTzDyv2QAv+cJ4rnyDfLNoAfZueHX0PpZH19uAa7eYY6sUBaQC7iBX2w4eYlErY5XyV2Hggek/ztEFlvtrgPefaaUUPqF+Q1QG9VwScLVU13r37GyJBNdEqC5EVJpQmszZAyarnhU1Z21mIVQEek7hMTwrPSDakem7N5+e+T5ceSqcTpZ4aghvWFn665FR/VMWzZnIU8EzbnYXzw0rvWjUdiPvp04BdoJXL1HipfQywPyuaVZ1bycfxE1HA/GtBWTPSpeZQTh5QnyB6+NgcYqKATh/FZ+6UToBHD1nkbyV8YgY+7XIKcWDiDRK2EkLAG1Og+cnsCOVQMu89M8xeQyT7lBW63szmwszTFhOgNSYs4ixKQaV/xDkxC4ejPEDAsiwSwg1ZmZmHHi2V0AD1CZxsrhTWK4IVT7WlrhKopHdCFzsbG5zX8VYWGo8x+Mz6L2Lyz5xttqwYdN6f0/LcMiK6M/pSs7rdPrBq2UaLSZ3hVSvQE0RTVcmfD3VFUZJGsWNJcHTTmjriseFygJk7GCg/Bvt51dxcyprWEdFGBPc8MgbZPyZoFFclYWFlus3XsWjFWiiyWPqaseEj+wI6iGqrM44e6tqnLvoAOStlZLjMibiOfKc+T5YADZGTFWSy1BXdqg6komVZ1pvU5rEH4mXbUzcPX+6G7km+JOhykhDu7NY9Pr4KgSgkyG13XDredutrzEyif5W79hWmxF7Yx2k62jsaOOawnyvaT3/79z9Bre7tk71soqx466en91N/JMJXCsOh0Zi7P4tv7COnR1D9+GRvgCpPhM83tACEpTQws60CXkt7IuLFPoLurn8uaHJicLS0MCoUPOY0J2WQKvlCbxbrW+hHzpo3UUFoR5hcHteVSG/qdUKPcYrK54pxi89A0ieGTQB2qiJs1ct2FxZlU+WJPNBmvyqzKLN8xYVzd8+mZOi57obdEtns3B7mdZcx29HO2vpkGOFsvnvBxy+GEh/KfG84KO//lKOhHUn9BO76v3LOFT+zjz7sv8/vy7z2dyRB076lefSl9VGvFrxnVwO3AGJQlSvxcZENc2Tt0YTUxtNYi3tYex2mozVFNWUd3BG25foglMgeAIX2TnQgSuVcvpHDNIpqR7wFWUPEKbIIoe9b9GgPnE2op5nl/TArUhKdYH8XnlLOmzgyQcb8WIMHZPXuOEcpobX9WLxHaOncCFjQXB5slHaQw97ls6Q/KlkPW4F2ShOP0PvkJ7zf1R+lf3+zm6rFHfFokYVKegy+rPJZL+rNWKH8ekgR75ExBqvMauafd59R31do/IRUb+8RP+vrOGZWNzwhYzN2LlsHj9f5YjUP7vIwJh43njrl9IwJJGB9yzClqcxAXrzuifnJbDCWkftIaQOEaPjvEankXlhtBeDSJmugTf0CMG7FrCnwMGf+LqzLpaM6SpyunM9piyelgtVtU/brfCZtsPoyIC2oopy54qukPynVUQplOdyiicTpGVw3CIxQa1ViQEt8ERjAF3VLAe1nZ4Qpa2BjNM/ODzpBPuiND86DMJm+DTD81a9C1osj8KRWMKwzaN2qWk8tjxGqhmPzCe5IYwZy8iuNc/FrKmjYotqfaJDJpyrb4pFNY3lus0Bp+4GhMwfWlXJbJCx/jQT9gBi4Ud+JhtCqZKSoJpUKo/Snnw1jm+0SWhRHX6KI1dYP1CanJEwgWov98BbX8BDvV5lbzVD9jfRl+a/J1eoj3AsT54YbDq3at36DVvffrqO2CPWGGXBKMwlcWie0GpF2Y374NFi1k6h+i3p4Kr1Dsi9TfeekGstjLgVMwoya0qcF+ogpzMKEExCTbzchBkkCAXEujMfA/bzuaHrVaFmmCzIB5iHcCMYvuxv80Jr1tLKtFCnSy2F/Pb+vCBV8lxnbR6+rm3HoH4STOO0g69+fCf+I9FqCcTzETBec3g8BqZNiuirV9A4YsqlWkoG3UVY5NJn/WyTcm+DSZMYN5UI/p2XjejEt+teDp72NEIFx+KmihDOJkB+xgXy7R1GkRsGPVfKCZgGo0dfF40of8XF9vB/TLML4lSL0zeaZLQjuPF4aCYlrLfA+9Rggjeqh4TJu3y8XgyiMegyup7t9spVQKBOUZTmuvklUHidTuZzX+DSujd3av30bZJRCo4xQLWsRj/67KxIi9xUClXOpNs7TiPA1xjMUxSpv+p/H70kZWfTsqcqghLahfwbvzPN6HhVCQAZ5sEtlEGuCehsxSyKBSdFZ1VA9Uw+Cyq0gueovQOKTmmNUYZ7ALbeZHBHglNjL6w2FyQSwL2/O95ev78efPT5Ajmr3meyjRVNMVzTV6XWv08UL8mOwL50D97X+Sn752xNy+QD1J+4bEFx0BMn5dH5mVWhw68KJ0zo3NG6f4RFw6HGvkgzItNTyjTXpw4uhfMWC72M4l3VPax+RP9ETzmmf30/k8kVHhoTARbp9YfudhewfiNrLWP5PikPrBvOfM52yqX243PmfIpVeRmkaiZzE0HWqJ8Sgh1RxCzSDw9/wkOH8MTnfMoM9r0Cuh6ZrJwX2pfvFXRdTep0e4xp5y6lZBl8Z1a8wGLTqNcWX6RLXWoNKKW0x4E85rRUcrSKcvpRpdOQIM7WT+SNmDo/EsI8tPDtm63tuuSwmEFc8RYNPr4J8suBa24pbtVoYxzuh0Xe4VCn0gs9BInZoguYpHQtwKwNPaDr3YGizeDM98w/7AJvFksf+3HgRowArd31tiKszB9ooLdGzkEZ7L+kYTuA2sQYfw189UIrMmJC8nFFgXtk1LLxcB+A2EiIOlGaE1IoK53oWBomsP2PmPG/mF7h/0ZEST1Az/raIc/NAD766YMNNMJemYC9iL7SqlPEVfw3pd6Nro3eqTv8wbfNKVLTJDhThs0M0b21hhO42QEsQsE9r0VVqK0Dsr3VV/3zr492wsy+wDxenXM07+F72sLP7I3er1OjBeNNj2HNHYFP1A+SHB/HyLonivEeWdqYBZn461cnd90K6yUR4HAqfN5ZVjJNQEn/ZqAkhba4RMFT8K9cFqqA8mqP31gXDk0R1KZ0s+P+NVzsmVzFB5dF7syaOwOB8RpB5dFn7dz/gM6A2IK3Cq/IV7KlJMvHxskEjAk7yQb0+tpn2ULGGp5QZ+wzgJJpoZ9NWwNA5740vE3VOD8Frd9E7v5dN8EwqK0gbItDxSUo0amjWmVgmBAR2WwYS5XACE8DS9MUVplfLr1w3VL1z6ZYGXGKwgVOzb1diOx11tkLo8qxsUeOjH72Cg2p+svR3bSbi52w0Y8I8+kvQ129l3cBinZAZFSXlIiV4IC7p/In5k/gW+ftwoiRrBb0jLRCjLVNZBXwEybSy0x2kZrvkIVK2xRpsLa7ZNXUtxdxQY7bk0iub2EWcBvRSkU49F2I+AIxo9zz1ZlMqrZbrdBQIbIoTvQjp5oaXXKKIyGhGpmx6KjdtyFxXhBAyxafoVYdOqiDXtu0SZ2maFGEAgIagwGgwK5kIFfxIR3xmUKt0G+luZFEhiNCMXZUW02xqqW81f0Tzmj8PS32WowStzYUIrN+oZGiJDDu8OGEASyLqPE2CUDG7ay7gZYbP/dsKJ+P5sV6M9QdpAp2ynk3TDuAeX7vkS+TOmVyMpwqc8Gz18/ET6xD9kH5XXwPNwcOvG2Et6oUBK8SobPhCtsckCS+oTjYok88jpMkX6b9F/bprQooC8fd2RVxtgflPVWX0AR3cqQOQFqFitstgasg8k00nDyp+oHMAaK8IDNb9byEiL3l3IOp/wXrsPK/guLX0dAkwxNSTMd9hcR8s1i9ec/S3VDfCEsV+mCWfGisDwIDetquBohD3Vy3nx03zq+rlDm0hms8XqpdViFnrMxvZ5Yc31VTpa9NtytlHCfPgJ9UK4WM9Q6rkzZAcOIMZyFA7bxFYLN7QZHcFaQ6g4Q/GGNyZ/KTfT+duDTEfwRhw+sn+hN54JGRF3qJ9A88/ygLcrHfm/37svswv8ca1TEXhIKOTqjt5JpiDZ6JRHcWQ9XonMqZEwyNPSs4vDm7slytWfpyLsF5EkIHest8HSHnuJZtw+wCLaJ4JPaothi8dVfLL+WQEqvVmyObRYNGO/0VPo+QLp5M7wCkHIz9CIEOrCXb9+2fXsE2+GjtG1bcAQpN8Ivwr+eXlhCwKuH4MArEUIUSIJSD4M8+U/k58eR1LBU8yvZkBq46wSUYId1CkjKk/+upAd2jh3Ghh+GgT4/8I5zwKc/5YEP1Efi128bzoXPbQhv6A/3byicGXoYAm2j0OQaHWwkLZhuxxJeTubKiBvu6JB5hhsPxpKfvBZ6IUe7/8OTp+rcJtKGWjmO9MlIdNa6zSbiJyBJfazS3yvJxUO8Brbe6UnASWaQR6TSiFwhRaiLXIFIuyjk0kg7cg953Cky+dQ4MnOXgEluP9ckd8lBD2sC5gDmX6n6p3/m91jM8yvgrUA9MxNoFiiCi/CQHBgFvkgJhj1kep7TT57k6oroi9RKuOHqjENrMldH3e4586Hfe618sYNSmXJljjMP+v1C2b0rHr26/HP6KvNz47IXr5x84EFa64LxtmvDPbRQbgrxhyKYMZmCmoKfH0jQnqX3DibDy3OumVm2rU++hloz5/As7qHoRVR7L3AkoEIIDLhXPlKOFN68LpoLUNU7Q4YdLS0GyRoDf+mWeDh7PWMH3kAVy+PM6X6L6ofRff87xi+2F1byHVaGkNkNrv22GZJGCk4NaHuBXzBuXdFSXiVLC5VWi0ESlr9fjJ3k7o4mzOU8NWI0aOpzlXNyDllLGFhQcEag8bwfwb7psVqFEGkaj0eb+jvJy1/E8RUOFTBEO5kml2k9gj1pcJaxTQL/lEt0m1iuD/d50ZYyFQQnmgSg89v+kHdnya4ZoRlvwz++jEFBQWUCjecqgj3iNNm4EIvrUmiFDpjKZKgntSBYbvHcsAFzYr8PwzNUqIxVXr+9pl4BElHF9V7F2hoXfqGxNm/yeNOm0gjp2mmuwm1htw4pV12isluyOk0VZNbV1ppdHnuwBILFZYcAvOegMcnXGr4WRvtAAsrRLLElrVYo0bWLAnPk0khEKh+DhFNFdnXCc3AWzpsdHqmDXMfh1BXDSCVOcpLDSbYj9pH+PEkinfyTBBxQkFx266vYuFKcJnJIZDXVN9hgR73FVGcWEhCOR7zowRSK0MHlOvh8nsPVCfgg4S5sDg+0CxzYewCSIgWnBnSh1wLASDEJdHn6Xr/dAzExxVIas0fXTWGqT8UDEhsF/w0ekwr9sAuWKlVOhYQl8EQ8O8/onTdAt7llPTV2XH38a+hLm84WAyuaSDLRVJD83K1uyv1buY7ICMxXzT9JxCdxRMG00xecIiVlUymT+Kj+649I7DYr7gIt2GE4uKZlPRixAVcsoTF7tNNA0gbNzXhAbKPgv8ZjkpaXu6H8KKnXHfHuPPtxHlipg+XnbnVR6cQFRNocRD1JQCHGcUTe9NMXnEIlZVOaSXhc/83HRCZU29eIbgkBSC7YBVR9L9poX99TrjS97zk3QOyydW5TiFJImk3KSpNykUm5wqlvogu3gEOItMumrslTH51bLxjSpkmNFkzc5q1p/oAFRqfE6LQZnd5Ih6TQpFgm5T+TUmlSGqK2JCQwHAfBG9VsudOCXRFvVzzWNdKoUVVww/bUwIC9C/FZJDdkh1AgfzE81zWo6wwfgZYT3+5u2PxF6azid0n8xQi8BvWhLFfnbEM5MV9+52azSGrI3lWzGnXEJih++KY7mM0isSGbVMQud4pCl0vCW8brLbP8LQHIW3ddVYB35wpXTA62H0AuMPiRuP0fAF23Q33kUeqhjN/xB/7In/gzf9F/tf4f17mIzpu64NLFAV060eVWRFZ4xYScLckudV9p/cD//ouPePTeS+fgay28Cv2628MAMrBLWjlA5wuFbTwlgmS9iuHofDjMURqJjgWgcxfOUkoXncByEyZ0sXRI6YtbCWEF5gcAukmhirynGj9pvlwzhM6HwyQNALY3hMLoXGeHQe8osBsVXFO9SrCrwIB+I/w2Ji8G2F+nIdIwkYpjkE0e9NNLoI2wJNlud++4zWjvR5ecfIiImBG4MWVpv9AYIPABVcKVqwzoHfRuyCTsl3IU8A4VVm91vkO/pj6q7t5XpPE1u5IG98D0dJ24M3ry0cIqGLcC2zL4dR1mayypr6PjJBnKNcTTWru9yRird6N7w0eKRfujKqw9ygBsu9qlurg4uGS4ox9wdeBiCqjOJd0B1cFmoDCdWLuV8sQtayd6I7Yrm/DTA7b23zEQr65cl9UxUEhyGWTlGqXNab+pAgb1EBgqh5nDa6N99Iyd46pxybh7vCT6Toqpdlo87Z6ei/+kjvOSed68dT6jbrO0YNl9uW65X662cnS10er81dPaR9qf8ZQxua/skdPyOzKUjymkckTZV5qU46pC5alWrZe2Q5cnNuYuMnDydcajxjvGz0Y2b3BeBZ1Jk2gx+XQ7PUef0j/UuaWgOWgzuh29H6PGrMK8iSVhlVgftgI7HUfH6YomFC0s+gM/DX+TUE8sICaIu4mniA+I35NGkDikUtIm0oekX8kGsorcT2FT9JQgpYKyjnKH8i11JJVGraG+SbPQntB+phvobDqbXkv/ljGSQWUYGDFGK2MV4xJzJHM5C8USsPysteyh7A72pxwOp46zhnOQc5PzHZfENfHs/Ml8p4AjuCIMC18Tfi0aLmKKvKI54hHiw5JuaaH0YxlPZpc1ypbJzsjHycXyuHyB/Kj8WwVecUoxqDQqM8o/VFfVLHWxeqH6XfVLTZimXLNFM6h1aEu1t7RFX04+SXV1m6Qnp5dOr5feKf1POsmYmJmR2TrzTfatrJXZnbK/5UnzLs6yzvrOTs6hzhnO1c59zov5G4WjOSeKw3O78qbYnkl+VsQpVzR40mLx3AcAuYDnPtToYIGBq+zqNTj82VUveoN/D86RHFBDXzy44RTt7eqQmo5Vn5pQLP1kMfT1f6N5Wf28PWjtzLSf+DClqRMuDA1/uVMHeDSvA09HZWB5dtEJh6LHClOoKeDS3BLuClkIYdT7K2oCqrYgArw88QMID0CRYrFYb7SuV0mzhOhogCY9dX0Tf3q24mF1kMQNSUQvss4O0wAP83EJLOi8YoitkkYgx2sgYZS0RWZPgxDG2ATCGiNm6zZkSijVrGAwvbj55bZOLaQhkeX6pAuKoCMYeJmsa1kCWHiadYHBKQHGQ0QgdLZufKaFcjPIFl+6ONFyTho4FtIJ4pSOwRQhDjkKk4Gm1xDJAMhXmesMTnEIlnchJExnlgYBDgSIIHmNGYSBGy7rLSAYgE6K8VtR+Pd/sx8i6rUPKKnbeycXXwIbRbeCNbLresMmiiYNGemlKzLqqnvc72Iazrj+EeSfzt1N3TvzC2tk+e3V3bPp/SqMb71vAJsUZXnZbSCE6Bl00UI7njNyfDwvj5I2Z7jDR3bqC6vvbIDorA/gQgQxzViRv0TRpM5iWMkk7L5vvb4Qx8fRUCaZPfBFIv6UgXt7PEmeJq1NW3JJCXDQWS5gJyM6bza2yj8g5fNdfAKXJHh4euBrrM/Y6Z3BUo6m/Q3fQKU+INRvGZ70q4ou9yVrkwrQdFYZeJJR28NKVeWfkspkBr+Ea7I2P3rSbFiBlURJlDqWt9D5NDzlAyObgpTkbORJcLQMBWXHJIdlhRwT5MKqIDjKTCHYRquNR7F4Gf3VWUY1VLQuorHhfGR5NMnmmqTQOnXD+T1DBjKQty4hNC0av4X7Qj21VB6OqECBDX40G3QaLFqVKfLiPZSm5vSrOj5lM3VNyBueDnCQN+Zgee1OrEegA77U09VVuYGa4ogm2xSbYnNUoRHdjivvg7fkinU6uzqkTZj6TpzM+2gxBDxER2oAHlYF50bDMDIDNn41DxTjgiPr3O+sk8ChRCJMKz5rIsmjhNscV/obLLSJU4GOE9F5RV2RRFmVzD76lgSQUXTeiEIwZBujA3vRxza+v1lD6Bp6l8ioY9yvm0TxJCPiAWmk+9/YKOXYXo8laxcUHaRC1VC9kS0WDYBTtE6zQnDJJkQLpmZMxe7VRaFE70OX6zLWYeKiBUuIBE8UYTDoonZdCEFkmDxTSVtqnYS1tLUBppOYUsQ5LdzA64s7JHI15GCUn+FVOzDhGVIvEbttC9WrJtEgAdpf4BBTwASHH8JXxfxzaxy81phn7KJixwVEGmhipfXu967el5imWgUIhJ/BlxtIz7ujx/9fORlKrCEaovFO2gxaG3M6thAm/czAcu6crWjdO9Ut3YzWy7UDSkmvk1wKilFg1SMXxS9O+Ompqbqlmx/ExvKMcW5yp7oUZr/XwP7fuqoc9I2p65ZurtBnmMA4dkHivY9D9hhOX9vTZxDvsShdrMuLneTu4dC9CSKzBp+9X90/O0iDaLxf9+paxXC5eg3uP5sFvOMmP739bvrV/e/T87dDs1lZVfzgaAW9+M3ZUyYREi5xRRbwGaNX9o4K9+i9k4u74uJSopC98n62/DY9u1ERSmx++/8OdWAt0RKtjuvLj04jnWR4x4+JTg5+l/m6qAhVojl560tDp+ByWI5wcM+0H/x4wJfJraB2JVCwMElyo+sk4kdbFDSFtpOkbzkf9HqO8rnwwBQZP+Dy57gkuXGuBDPIu4AInvaZWPyzLzSIUfJoVKJwqDWld9m7ZBOvbnFQWLSd9ZQwfqs2h+7sq8LpQOWfOy+6JD286sa5MTgifu3QOZe3g0dBTV3Ls1VhFrWXQ7gT8mxX4WpwjXy28WLjGdoDoYIeGW++vP3yTeoGJkIan338Pzv/8zED01pRHFDnkq3rCsSEl/A/+T+yvSfe3ADG/DEL1FoUz0QjFLroT+Ce3pXCeLw2k/Kgq34F35aDtqpDrNqEOT8WCeZNj/43fbX7fTp5MxSbFbGiD46WohdvneWZW3i4hwT8Ufpyz81yVf48tIFfRiQgQGs11WWosslEMk2TtL7WI3BuY0kiQFrspE4haJM5yII2tOjwwkFl4UjQu+UuMNIOLU9cW0pSTq/LrAL2dRrQQH57tp9JkWVyqQiHXUFu0qk2IFDth+zcZGgMkiaSIKH0mY3YQdRUa8pDkhb8AF6gSYJr7SUxL7mzbui5YlMM1BrsBsl1pkSBrahu785GL3YQQxg4Ac3zn2MDmUAIuCBBiS9ZCH2WcHsQh5XebLTXsE4WPsa7D7cTMBak23/JyG8vq9Xfqh1jip8ULAOWWTGjN4j33iyixCNkpgM8hNvXwAMe7dF79HcONXmmd7MX0RAHjsD31ncwlVCtq9SCqOcvK9h/zPYjS4BDHyEaMefOPhvt32sH8xEupP8cbcdXW3rv3iz2M38nvfN/KPjz6JOxffGfexVtJr10M4dVRIVXvgzIJ+GNrk46kgjKcUITEQiVwt4L30myBCmQQBiYtHLEAIbgfKbYBMtoJJsSgHF1jku1GigsBb0njjx6nN/kUdMsWEJpS8gCFEhoGuBk2t/X4bx/+YJLBvf+jF9UFbqCkY25SqpWg/xSJNR6vkC5LuJ3ZyjiA3fxtY20CzzKqh6oR2FQ+ORWzoPb14+4rhWA89OrZGUYJ2A765CqVjfwZMlnVfhr6w2XxY6lXnFZ5Dg4vXzZuHb7bb/fn0IbCD4RyvrSgbPsKcWyI9BlKg7X/C7joA1aeQ55bUrDFWkzvGE3bWQoXXBga6KvHHlg3JCz0JVtzK76sizqrWAr9hwrdPfivDvVwr2SdZmyf5gJxyKnTmkqYqed23jbqUz4pmDYu7M1b4wA9jjf6+Y2ZlcDqEgG5XTFnmP59kFWulvV4y8oulSmfK+9jjw+kymHynQubrzNVGXEqmDE+a1cPr2/Avjc4v+bfrAoWWxp9Kq0ebBy8zBYoVdKVmrge1dhcqdkHml9OybX0G0ZbBMRWaaGKmt9M3W+uq67CfKS825dqafkMNnfrXQ9fwcElwt6ikRPM8kTqO1x40yLlop2Y12fQ3hNRegw6HWjWwNXCbqGGEEt2Rks8uhAB+oe7yZsknG+q372dEvv9RK9m/+Rgo8WnFYQ1/ZDWnnQh6P1WaRaLNpNo/rYce5YrvtZ9LrRreFVvcalw8NytdefHKPnEpmAbFe76tsfLQ7/3/7ldC//NQLfbEWdwH5/lMf6abBPwooFREAETI1BT7A7QrqY2B7OsGV1bgOHLkNMJzkvFzyQfjayfevqQtyxkqqeXGg8h7rZ2j5MgP9Lw4ue2CYuOCsbN4NXGuOM7UbVNvXohcZLOtdbJ55WIFEMxxrf6OKCC7J52fzfSrLLoiLKowl0N51BDE7b3iZIOWBSuXBNJhCNkvXgkjTIsevHYS+IJVFNBhc8kFLtytYEV6pB9NcOR0FCC1WDcsFbUq2dGat2ZktiSSw9gzcy/0sadbthEMZzkwt6kXYxmk37q5bzDclC/n1Gi9/2Ozpa38fpv6RhjsiMTgXsmmzt3rK4zab/eMb7+bor4P0Lnnw9f5dPR/D7OP2XNC4tIqVTsXlibR6cNbGcTf/5mBCWyyaDT26l+uXyYzkb1VlKpETKNBr0ViEnuP3iRX9lcSRF4kcdT/d3F7ZOIiowM6bwcQy36aZBJNsBCePsgRMW4NW3fdnLg6dS7Wx2PYWdJMD3HRwMU6wLsmMMrtHl68vTln/COHknsVPPt9Orjb75ltns1TZ9RWZXIH4QpIkgO9554YLOf1VjfvQySNlRcUwcs0Q/EBfqXOq0BJsFtbHLpbJyeCJZx/kWh6duIEhflm40aS3RGlYV9p21A4eeLLzweZwJPKMVJ4g+IswA6gUNW4d7zggVxqav3cqe2yJ+OFSYrHl3HkRnrKX4JgpFPcXrp+cq0youdhlIZFnNJzHEWNTb59YcRMWdsl6v2bXYdbGQaZempRNtv9M88kQGK1jKywrSJIYe3eo/E9x9mBuc0Lx2heCUB9ZZp3ZLNvqj6lTm1mThXMhRBCNOR3sK0IN9EUePBjPK9nms27nDgYVogci0dLQ+fPX8Gf4jlPGerGnqgxx2FCBMJERcdEmgCHP3FPmjkblyD5BwX354c1n/GXgKd6PPNGqs5/AcFTFKUJzKoXxHFHgmdeEvsM8k0CBxppJd64hSs4LU4WrhaSN4SyrP50dwpk3AzgOXRSlO3kPEYMyIHYV8sQM+kVbt1Qu42GkDA5ZE2Zw6CyQDpw1VDneqr8D02bwGiwRmev9o+u/T79MfFmGyWVlV/OBoEb34a/GPvceEtwG+oX9P4hcGQLTgTeo2vmI2JN1agcINbP/msv6+Az00C1MHPJJMyY9KucF49Grn3J3+JrggkPAP4IeCoaMa2rNYc6H6/oP01iUaHMJngbMKbh1V115XPH7ecHfJ9PH1CfDr618Brij4a7gpQ9GRfwvN4aKl6gNxAiCSCILCTKu1HnTClLdGwTRMrYEBK8Fg37LzfljhyihbhRVUNrfeaGUaoRGakcJWgXC57uiy4DiCBSofwXJk7YhhNi680GzCmiGwLcRWRnXJYO+S+I+1NTglwOHQwfGjaQ7HUe2GtbkRODXg2B0QQzR/yK15EqnYvw1UGdHi85Xa0UuJJz+DwLqeu3ZrYR4k5Ojib4PriHFXhVjlqwZ0T81YAZF4FU/jGt5TsuRONoghIFpnWt0xm+S+shoskaJq74yywSUzQtEWUVySGIFcrHyUglv1MC8vcbWGt6dsI5XGM4qMsgcT37+yo6FWasRwMDxlrbjBP69Fl2ekfUCWdk0YiiLpTpTONOElDfBSyle+kvDQj7pw436pjv1TVnEm8DhuR5V2L0mOMzI2NzRiMV8chJzfFh/Xoq0v0okA+1GKnHGlqOr+RtFEY2EY5QvY4V96yeAdMYeBK7VxhtJ17sy5Wa3g3twKHgzYlO/wq6WcfvtZjnm9lDWnvFxKzVPenq3Y+8UHxAfygjaJxJ3H0+M9g/60lRgz0icl6xihrukHVQtMXOlJKbhM+Dqun9PGtvhP4v6m4Dwo2UKQVLh2RhkdAqy93udnRSrjHk+ULfEE0dqua9tn4GZNR7fnuQ6qaDN3EE/kk6hZ44PVbq1Pr1Rj173QRb+tkpRCROcQup7B4/CUk5u6XcmQQ2bEdI/S8faM/6TE3YNsoyxzywNYgRtMCJaqV7YHlnBWVMITUmxHqe8gsDp+RZZNvfcoMNodpRLZcUBKdmeqOZs1nVUC94RHmdr+DEUnIh+2VJIRIdN9TYtjgwZG4/YGXRc02KS3mKrGy/Z2xgfj/zP9jWUR7cVAfmIFSrE2yv0fJRNLhBx5MuHXyvV688Gw0qc6bXde29+Zue1yCDMU72SU4tc9X3CLNI2Ni3ExXsJW8R2E9Ro9Ib5PmOAUhdCYxZKWPUtkPArspFzLWb3kzkE5dsbCUpb42SSlCW9x3Vg+rqblsDoMPhiW0yrMB5nUIO/WnayigzQJlYlLgnZKr2ttFYdkjAsC9LSCz/9Q6YKY/Xy9fM/Wl83L7W/2v15uftkymG9MpTbm7F0jJ1k0uenAAgGQtkKtaxtr0aMyISl8kRnEbdNXMho9mIb00LE8SqZjTj3eSWFkxzeIU2Q7Tg+jiTVnl2Hl4K5qRyG4mBn5OEqhjkTSi4ZQMmkzcjRPaKtlhoLTzOtv5/OBWczIClPs3Bn/gMW1gQDHIWPqlI2Ir07Q0IhUxOynOy2V6szVeQ9XZomlZIO0uo3LSTD/ClkqUBm+zhOhRIMz4cZcI5GL/9ttI29M44dVGpjtjZWrC3uHeId4x6jCI6POpQDBObcSE3V1SIeoDcbosuaECYrb6fIPMEZwr2p+GHdIGIVOenuI1HZoRrQlKgmlAhXSRFnbTPbZ2JGyJU7iOUHm9SgfKKQQEDSzcQeFYOlfwnuo7YgEjRJme9OCU1wxZr/UE1SkyxqUoA6dYT5Qo4PASfNI7qAQnPWLvYPaYLPheXeJGY0PhqAE52c7KFunTCyM87KWbiy6BMQV5nLSiDBkqSra5bxImIDNPGrieAJBOVo3Vl4KLZ+QsU1W/EViMbsyjbza8Uay3EpnO1LgAg0RfVFTtLqgopVVUgrwrmmzTTZ/8Oox38rXqyD5YY10Hi3Zu2yvVfp6z28zgfZkfzxux0CQBjUh6IzQek7WvMjgwytel65/zEPh5l5YDjuWXV2OPPNQkHIyUZbRrkzSho9aadZoDYUR1ck6MQSPSY/dlAP11JNjeOo8k7cIXB2X6LFmWbtDhLtSAOMQwXC9oseuSGVRLObErnGzR+NKNAi2PkE0iJreQ1XR5pwl27zQB7sqzxObDhW8ZwwWDa8AY142JiNMsPOwxM+hKi/ojE6pbrLV5XGMgUnwNGIxrN07UHzC+sn65phrVKIzJVbXXCT15Mp0q2JTStGzoVKB+yaE1HqPcjX2F18jfcAKXtY6I1xq8ifL9jnU00uK8XVNlF2xOxAx5CK8bz7g8GYz0GO44uNyhnQP35q3v3n0v3MwgjQEYej4Mm9izi7U+M06o07gHQZR1RU+oWvthUpfWxcKxGw14Jt3hKKM17w4Gk8zk2NbFL0Ndd5/QdV4oEYzm1fjrHEFZTfJb9AN4fp+sg7XxX5UzlYTGbfQHaUitPvDwbY97ktil+P3ecynzrGaTqzhZuzrm9W2ZPwG9zWya9WGAUqxq14Ob2ezlIffc/Z/9Bt41Npryi+Xcv7tF3PKq7MlCwha0IbaQTAm9qFN4/uY4+ULCwaIQEbyrk271APXtRVl99p80a+Ncwbf4vHIy3J5qpLTRQ8xFL4kHIc0FaQ07kg7mKInerOzre3IWzgscq3W6mwj+kIPMUxuup+eevxYDz+l7YrQk5UbCzskDovDNCbtb0IHOM6zuEzESEecM+oLIC0jzTnJ47WJK+M1b1zRCnBGnAtGG9ELJaUqVIsU1zpk1sZV2SqW/BiLvCsyVUdjNT5vXG9BgfT3x5rcCpsbtJm50Xr5D3lTtPr1oLGHRMKr8QBlGzfMgJfRWlBMl1uzsxmwkAJpQbQRVquLbLdVi5fmqUTUp4ZKlGZvvr7eN2A7PD609S7saBPXM6/Sk3UefgIq+lyFCkptudOvpwkQpbBkuAvPIp9Y7xAakJXURjKKLeRhu2TvwjGVLI+abBbRg6/4LAuJkAg1tAlXF0FM2Zy08EQU6aLa+EFStdobh/yYR4UaKJqy0RVHdWoV5rSTvCD8hAqXOBrGQP/5JUUJJ/Kc7BRZBhFJCJIocz5fjCezhZeds3GytyQGNjLDqCA1mpI16rTJgd1wjFpt4WXVQOZzY5hgfMF/On8Wz9Lm/++Bywmm2s8N4A/NBzfq/uOFEwltvOSp6A3UlGecLoV/+yG+4flShrzk2VL63FdfgrOf+29wkRHCIixdTOsAdz3htSSi1JgGcQLBgrggpftvUlZp57vAAz+HJyAniHdZY4Uo6Fr5L5K1sDtzIHhzSyQyoLobfph0iEjcpRhUZ97wE/Zi8CniwgnJAT0dv1poYvADPGDukDoIXgO7tNThzXcMTcN0pkM/8FUDf/b4YeFKx7DHMA/U2U+HzCzM3GyA9K4JRODkyGIilYIMiOnirs4TSOhaPCpu8bCsJ5OtVqG66CEzjFeEbjXZVNl2G9jUM1afn4d5PCzaTndm06zm9NicmBNzhNsgblAiaRIjTOExJEDCtiIhq2rY6CKPPOnHEM7HrbS/RGPUhbzZIwotLMl3xNH+Ovh4mBdlWY0n4/l8a8caGKg8VewZnHfdtAeDixz8PP4ltGb9fVNUhWZL2qo42l/K7w/NF6vVtrVUrFanWtOBgSr6ZvQVeNj1iy2jGAogzuOOtQI+Tyv1yuk3G71NxoVmd9pg2VEUexU3yPewPYLooo/oxw/x+276DCgCsToAD6prmHzuGu67RZeY5tMbUPXXOD3UuAwRTFi+7PTv0hg9ot3xmCDZHJgNPvaiq18F5u1TfVLpHb1Wb8BDJ+mNls/ESaZ6cYJjT2WpcodKlcH+POnDhC+ao65F0iYfo5QQjKBr0aTa3M/cYEzig3S9HnTgwF2wAzMJ5nSYmCXanAXldmCMv5ZFEfDgzTFd4Rr80zbF8JRDbHmtnd9wK2XjtFoD69yqruHwx7KEp86t1nnTpZx8+8Wc8s3Z1bAj2UOGbpT8aFdn+KWNg20NJdpAsGARJBtXmlcT5DWJXnrk610dvPWyh8sllQq5u8ZLZ1QqCWhWnhBVITVQzlpSq1t6RtIVWrtSa3Yz6/E846LzMLx6NMf7oZe9afNspqYG8al2OL6jVxs2LBJCxNbkbJ0xp7e6+Kt11UkbeVwcQO+3M7s5ECDkHlPHiJL4cet+3gO8uvyMxszkqsPCnA/oXJiD1bRdFHsC26gv1Dk/J3Tzn5/fTqouNVq+N3vGQqfQ8RzcSlxLDumnt7iZZ9D9aGmDHMLJHWo0XC6skXZSCcKTDjFt5yx1i8xaArOVNLo8YQ3tFM6uQFkhzU36a0PX3M/yJL4vEWo3BXXX+E8Wcp9i3zAbSR4PwDXTUlmBiOkr0A8Rg1HOT73YKuuEinBsLZHdPZ+WTG/Vi31t0FucTe9hQqnrSP6a754GXmScXrPesM+oaOqk9zj2DU8SLbPQ/bpyLZNIRKMR0tPcYeuopv2t3v1A/lKSlybMud2tPwUKkF678fRe376fYQDvh3Jf5PPdHwlQcYRq92r36lWtBr2lyIWCEpqrCcmp7xMy17FGsGpgV8ngktY22mc6XmoGzCrhepp9Y0mTCaUWbevG4h+9eKCwhxN+yWGOr2J1I61lYQT9Apom3nlfK9SvJyqWdZXFv3wgt4cP+5JLthJ1I61lXXrASWedr4X1i4mS9zuukEmUrzsheICylDExUwm92BTB2a4ILqRKOe5JmHp4H8Ahb4tz2tSqgKBp66ZqVy8bs3RpXwdIbFRLSIBm2ti0dn4UjeixPWKP2JPTj9SPQIITYFHddLGVzOWQRmDfh56HRNQe5jyvSyEgkCG1ZHNcTY1HTEscX2kq9dJ1XL1drLtQs4rqCQRDy7pxMRFqK70NbvNKjPxFh2kxGIxGk1DBuI9MIBHCun/vVgYRjEhxaaP/qR3z1Ew2azL01maxuvOClX5+sSPWljnf81xThbPhRpnxbDFfrXYEJsmxSScOnKZcQWZ8Z48UpANRbLn0BVelGCLf5OGFqYCXP+ohsTK2ICMEIYgiRuktciwP4WLSAYzMtaRN7k5TYpKj5DrYjQJLleWoHBIDcpVAJpL8p6/5GV/kpfxgmA1GRfFlZ5YEpPCaUdoS3/rSXeunJGxN7BV7SfoDKGXnKiw9Mqr6eQeMdIx20J11UnZYSBanFHk0S+AMLEKCDdmpTNaNk5xJrKAhrrJQxrmsAsVQyZU0f7HELy7GZEXJXaastAOoZza9lmTe1/zpqh3tGdZIyFPnO/acpbQBzVlImOIeCjROoOqOCa7TOxtMOam30GYCXiCbdiNrE+rT7GK3VeJ+x9eMbhAa+5iTnEy5le64JV2uF6yEEvMroVb9ldkIJDSlIzfjBrC9qSHBMr6eyOvQ6uRu78PjDMc9JomiHA8phrGD4oA42I8tvSb9WM/U0Ta+dDpZUdYSWENBc1K7bfuof0Y7jk80wNT+2IMgUfo86qN7P1bJ4PfCd3lBaWtXcciVEJTRwBCz6zFhd3y5UQuPJr7nSYTqQ9kp4DOaJgOUlHLrV/4MvVotSgsEqclHJyOhSMC6eoi25Lzxe5MPcVTQ5UhNDWr6aKO1jXEN2Ox6r5V6hYHXwpODLE01Sm0ZejyHj2jaU93RUn6nYXWcbtQrmRCkqckXihmhXMaaszY6pm7w8PUtNR1dp/ORnvmyVlmpTAYjtXDgD6PmII9DVm5NQircK3/A231EHAe4IA9O3yD/Vg7pviBBv/Xvi+BRJCXyxdlqlc62HX0MclsKq/QfDrVrCal29lQBD6Kf9SDfger1dGy63cdQaksR3fvrU+30w8VGVjMsRgu/8G9qOhTP6vIgW9kD77gO1qKMhvuPiAqSVuoCQcKotFsTaY6qhnaCD1SCxNZt9HHVJzrvqykR+ae+fSdK01Rsuz60a7wLfKlKR+lcRd+syiWZwhO7cpA9jAaVzyldPI5Sb2deXcG9uTk8GXCDD/jZUt58+zHe8vXZBXMIqZAKqaUnY7LhaYOHFvLJ0cJtHuV8B+bZkoWHwppDB+HQgdcm51NTcO7B+L9Y/dvQeLEwzgE5BYNHcWBDiLPJyN+5yDjjUBWeDExWwB5VBLtnuPtIwbEjTNSBtr7+TGCmgp/MJEzCdKpdJ2t/ShR1QlrFhBAB9AqigFbBRCu04fyrjlG5WufMHIP6LBCwHAjmG02I//aNmu157oIZmBeQsBHIFqN5qKckn34iSmulHETutUAuRdOcSBqoHKdSEZvTXYjAxIaNX/Q1GrkcazcGxsOK5UYlF/NRsLwVziAjFDwC2CkHMArp/a0oFEq5pB06c6rji7ONYsQLxwm+/KZ6AQkcnxqSPY4XbZ1AtQuWn00PHM+anH+0iKaMfLxzRuhQuNggEiFy14C+KLoRn25aKCfRxX8E14yeWwxM9h1pjqFrfgFfVhm2KBbF4q3iBunSdOMjUIqdYjs+b7UYAh2/1IvQRawKt26P0SCtMKmtlDaG9FXcDul8Bn2awCpd5TiFBzRRHbVa0DWReLphiofUgh1oRlOmouUa9kP4hGjGNZGbOzeRgRZMBIsy2liZnj0vSTOWUxGQ2FXJwrU5qAbqVSyZzsQ1UWS64VoeYVQ8tj1M9ZQg8RwjxFxfxKJBRFsDJq6WPBXYbvwFL4vqiQD5xA8NCprn0I3UN2HETF+JvCwmMiKTmz4DoCAYGkmJotLEQnrD+0Y2WUID+iagIloyByzCzmCHrWms8LTCKu6rupQq0LSRRTx2/BAYQTAK4k7JqxU+wGioBXMgU9Cj33hZm2wRk0Fz85IJWZxklP0ANdWBlXkeEkDmwsjYHmtD/zybOZhtOowjOIKTd6FCVzlz2LInuYXTcPrEMBPPKuVFkywHrJOMo6t4PjT22KlZ7PYQYWoL2/q6v9j/UiEAyTsRjtzNNn9C5MEKqEfh7Ht6KBnKkZ3ZhV3Yc9kHNwm5Ik8dDVui4SwEiU0h8J5GRObGayIer7twvZwjueWK1PLxWgIm75u/MHxEBksYAYvZoHtIR0vgJ5LSuTnnnXYJlg1Ctu1KTfMblHTaLIb7a8iTJ7A+6qQwVTXsAHvFzq0/av49CA9qT/29E+iftalQc/kghEJ40y6rGHAHb4xhk7JQFO8UTk2vwRdXakw9S8kZj+wIFaiNMckJlCNeuXmZ2HczlnwNkFPgmPNtpvHy+2eMYGLm2fcKG7MX+nyvSrRkBM0CPlMK4ADKxxN/3cKHGXWkwezFbmQGE2TtqEeMlzwXThNgzah19fpTKACqkK+g1OXdux7Txk26kV0EeiE4IbUZweH+Sl/V1egPR+g1B9z6OkgShMnv+TUUFmakRr00YqauRD9/hu7fL9bJV3u8g92uhP0B8wQoamKBg3RWDh9TgrvLOmHA+0qiA80XKazhTL/fxbCJ1PHejXfiXr7MVSqWbq1Wxjc3SszqyElKa9Ge0WJt5QBPYsu2NZQIeB+FuWYP19pCyyuzzWrWM0hludSojJWCNrlXTXg8DrtISr/WyWOCMG+zqU2TlB/35CqVWuft6T4y0FNzEt+83CLQFFqKB778WDJ83y1+labbe0DHjy3OTIx7FtkTecESqKUB2FdQxOhMJH1pK/IYw1cs26yUv5RSZ2HOyxS43hLxXBMqbN8z7bFhHijxLS0ox4LlFH5SbCRTCtOpbJHjyownlE6VRMm9H3aiMDBsGGuKCCmVtLnRqMOV+CFjN6s15auSHuHYz7DrFSI7bsv19g26iBTb597JUCMaAivzi+1WhU4ESaPNtXuhlkh4NJKeRHVpsirsBmewTYrW1UGVS3mWLSV9bDhcNxlRlbbKMLHh4PVnboezM85xv+4WJ1wYJlS2Zj2NHo6rw3t3t+fpUsxmpgJnD3fKpbBBMlxqH52sDWfBGRxbRFZcxKtc4ufPTOjrZ2+4Yfay+h/Uo1H1lYf7b30dFO2sOPh6PzqQLAz/AXoVVWBbAylPhkP7jjb3HsIILJ4AcyHzw+TA1OFcbdxoHatCYfZntMbNPzW6JGjI8KImcKsVCcSK9YnaI69VXNMXXdNXb8TEJeMaArkgE/Tq1YNsTYZUIY+TBUWSU1YJ+a6mnDwsilzQwwkHCP0OAkhBenk6TVAFRdHXsOhlqqwmOqIzGfmLmjCI6FHyf/aCkSfv3rz77Mndhy+fRd1oaHJ0NAx3ccw0on/E550TQpMBlG619TTqydKA/e5m1o53LYRhb2p3SzH3wOKgByw33lRjDBd6wwy8jaWyB2qduS6fCUWrFkFdudJh+PzZnw0ig6RbPdHTiBZLA/a7mw1L+PuTJfFiS6wuf3xlxgPestomKywUegvNuo2l2sfDvkAm5QFWuxdBnTnTLf9wd2VsEBkk3eqJnka0WBqw39u/ijciuVpTGIqj/4WaxYhaUd5+wGYgK38kCDR7tBZDl2D5y4Q+w5eLz458ZvnUpBsD+ViTF8ZtbKmz5QJYmxu7ePwRtB+KWxm8+xYAGUhUCS/maL7ossmnn7Krk3W2/252rmdvaX0fb7Wyt8iNHtwJcA8d9/fAfRKt/wyMECQnc2CYiaiQncMgEXySxcoIDEXF1gHI15I7wVACPz8abhtNgI/A0d35VPAQoaNdxIgVw+9YlptbXwZJcAaOH1CPNBStVUgn0IsFoR2Y3cVrtt+yR8nGrOZGvjqd5x1Nl3o05w/IMvKubcwHKVXI3i+2h/7I+xwEGQ76PcaQMCJf+UYkEjjeSIBB3+L6VJwkc0LpjT1sqnbTnAmYVChE4HxO/f223ePuu2SYLAaSNc2NPC/TmKQtyzbEtBxvJKBBr/fzPcbxdRnq/+wXU/V7t/BymSCF8g59aHLN8GJ7X7zfk5RhKEW66cCdzZb3/E7Guh4TcbIcO4Mk6O390UuE3Dt3jPbf2dlU/Szmx8skKZSz6H+4qIIBmnSTbsZ7CZ7/GOXcit424aIoybnND4/jEo4J6nVzHlhFhQoR9ic0+ReepfCMvh3YXByfRe0XmHQZIxmN5C6bhbuqSNFoh2RhudyCOYJ6gCao99JSOam1sVKEha+ssdpf/VHUSLUmQI3hcrGQWWQKZXO4k8mOERMhUq+y5ZpOTjca0ySds6kgaXTK9VlE1ojy8GV7QFQxtj/1Jx+c5VwmE1/uiq+/XTMsPeX5/BiZ9j+ldEMBXrp8b3oL9y2brY75kABhOfY/BYSK5jyG2S8/UOzeF1/zEPQr+IZmBmrz/kbzLMtOIdH7fmdPwWtPfSrllp4m2QP52Tj8RI1tgUfcMpGssQPFY05wo4ba4AG3TFV34aCKeT+EYJTNstl4n7hiPEFuYT6/fbjexw9fH+ML3cSJoca+Pzk3lqZ9S3lm7cx6z57Ze/IvdICTUHPel/tma0l/pbX3TAXeVtnvDbiWPUfxhV7i5N+AXc9495Uz4+n5j0CwL8C8+OzZA/k6p1pY6t6Mh7wBPiY132vRqpSanjObns7i3cWFJp4udT1+Ord35UDfXlPy6GE8Dyxu6ta9Td67977tDYRoJ/CW+8NotcJF3lkvtpK+NpGaeO7ky2XuUnZaw3/tIazInCHXqb1N/v//k+/7bh/txqXv29PRaoWLFcKKZ4tPiFs/GjnfRmoVIrvN2lNrcS/Lyce7+dHEvbdPfIlxe8Q70VDgHrh4gjY/mvj/4VNmWLFH5YHPw/wPLvbZhc6uDtSsgQvNrh66h5sLza72d0KVp1ysgtneRNsAfgbRrnuuP4Ow297r5n8PnvwclI1cd2Gw7p//gcmETMgizi2WL1+/2HlwGIQvvElOEZzw1nkhZWNQPwlDgQGasBYRmMuK3PuTe/rf32tLYPzzcW8MFFtTIE32P3gYh+bFKPUVCjEil+FnArmhyYPKAeHMg++5X3zjcfG6D3r59y8+faL5QZ/1QFpEknbGfS12p3btFqRzL5yCL/GXLxx1H6bunIf5Bi1omcOAtemBTwv89Il93becThMchdUFR6jJd/IxfLmSZQ4D3jdQxL4kloplRs5MLD+IUhwfCt7QTsekMM5HRHwIiAuhVivOlDYRYQwDYzSnSBhrtMXm0p0OuUCM4iD7cfEGllVFCDBJRfACwgYXiKwhpdn0duj4hPipsl9QIsR19HWMQA1nkC8854FE50S6R5J24I1F4F2YyMdUzHNN5khactpZaIN3VvqiGOP6lLAQEthH5BNmIWrPUzYhk9aDMAqzOi62rCwBaFE1Fhh1HgjXox0XSfcxidPZLYRCTPB2GYuCyZFzPi1MLLVi4zhvnL0RcljXMHQ4jzIJrsN+2ahIPqoSG9lI+nVcS3Jjm8kKPUzAcGWekwBWtJCi5oJgTDGuOxoUJHXKzKMkCrhFVRvgrHOJbrU7yr4ReneSYMc840N6yNGgoAvsrE9xHcfW8HFC1NbchiS83TLXqHnSV5FfsHWxLtbz7hNEGCo3dMQ/wFKoRKN0i/g5jrGXaefjI6JOhwu+3+aLYxQvWzRQNMXlUCgAFVOEuu3glA1fcE6Cu4RTjJ4WnjDZyIB8NRrwtVOahz4jvBoYTddJ5ooKQVF4tG4aTXspOHJ8hZIWemOwtJ8FD3GafHQExccv2dA7dffDS3DscCTlcr3mpUpdZnZvhYYn1TQkbniJVcw1TUb6IyIbN7HQv0niWbZ2x6vRM7W0SrXxV8Mv7W5WSpBxmp5OIU7XTUN3GGUcdjoQhXOcq0ppP/UvTSY+OYH8zf9+7qLtm6d//48eTqU8OvLHSk1A73Yo2NGHBoRuedqCoamiYWu1YSQcu12TRLF2kVDiH2Q5asNs/vpgmMidckPVOTXw6T8UonF0ZcpZjZzRy36NRIgSzN+JlILSl7h2BWs+VrQPcLRAiFBMs7RxTOtLjylBmH7tALqpSWTyNt7s1PWPkNvXaQLK3ic+wN9HovDhEjrjQdGNo4JNwOTAYCRJnaCdXKNB4nOpILlWVPYPLKRodJyqE6BqXJ+uv4Yygxuwcm44v5OwGHL6GAwyzp426afTDWEZH5JJi/TszwxQb52UXHm4ephLO1AFtlnxhjQaQ5y+P0AddB01450j8loHx6SaDA0vvnf5wKqkfM0PB/IrgexAxUrKH5eqZZfL92HvK60eIMGGqwO/EGHyWNBagvAvhsa7cIJQrT62Wp9ZX0+xUhY1GSMqgxwBrili1Y6Ohv40GtYeD9dNxJx6PHMZfCE1E53tZe+1q8fkauImg1ubj2fW89TqZ3PkD9L1lBoalbhfqtY/v7TEPrEMeECBlTSP+jOV9iU8SMWR9C7qDsnxdFOLv7rP9QmPRIW1srCNGFY9XSSB9uF3m9bTljVJ1XwxqNnh2f1SHNn6yDXRnALDFLVmwokc5hgVQQvdhEICW5jo+2UEhkbYhQnr5zQAmu26kIkoQ2EwFIO17IAxeECFjYC5iXVDwzEwVtD1bF8YZmtYE64BWOetSfe2FxEN2PTajfoad6kwnNViIVsNFciCYhdXFQm8EYwV4eK1QYZ3DgQ8gf+7Dk5B2xBUXOQXBvGRqSN0FmclXcpagrf6blMbqaRSStpmzxkBJq52NNAtgVYZsFw/BnFE50BKwTAw7qmva10EzIS0KUuI8ZlF2eszKjQIIsNTKcUmhg2/NTCRgT4TC0adTghMukhKFZPWbrywGY+5tyvR2MJQVCgMfXCpMigL2DNxxQFHvNWvQF6AGteeZK+tVyKFah/d8ZAJeLLmhOIMP5KZCk08J7fpYq1pkm+HIG9Ydp6sshlX/AQsmc3O/a5dsBTKzaM3cDuEN9pkYqoCkkj1fQXD5VXL65l/cAmv8HakEVxRg8+rjUZlo5NHrvjz755EnQg7F689AZcFcYB+nI4CFAaoJ0y7x9zHj5fLM4lq9dEFpXdazGbo0MIiBRnUIXGncuvX+gRxcsr/2muTk2v5VuvhOcYPUg4HHPgKVkIKUklwgNVCNtPPOuRMSCZi46wLjM4g3M4GVHmWiJrjFtkmCAiQCJEqlSIQ6fvLu+D7trO3LFPpKE3qQ0SFHJC61vdcdvcAdMY2ZSTBjB2Jhnzaan4Sz+fjRKi89O2LZLEFrZ3XhInTgAW9hRxKzzlwqCTm90GFyQJbOQbTYIldQ9B6VcH0q5ZVJe6rlmSKVY+Af7V3KcEbLweYByjnvZMwMQETkTLIL0UUwX9GEMklkN7NEcFf+aVZIInl6leJNMJ8W1Mo06/waMxoz39Be28Zu1ZBmloXzWMs9PA/C17kYS2WEVM782EB9x1/dVna//aKRjYr2rzdC9en8YgmDLW/Vcmi4WuoMgpML8Osyaua733bBYgqVKGg3kcIReJ1NyBSDkofaZh2RajUyRXIYiGeNbZx/HZolFTxP/RNK+zfpoEhPukHbL3omdrX35g5cdAhRqDKKFEMCLADPbZ6vfcKRyFdgSHYkm6Gh8V6m3O1Uify49qf51lRVrfowLBq1RNp2uQcp5VfcYcATvm129CmxO87RD2Mjl4dfD7PDIoxDMmL/bZYeRTH2enZk7uzp+SjMQ0h2TsiQKWk9kAQbBsz1hWtAREYaKl8FvWCurgTDbbJHKrqJmutdcAEr+vhRztDF1zJBYPvSEoSzQhKzpiuQOQwNEfAk541bqcAYUJWhkDmpJUUOEBqWqXxNknBCAup4ozsyhEvs5nsRyVUPUCGq6dPnxkYVVKNOZ7GmItS6gRYalXbNM2CfTQ1O/DouJO/oJeB3U/Xy0MwZDXI2hvvijHNi+WQBwiTkiFQ9nM4MClnu1pHGfccwebC3a+XV7xzNdUCGMXFRGBgCbnmKoLQaqN89Orp029O+h57WbwiXiUyv6EQUl0Eeb2yAFCEO1JC+lO6SRZNovm7o1IdzeNC4jMMz0OgmyTefAyonQW/uwPieud5jtaKIoymC8zNQLPMC0r5pekTjwlephOPZJwKZ3cYHOYlXz/kvKEMP+S1OK+RPI74LnKz9MJebjJWNPx4jolc/Dhl4BYpzwecstIGNSFDWFhzkI2GbzyPKhnXcZWGtGn7hy/3z0tQkQVa4CJ9mDTdA9MyF//xCBYsE9YPhagw7j7o0/XKAkFk6sfi0InH1Zm5vskE6KbxYs9xiRcpWblPKoZzXnCVBXpCjrCMo0fj5cb/jYY2prp0qViGyOvDp/99dEnVkA5ZiiBIrSGsbR3DuPa3Z1YmhjDYh+0vgyUDdqaMTURko/hsUmtoQD6Gm2Cvud6yrXRfCnlW+SQWIRkpj5oIUHEeEiKM1aYgnDdWhZwQim3PKbJ3Z0eY1KZkd/+eUrSKPs0u0w4HRuWNdU5mITdJNIDKe5ZH79y21NYv63mpb960+pjljlyVeSAHPQlKLWPRCTG3sZwO2rBfIDqsRnoc+fGSXowO3p/xmtTgR5c9RsBQ5M9o3hLPQm4zZqwbr2GSfOg7PoL9Ks+LhfuOP0TfnXm3NBngoMdeyotsq2NsGSdqOmj85v3PYTUKnh/SS8uL4SqvNNWmuOqx7mzv6St6aXr0UNl1PhhbeqlL5N0Jgs4wviONb4KHI0p7w8HpckWMTs8R0bXtG11PcCEYUsDA4hMapBuuCmuLXEnqI5IkKQ9JtmVkUVjrKNnLZTiYCrnsOnO3Dt3+WcMvp47Gn0byineIQsqK8P34QsbppC+c9p/Thwb90/WcoFxMxrntu1o+dNqRJMIqMBPMe+ersaf0rne8nndWG58k25PuvmHppK2KuUKuM0VXDAs3KnzVGKNTHqI/nzXqfBbmJ1jE14FteyQpuHo8upAQ7Y2FB1UNfTYzPmGWFJtft5dScd535suEydpcZ51oXcZ87CvufKwxi3Ncz7uotEsob/+//8joyJwURSlEqm/YhhfgFrPNTZAClzyely/ZP4ScPopkJjocOThNam7nnwFbVhydpF86CKrxyRVEYTIldzs77jd5ixCl8+lp5Bpab/N1CtgGa1tLOun2NPnLEaWHqqvIU+ivjh66gEOwGs4Hm3Hu67EMgszM48bKGMREcnMBCitkv+rFf9c+0NyfADYHofzkUz0E3JdxknacrWVnxdkVoC3X5bP42eXm6LJ4fROYcgbt42AG0ArvYOk5u7Cmc7TIxh9A88Er1tnuGwBeGnwRSy7AKbih+d1xxCu4qyJ+u7DrbW79sNFf++HFSdxrLK447PEqcIro9rTvTu3S14vk1mr43Yt/4i18cXNfPtoAURFdnXvanXXYT4v8oNdgGD4bkj/tLWHpsDAtWG1jZCql0zCcYJrMl8RPiWPhMEYYE7SSILL2beM5Wrd5UOEkdDn+SKaU3pIZn6h4B5G9vi0/rq1sx3ZenIPjcL36iAb68923KVsebw5NiWiNc8UHs+LPPF08nWOD9yh5KbfiOVnO+M3iXV6tjT9IsHZTe+x2bfftLbsypVAKZZkeDMLWAtaVVJdLuhKz2S2wsi8AfOHqwfq/TqXn8FOOIdBet3ii/uezfPEQ8JcALvBroV+JtTg6PKXX8spz04A+RNfa5gx2gf7XypMpDOnS+g73wSSX2X9Zefe6hLUhXg6kwxe0XgaqKuhXmbyQSzgu/OZW/NcuuUWDBWCFefBtzMv1997Ce2bXOgv67VgjIBFQ+G/i23+J/6+Nj93AR9deqK1pe0qDrxMasbU6qeEpC3yd26ew55e+XcNTvoqvc/My/s9rv9y7G2rFm2C1BnsKZM/5Agjh5BhgxxnRH08L7SNhH7iCePQ24O76yHBXN9A8k48APY0n7wUh8/Pp3Yx/r7f609DDSghARNQTNWR29BsUW4Faw4hEP8TFZU7hj7AEXB58aXvxBF5QbBu33GOcKSliab3IRp+N9Oz64NF78KI2B4cvngmpKEuCibcMtgCucvn/kZ/hmShWTG1q0xsNDOWJuRl5UNUUJzXWO48R/NlIN64fPjibHD3tNp/8++O/CPVhuIhS3UU/OM/l34O5wVGSWuF6ddb1Oq2mGtF5tOMh01KS2lyde8j31mUQMqEQPl349vsnlIJtndvFJcB+Cc70NC6u/T9Y/Tc439c4uf2fSlhcxHn8zqFr1BDyiZqcl1VEKWkND1rRARwvqpwKNm6wPHanLxECC/2uotng3qPTCJV7e9R6/Vzp6Awjhjq4QfX/4dowTP4yyWbamtGQ/aDyuNR6Y3RePvr3vzJAKApRptrgirK/qbUJnqbpSou4uzMPQn8d2WAYVnp+y12FLtXxzTFQHGGBhVK2mY67vRNwjNhbvMB3a3AbfA/AwyNYaXZJzhyUGekCJDEmfS2lr63sssM4uO/+6erNnyTuJMmlQZ2q0gmFAm7Hj28/HP4U8465ynoEFCkG2FSqeLqAHNjipNeCGKHwTZ3DxHFt5xHZ+nUUcyp+wXbEtvdF2GrLH3Bqxej60g97Xd50qVqitXQnt1Gfy4oKKC1uL7RbQPYNFoOYfCf/1xCNlXxPgjGWm112vPD4QC7LF4Z62p1IjB7zlj4/HguWqu1qwmlylqYOTU1skHhCj6+FOqk3ne/fm53Y2OmUQiwmlAVy25omdwOrN9s3O3Nn9oCxYhvuTd4k2qIf7fLNm9cvnjtz6sy5awP9x/rtuwjmbuQdrudae2/xvinL/0sKuWF3PFOR8al8ramFTDe8MTlgrNgle3fPkry/i+Jgeb4lXwIb4PKp1qEKhpD/PeqwRW12895K5a2irnl23JqZTGDbQauiqZTRBN+skk8heS2EbbRaRukjbQlRp00wjJnCMJ9C8kHLGq++5c2pGJs4ReEwN6tmDNvkhvkUTn86CLa+kViqEzjfj2aziLlci3ZRl14yawmdUHDFBbXQN9ioJS4fi1VRdyxYVzVjmRLazxCv2NR2hliLmLNGqZuXo07yYVdxa6+aVVOTAtrhBOKeiLFBtloRK17spGmvKRVUQsLxjyHOx+E33LwaLXpVxTc1OUaxW9k1IHLWxdgUo2QgjcgXLEAj5WcyriOGgWNEQ822S5sERojIPinPN8gkBS62XHeieLUGotCEmS29k6LYnIHqOYwQMozhgfa11lA2RN2IT5njmKB4qAd+9eVL6wF7TLSc44SqZNvJikI0Nw6IHuXQjJ7D9IJR0hFiLsi8ZJKuhcAoTWMo63a/JJmOEff44xZJUABMPtHscLjKti9bNtaaDkS/821GCiBXeSko7ZYCrEPiHS1bYbowFpP1eeT2q7Qn0xHJIlG9gWFgsdWXnKgi2dpGPEuO70KLwI4BdWQPBka7/Yfvjb4ydBNG6Rl0DQFCfg+fuFyUm3DyEFLOjNtNhOdM5tEy+btpOhAiXD7UA/cSt0D3Og9Dmh5WVA+1hmMLxaVgneFHkVYocga+9/9ntYqtHy8x7iIVd7RwiJAQDodtZu5no0yVZd20bZO5CDczib0bVrEPIWYkGXW4fZBXuQYhshzHalwzzM0KkeXZAgwpiDFlQ3HhxJ5A3/Wi3NGw88rXHDYkQiGqVORV7Qolo7tOlSsqn9BsdKBAZFgGwpgZ69pVQVZ003KTnMhWFpvNeyhzG0KSdpWWSgqVU+hz69KPEHK8wHNwHu3atoF0w/bDpJwShYisNpKhjPdJudpKraR5Vyg8pGb5/uN9XbvdQGznN5C08Xu/gTDDKqImag1+4tiI450TzApnGLcZdoZLLdigrzTvcD1bhvBt2uxdg9SMAVMKX2iPYg8Z4dJyLuI4SnJ65Crim+t7f0Twad0ygeaMw3Ak/S4KWXSvqFBSFHKWyURWS4hkbH3PRQDfQeZ+2daeL8TkPXByrJzDcGnQFk6Grf6Bh+3OXefI4i87CWfN4tc5X53li9/o5Jypi5/tVJw5YsmwzpI8GaUR7xdQjqpBFEU4bkp9SZwgPX25IrNxpJeab0BUbUKOvkmuaOUJMDEdY6rvGgzcSOMTfxtocGbC0IzF9U7AY4IkiGSM/JAR9da/E5co06J9aO7AKRKZDaRP/3c57LjYk0oDZ+AK6sLvvyRgZRC+/W4kgGt3rb6vWI2dhLe+MpnpDn6dJetzZ2cwQ6VRfHAMC0yJ7EdABq64gOcwoqvSIDjQ0672u4//qKm9/P9/2SfVXjx/3uRw/QYsTD0GobRQRjq36QAUxJ5RQ5avR3d4phO80s+MgPtkkl88rxPnV9xL+c1ScE+8sgFCM9/9pMYOy8Qo09Qdb+liNySqyZ6tkUbzTqgMRVSmS1hVwb8OqzYRNVTJDvNhrRD2dOMh9NsJQnfnPNYYd9GeTGt6KOmTctuW3461SRs4f1N4t9XDgu26tuE00lPttAjzrSDLTl3O0aYvEzZSd7l6nNBAN51tXy09ccQVAj+Fj2RaqxOb/WROFBv+BnaSheVeNh6/WLz/d/ziCtgZU1XQCWnqoXF8iGLHN5g3TtMmY4ohLDKu4M6ccc0ruQ+Oag8yzuEKaVBRTzqaFE6alQ0xE8SBZh1kqgtP4tE84Yn5CfN6EsrzWfNjDcj9OD6z8z6d6UGOTCaRl5kSMBVzturyJO+DXZ6oW8ZhE2m4tzW7ZcI0SqlpFGIIwmpbCIohezZ8Ys9NS5m8sZiXk7Dx8mZvi4N6NByemMMxKzr5VOdGO/nVVAU2m7PFPs2lkXEsk2WNMGwhA7dz3f3LKk567c/1eWqUKSQbBjmdtSIFQwy9kIKSc8ytzfOtqIO7Bdx7DPAv4st3e/nG5xPybAuIMrh9BuYTTT/jp1/7nJavt8GRAw9PQdOw6XJu2qmZRvycqakf2dxcIq96qY6bU5peKxnPg6UZzBnpKZjkjboxwgpEJoViTEILu6OfsKibh5DC1zY8UZv+jqM+mdZJJeY4GiniK++urbmmARU7ZJzZA1qw2GA+94ph03h5MoKCDC2K6C+dSxSVxxkaf7SRvc6m3YntZ7NzRYk5SXVD/R9zN7KTwENGWJAEgpOhSJLY9kbI1ufXOqYs5CyK6Devr7WYEsFlD/jTbdofwH0i4o0kvTwmUUtr37O51sGpP5BXaKBGA3Ij9F2L6FgXlWE1DcikCgo7t8WYNNZEBFeKSTvui8BbummcRaymKqeSisamd5zgaLeYzuaFgZxACvU67Zmcmr2yjAGsoLAJ4pJOp9g3cCCVbOUGQUqlkYfHQQ5bH4soWR6uz1K8wionwaQoSA8jkrrzL0HVlO/FuZQrMO2/cho/XN7cAxQo4rwmFJtOid/Op8mjvalHQipjsYd3TYv48m+9kzkf5Ot85e3xVYaxK+UBTSA7+i5MsMj8pM4fh0tA3rp/boPHvTG/7F3514HjKb/+JV/sTfGGeCPP/fpcRyaDLkHIB2+U7LAMUeFCEfcQTZ1sCVKFy23+QIe45bItuoS2eogQZ61O4V6kJDqlqFTEJa9dydEpjWoXRoks3DmDt+nSZDIeIZEyLXHN1o+5w3vNu66aziceZdJKUxtpDK9rB7GK516KPA7vGh/JGU/t5Hi7B0QF3ifKSmx0x9Vj3TGK+5lB0iqylFCu97BFTZawVKdflmnH9oNFQ3eK1C1H68eiyzguuSafRCWRCrz0yzxAJkuUJwbySzFMKpRIRLsZIjIVvbDcCHkgPpYRts/Y2HZUOmWtpH5kMXGvQyC/PbZ5/O7Uloj37GpT05iObFpPdV2LxN3hdnezGTEjWgWnOymHnkCBjBKUMF+ma7eTZMdDqEcGurMnAVLCstdqGbGlEFRHMRLG96YTcKUYzli8/alNo1nXk8byn3//4nCEJUiHgdSpb7INe6enB/9HHR7Vh7tHCruQIixvxkQwb0OU1Ss6fedmBRx+Bas2rdey9WSFh/56+affv/1N26FCUnKmYt9oR+eP7Cd/Qd/iYJw5TfmnJ06krytuJOwkNK28YfP3f8MOMdMWWZ++fsI1R3zCdvIiOkMFKtAe4M+OIA2sNXCcDu6EAtwoSqKRQIm5nry+U4jgIlR1NHbklN6to3e/Aifh3YJf/lF2ve3vTGc+8pdDfkSATkzIOFZ8UpswLpMXLzMeExY/zkSsvLQ8qyy+wNA3TTGQbbPOM33D+PN6jB575QO/uzrwcH8InJ/Kx3LgbwJhTTEhJspwCDlGSy6mnbUYGzPhdcYIQlo1qTjpkhZGSgJFJ2TOPQZU1BIeJC+EzlG4YUy6mJdlhFwVrbvbrqFiKq09dOhYm0TUAKEo6uaqEQzUHW/7XOFtuY3/v7XO3Npts82GD5STiJKxqQxKlUOEXojGPhjKJVQcP4l4vh0NoHTfL0sO2kGxVO9OaC00BFHU33obvOse8LUNvQFnJOec672Qo4nj2G5Isji+ZodKL/6dx6RUGIZp9m8FzNOnvLxS2zDwWOta79dMrvTirB1Nrt+R+v5wETjOklrJnHsFMj4vWK33a+ZVenFJRZdUvmfQ6+EioM5I/wAPxP8GCV3qWu9XTWGviBfFi7bsh/5rMK4DzAlVNs+G1zoSn+WEgLdmmTncRxSVR7Zp2vv7zWYfvm5J0KS7o7XRBAamYmmyrreIKCMlaRfiXwgwooxiKpjQnRBCZd+ePRrBrc0ezcA0rrGdxmqU9uqtUZihqoNTFo8NhDRsZFCqEEVpGn7TUy734URLgDLPqsqM7ZYpGpetPh6hGm91kqSZiql1AXwERIGFC9qJjgqhsr9qPJpo33QrWRysbkvo1lbLHk81RhltmTY4ZZnuOkg3dDzKgklSFPEPkUajD+fa4BePGtVGT+K9UFxjUYuTCa06X8dE9UxOrfPgAiCmQ+AFR4VQHey/G7+g8/aRkArZWdsFICDwHv8U868ThAqZMfa+C2wzX/wfc40s7LH00wR45F+767QGFhNRHruMXk3pvN+iphR5qxgODJZ0CcsquIWOGZGxeixzYSWvci8IufqNqdJQIkkm6nMRZdBxbzhaQQh0dCdd3Gl77+QFYzNR6aK/6cdTG02pnDPN5zLpoyhpvvrmUgzM7u736q20VoKzsPpJQcqSzYt50Vn3+OWUTtDcM93TJkSkkxsVJe1dYi7cxOrNJBb0TiZI61cWIWBhGLnk09EhZXxuTu0oWFTazuCHaDMkgBmsKjuNJnk1hqy74HhE3823EdUT7u751IXUh6Cjw4g/p+bMXhsu3aP3g2w0IU0V2MGqNLN4PzvZxmLLTyayGm5eVMFYialxLrU+Id6OR/EwIACTv2v8mZcbTDD+y+f8JQB4fIxnMwDgyfmrXxa/H1FCw0cARAwAEPwB5pEThR0W3cx/4OUC/Pv1s4xIqDZj11ptfQB2oWAtFsVwr7Ta/wWUrslNANdzRJTPlWVSgZ1PIqkCMMLbQ7BIrqatqMNX6DJOk9r3xMKC4O5SXP3u2SUmrM3KIRsxrtU0uZrvxnIAuLP/8IAKEABXqxih1Or5DL3dpQSq88EboodVTLFjq/uLF6bpNiIXN8UTZ771R3BE3mJKRqKwBbj/wOAKMdldrRcZhkHMOKeMOw/QrZyC4VoLi6jmkGvAWsuYR03THMKqzsJMO1VmUQYHGDfGXuoy01Wvdg9Zs+0PIXIG5J5Uv8Vqc0RyPsOkWik4C9kw7FSM/Ibkph0uHT1OpESNLQnsND0mTSJGt+5a1pJyt8pLXpGcV4Tyxc1qYxFVjzEqfyO4JiIaWZTRphImS9Jts9CtSCjcfTGYKlOAaNsYq7HiAOBO4lh9mnqoUDRlB3vxUDgbokrzuSsFIKC4urZV8CjClQYQ5kpLuYfubAR8sB1UUmNWU8tkZaugYjKVNbA3nl1+hoqx5R8YqwVjFdPVNEqARuAFMaACaToG4Obc5TWhJYk1qaPy7gAwh5q7Ggjgp6ZGKWn4DpZnamsz+5MYGjQA/oLYR5IMfIwhcT6uesw+lcJs8gm8M3COKDc/DEaArhJ8BFuZfQxyVbZwTRKpdum6PgGmqvWJUFdPnwRLzQNqevIOaSDXfAWatZiuTZ0atTpQhQHV3Rf8Qo/W3plDlZfaXr/XbNKuuShT1U3XonmbBngNVCHMqZqiafJ9ppk3mxqV39Ms6dSh3jzj7SJKjzh6y2CXXkBAYdo43mlWEDsQ1dggpjiqRpOqDfGO9a+T2KfjwogcHSpy+v3n0VJEIpb47LmVphwtmMshGU0hfK2DQcNpVbPqRUQ4B/Y+mTLFmq5rV7eZ6X1udW3EL1nQyNE4rofn+DNhSUCVSm12alTMaNxp16yhkYkyedlO93SeK3fXyYsEQKecJsPwiyzeLE3y9691SPH11/g4AAAA) format("woff2");font-weight:200 800;font-style:normal;font-display:swap}\n:root{\n  --bg:#F7F7F4; --surface:#FFFFFF; --ink:#1E1B17; --muted:#5C564E; --line:#E3DED4; --fill:#EFECE5;\n  --accent:#AD371D; --accent-ink:#FFFFFF; --accent-soft:#F2EAE5; --tab-line:#928E87;\n  --danger:#B3261E; --sample:#8a5a12;\n  /* Data colours: ink family and ochre/brown, never the accent, green or red. */\n  --c1:#3E3830; --c2:#B7862C; --c3:#8A6E55; --c4:#968B7C; --hatch:rgba(255,255,255,.6);\n  --sans:"Atkinson Hyperlegible Next",system-ui,sans-serif;\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;\n  color-scheme:light;\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){\n  --bg:#131210; --surface:#24221E; --ink:#F1EEE8; --muted:#B2ACA2; --line:#383530; --fill:#33302B;\n  --accent:#FF8A65; --accent-ink:#000000; --accent-soft:#3D281F; --tab-line:#77736D;\n  --danger:#FF453A; --sample:#E0B56A;\n  --c1:#E6DFD3; --c2:#D9A441; --c3:#B08F72; --c4:#7D7469; --hatch:rgba(19,18,16,.6); color-scheme:dark}}\n:root[data-theme="dark"]{\n  --bg:#131210; --surface:#24221E; --ink:#F1EEE8; --muted:#B2ACA2; --line:#383530; --fill:#33302B;\n  --accent:#FF8A65; --accent-ink:#000000; --accent-soft:#3D281F; --tab-line:#77736D;\n  --danger:#FF453A; --sample:#E0B56A;\n  --c1:#E6DFD3; --c2:#D9A441; --c3:#B08F72; --c4:#7D7469; --hatch:rgba(19,18,16,.6); color-scheme:dark}\n/* High contrast (section 3): muted to 7:1, line to 4.5:1, accent mixed 30% toward ink.\n   Dark (#108): surface #24221E and fill #33302B step lighter than bg by tone, not shadow; HC dark muted\n   #C6C0B6 keeps 7:1 on both (8.78 on surface, 7.27 on fill; QA-R1). */\n@media (prefers-contrast:more){:root{--muted:#534D46; --line:#75716A; --accent:#822F1B; --accent-soft:#EFE9E5}}\n@media (prefers-contrast:more) and (prefers-color-scheme:dark){:root:not([data-theme="light"]){--muted:#C6C0B6; --line:#807D78; --accent:#FBA88C; --accent-soft:#3D2D26}}\n@media (prefers-contrast:more){:root[data-theme="dark"]{--muted:#C6C0B6; --line:#807D78; --accent:#FBA88C; --accent-soft:#3D2D26}}\n*{box-sizing:border-box}\n[hidden]{display:none!important}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:22px;font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%}\nmain :where(h1,h2,h3,p,ul,ol,pre,figure,table,caption){margin:0;padding:0}\nmain :where(button,input,select,textarea){margin:0}\nb,strong,th{font-weight:600}\n.wrap{max-width:960px;margin:0 auto;padding-top:24px;padding-bottom:32px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:24px;position:relative}\na{color:var(--accent);text-underline-offset:3px}\n:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\nheader.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;min-height:32px}\n.brand{font-weight:600;font-size:17px}\n.pill{font-size:17px;line-height:22px;border:1px solid var(--tab-line);border-radius:999px;padding:4px 12px;color:var(--ink)}\n.pill.sample{border-color:var(--sample);color:var(--sample)}\n.intro{display:flex;flex-direction:column;gap:8px}\nh1{font-size:22px;line-height:28px;font-weight:600;text-wrap:balance}\n.lede{max-width:60ch;color:var(--ink)}\n.privacy{display:flex;gap:8px;align-items:flex-start}\n.privacy svg{flex:none;width:16px;height:16px;margin-top:4px;color:var(--ink)}\n.privacy b{font-weight:600}\nh2{font-size:22px;line-height:28px;font-weight:600;text-wrap:balance}\nh3{font-size:17px;line-height:22px;font-weight:600}\ncode,kbd,pre{font-family:var(--mono);font-size:1em}\nkbd{border:1px solid var(--tab-line);border-radius:4px;padding:0 4px}\n.muted{color:var(--muted)}\n/* Tabs: at the top of the page, not the bottom (see the template note). One rule under the row. */\n.tabs{display:flex;gap:4px;border-bottom:1px solid var(--tab-line);position:sticky;top:0;z-index:2;background:var(--bg);overflow-x:auto;scrollbar-width:none}\n.tabs::-webkit-scrollbar{display:none}\n.tabs [role=tab]{flex:none;font:inherit;font-weight:500;min-height:48px;min-width:48px;padding:0 12px;border:0;border-radius:0;background:transparent;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}\n.tabs [role=tab]:hover{color:var(--accent)}\n.tabs [role=tab][aria-selected="true"]{color:var(--accent);font-weight:600;box-shadow:inset 0 -2px 0 var(--accent)}\n.tabs [role=tab]:focus-visible{outline-offset:-2px}\n@media (max-width:599px){.tabs{gap:0;justify-content:space-between}.tabs [role=tab]{padding:0 4px}.thumb{width:72px}}\n/* Under 375px the five tabs can overflow: fade the right edge so the row reads as scrollable (UX-R62). */\n@media (max-width:374px){.tabs{padding-right:24px;scroll-padding-right:24px;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent)}.tabs [role=tab]{padding:0 4px}}\n/* An unselected panel stays laid out (charts keep their size) but is invisible, unfocusable and takes no space. */\n[role=tabpanel]{display:flex;flex-direction:column;gap:24px;min-width:0}\n[role=tabpanel][hidden]{display:flex!important;visibility:hidden;position:absolute;top:0;left:max(16px,env(safe-area-inset-left,0px));right:max(16px,env(safe-area-inset-right,0px));height:0;overflow:hidden;padding:0;border:0}\nsection,.block{display:flex;flex-direction:column;gap:16px;min-width:0}\n.block>p,.explain{max-width:65ch}\n/* Controls (section 6): secondary ink on fill, tinted accent on accentSoft, primary filled accent. 48px. */\nmain button,.btn{font:inherit;font-weight:600;min-height:48px;min-width:48px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;padding:12px 16px;background:var(--fill);color:var(--ink);cursor:pointer;text-align:center}\nmain button:hover,.btn:hover{box-shadow:inset 0 0 0 2px var(--tab-line)}\n.vh:focus-visible+.btn{outline:2px solid var(--accent);outline-offset:2px}\n.primary{background:var(--accent);color:var(--accent-ink)}\nmain button.primary:hover,.btn.primary:hover{box-shadow:none;text-decoration:underline;text-underline-offset:3px}\n.tinted{background:var(--accent-soft);color:var(--accent)}\n.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\n/* Visually hidden but still focusable, so the styled label stays reachable by keyboard. */\n.vh{position:absolute;width:1px;height:1px;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\n/* Segmented choices (time window, appearance): picked = accent outline and word, never colour alone. */\n.seg{align-self:flex-start;display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--fill);border-radius:999px}\n.seg button{background:transparent;padding:12px 16px;font-weight:500}\n.seg button[aria-pressed="true"]{background:var(--surface);color:var(--accent);font-weight:600;box-shadow:inset 0 0 0 2px var(--accent)}\n/* Overview: a settings-style grouped list. Each row is one whole tap target into its detail. */\n.ov{display:flex;flex-direction:column;gap:24px}\n.group{display:flex;flex-direction:column;gap:8px}\n.group-title{color:var(--muted);padding:0 16px}\n.list{background:var(--surface);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}\n.row{display:flex;align-items:center;gap:16px;min-height:48px;padding:16px;color:var(--ink);text-decoration:none;position:relative}\n.row+.row{box-shadow:inset 0 1px 0 var(--line)}\n.row:hover{background:var(--accent-soft)}\n.row:hover .row-title{color:var(--accent)}\n.row:focus-visible{outline-offset:-2px;border-radius:12px}\n.row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}\n.row-title{font-weight:600}\n.row-value{font-size:34px;line-height:40px;font-weight:600}\n.row-value small{font-size:17px;font-weight:500}\n.row-text{color:var(--ink)}\n.row-detail{color:var(--muted)}\n.row .range-track{margin:8px 0 4px;max-width:360px}\n.chev{flex:none;width:12px;height:12px;color:var(--accent)}\n.thumb{flex:none;width:96px;height:auto;border-radius:4px;box-shadow:0 0 0 1px var(--line)}\n.back{display:inline-flex;align-items:center;gap:8px;min-height:48px;min-width:48px;align-self:flex-start;font-weight:600;text-decoration:none}\n.back svg{width:12px;height:12px}\n/* The statement in the Electricity tab: amount, plausible range, window. On the page, not in a box. */\n.hero{display:flex;flex-direction:column;gap:16px;padding-bottom:24px;border-bottom:1px solid var(--line)}\n.eyebrow{color:var(--muted)}\n.bill-main{display:flex;flex-direction:column;gap:16px}\n.big{font-weight:600;font-size:34px;line-height:40px}\n.big small{font-size:22px;font-weight:500;margin-left:8px}\n.range{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:480px}\n.range-track{position:relative;display:block;height:8px;border-radius:999px;background:var(--line);margin:8px 0}\n.range-track::before,.range-track::after{content:"";position:absolute;top:-4px;width:2px;height:16px;background:var(--ink)}\n.range-track::before{left:0}\n.range-track::after{right:0}\n.range-dot{position:absolute;top:50%;width:16px;height:16px;border-radius:999px;background:var(--ink);box-shadow:0 0 0 4px var(--bg);transform:translate(-50%,-50%)}\n.row .range-dot{box-shadow:0 0 0 4px var(--surface)}\n.range-ends{display:flex;justify-content:space-between;align-items:baseline;gap:8px}\n@media (min-width:720px){.bill-main{display:grid;grid-template-columns:auto minmax(0,1fr);gap:32px;align-items:end}.range{padding-bottom:4px}}\n.meta{color:var(--muted)}\n#hero-meta span{white-space:nowrap}\n.whatif-flag{color:var(--sample)}\n/* Charts draw at their real width, so every label is 17px on screen. */\n.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px}\n.chart{width:100%;height:auto;display:block;overflow:visible}\n.chart text{fill:var(--muted);font-family:var(--sans);font-size:17px}\n.legend{display:flex;flex-wrap:wrap;gap:4px 16px}\n.legend i{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:8px}\n/* Line items, like a bill: name and amount, a bar, then the range. Rules between, no boxes. */\n.rank{display:flex;flex-direction:column;gap:12px;list-style:none}\n.rank li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding-bottom:12px;border-bottom:1px solid var(--line)}\n.rank li:last-child{border-bottom:0;padding-bottom:0}\n.rank .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.rank .val{text-align:right}\n.rank .val b{font-weight:600}\n.rank .bar{align-self:center;height:8px;background:var(--line);border-radius:999px;overflow:hidden}\n.rank .bar span{display:block;height:100%;background:var(--c1)}\n.rank .rng{text-align:right;white-space:nowrap}\n.drives{display:flex;flex-direction:column;gap:16px;padding-top:24px;border-top:1px solid var(--line);scroll-margin-top:64px}\n/* Disclosures: a 48px row with a chevron that turns when open. Closed content takes no space. */\n.disclose{cursor:pointer;min-height:48px;display:flex;align-items:center;gap:8px;color:var(--ink);list-style:none;border-radius:12px}\n.disclose::-webkit-details-marker{display:none}\n.disclose::before{content:"";width:8px;height:8px;border-right:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(-45deg);flex:none;margin-right:4px}\ndetails[open]>.disclose::before{transform:rotate(45deg)}\ndetails:not([open])>:not(summary){display:none}\n.disclose:hover{color:var(--accent)}\ndetails>*+*{margin-top:8px}\n@media (prefers-reduced-motion:no-preference){.disclose::before{transition:transform .15s ease}.rank .bar span{transition:width .3s ease}}\n/* "What if?" cache-read slider (M2.6.5): a what-if view, never the published estimate. */\n.whatif{display:flex;flex-direction:column;gap:8px;max-width:65ch}\n.whatif-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}\n/* UX-R65: the h2 shares the row with the label and value, so the column stays as short as the token box beside it (AC-T2). */\n.whatif-pick{display:flex;align-items:baseline;gap:12px}\n.whatif-head label{font-weight:600}\n.whatif output{font-weight:600;font-size:22px;line-height:28px}\n.whatif input[type=range]{width:100%;height:48px;accent-color:var(--accent);cursor:pointer;background:transparent}\n.whatif-scale{display:flex;justify-content:space-between;font-size:17px;color:var(--muted);margin-top:-8px;position:relative}\n/* The "published" tick sits where the published value is on the track (thumb is about 16px wide). */\n.whatif-scale .mark{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}\n.whatif-scale .mark::before{content:"";position:absolute;left:50%;top:-8px;height:4px;border-left:1px solid var(--muted)}\n.whatif-note{border-left:4px solid var(--sample);padding-left:12px}\n.whatif button{align-self:flex-start}\n.note{max-width:65ch}\n/* "Have a token count?" (EST): a total typed in, for usage with no local log. Electricity tab, beside What if on wide screens, under it on phones. */\n.manual{display:flex;flex-direction:column;gap:16px;max-width:65ch}\n.manual-fields{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}\n.manual-field{display:flex;flex-direction:column;gap:4px;min-width:0}\n.manual-field:first-child{flex:1 1 160px}\n.manual-field label{font-weight:600}\n.manual input,.manual select{font:inherit;min-height:48px;min-width:48px;width:100%;border:1px solid var(--tab-line);border-radius:12px;padding:12px;background:var(--surface);color:var(--ink)}\n.manual input::placeholder{color:var(--muted);opacity:1}\n.manual select{cursor:pointer;width:auto;padding-right:32px}\n.manual-result{display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere;text-wrap:pretty}\n.manual-result:empty{display:none}\n.manual-kwh{font-size:22px;line-height:28px}\n.manual-kwh b{font-weight:600}\n.manual-result.error{color:var(--danger);border-left:4px solid;padding-left:12px}\n/* Share */\n.card{max-width:min(100%,720px);height:auto;border-radius:12px;box-shadow:0 0 0 1px var(--line);display:block}\n/* On a phone the 1200px card\'s text shrinks, so it links to the card at full size (UX-R17). */\n.full-size{display:inline-flex;align-items:center;min-height:48px;align-self:flex-start}\n.sharetext{background:var(--fill);border-radius:12px;padding:12px;white-space:pre-wrap;font-family:var(--mono);font-size:17px}\n#post{font-family:var(--sans)}\n/* SPEC-CLOUDP: the web prompt is read, not edited, so it is set in the reading font (CLOUDP-6). */\n.prompt-text{font-family:var(--sans)}\n.status{min-height:22px}\n.status:empty{display:none}\n.status.error{color:var(--danger);border-left:4px solid;padding-left:12px}\n/* Your logs (#drop): opened from the Overview row; a drop zone on the plain page. */\n.drop{border:2px dashed var(--tab-line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px}\n.drop.over{border-color:var(--accent)}\n.export label{display:block;font-weight:600}\n.export textarea{display:block;font-family:var(--mono);font-size:17px;width:100%;border:1px solid var(--tab-line);border-radius:12px;padding:12px;background:var(--fill);color:var(--ink)}\n/* Method table */\n.tablewrap{overflow-x:auto}\ntable{border-collapse:collapse;width:100%;min-width:620px}\nth,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top}\nth{color:var(--muted);font-weight:600}\nth:first-child,td:first-child{padding-left:0}\ntd.num{white-space:nowrap}\ntr:last-child td{border-bottom:0}\ntd .note{color:var(--muted);margin-top:4px}\n.label{border:1px solid var(--tab-line);border-radius:999px;padding:0 8px;white-space:nowrap}\na.src{display:inline-flex;align-items:center;min-height:48px;min-width:48px}\n.phone-only{display:none}\n@media (max-width:600px){\n  .phone-only{display:block}\n  /* Method table: one block per parameter instead of a sideways scroll. */\n  table{min-width:0}\n  thead{display:none}\n  table,tbody,tr,td{display:block}\n  tr{padding:12px 0;border-bottom:1px solid var(--line)}\n  tr:last-child{border-bottom:0}\n  td{border:0;padding:4px 0;white-space:normal}\n  td[data-label]:not([data-label="Parameter"])::before{content:attr(data-label) " ";color:var(--muted);margin-right:8px}\n  td.num{white-space:normal}\n}\n/* Pace (M4.5): work rhythm by week, same visual language as the energy chart. Numbers, never a verdict. */\n.pace-title{display:flex;flex-direction:column;gap:4px}\n.pace-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}\n#pace-body{display:flex;flex-direction:column;gap:16px}\n.pace .agent{fill:var(--c4)}\n.legend i.agent{background:var(--c4)}\n.legend i.sofar{background-color:var(--c1);background-image:repeating-linear-gradient(-45deg,transparent 0 2px,var(--hatch) 2px 4px)}\n.pace-lead{max-width:60ch;text-wrap:pretty}\n.pace-lead b{font-weight:600}\n.pace-sofar{color:var(--muted)}\n.legend .whisker{width:2px;height:12px;border-radius:0;background:var(--ink);margin-left:4px;margin-right:8px}\n#pace-chart text.val{fill:var(--ink);font-weight:600}\ntable.vh{min-width:0}\n/* Footer: version, links, and the Light / Dark / System choice (principle 10). */\nfooter{border-top:1px solid var(--line);padding-top:24px;display:flex;flex-direction:column;gap:12px}\n#footer-version{color:var(--muted)}\nfooter .appearance{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;color:var(--ink)}\nfooter p{max-width:65ch}\n/* Studio demo bar (DEMO-BAR, pm-tools docs/DEMO-BANNER.md): playground only, in the page\'s own tokens. */\n.demo-bar{--demo-bg:var(--surface);--demo-fg:var(--ink);--demo-muted:var(--muted);--demo-line:var(--line);--demo-badge-bg:transparent;--demo-badge-fg:var(--ink);--demo-font:var(--sans);\n  background:var(--demo-bg);color:var(--demo-fg);border-bottom:1px solid var(--demo-line);font-family:var(--demo-font);font-size:14px;line-height:1.4}\n.demo-bar__row{display:flex;width:100%;box-sizing:border-box;align-items:stretch;max-width:960px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px))}\n.demo-bar__home{flex:none;display:inline-flex;align-items:center;min-height:44px;padding-right:12px;border-right:1px solid var(--demo-line);color:inherit;font-weight:600;text-decoration:none;white-space:nowrap}\n.demo-bar__home:hover{text-decoration:underline;text-underline-offset:3px}\n.demo-bar__toggle{display:flex;align-items:center;gap:10px;flex:1;min-width:0;min-height:44px;margin:0;padding:0 max(16px,env(safe-area-inset-right,0px)) 0 12px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}\n.demo-bar__toggle:hover .demo-bar__more{text-decoration:underline;text-underline-offset:3px}\n.demo-bar a:focus-visible,.demo-bar .demo-bar__toggle:focus-visible{outline:2px solid var(--demo-fg);outline-offset:-4px;border-radius:2px}\n.demo-bar__badge{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--demo-fg);background:var(--demo-badge-bg);color:var(--demo-badge-fg);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:1.3}\n.demo-bar__sum{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--demo-muted)}\n.demo-bar__long{display:none}\n@media (min-width:600px){.demo-bar__long{display:inline}}\n@media (max-width:359px){.demo-bar__sum{display:none}}\n.demo-bar__more{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-weight:600}\n.demo-bar__chev{width:10px;height:10px;transition:transform .15s}\n.demo-bar__toggle[aria-expanded="true"] .demo-bar__chev{transform:rotate(180deg)}\n@media (prefers-reduced-motion:reduce){.demo-bar__chev{transition:none}}\n.demo-bar__panel{max-width:960px;margin:0 auto;padding:4px max(16px,env(safe-area-inset-right,0px)) 16px max(16px,env(safe-area-inset-left,0px))}\n.demo-bar__panel p{margin:0 0 8px;max-width:70ch;font-size:16px;line-height:1.5;text-wrap:pretty}\n.demo-bar__actions{display:flex;flex-wrap:wrap;gap:0 20px;align-items:center}\n.demo-bar__actions a{display:inline-flex;align-items:center;min-height:44px;color:inherit;font-weight:600;text-underline-offset:3px}\n@media (max-width:719px){.range-scale{display:none}}\n@media (max-width:599px){\n  /* On a phone the lede and the privacy detail step aside so the tabs start above the fold. */\n  .lede,.privacy-more{display:none}\n  .wrap{gap:16px;padding-top:16px}\n}\n</style>\n</head>\n<body>\n<section class="demo-bar" id="demo-bar" aria-label="Demo" hidden>\n  <div class="demo-bar__row">\n    <a class="demo-bar__home" id="demo-home" href="#">\u2190 Portfolio</a>\n    <button type="button" class="demo-bar__toggle" id="demo-toggle" aria-expanded="false" aria-controls="demo-panel" aria-label="Demo details">\n      <span class="demo-bar__badge">Demo</span>\n      <span class="demo-bar__sum"><span id="demo-sum-sample">Sample data<span class="demo-bar__long"> \xB7 nothing leaves this browser</span></span><span id="demo-sum-files" hidden>Your files<span class="demo-bar__long"> \xB7 read in this browser only</span></span></span>\n      <span class="demo-bar__more">Details<svg class="demo-bar__chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></span>\n    </button>\n  </div>\n  <div class="demo-bar__panel" id="demo-panel" hidden>\n    <p id="demo-copy-sample">This is the real ccwatts, running on made-up sample data. Nothing you do is saved or sent anywhere; reload to start over.</p>\n    <p id="demo-copy-files" hidden>This is the real ccwatts, now showing the files you picked. They were read in this browser and never uploaded; nothing is saved, so reload to start over.</p>\n    <div class="demo-bar__actions"><a id="demo-back" href="#">\u2190 Chase Holroyd\'s portfolio</a><a id="demo-code" href="#" rel="noopener noreferrer">Code on GitHub</a></div>\n  </div>\n</section>\n<main class="wrap">\n  <header class="top">\n    <div class="brand">ccwatts</div>\n    <span class="pill" id="source-pill">Loading</span>\n  </header>\n\n  <div class="intro">\n    <h1>How much electricity does your AI coding use?</h1>\n    <p class="lede" id="lede">Electricity estimates for Claude Code, the AI coding agent, from its local logs. Try it on your own logs below.</p>\n  </div>\n\n  <div class="privacy" id="privacy"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><div><b>Your logs never leave this browser.</b><span class="privacy-more"> No network requests; it reads token counts only.</span></div></div>\n\n  <!-- Tabs sit at the top of the page, not the bottom: a deliberate deviation from STUDIO-CORE section 6 (tab bar) because this is a scrolling web page, not a phone app (Chase, Nov 21). -->\n  <div class="tabs" id="tabs" role="tablist" aria-label="Views">\n    <button type="button" role="tab" id="tab-overview" aria-controls="p-overview" aria-selected="true" tabindex="0" data-hash="">Overview</button>\n    <button type="button" role="tab" id="tab-electricity" aria-controls="p-electricity" aria-selected="false" tabindex="-1" data-hash="#electricity">Electricity</button>\n    <button type="button" role="tab" id="tab-pace" aria-controls="pace" aria-selected="false" tabindex="-1" data-hash="#pace">Pace</button>\n    <button type="button" role="tab" id="tab-share" aria-controls="p-share" aria-selected="false" tabindex="-1" data-hash="#share">Share</button>\n    <button type="button" role="tab" id="tab-method" aria-controls="p-method" aria-selected="false" tabindex="-1" data-hash="#method">Method</button>\n  </div>\n\n  <section id="p-overview" role="tabpanel" aria-labelledby="tab-overview">\n    <div class="ov" id="ov-list">\n      <div class="group">\n        <h2 class="vh">At a glance</h2>\n        <div class="list">\n          <a class="row" id="ov-energy" href="#electricity"><span class="row-main"><span class="row-title" id="ov-energy-title">Electricity</span><span class="row-value" id="ov-energy-value">\u2013</span><span class="range-track" id="ov-energy-bar" aria-hidden="true"></span><span class="row-detail" id="ov-energy-detail"></span></span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>\n          <a class="row" id="ov-pace" href="#pace"><span class="row-main"><span class="row-title" id="ov-pace-title">Pace</span><span class="row-text" id="ov-pace-text"></span><span class="row-detail" id="ov-pace-detail"></span></span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>\n          <a class="row" id="ov-drives" href="#electricity"><span class="row-main"><span class="row-title">What drives it</span><span class="row-text" id="ov-drives-text"></span></span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>\n        </div>\n      </div>\n      <div class="group">\n        <div class="list">\n          <a class="row" id="ov-share" href="#share"><img class="thumb" id="ov-share-thumb" alt="" width="1200" height="627"><span class="row-main"><span class="row-title">Share card</span><span class="row-detail">Save a PNG or copy a LinkedIn post</span></span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>\n          <a class="row" id="ov-logs" href="#drop" hidden><span class="row-main"><span class="row-title">Use your own logs</span><span class="row-detail">Drop in a log folder or .jsonl files</span></span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>\n        </div>\n      </div>\n    </div>\n    <a class="back" id="drop-back" href="#" hidden><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M8 1.5 3.5 6 8 10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Overview</a>\n  <section class="drop" id="drop" aria-label="Your logs" hidden>\n    <h2>Try it on your own logs</h2>\n    <p>Claude Code saves logs in <code>~/.claude/projects</code>. Pick that folder, or drop any <code>.jsonl</code> files here. Files are read by this page on your device and never uploaded. On a Mac the folder is hidden: in the picker, press <kbd>\u2318</kbd> <kbd>\u21E7</kbd> <kbd>.</kbd> to show it.</p>\n    <p class="phone-only" id="phone-hint">On a phone? Your logs live where Claude Code runs.</p>\n    <div class="controls">\n      <input type="file" class="vh" id="pick-folder" webkitdirectory multiple>\n      <label class="btn primary" for="pick-folder">Choose folder</label>\n      <input type="file" class="vh" id="pick-files" accept=".jsonl" multiple>\n      <label class="btn" for="pick-files">Choose files</label>\n      <button type="button" id="use-sample">Use sample data</button>\n    </div>\n    <p id="cli-line">Prefer the terminal? Run <code id="cli-cmd">npx ccwatts</code> with Node 22+. Same numbers, plus a history that outlasts Claude Code\'s log cleanup.</p>\n    <details class="export" id="cloud">\n      <summary class="disclose">Use Claude Code on the web? Ask it.</summary>\n      <p>Paste this into a Claude Code session at claude.ai/code. Claude runs ccwatts there and replies with that session\'s electricity, from token counts only. Each web session keeps only its own log. Plain claude.ai chats keep none; use the token count box instead.</p>\n      <pre class="sharetext prompt-text" id="cloud-prompt">Estimate the electricity this Claude Code session has used, with ccwatts.\n\n1. Run: npx -y ccwatts@latest\n2. Reply in three short lines: the energy range exactly as ccwatts shows it, the method version, and the one comparison it prints.\n3. If I ask for a breakdown, run: npx -y ccwatts@latest --by day\n\nRules: ccwatts reads token counts only. Don\'t open, read, search or quote the log files or anything from our conversation yourself. Use only what ccwatts prints. If the command fails, tell me the error in one line. Don\'t guess a number.</pre>\n      <div class="controls">\n        <button type="button" id="copy-cloud">Copy prompt</button>\n      </div>\n      <p>Claude says npm is blocked? Some sessions can\'t download tools. If your app shows a token total for the session, type it in the "<a href="#electricity">Have a token count?</a>" box on the Electricity tab. Otherwise, run the prompt on a computer with Claude Code.</p>\n    </details>\n    <details class="export" id="export">\n      <summary class="disclose">Can\'t find the folder?</summary>\n      <p>Paste this prompt into a Claude Code session. It writes a copy of that machine\'s usage with token counts only, and no prompts or code. Then drop the file here, or paste what it prints into the box below.</p>\n      <pre class="sharetext" id="export-prompt">Make a counts-only copy of my Claude Code usage for ccwatts.\n\nRead every .jsonl file under ~/.claude/projects. For each line whose "type" is "assistant" and that has message.usage, write one JSON line containing only:\n- type, timestamp, requestId\n- cwd, reduced to the last folder name (never the full path)\n- message.id and message.model\n- message.usage with input_tokens, cache_creation_input_tokens, cache_read_input_tokens and output_tokens\n\nLeave out everything else, especially message content. Save the lines as ccwatts-usage.jsonl and give me the file to download. If you can\'t offer a download, print the lines in one code block instead.</pre>\n      <div class="controls">\n        <button type="button" id="copy-prompt">Copy prompt</button>\n      </div>\n      <label for="paste-log">Paste the lines it printed</label>\n      <textarea id="paste-log" rows="4" spellcheck="false" placeholder=\'{"type":"assistant", \u2026}\'></textarea>\n      <div class="controls">\n        <button type="button" id="read-paste">Read pasted lines</button>\n      </div>\n    </details>\n    <div class="status" id="drop-status" role="status" aria-live="polite"></div>\n  </section>\n  </section>\n\n  <section id="p-electricity" role="tabpanel" aria-labelledby="tab-electricity" hidden>\n    <section class="hero" id="hero">\n      <span class="eyebrow" id="hero-eyebrow">Claude Code electricity</span>\n      <div class="bill-main">\n        <div class="big" id="hero-big">\u2013</div>\n        <div class="range" id="hero-range" role="img" aria-label="Loading"></div>\n      </div>\n      <div class="compare" id="hero-compare"></div>\n      <div class="meta" id="hero-meta"></div>\n      <div class="seg" role="group" aria-label="Time window">\n        <button type="button" data-window="7d" id="w-7d">7 days</button>\n        <button type="button" data-window="30d" id="w-30d">30 days</button>\n        <button type="button" data-window="all" id="w-all">All time</button>\n      </div>\n    </section>\n    <div class="block">\n      <h2>Over time</h2>\n      <div class="legend" id="legend"></div>\n      <svg class="chart" id="chart" viewBox="0 0 720 240" role="img" aria-label="Daily electricity by token type"></svg>\n    </div>\n    <div class="grid2">\n      <div class="block"><h2>By model</h2><ul class="rank" id="by-model"></ul></div>\n      <div class="block"><h2>By project</h2><ul class="rank" id="by-project"></ul></div>\n    </div>\n    <div class="drives" id="drives">\n      <div class="block">\n        <h2>What drives your number</h2>\n        <p class="explain" id="explain"></p>\n        <details class="fine" id="explain-box">\n          <summary class="disclose">Why this happens</summary>\n          <p class="explain" id="explain-more"></p>\n        </details>\n      </div>\n      <div class="grid2 drives-tools">\n        <div class="whatif" id="whatif">\n          <div class="whatif-head">\n            <h2>What if?</h2>\n            <span class="whatif-pick"><label for="whatif-cache">Cache-read cost</label> <output id="whatif-value" for="whatif-cache">10%</output></span>\n          </div>\n          <input type="range" id="whatif-cache" min="0.01" max="0.25" step="0.01" value="0.1" aria-valuetext="10% of fresh input" autocomplete="off">\n          <div class="whatif-scale" aria-hidden="true"><span>1%</span><span class="mark" style="left:calc(37.50% + 2.0px)">published 10%</span><span>25%</span></div>\n          <p class="whatif-note" id="whatif-note" role="status" hidden></p>\n          <details class="fine" id="whatif-why">\n            <summary class="disclose">Why this assumption?</summary>\n            <p class="note">Cache reads are most of your tokens, and their cost is the least certain assumption. The method uses 10% of the cost of fresh input and tests 1% to 25%. Drag to see your number move.</p>\n          </details>\n          <button type="button" id="whatif-reset" hidden>Reset</button>\n        </div>\n        <section class="manual" id="manual" aria-labelledby="manual-h">\n          <h2 id="manual-h">Have a token count?</h2>\n          <p class="note" id="manual-hint">For a cloud thread or chat that shows a token total. Local Claude Code logs give a tighter range.</p>\n          <div class="manual-fields">\n            <div class="manual-field">\n              <label for="manual-tokens">Total tokens</label>\n              <input type="text" id="manual-tokens" placeholder="88.8M" autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="done" aria-describedby="manual-hint">\n            </div>\n            <div class="manual-field">\n              <label for="manual-model">Model</label>\n              <select id="manual-model">\n                <option value="opus" selected>Opus</option>\n                <option value="sonnet">Sonnet</option>\n                <option value="haiku">Haiku</option>\n              </select>\n            </div>\n          </div>\n          <p class="manual-result" id="manual-result" role="status" aria-live="polite"></p>\n        </section>\n      </div>\n    </div>\n  </section>\n\n  <section id="pace" class="pace" role="tabpanel" aria-labelledby="tab-pace" hidden>\n    <div class="pace-title">\n      <span class="eyebrow">Your work rhythm \xB7 opt-in \xB7 stays local</span>\n      <div class="pace-head">\n        <h2 id="pace-h">Pace</h2>\n        <span class="pill sample" id="pace-pill">Sample data</span>\n      </div>\n    </div>\n    <div id="pace-body">\n      <p class="pace-lead" id="pace-lead"></p>\n      <p class="pace-sofar" id="pace-sofar" hidden></p>\n      <p class="pace-agents" id="pace-agents"></p>\n      <div class="legend" id="pace-legend" aria-hidden="true"><span><i style="background:var(--c1)"></i>Active hours</span><span><i style="background:var(--c2)"></i>Past 10pm (part of active)</span><span><i class="agent"></i>Agent-only</span><span><i class="sofar"></i>This week, so far</span><span><i class="whisker"></i>Low \u2013 high range</span></div>\n      <svg class="chart" id="pace-chart" viewBox="0 0 720 260" role="img" aria-label="Active and agent-only hours per week, last 4 weeks"></svg>\n      <table class="vh" id="pace-table"></table>\n      <details class="fine" id="pace-how">\n        <summary class="disclose">How Pace is counted</summary>\n        <p class="note pace-foot" id="pace-foot">Active time counts idle gaps under 10/20/30 min (low/central/high) as work. Past 10pm and the longest stretch use the 20-min gap. A day off has under 15 active minutes. Agent-only: no turn from you. Heuristic, not a measurement \xB7 method v0.1.2</p>\n      </details>\n    </div>\n    <p class="note" id="pace-empty" hidden></p>\n    <p class="note" id="pace-skipped" hidden>Pace is skipped with --path or --no-history, which leave pace.jsonl alone. Run <code>ccwatts dashboard</code> without them to see it.</p>\n    <p class="note" id="pace-unreadable" hidden>Couldn\'t read pace.jsonl, so Pace is left out this time. The file is left as it is.</p>\n    <p class="note" id="pace-optin" hidden>Pace is off. Run <code>ccwatts pace</code> once to turn it on: it keeps daily minutes and whole hours in <code>~/.ccwatts/pace.jsonl</code> on this computer, and this page shows it next time.</p>\n  </section>\n\n  <section id="p-share" role="tabpanel" aria-labelledby="tab-share" hidden>\n    <div class="block">\n      <h2>Share it</h2>\n      <img class="card" id="card" alt="Electricity receipt card" width="1200" height="627">\n      <a class="phone-only full-size" id="card-full" href="#" target="_blank" rel="noopener noreferrer">Open full size</a>\n      <div class="controls">\n        <button type="button" class="primary" id="save-png">Save PNG for LinkedIn</button>\n        <button type="button" id="save-svg">Save SVG</button>\n        <button type="button" id="copy-line">Copy share line</button>\n        <button type="button" id="copy-post">Copy LinkedIn post</button>\n      </div>\n      <div class="status" id="share-status"></div>\n      <details id="post-box">\n        <summary class="disclose">Show the LinkedIn post</summary>\n        <pre class="sharetext" id="post"></pre>\n      </details>\n    </div>\n  </section>\n\n  <section id="p-method" role="tabpanel" aria-labelledby="tab-method" hidden>\n    <div class="block">\n      <h2>How this is estimated</h2>\n      <p class="explain" id="method-intro"></p>\n      <details class="fine" id="method-box">\n        <summary class="disclose">More on the method</summary>\n        <p class="explain" id="method-more"></p>\n      </details>\n      <details id="params-box">\n        <summary class="disclose">Show all parameters and sources</summary>\n        <div class="tablewrap"><table id="params"></table></div>\n      </details>\n    </div>\n  </section>\n\n  <footer>\n    <div id="footer-version"></div>\n    <p>Open source. Read the code and the full methodology on <a id="repo-link" href="#" rel="noopener noreferrer">GitHub</a>. Built by <a id="built-by" href="#" rel="noopener noreferrer">Chase Holroyd</a>.</p>\n    <div class="appearance"><span id="appearance-label">Appearance</span><div class="seg" role="group" aria-labelledby="appearance-label">\n      <button type="button" data-theme-pick="light" aria-pressed="false">Light</button>\n      <button type="button" data-theme-pick="dark" aria-pressed="false">Dark</button>\n      <button type="button" data-theme-pick="system" aria-pressed="true">System</button>\n    </div></div>\n  </footer>\n</main>\n<script id="ccwatts-data" type="application/json">{"mode":"playground","generatedAt":null,"rows":[]}</script>\n<script id="ccwatts-sample" type="application/json">[{"date":"2026-09-21","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":47,"tokens":{"input":481,"cacheWrite":224858,"cacheRead":5433921,"output":21302},"outputContext":2453872321},{"date":"2026-09-21","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":17,"tokens":{"input":190,"cacheWrite":86694,"cacheRead":873313,"output":7714},"outputContext":425266546},{"date":"2026-09-22","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":40,"tokens":{"input":393,"cacheWrite":206396,"cacheRead":4259456,"output":20119},"outputContext":2244470466},{"date":"2026-09-23","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":52,"tokens":{"input":503,"cacheWrite":212076,"cacheRead":5914935,"output":28587},"outputContext":3409886608},{"date":"2026-09-24","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":21,"tokens":{"input":190,"cacheWrite":94458,"cacheRead":1218020,"output":10292},"outputContext":590700102},{"date":"2026-09-24","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":95,"tokens":{"input":977,"cacheWrite":439114,"cacheRead":11248882,"output":44237},"outputContext":5490113479},{"date":"2026-09-25","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":19,"tokens":{"input":209,"cacheWrite":93535,"cacheRead":1038543,"output":9584},"outputContext":589452635},{"date":"2026-09-27","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":64,"tokens":{"input":655,"cacheWrite":253381,"cacheRead":7300740,"output":31952},"outputContext":3769121520},{"date":"2026-09-28","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":28,"tokens":{"input":276,"cacheWrite":140541,"cacheRead":2230744,"output":13360},"outputContext":1153747881},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":38,"tokens":{"input":356,"cacheWrite":152315,"cacheRead":3272451,"output":18960},"outputContext":1641654756},{"date":"2026-09-29","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":340,"cacheWrite":134170,"cacheRead":2682489,"output":16997},"outputContext":1568755458},{"date":"2026-09-30","source":"claude-code","model":"claude-sonnet-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":31,"tokens":{"input":353,"cacheWrite":135035,"cacheRead":2371226,"output":16712},"outputContext":1324962703},{"date":"2026-10-01","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":16,"tokens":{"input":138,"cacheWrite":80233,"cacheRead":768856,"output":6943},"outputContext":382418077},{"date":"2026-10-01","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":24,"tokens":{"input":303,"cacheWrite":108412,"cacheRead":1401918,"output":11697},"outputContext":695089914},{"date":"2026-10-02","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":50,"tokens":{"input":467,"cacheWrite":243377,"cacheRead":6114791,"output":24218},"outputContext":3052033764},{"date":"2026-10-02","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":31,"tokens":{"input":291,"cacheWrite":156640,"cacheRead":2602032,"output":14670},"outputContext":1290375171},{"date":"2026-10-03","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":67,"tokens":{"input":677,"cacheWrite":296672,"cacheRead":8900888,"output":33220},"outputContext":4724382924},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":61,"tokens":{"input":601,"cacheWrite":250048,"cacheRead":7595553,"output":29379},"outputContext":3577266281},{"date":"2026-10-05","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":32,"tokens":{"input":349,"cacheWrite":148766,"cacheRead":2857812,"output":18526},"outputContext":1716421621},{"date":"2026-10-06","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":42,"tokens":{"input":371,"cacheWrite":175342,"cacheRead":4217525,"output":20010},"outputContext":2086579461},{"date":"2026-10-07","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":53,"tokens":{"input":519,"cacheWrite":232336,"cacheRead":6626491,"output":26226},"outputContext":3535583255},{"date":"2026-10-07","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":27,"tokens":{"input":299,"cacheWrite":126737,"cacheRead":2032642,"output":15950},"outputContext":1332905565},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":72,"tokens":{"input":805,"cacheWrite":314745,"cacheRead":9938479,"output":36755},"outputContext":5269927123},{"date":"2026-10-08","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":71,"tokens":{"input":823,"cacheWrite":315410,"cacheRead":9639360,"output":33996},"outputContext":4708628928},{"date":"2026-10-08","source":"claude-code","model":"claude-sonnet-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":29,"tokens":{"input":288,"cacheWrite":144763,"cacheRead":2133553,"output":18135},"outputContext":1399436901},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":32,"tokens":{"input":316,"cacheWrite":129817,"cacheRead":2427569,"output":15515},"outputContext":1186325442},{"date":"2026-10-09","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":15,"tokens":{"input":122,"cacheWrite":58466,"cacheRead":581654,"output":7239},"outputContext":307424407},{"date":"2026-10-09","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":52,"tokens":{"input":438,"cacheWrite":243114,"cacheRead":6293294,"output":26306},"outputContext":3344828844},{"date":"2026-10-10","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":66,"tokens":{"input":673,"cacheWrite":273538,"cacheRead":8614195,"output":31043},"outputContext":4430386287},{"date":"2026-10-11","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":71,"tokens":{"input":885,"cacheWrite":325807,"cacheRead":9676339,"output":33624},"outputContext":4753439717},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":16,"tokens":{"input":186,"cacheWrite":90712,"cacheRead":869169,"output":8201},"outputContext":521288313},{"date":"2026-10-12","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":46,"tokens":{"input":504,"cacheWrite":208473,"cacheRead":4885505,"output":22366},"outputContext":2523675175},{"date":"2026-10-13","source":"claude-code","model":"claude-opus-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":244,"cacheWrite":111650,"cacheRead":1255969,"output":9499},"outputContext":611397728},{"date":"2026-10-13","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":25,"tokens":{"input":221,"cacheWrite":111841,"cacheRead":1586210,"output":11735},"outputContext":798440653},{"date":"2026-10-14","source":"claude-code","model":"claude-opus-4-6","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":43,"tokens":{"input":530,"cacheWrite":183803,"cacheRead":4389683,"output":20586},"outputContext":2203768836},{"date":"2026-10-14","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":59,"tokens":{"input":674,"cacheWrite":217090,"cacheRead":6575361,"output":28579},"outputContext":3253006122},{"date":"2026-10-15","source":"claude-code","model":"claude-haiku-4-5","projectId":"367b937ac815b163","projectName":"ccwatts","responses":74,"tokens":{"input":825,"cacheWrite":309110,"cacheRead":10212638,"output":38706},"outputContext":5535358176},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"367b937ac815b163","projectName":"ccwatts","responses":20,"tokens":{"input":265,"cacheWrite":109170,"cacheRead":1296443,"output":8112},"outputContext":599370597},{"date":"2026-10-15","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":31,"tokens":{"input":253,"cacheWrite":156477,"cacheRead":2747706,"output":13093},"outputContext":1311357449},{"date":"2026-10-16","source":"claude-code","model":"claude-haiku-4-5","projectId":"0bb3418a8c1418a8","projectName":"hearth","responses":28,"tokens":{"input":336,"cacheWrite":130298,"cacheRead":1943815,"output":14701},"outputContext":1081930686},{"date":"2026-10-16","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":48,"tokens":{"input":494,"cacheWrite":215976,"cacheRead":5622539,"output":24681},"outputContext":3062604147},{"date":"2026-10-17","source":"claude-code","model":"claude-opus-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":56,"tokens":{"input":530,"cacheWrite":237670,"cacheRead":6869143,"output":25467},"outputContext":3159646087},{"date":"2026-10-18","source":"claude-code","model":"claude-haiku-4-5","projectId":"48cee83ad258011a","projectName":"dotfiles","responses":38,"tokens":{"input":416,"cacheWrite":162013,"cacheRead":3360821,"output":20262},"outputContext":1907957687},{"date":"2026-10-19","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":97,"tokens":{"input":1108,"cacheWrite":414100,"cacheRead":10652494,"output":48446},"outputContext":5589764863},{"date":"2026-10-19","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":65,"tokens":{"input":708,"cacheWrite":292947,"cacheRead":8732693,"output":35185},"outputContext":4755010745},{"date":"2026-10-20","source":"claude-code","model":"claude-haiku-4-5","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":66,"tokens":{"input":726,"cacheWrite":297357,"cacheRead":8882173,"output":32673},"outputContext":4543520242},{"date":"2026-10-20","source":"claude-code","model":"claude-sonnet-4-6","projectId":"d11d2b07dcb20490","projectName":"portfolio-site","responses":128,"tokens":{"input":1264,"cacheWrite":557853,"cacheRead":16226037,"output":59579},"outputContext":7838321066}]</script>\n<script id="ccwatts-sample-pace" type="application/json">[{"date":"2026-09-21","activeMinutes":{"low":293,"central":336,"high":379},"agentMinutes":{"low":40,"central":50,"high":63},"lateNightMinutes":0,"longestStretchMinutes":83,"firstHour":9,"lastHour":18},{"date":"2026-09-22","activeMinutes":{"low":338,"central":377,"high":416},"agentMinutes":{"low":19,"central":24,"high":30},"lateNightMinutes":0,"longestStretchMinutes":111,"firstHour":9,"lastHour":17},{"date":"2026-09-23","activeMinutes":{"low":347,"central":373,"high":399},"agentMinutes":{"low":49,"central":61,"high":76},"lateNightMinutes":75,"longestStretchMinutes":133,"firstHour":10,"lastHour":23},{"date":"2026-09-24","activeMinutes":{"low":293,"central":331,"high":369},"agentMinutes":{"low":25,"central":31,"high":39},"lateNightMinutes":0,"longestStretchMinutes":152,"firstHour":9,"lastHour":19},{"date":"2026-09-25","activeMinutes":{"low":302,"central":332,"high":362},"agentMinutes":{"low":59,"central":74,"high":93},"lateNightMinutes":0,"longestStretchMinutes":153,"firstHour":9,"lastHour":18},{"date":"2026-09-26","activeMinutes":{"low":63,"central":73,"high":83},"agentMinutes":{"low":0,"central":0,"high":0},"lateNightMinutes":0,"longestStretchMinutes":58,"firstHour":10,"lastHour":12},{"date":"2026-09-28","activeMinutes":{"low":318,"central":350,"high":382},"agentMinutes":{"low":48,"central":60,"high":75},"lateNightMinutes":0,"longestStretchMinutes":110,"firstHour":9,"lastHour":18},{"date":"2026-09-29","activeMinutes":{"low":308,"central":346,"high":384},"agentMinutes":{"low":46,"central":58,"high":73},"lateNightMinutes":0,"longestStretchMinutes":162,"firstHour":10,"lastHour":19},{"date":"2026-09-30","activeMinutes":{"low":392,"central":436,"high":480},"agentMinutes":{"low":37,"central":46,"high":58},"lateNightMinutes":69,"longestStretchMinutes":167,"firstHour":10,"lastHour":23},{"date":"2026-10-01","activeMinutes":{"low":365,"central":395,"high":425},"agentMinutes":{"low":54,"central":68,"high":85},"lateNightMinutes":0,"longestStretchMinutes":122,"firstHour":10,"lastHour":19},{"date":"2026-10-02","activeMinutes":{"low":342,"central":374,"high":406},"agentMinutes":{"low":46,"central":58,"high":73},"lateNightMinutes":0,"longestStretchMinutes":167,"firstHour":10,"lastHour":19},{"date":"2026-10-05","activeMinutes":{"low":298,"central":340,"high":382},"agentMinutes":{"low":32,"central":40,"high":50},"lateNightMinutes":0,"longestStretchMinutes":136,"firstHour":9,"lastHour":18},{"date":"2026-10-06","activeMinutes":{"low":328,"central":359,"high":390},"agentMinutes":{"low":33,"central":41,"high":51},"lateNightMinutes":0,"longestStretchMinutes":171,"firstHour":9,"lastHour":19},{"date":"2026-10-07","activeMinutes":{"low":364,"central":400,"high":436},"agentMinutes":{"low":23,"central":29,"high":36},"lateNightMinutes":50,"longestStretchMinutes":85,"firstHour":9,"lastHour":23},{"date":"2026-10-08","activeMinutes":{"low":322,"central":350,"high":378},"agentMinutes":{"low":29,"central":36,"high":45},"lateNightMinutes":0,"longestStretchMinutes":127,"firstHour":10,"lastHour":17},{"date":"2026-10-09","activeMinutes":{"low":294,"central":321,"high":348},"agentMinutes":{"low":35,"central":44,"high":55},"lateNightMinutes":0,"longestStretchMinutes":90,"firstHour":10,"lastHour":18},{"date":"2026-10-10","activeMinutes":{"low":67,"central":77,"high":87},"agentMinutes":{"low":0,"central":0,"high":0},"lateNightMinutes":0,"longestStretchMinutes":62,"firstHour":10,"lastHour":12},{"date":"2026-10-12","activeMinutes":{"low":308,"central":350,"high":392},"agentMinutes":{"low":29,"central":36,"high":45},"lateNightMinutes":0,"longestStretchMinutes":106,"firstHour":10,"lastHour":17},{"date":"2026-10-13","activeMinutes":{"low":315,"central":346,"high":377},"agentMinutes":{"low":37,"central":46,"high":58},"lateNightMinutes":0,"longestStretchMinutes":174,"firstHour":9,"lastHour":19},{"date":"2026-10-14","activeMinutes":{"low":321,"central":362,"high":403},"agentMinutes":{"low":28,"central":35,"high":44},"lateNightMinutes":72,"longestStretchMinutes":130,"firstHour":10,"lastHour":23},{"date":"2026-10-15","activeMinutes":{"low":381,"central":416,"high":451},"agentMinutes":{"low":59,"central":74,"high":93},"lateNightMinutes":0,"longestStretchMinutes":140,"firstHour":9,"lastHour":18},{"date":"2026-10-16","activeMinutes":{"low":303,"central":330,"high":357},"agentMinutes":{"low":31,"central":39,"high":49},"lateNightMinutes":0,"longestStretchMinutes":179,"firstHour":9,"lastHour":18},{"date":"2026-10-19","activeMinutes":{"low":365,"central":405,"high":445},"agentMinutes":{"low":43,"central":54,"high":68},"lateNightMinutes":128,"longestStretchMinutes":79,"firstHour":9,"lastHour":23},{"date":"2026-10-20","activeMinutes":{"low":345,"central":383,"high":421},"agentMinutes":{"low":61,"central":76,"high":95},"lateNightMinutes":114,"longestStretchMinutes":171,"firstHour":10,"lastHour":23}]</script>\n<script>"use strict";(()=>{var N="ccwatts",je="0.2.0",F="https://github.com/holroydchase-afk/ccwatts",ke="https://chaseholroyd.com/ccwatts/",xe="https://chaseholroyd.com/ccwatts.html";var Z={input:"input",cacheWrite:"cache write",cacheRead:"cache read",output:"output"},I=e=>Math.round(e).toLocaleString("en-US");function B(e){return e>=100?I(e):e>=1?(Math.round(e*10)/10).toString():e>=.01?(Math.round(e*100)/100).toString():e===0?"0":e.toPrecision(1)}var We=e=>e>=1&&e<100?e.toFixed(1):B(e);function C(e){let t=e.high>=1e3,n=t?1e3:1,o=t?"kWh":"Wh";return{central:`${We(e.central/n)} ${o}`,range:`${We(e.low/n)} \\u2013 ${We(e.high/n)}`,unit:o}}var re=e=>e.replace(/^claude-/,"");var M=["input","cacheWrite","cacheRead","output"];var se=()=>({low:0,central:0,high:0});function $e(e,t){return e.low+=t.low,e.central+=t.central,e.high+=t.high,e}function ve(e,t){let n=e.toLowerCase();for(let[o,r]of Object.entries(t.tiers))if(Array.isArray(r)&&r.some(a=>n.includes(a)))return{tier:o,known:!0};return{tier:String(t.tiers.fallback),known:!1}}function an(e,t){let n=e.params[t];if(!n)throw new Error(`Missing parameter "${t}" in params.json`);return n}function cn(e,t){let n=`output_wh_per_1k.${e}`;switch(t){case"output":return[n];case"input":return[n,"input_vs_output"];case"cacheWrite":return[n,"input_vs_output","cache_write_vs_input"];case"cacheRead":return[n,"input_vs_output","cache_read_vs_input"]}}function ln(e,t,n){let o=.001,r=0,a=0;for(let s of cn(t,n)){let i=an(e,s);o*=i.value,r+=Math.log(i.high/i.value)**2,a+=Math.log(i.value/i.low)**2}return{whPerToken:o,up:Math.sqrt(r),down:Math.sqrt(a)}}var ft=()=>({input:0,cacheWrite:0,cacheRead:0,output:0});function X(e,t,n){let o=se();for(let r of M)$e(o,Ue(e[r],t,r,n));return o}var yt=new WeakMap;function un(e,t,n){let o=yt.get(e);o||yt.set(e,o=new Map);let r=`${t}:${n}`,a=o.get(r);return a||o.set(r,a=ln(e,t,n)),a}function Ue(e,t,n,o){if(e<=0)return se();let r=un(o,t,n),a=e*r.whPerToken;return{low:a/Math.exp(r.down),central:a,high:a*Math.exp(r.up)}}var dn=e=>e.slice(0,10);function Te(e,t){let n=se(),o=ft(),r={model:new Map,type:new Map,day:new Map,project:new Map},a=new Set,s=null,i=null,m=(u,l,b,w,h)=>{let p=r[u].get(l);p||r[u].set(l,p={key:l,energy:se(),tokens:ft()}),$e(p.energy,b),p.tokens[w]+=h};for(let u of e){let{tier:l,known:b}=ve(u.model,t);b||a.add(u.model);let w=dn(u.timestamp);(s===null||w<s)&&(s=w),(i===null||w>i)&&(i=w);let h=u.project?.name??"(unknown)";for(let p of M){let y=u.tokens[p];if(y<=0)continue;let k=Ue(y,l,p,t);$e(n,k),o[p]+=y,m("model",u.model,k,p,y),m("type",p,k,p,y),m("day",w,k,p,y),m("project",u.project?`${h}#${u.project.id}`:h,k,p,y)}}let d=u=>[...u.values()].sort((l,b)=>b.energy.central-l.energy.central),f=[...a].map(u=>`Unknown model "${u}": estimated as ${String(t.tiers.fallback)}.`);return{methodVersion:t.version,total:n,tokens:o,responses:e.length,byModel:d(r.model),byType:d(r.type),byDay:[...r.day.values()].sort((u,l)=>u.key.localeCompare(l.key)),byProject:d(r.project),span:s&&i?{from:s,to:i}:null,warnings:f}}var Fe=e=>e.split("#")[0]??e;function pn(e,t){if(t(e)===1)return"charging a phone about once";if(e>=1)return`charging a phone about ${t(e)} times`;let n=Math.round(e*100);return n<1?"under 1% of a phone charge":n>=45&&n<=55?"about half a phone charge":`about ${Math.round(n/10)*10||n}% of a phone charge`}function Be(e,t){let n=t.comparisons,o=[],r=s=>s>=10?Math.round(s):Math.round(s*10)/10,a=(s,i,m)=>r(s)===1?`1 ${i}`:`${r(s)} ${m}`;if(n.ev_kwh_per_mile){let s=e/n.ev_kwh_per_mile.value;o.push({id:"ev",amount:s,text:`driving an EV about ${a(s,"mile","miles")}`})}if(n.fridge_kwh_per_day){let s=e/n.fridge_kwh_per_day.value;o.push({id:"fridge",amount:s,text:`running a fridge about ${a(s,"day","days")}`})}if(n.phone_charge_kwh){let s=e/n.phone_charge_kwh.value;o.push({id:"phone",amount:s,text:pn(s,r)})}if(n.us_home_kwh_per_day){let s=e/n.us_home_kwh_per_day.value;o.push({id:"home",amount:s,text:`powering a US home about ${a(s,"day","days")}`})}return o}function Y(e,t){let n=Be(e,t),o=n.filter(a=>a.amount>=1).slice(0,2),r=[...n].sort((a,s)=>s.amount-a.amount).slice(0,1);return(o.length?o:r).map(a=>a.text).join(" \\xB7 ")}var wt=F.replace(/^https:\\/\\//,"");function bt(e){return e==="all time"?"All my Claude Code use so far":e.startsWith("since")?`My Claude Code use ${e}`:`My ${e} of Claude Code`}function kt(e){return e==="all time"?"(Sample data) All of a sample\'s Claude Code use":`(Sample data) ${e[0].toUpperCase()}${e.slice(1)} of Claude Code`}function Me({estimate:e,params:t,windowLabel:n,sample:o}){let r=C(e.total),a=Y(e.total.central/1e3,t).split(" \\xB7 ")[0];return`${o?kt(n):bt(n)} came to about ${r.central} of electricity (range ${r.range} ${r.unit}), like ${a}. Estimated locally with ${N}, method v${t.version}: ${wt}`}function Ye(e){let{estimate:t,params:n,windowLabel:o,sample:r}=e,a=C(t.total),s=t.total.central>0?Math.round((t.byType.find(i=>i.key==="cacheRead")?.energy.central??0)/t.total.central*100):0;return r?[`(Sample data) This is what ${N} shows for a sample developer, not a real measurement. ${kt(o).replace("(Sample data) ","")}: about ${a.central} (range ${a.range} ${a.unit}), like ${Y(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${s}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and it runs entirely on your own machine, so no logs leave it.","",`Try it on your own logs: ${ke}`,`Code and method: ${F}`].join(`\n`):[`I estimated the electricity behind my AI coding. ${bt(o)}: about ${a.central} (range ${a.range} ${a.unit}), like ${Y(t.total.central/1e3,n).replace(" \\xB7 "," or ")}.`,"",`${s>=50?"The surprise: ":""}${s}% of it came from the agent re-reading context it had already seen.`,"","It\'s a range because nobody outside the AI labs knows the real energy per token. Every assumption is sourced, and the tool runs entirely on my laptop, so no logs leave it.","",`Try it in your browser: ${ke}`,`Code and method: ${F}`].join(`\n`)}var O=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");function ae(e,t,n){let o=Math.max(2,n-e.length-t.length-2);return`${e} ${".".repeat(o)} ${t}`}function ze({estimate:e,params:t,windowLabel:n,sample:o}){let s=C(e.total),i=e.total.central/1e3,m=Y(i,t).split(" \\xB7 "),d=s.unit,f=d==="kWh"?1e3:1,u=712,l=432,b=36,w=[],h="-".repeat(b);w.push({text:"ELECTRICITY RECEIPT",weight:"bold"}),w.push({text:e.span?`${e.span.from} \\u2192 ${e.span.to}`:n,muted:!0}),w.push({text:h,muted:!0});let p=[...M].sort(($,E)=>(e.byType.find(A=>A.key===E)?.energy.central??0)-(e.byType.find(A=>A.key===$)?.energy.central??0));for(let $ of p){let E=e.byType.find(A=>A.key===$);w.push({text:ae(Z[$],`${B((E?.energy.central??0)/f)} ${d}`,b)})}w.push({text:h,muted:!0}),w.push({text:ae("TOTAL (central)",s.central,b),weight:"bold"}),w.push({text:ae("RANGE",`${s.range} ${d}`,b)}),w.push({text:h,muted:!0});for(let $ of e.byModel.slice(0,3)){let E=e.total.central>0?Math.round($.energy.central/e.total.central*100):0;w.push({text:ae(re($.key),`${E}%`,b),muted:!0})}w.push({text:ae("responses",I(e.responses),b),muted:!0}),w.push({text:`method v${t.version} \\xB7 counts only`,muted:!0});let y=25,k=46,P=k+44,z=P+w.length*y+6,S=z+70,j=e.byDay.slice(-30),W=Math.max(...j.map($=>$.energy.central),1e-9),T=(l-64)/Math.max(j.length,1),G=j.map(($,E)=>{let A=6+$.energy.central/W*40;return`<rect x="${(u+32+E*T).toFixed(1)}" y="${(z+46-A).toFixed(1)}" width="${Math.max(1,T-2).toFixed(1)}" height="${A.toFixed(1)}" fill="#1f2a24"/>`}).join(""),fe=[];for(let $=0,E=u+l;E>u;$++,E-=9)fe.push(`${E.toFixed(1)},${S+($%2?10:0)}`);let ye=`M${u},${k} H${u+l} V${S} L${fe.join(" L")} L${u},${S} Z`,K="ui-monospace, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace",_="\'Helvetica Neue\', Helvetica, Arial, sans-serif",we=w.map(($,E)=>{let A=P+E*y,V=E<2||$.text.startsWith("method");return`<text x="${V?u+l/2:u+30}" y="${A}" font-family="${K}" font-size="16.5" ${V?\'text-anchor="middle"\':""} font-weight="${$.weight??"normal"}" fill="${$.muted?"#5e6b63":"#1f2a24"}">${O($.text)}</text>`}).join(`\n    `),be=s.central.split(" ");return`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627" role="img" aria-label="${O(Me({estimate:e,params:t,windowLabel:n,sample:o}))}">\n  <rect width="1200" height="627" fill="#12251c"/>\n  <rect x="0" y="621" width="1200" height="6" fill="#7cc4a0"/>\n  <text x="64" y="104" font-family="${K}" font-size="20" letter-spacing="2" fill="#7cc4a0">${o?\'<tspan fill="#e0b56a">SAMPLE DATA \\xB7 </tspan>\':""}CLAUDE CODE \\xB7 ${O(n.toUpperCase())}</text>\n  <text x="60" y="262" font-family="${_}" font-size="148" font-weight="700" fill="#f4f1e8">${O(be[0]??"")}<tspan font-size="64" font-weight="500" dx="14">${O(be[1]??"")}</tspan></text>\n  <text x="64" y="318" font-family="${_}" font-size="28" fill="#cfe3d6">of electricity, range ${O(s.range)} ${d}</text>\n  ${m.map(($,E)=>`<text x="64" y="${384+E*38}" font-family="${_}" font-size="26" fill="#f4f1e8">\\u2248 ${O($)}</text>`).join(`\n  `)}\n  <text x="64" y="520" font-family="${_}" font-size="20" fill="${o?"#e0b56a":"#9fb8a8"}">${o?"Sample data, not a real measurement.":"Estimated on my laptop. No logs left it."}</text>\n  <text x="64" y="552" font-family="${K}" font-size="17" fill="#7cc4a0">${O(N)} \\xB7 method v${O(t.version)}</text>\n  <text x="64" y="578" font-family="${K}" font-size="17" fill="#7cc4a0">${O(wt)}</text>\n  <path d="${ye}" fill="#f7f5ef"/>\n  <g>\n    ${we}\n  </g>\n  ${G}\n</svg>\n`}var hn=/[\\u0000-\\u001f\\u007f-\\u009f\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;function Q(e,t=64){let n=e.replace(hn,"");if(n.length<=t)return n;let o="";for(let r of n){if(o.length+r.length>t-1)break;o+=r}return`${o}\\u2026`}function mn(e){let t=0xcbf29ce484222325n,n=0x100000001b3n;for(let o=0;o<e.length;o++)t^=BigInt(e.charCodeAt(o)),t=t*n&0xffffffffffffffffn;return t.toString(16).padStart(16,"0")}function Ge(e){let t=e.replace(/[\\\\/]+$/,""),n=t.split(/[\\\\/]/).pop()||t,r=t===""||/^[A-Za-z]:$/.test(t)?"(root)":Q(n)||"(unnamed)";return{id:mn(t),name:r}}var xt=1e9,Ee=(e,t=!1)=>e===null&&t?null:typeof e!="number"||e<=0?0:Number.isInteger(e)&&e<=xt?e:null,$t=e=>/^\\d{4}-\\d{2}-\\d{2}/.test(e)&&!Number.isNaN(Date.parse(e)),ee=e=>typeof e=="string"&&e!==""?e:null;function gn(e){if(e.type!=="assistant")return null;let t=e.message,n=t?.usage,o=ee(t?.model),r=ee(e.timestamp),a=ee(t?.id);if(!n||!o||!r||!a||!$t(r)||o==="<synthetic>")return null;let s=Ee(n.input_tokens,!0),i=Ee(n.cache_creation_input_tokens),m=Ee(n.cache_read_input_tokens),d=Ee(n.output_tokens,!0);if(s===null||i===null||m===null||d===null)return null;let f=ee(e.cwd);return{source:"claude-code",key:`${a}:${ee(e.requestId)??""}`,timestamp:r,model:Q(o)||"(unnamed)",project:f?Ge(f):null,tokens:{input:s,cacheWrite:i,cacheRead:m,output:d}}}var Je=e=>typeof e=="object"&&e!==null?e.type:void 0;function fn(e){if(e.type!=="user"||e.isMeta===!0||e.isSidechain===!0||e.isCompactSummary===!0||"toolUseResult"in e)return!1;let t=e.message?.content;if(Array.isArray(t)&&t.some(n=>Je(n)==="tool_result"))return!1;if("origin"in e){let n=e.origin;return typeof n=="object"&&n!==null&&n.kind==="human"}return typeof t=="string"?!0:Array.isArray(t)&&t.length>0&&t.every(n=>Je(n)==="text"||Je(n)==="image")}var te={id:"claude-code",parse(e){let t=new Map;for(let n of e.replace(/^\\uFEFF/,"").split(`\n`)){if(!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}let r=gn(o);r&&t.set(r.key,r)}return[...t.values()]},activity(e){let t=[];for(let n of e.replace(/^\\uFEFF/,"").split(`\n`)){if(!n.includes(\'"user"\')&&!n.includes(\'"assistant"\'))continue;let o;try{o=JSON.parse(n)}catch{continue}if(typeof o!="object"||o===null||o.type!=="user"&&o.type!=="assistant")continue;let r=ee(o.timestamp);!r||!$t(r)||t.push({event:{timestamp:r,human:fn(o)},ms:Date.parse(r)})}return t.sort((n,o)=>n.ms-o.ms).map(n=>n.event)}};var vt={version:"0.1.2",as_of:"2026-11-18",license:"CC BY 4.0",boundary:"comprehensive: accelerators, host CPU and memory, idle capacity, and data-center overhead (PUE)",interval:"low and high are each parameter\'s plausible bounds, treated as a ~90% interval",params:{"output_wh_per_1k.opus":{value:1.2,low:.4,high:3,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-10-21",note:"Largest tier. Scaled up from the Sonnet value; Anthropic does not disclose model size or energy. Bounds cover published per-token estimates for frontier models. Fable and Mythos models (a class above Opus in Anthropic\'s lineup, no public size or energy figures) are priced at this tier, the largest ccwatts has; treat it as a floor, not a measurement."},"output_wh_per_1k.sonnet":{value:.6,low:.25,high:1.5,unit:"Wh per 1k output tokens",label:"MODELED",source:"https://arxiv.org/abs/2508.15734",as_of:"2026-11-10",note:"Anchored so a typical chat query (about 1k input, 400 output tokens) lands near Google\'s measured 0.24 Wh median Gemini prompt and the 0.34 Wh median frontier query (IQR 0.18-0.67). Third-party estimates for Claude output run 0.4-2 Wh per 1k. Epoch AI\'s bottom-up estimate (https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) of about 0.3 Wh for a 500-output-token GPT-4o query supports the central value. Jegham et al. (How Hungry is AI?, https://arxiv.org/abs/2505.09598) put Claude 3.7 Sonnet at 0.95 Wh for 100 input + 300 output tokens, about 3.1 Wh per 1k output with input near 0.03x output. That is above this high bound, but it pairs with a much lower input ratio, so agentic totals land close to ours (see METHODOLOGY.md, How ccwatts compares)."},"output_wh_per_1k.haiku":{value:.25,low:.08,high:.6,unit:"Wh per 1k output tokens",label:"GUESS",source:"https://www.anthropic.com/pricing",as_of:"2026-11-10",note:"Smallest tier. Scaled down from Sonnet roughly in line with the price gap between tiers, which is a weak proxy for compute. Jegham et al. (https://arxiv.org/abs/2505.09598) put Claude 3.5 Haiku at about the same energy per prompt as Sonnet, one more reason this stays a GUESS."},input_vs_output:{value:.3,low:.15,high:.5,unit:"ratio",label:"MODELED",source:"https://www.anthropic.com/pricing",as_of:"2026-11-10",note:"Energy of one fresh input token relative to one output token. Input is processed in parallel (prefill), so it costs less per token. Anthropic prices input at 1/5 of output; a Watershed-based estimate uses about 1/3. Epoch AI\'s estimate that 10k input tokens add about 2 Wh to a GPT-4o query (https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use) gives about 0.35x. A fit to Jegham et al.\'s three Claude 3.7 Sonnet prompt sizes (https://arxiv.org/abs/2505.09598) gives about 0.03x, below this low bound; it comes paired with a higher output value (see output_wh_per_1k.sonnet)."},cache_write_vs_input:{value:1,low:.8,high:1.25,unit:"ratio",label:"MODELED",source:"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",as_of:"2026-10-21",note:"Writing to the cache means processing the tokens fresh, then storing the result. Priced at 1.25x input."},cache_read_vs_input:{value:.1,low:.01,high:.25,unit:"ratio",label:"MODELED",source:"https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai",as_of:"2026-11-10",note:"The parameter that matters most for agents, where cache reads are 90%+ of tokens. Hausfather\'s central case is 10% of fresh input, tested at 1% and 25%. Anthropic prices cache reads at 0.1x input. Six other open-source Claude Code estimators checked on 2026-11-10 use 0.08-0.1, inside these bounds."}},tiers:{opus:["opus","fable","mythos"],sonnet:["sonnet"],haiku:["haiku"],fallback:"sonnet"},comparisons:{ev_kwh_per_mile:{value:.3,unit:"kWh per mile",label:"MEASURED",source:"https://www.fueleconomy.gov/feg/evsbs.shtml",as_of:"2026-10-21",note:"Typical EV uses 25-35 kWh per 100 miles (EPA)."},fridge_kwh_per_day:{value:1.5,unit:"kWh per day",label:"MEASURED",source:"https://www.energystar.gov/products/refrigerators",as_of:"2026-10-21",note:"A typical US refrigerator uses about 400-600 kWh a year."},us_home_kwh_per_day:{value:29,unit:"kWh per day",label:"MEASURED",source:"https://www.eia.gov/tools/faqs/faq.php?id=97&t=3",as_of:"2026-10-21",note:"Average US household used about 10,800 kWh in a year (EIA)."},phone_charge_kwh:{value:.019,unit:"kWh per smartphone charge",label:"MEASURED",source:"https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",as_of:"2026-10-21",note:"EPA\'s figure for fully charging one smartphone."}},pace:{gap_minutes:{value:20,low:10,high:30,unit:"minutes",label:"GUESS",source:"https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",as_of:"2026-10-31",note:"Heuristic, not measured: an idle gap longer than this ends a work block. The low gap gives the low active time (more splits), the high gap the high."},break_minutes:{value:15,low:15,high:15,unit:"minutes",label:"GUESS",source:"https://github.com/holroydchase-afk/ccwatts/blob/main/docs/spikes/2026-10-31-pace-spike.md",as_of:"2026-10-31",note:"Heuristic, not measured: a pause of at least this long inside a block ends a stretch, for the longest-stretch count."},late_night:{start_hour:22,end_hour:6}},token_mix:{typical_claude_code:{label:"MEASURED",source:"Counts-only copies of 6 of the maintainer\'s Claude Code sessions, Oct-Nov 2026; light and heavy are the lowest and highest observed shares.",as_of:"2026-11-19",note:"Shares of a token total, for estimating from a total when the split is unknown. Observed: cache read 89.0-96.9%, cache write 2.6-10.6%, output 0.21-0.50%, fresh input about 0%. Central is the estimate; low uses the light mix, high the heavy mix.",central:{input:.001,cacheWrite:.04,cacheRead:.955,output:.004},light:{input:0,cacheWrite:.026,cacheRead:.972,output:.002},heavy:{input:.001,cacheWrite:.106,cacheRead:.888,output:.005}}}};var x=vt;function qe(e,t,n={}){let o={...e.params};for(let[r,a]of Object.entries(t)){let s=e.params[r];if(!s)throw new Error(`Unknown parameter "${r}"`);if(!Number.isFinite(a)||a<=0)throw new Error(`Parameter "${r}" must be a positive number, got ${a}`);let i=a/s.value;o[r]=n.pin?{...s,value:a,low:a,high:a}:{...s,value:a,low:s.low*i,high:s.high*i}}return{...e,params:o}}var Ve=e=>{let t=x.pace;return{timeZone:e,gapMinutes:{low:t.gap_minutes.low,central:t.gap_minutes.value,high:t.gap_minutes.high},breakMinutes:t.break_minutes.value,lateNight:{startHour:t.late_night.start_hour,endHour:t.late_night.end_hour}}},ie=6e4,wn=60*ie;function bn(e){return e.map(t=>({ms:Date.parse(t.timestamp),human:t.human})).filter(t=>!Number.isNaN(t.ms)).sort((t,n)=>t.ms-n.ms)}function Tt(e,t){let n=[];for(let o of e){let r=n[n.length-1];r&&o.ms-r[r.length-1].ms<=t?r.push(o):n.push([o])}return n}function kn(e){let t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});return n=>{let o={};for(let r of t.formatToParts(n))o[r.type]=r.value;return{date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour)%24,minute:Number(o.minute),second:Number(o.second)}}}function Mt(e,t,n){let o=[],r=(s,i)=>s.date===i.date&&s.hour===i.hour,a=e;for(;a<t;){let s=n(a),i=a+wn-(s.minute*ie+s.second*1e3+(a%1e3+1e3)%1e3);if(i>t)i=t;else if(!r(n(i-1),s)){let m=a,d=i-1;for(;d-m>1;){let f=Math.floor((m+d)/2);r(n(f),s)?m=f:d=f}i=d}o.push({date:s.date,hour:s.hour,ms:i-a}),a=i}return o}var xn=(e,{startHour:t,endHour:n})=>t<=n?e>=t&&e<n:e>=t||e<n,$n=["low","central","high"],Et=1,Ke=e=>Math.round(e/ie/.1)/10,Rt=e=>{let[t,n,o]=e.map(Ke).sort((r,a)=>r-a);return{low:t,central:n,high:o}};function Ze(e,t){if(typeof t.timeZone!="string"||t.timeZone==="")throw new Error("paceDays needs a time zone");let n=kn(t.timeZone),o=bn(e),r=new Map,a=s=>{let i=r.get(s);return i||(i={active:[0,0,0],agent:[0,0,0],lateNight:0,longestStretch:0,firstHour:null,lastHour:null},r.set(s,i)),i};for(let s of[0,1,2])for(let i of Tt(o,t.gapMinutes[$n[s]]*ie)){let m=i.some(u=>u.human),d=i[0].ms,f=i[i.length-1].ms;for(let u of Mt(d,f,n)){let l=a(u.date);(m?l.active:l.agent)[s]+=u.ms,!(s!==Et||!m)&&(xn(u.hour,t.lateNight)&&(l.lateNight+=u.ms),l.firstHour??(l.firstHour=u.hour),l.lastHour=u.hour)}if(!(s!==Et||!m))for(let u of Tt(i,t.breakMinutes*ie-1)){let l=new Map;for(let b of Mt(u[0].ms,u[u.length-1].ms,n))l.set(b.date,(l.get(b.date)??0)+b.ms);for(let[b,w]of l){let h=a(b);h.longestStretch=Math.max(h.longestStretch,w)}}}return[...r.entries()].filter(([,s])=>[...s.active,...s.agent].some(i=>i>0)).sort(([s],[i])=>s<i?-1:s>i?1:0).map(([s,i])=>({date:s,activeMinutes:Rt(i.active),agentMinutes:Rt(i.agent),lateNightMinutes:Ke(i.lateNight),longestStretchMinutes:Ke(i.longestStretch),firstHour:i.firstHour,lastHour:i.lastHour}))}var Re=e=>`${e.date}|${e.source}|${e.model}|${e.projectId??""}`;var Pt=e=>e.output*(e.input+e.cacheWrite+e.cacheRead);function Xe(e){let t=new Map;for(let n of e){let o={date:n.timestamp.slice(0,10),source:n.source,model:n.model,projectId:n.project?.id??null,projectName:n.project?.name??null},r=Re(o),a=t.get(r);a||t.set(r,a={...o,responses:0,tokens:{input:0,cacheWrite:0,cacheRead:0,output:0},outputContext:0}),a.responses+=1;for(let s of M)a.tokens[s]+=n.tokens[s];a.outputContext+=Pt(n.tokens)}return vn([...t.values()])}function vn(e){return e.sort((t,n)=>Re(t).localeCompare(Re(n)))}function Pe(e){return e.map(t=>({source:t.source,key:Re(t),timestamp:`${t.date}T00:00:00.000Z`,model:t.model,project:t.projectId?{id:t.projectId,name:t.projectName??"(unknown)"}:null,tokens:{...t.tokens}}))}function Qe(e){let t=new Date(`${e}T00:00:00Z`),n=(t.getUTCDay()+6)%7;return t.setUTCDate(t.getUTCDate()-n),t.toISOString().slice(0,10)}var tt=15,_t=864e5,Se=e=>Date.parse(`${e}T00:00:00Z`),Tn=e=>new Date(e).toISOString().slice(0,10),et=(e,t)=>Tn(Se(e)+t*_t),ce=e=>Math.round(e*100)/100,St=e=>({low:ce(e.low/60),central:ce(e.central/60),high:ce(e.high/60)}),Mn=e=>[0,6].includes(new Date(Se(e)).getUTCDay());function nt(e,t,n=4){let o=Qe(t),r=[];for(let a=0;a<n;a++){let s=et(o,-7*a),i=et(s,6)<t?et(s,6):t,m=e.filter(y=>y.date>=s&&y.date<=i),d={low:0,central:0,high:0},f={low:0,central:0,high:0},u=0,l=0,b=0,w=null,h=0;for(let y of m){for(let k of["low","central","high"])d[k]+=y.activeMinutes[k],f[k]+=y.agentMinutes[k];u+=y.lateNightMinutes,l=Math.max(l,y.longestStretchMinutes),Mn(y.date)&&(b+=y.activeMinutes.central),y.lastHour!==null&&(w=Math.max(w??0,y.lastHour)),y.activeMinutes.central>=tt&&h++}let p=Math.round((Se(i)-Se(s))/_t)+1;r.push({start:s,activeHours:St(d),agentHours:St(f),lateNightHours:ce(u/60),longestStretchMinutes:l,restDays:p-h,daysCounted:p,weekendShare:d.central>0?ce(b/d.central):0,latestHour:w})}return r}function H(e){return e===0?"0":e>=10?I(e):(Math.round(e*10)/10).toFixed(1)}function U(e){let t=Math.round(e),n=Math.floor(t/60),o=t%60;return n===0?`${o}m`:o===0?`${n}h`:`${n}h ${o}m`}var En=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],ne=e=>`${En[Number(e.slice(5,7))-1]} ${Number(e.slice(8,10))}`,_e=e=>e===0?"midnight":e===12?"noon":e<12?`${e}am`:`${e-12}pm`,D=e=>`${H(e.low)} \\u2013 ${H(e.high)}`,Ct=e=>`about ${H(e.central)} active hours (range ${D(e)})`,Lt=3;function At(e){let[t,n]=e;return!t||!n||t.daysCounted>Lt?0:n.activeHours.high>0||n.agentHours.high>0?1:0}function ot(e,t){let n=At(e),o=e[n],r=n===0?"This week so far":`Week of ${ne(o.start)}`,a=_e(t.pace.late_night.start_hour),s=o.daysCounted-o.restDays,i=e[0],m=`${i.daysCounted} day${i.daysCounted===1?"":"s"}`;return{focus:n,lead:`${r}: ${Ct(o.activeHours)}`,rest:`${U(o.lateNightHours*60)} past ${a}, longest stretch ${U(o.longestStretchMinutes)}, active ${s} of ${o.daysCounted} days.`,soFar:n===0?null:i.activeHours.central>0?`This week so far: about ${H(i.activeHours.central)} hours in ${m}.`:"This week so far: no active hours yet.",agents:Nt(o)}}function Nt(e){return e.agentHours.high>0?`Agents worked another ${D(e.agentHours)} hours on their own.`:null}var jo=["activeMinutes","agentMinutes","date","firstHour","lastHour","lateNightMinutes","longestStretchMinutes"].join();function rt(e){let t=new Map;for(let n of e)t.set(`${n.source}:${n.key}`,n);return[...t.values()]}var Dt=1e13,at="Wide range: the mix of token types is guessed.",Rn={"":1,k:1e3,m:1e6,b:1e9};function it(e){let t=/^(\\d{1,3}(?:,\\d{3})+|\\d+)?(\\.\\d+)?\\s*([kmb]?)(?:\\s*tokens?)?$/i.exec(e.trim());if(!t||t[1]===void 0&&t[2]===void 0)return null;let n=+`${(t[1]??"0").replace(/,/g,"")}${t[2]??""}`*Rn[t[3].toLowerCase()],o=Math.round(n);return!Number.isFinite(o)||o<=0||o>Dt?null:o}function st(e,t){let n=M.map(s=>e*t[s]),o=Object.fromEntries(M.map((s,i)=>[s,Math.floor(n[i])])),r=e-M.reduce((s,i)=>s+o[i],0),a=M.map((s,i)=>({k:s,r:n[i]-o[s]})).sort((s,i)=>i.r-s.r);for(let s=0;r>0;s=(s+1)%a.length,r--)o[a[s].k]++;return o}var Ht=e=>e!==void 0&&Number.isFinite(e)&&e>0?Math.round(e):0;function ct(e,t){let{tier:n,known:o}=ve(e.model,t),r=o?[]:[`Unknown model "${e.model}": estimated as ${String(t.tiers.fallback)}.`],a={methodVersion:t.version,model:e.model,tier:n,knownModel:o,warnings:r},s=Ht(e.tokens);if(e.mix&&M.some(f=>e.mix[f]!==void 0)){let f=Object.fromEntries(M.map(l=>[l,Ht(e.mix[l])])),u=M.reduce((l,b)=>l+f[b],0);return s>u&&(f.cacheRead+=s-u),{...a,tokens:f,total:X(f,n,t),mixAssumed:!1}}let i=t.token_mix.typical_claude_code,m=st(s,i.central),d={low:X(st(s,i.light),n,t).low,central:X(m,n,t).central,high:X(st(s,i.heavy),n,t).high};return{...a,tokens:m,total:d,mixAssumed:!0}}var Pn=Object.freeze({on:!1,after:23,until:5,persona:"random"});function It(e,t){if(!t)return e;let n=e.texts.flatMap(o=>te.activity?.(o)??[]);return{...e,pace:Ze(n,Ve(t))}}var Sn="No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";async function Ot(e,t){let n=[...e].filter(r=>r.name.endsWith(".jsonl"));if(!n.length)return{ok:!1,status:Sn};let o=[];for(let r of n)try{o.push(await r.text())}catch{return{ok:!1,status:"Couldn\'t read one of those files. Try again, or pick the files instead of the folder."}}return It({ok:!0,texts:o,what:`${n.length} file${n.length===1?"":"s"}`},t)}var _n="Paste the lines first.";function jt(e){return e==="pasted text"?"We couldn\'t find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.":`We couldn\'t find any Claude Code usage in ${e==="1 file"?"that file":"those files"}. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.`}function Wt(e,t){return e.trim()?It({ok:!0,texts:[e],what:"pasted text"},t):{ok:!1,status:_n}}var Cn={"7d":"last 7 days","30d":"last 30 days",all:"all time"},Ln={"7d":"a sample week","30d":"a sample month",all:"all sample data"};function lt(e,t){return(t==="sample"?Ln:Cn)[e]}var c=e=>document.getElementById(e),g=e=>e.replace(/[&<>"\']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"})[t]);function ht(e,t){try{return JSON.parse(c(e).textContent??"")}catch{return t}}var R=ht("ccwatts-data",{mode:"playground",generatedAt:null,rows:[]}),Zt=ht("ccwatts-sample",[]),Xt=ht("ccwatts-sample-pace",[]),v={rows:R.mode==="dashboard"&&R.rows.length?R.rows:Zt,source:R.mode==="dashboard"&&R.rows.length?"history":"sample",window:"30d"},L=R.mode==="dashboard"?{days:R.pace??null,source:"history",off:R.paceOff}:{days:Xt,source:"sample"};function An(e,t){if(t==="all"||e.length===0)return e;let n=t==="7d"?7:30,o=e.reduce((s,i)=>i.date>s?i.date:s,"0000-00-00"),r=v.source==="history"?Date.now():Date.parse(`${o}T00:00:00Z`)+864e5,a=new Date(r-n*864e5).toISOString().slice(0,10);return e.filter(s=>s.date>=a)}var pe="cache_read_vs_input",Ie=x.params[pe].value,q=x,J=()=>q!==x,oe=e=>`${Math.round(e*100)}%`;function Ut(e,t=x){let n=Te(Pe(e),t);return n.responses=e.reduce((o,r)=>o+r.responses,0),n}function Qt(e){let{low:t,central:n,high:o}=e.total;return t>0&&o>t?Math.min(1,Math.max(0,Math.log(n/t)/Math.log(o/t))):.5}function Nn(e,t){let n=C(e.total),[o,r]=n.central.split(" ");c("ov-energy-title").textContent=`Electricity \\xB7 ${t}${J()?" \\xB7 what-if":""}`,c("ov-energy-value").innerHTML=e.responses?`${g(o??"")} <small>${g(r??"")}</small>`:"No usage in this window";let a=c("ov-energy-bar");a.hidden=!e.responses,a.innerHTML=e.responses?`<span class="range-dot" style="left:${(Qt(e)*100).toFixed(1)}%"></span>`:"",c("ov-energy-detail").textContent=e.responses?`range ${n.range} ${n.unit} \\xB7 method v${x.version}`:`method v${x.version}`;let s=e.total.central?Math.round((e.byType.find(i=>i.key==="cacheRead")?.energy.central??0)/e.total.central*100):0;c("ov-drives-text").textContent=e.responses?`${s}% comes from re-reading the conversation`:"Load some usage to see what drives it"}function Hn(e,t){let n=C(e.total),[o,r]=n.central.split(" ");c("hero-eyebrow").innerHTML=`Claude Code electricity \\xB7 ${g(t)}${J()?` \\xB7 <span class="whatif-flag">what-if: cache reads ${oe(q.params[pe].value)} \\xB7 not published</span>`:""}`,c("hero-big").innerHTML=e.responses?`${g(o??"")}<small>${g(r??"")}</small>`:"\\u2013";let a=J()?`, with cache reads fixed at ${oe(q.params[pe].value)} and every other assumption at its bounds.`:", from the bounds on every assumption.";Dn(e,n,a),c("hero-compare").textContent=e.responses?`That\'s like ${Y(e.total.central/1e3,x).replace(" \\xB7 ",", or ")}.`:"";let s=M.reduce((m,d)=>m+e.tokens[d],0),i=[`${I(e.responses)} responses`,`${I(s)} tokens`,...e.span?[e.span.from===e.span.to?e.span.from:`${e.span.from} to ${e.span.to}`]:[],`method v${x.version}`];c("hero-meta").innerHTML=i.map(m=>`<span>${g(m)}</span>`).join(" \\xB7 ");for(let m of["7d","30d","all"])c(`w-${m}`).setAttribute("aria-pressed",String(v.window===m))}function Dn(e,t,n){let o=c("hero-range");if(!e.responses){o.setAttribute("aria-label","No usage in this window."),o.innerHTML=\'<span class="range-empty">No usage in this window.</span>\';return}let[r,a]=t.range.split(" \\u2013 "),s=Qt(e);o.setAttribute("aria-label",`Plausible range ${t.range} ${t.unit}, central ${t.central}${n}`),o.innerHTML=`<span class="range-track"><span class="range-dot" style="left:${(s*100).toFixed(1)}%"></span></span><span class="range-ends"><span class="range-low">${g(r??"")} ${g(t.unit)}</span><span class="range-cap">Plausible range<span class="range-scale"> \\xB7 log scale</span></span><span class="range-high">${g(a??"")} ${g(t.unit)}</span></span>`}var Ft=[["cacheRead","--c1"],["cacheWrite","--c2"],["output","--c3"],["input","--c4"]],en=e=>Math.round(Math.max(280,e.getBoundingClientRect().width||720));function mt(e){let t=c("chart"),n=en(t),o=240;t.setAttribute("viewBox",`0 0 ${n} ${o}`);let r={l:52,r:8,t:36,b:34},a=e.byDay;if(c("legend").innerHTML=Ft.map(([p,y])=>`<span><i style="background:var(${y})"></i>${Z[p]}</span>`).join(""),!a.length){t.innerHTML=`<text x="${n/2}" y="${o/2}" text-anchor="middle">No usage in this window</text>`,t.setAttribute("aria-label","Daily electricity by token type: no usage in this window");return}let s=C(e.total),i=s.unit==="kWh"?1e3:1,m=Math.max(...a.map(p=>p.energy.central))/i,d=tn(m/3),f=Math.max(d*Math.ceil(m/d),d),u=p=>r.t+(o-r.t-r.b)*(1-p/f),l=(n-r.l-r.r)/a.length,b=[];for(let p=0;p<=f+1e-9;p+=d)b.push(`<line x1="${r.l}" x2="${n-r.r}" y1="${u(p)}" y2="${u(p)}" stroke="var(--line)" stroke-width="1"/>`),b.push(`<text x="${r.l-8}" y="${u(p)+6}" text-anchor="end">${B(p)}</text>`);b.push(`<text x="0" y="17">${g(s.unit)} per day, central estimate</text>`),a.forEach((p,y)=>{let k=0,P=r.l+y*l+l*.12,z=Math.max(1,l*.76);for(let[S,j]of Ft){let W=In(p,S);if(W<=0)continue;let T=k/i;k+=W;let G=k/i;b.push(`<rect x="${P.toFixed(1)}" y="${u(G).toFixed(1)}" width="${z.toFixed(1)}" height="${Math.max(.5,u(T)-u(G)).toFixed(1)}" fill="var(${j})"><title>${g(p.key)} ${g(Z[S])} ${B(W/i)} ${g(s.unit)}</title></rect>`)}});let w=a.length-1,h=a.length===1?[0]:n<480?[0,w]:[0,Math.floor(w/2),w];for(let p of new Set(h)){let y=p===0?"start":p===w?"end":"middle",k=p===0?r.l:p===w?n-r.r:r.l+(p+.5)*l;b.push(`<text x="${k}" y="${o-8}" text-anchor="${y}">${g(a[p].key.slice(5))}</text>`)}t.innerHTML=b.join(""),t.setAttribute("aria-label",`Daily electricity by token type. Bars show the central estimate per day. The total for this window is ${s.central}, with a range of ${s.range} ${s.unit}.`)}function In(e,t){return Ae.get(e.key)?.[t]??0}var Ae=new Map;function On(e,t){Ae=new Map;for(let n of e){let o=Te(Pe([n]),t),r=Ae.get(n.date);r||Ae.set(n.date,r={input:0,cacheWrite:0,cacheRead:0,output:0});for(let a of o.byType)r[a.key]+=a.energy.central}}function tn(e){if(e<=0)return 1;let t=10**Math.floor(Math.log10(e)),n=e/t;return(n<=1?1:n<=2?2:n<=5?5:10)*t}function Bt(e,t,n,o){let r=Math.max(...t.map(s=>s.energy.central),1e-9),a=t.slice(0,6);c(e).innerHTML=a.length?a.map(s=>{let i=C(s.energy),m=o.total.central?Math.round(s.energy.central/o.total.central*100):0;return`<li><span class="name" title="${g(n(s.key))}">${g(n(s.key))}</span><span class="val"><b>${g(i.central)}</b> \\xB7 ${m}%</span><span class="bar"><span style="width:${(s.energy.central/r*100).toFixed(1)}%"></span></span><span class="rng">range ${g(i.range)} ${g(i.unit)}</span></li>`}).join(""):\'<li><span class="name">No usage in this window</span></li>\'}function jn(e){let t=r=>e.total.central?Math.round((e.byType.find(a=>a.key===r)?.energy.central??0)/e.total.central*100):0,n=M.reduce((r,a)=>r+e.tokens[a],0),o=n?Math.round(e.tokens.cacheRead/n*100):0;c("explain").textContent=e.responses?`Most of the electricity comes from re-reading the conversation so far (${t("cacheRead")}% here). A fresh session per task is the simplest way to lower it.`:"Load some usage to see what drives it.",c("explain-box").hidden=!e.responses,c("explain-more").textContent=e.responses?`Each time Claude Code takes a step, it re-reads the conversation so far. Most of that comes from a cache, which is cheap per token but happens constantly. Here, cache reads were ${o}% of tokens and about ${t("cacheRead")}% of the electricity. Writing new context into the cache was ${t("cacheWrite")}%, and the text the model wrote back was ${t("output")}%. Long sessions grow the context the agent re-reads, so starting fresh sessions for new tasks is the simplest way to lower your number.`:""}function Wn(){let e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}var Ne=_e(x.pace.late_night.start_hour),Un={sample:"Sample data",history:"Your history",files:"Your files"},he=[];function Fn(){let e=L.days,t=e===null,n=L.source==="history"?Wn():(e??[]).reduce((d,f)=>f.date>d?f.date:d,"0000-00-00"),o=e&&e.length?nt(e,n,4):[],r=o.some(d=>d.activeHours.high>0||d.agentHours.high>0);he=r?o:[];let a=c("pace-pill");a.hidden=t,a.textContent=Un[L.source],a.classList.toggle("sample",L.source==="sample"),c("pace-optin").hidden=!t||!!L.off,c("pace-skipped").hidden=!t||L.off!=="skipped",c("pace-unreadable").hidden=!t||L.off!=="unreadable",c("pace-body").toggleAttribute("hidden",!r);let s=c("pace-empty");if(s.hidden=t||r,s.textContent=L.source==="files"?"No pace for these files: they hold no timed turns to count.":"No active time in the last 4 weeks yet. Pace fills in as you use Claude Code.",!r){c("pace-chart").innerHTML="",c("pace-table").innerHTML="",Yt(null,t?c("pace-optin").textContent??"":s.textContent);return}let i=ot(o,x);c("pace-lead").innerHTML=`<b>${g(le(i.lead))}</b>, ${g(le(i.rest))}`,c("pace-sofar").textContent=i.soFar?le(i.soFar):"",c("pace-sofar").hidden=!i.soFar,c("pace-agents").textContent=i.agents?le(i.agents):"",c("pace-agents").hidden=!i.agents,gt(o),Yt({week:o[i.focus],current:i.focus===0},"");let m=o.map((d,f)=>`<tr><td>${g(dt(d,f))}</td><td>${g(D(d.activeHours))}</td><td>${g(U(d.lateNightHours*60))}</td><td>${g(U(d.longestStretchMinutes))}</td><td>${d.restDays}</td><td>${g(D(d.agentHours))}</td></tr>`).join("");c("pace-table").innerHTML=`<caption>Pace by week, newest first</caption><thead><tr><th>Week of</th><th>Active (h)</th><th>Past ${g(Ne)}</th><th>Longest</th><th>Days off</th><th>Agent-only (h)</th></tr></thead><tbody>${m}</tbody>`}function Yt(e,t){if(!e){c("ov-pace-title").textContent="Pace",c("ov-pace-text").textContent=L.days===null?"Pace is off. Open to see how to turn it on.":t,c("ov-pace-detail").textContent="";return}let{week:n,current:o}=e;c("ov-pace-title").textContent=`Pace \\xB7 ${o?"this week so far":`week of ${ne(n.start)}`}`,c("ov-pace-text").textContent=`About ${H(n.activeHours.central)} active hours`,c("ov-pace-detail").textContent=le(`range ${D(n.activeHours)} hours`)}var le=e=>e.replace(/(\\d+h) (\\d+m)/g,"$1\\xA0$2").replace(/(\\d) \u2013 (\\d)/g,"$1\\xA0\\u2013\\xA0$2"),dt=(e,t)=>t===0?`${ne(e.start)} (so far)`:ne(e.start);function gt(e){let t=c("pace-chart"),n=en(t),o=270;t.setAttribute("viewBox",`0 0 ${n} ${o}`);let r={l:40,r:8,t:56,b:56},a=[...e].reverse(),s=Math.max(...a.map(h=>Math.max(h.activeHours.high,h.agentHours.high)),1),i=tn(s/3),m=Math.max(i*Math.ceil(s/i),i),d=h=>r.t+(o-r.t-r.b)*(1-h/m),f=(n-r.l-r.r)/a.length,u=[];for(let h=0;h<=m+1e-9;h+=i)u.push(`<line x1="${r.l}" x2="${n-r.r}" y1="${d(h)}" y2="${d(h)}" stroke="var(--line)" stroke-width="1"/>`),u.push(`<text x="${r.l-8}" y="${d(h)+6}" text-anchor="end">${B(h)}</text>`);u.push(\'<text x="0" y="17">hours per week, starting Monday</text>\'),u.push(\'<defs><pattern id="sofar" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" stroke-width="3"/></pattern></defs>\');let l=h=>h.toFixed(1),b=(h,p,y,k)=>{if(y<=p)return"";let P=5;return`<path d="M${l(h)} ${l(d(p))}V${l(d(y))}M${l(h-P)} ${l(d(y))}H${l(h+P)}M${l(h-P)} ${l(d(p))}H${l(h+P)}" stroke="${k}" stroke-width="1.5" fill="none"/>`};a.forEach((h,p)=>{let y=dt(h,a.length-1-p),k=Math.min(56,f*.36),P=Math.min(48,f*.26),z=Math.max(4,f*.04),S=r.l+p*f+(f-k-z-P)/2,j=S+k+z,W=d(0),T=h.activeHours,G=Math.min(h.lateNightHours,T.central),fe=h===e[0],ye=(E,A,V)=>fe&&V>0?`<rect x="${l(E)}" y="${l(d(V))}" width="${l(A)}" height="${l(Math.max(.5,W-d(V)))}" rx="2" fill="url(#sofar)" aria-hidden="true"/>`:"",K=`Week of ${y}: about ${H(T.central)} active hours (range ${D(T)}), ${U(h.lateNightHours*60)} past ${Ne}`;T.central>0&&(u.push(`<rect x="${l(S)}" y="${l(d(T.central))}" width="${l(k)}" height="${l(Math.max(.5,W-d(T.central)))}" rx="2" fill="var(--c1)"><title>${g(K)}</title></rect>`),G>0&&u.push(`<rect x="${l(S)}" y="${l(d(T.central))}" width="${l(k)}" height="${l(Math.max(1.5,d(T.central-G)-d(T.central)))}" rx="2" fill="var(--c2)"><title>${g(`${U(h.lateNightHours*60)} past ${Ne}`)}</title></rect>`),u.push(ye(S,k,T.central))),u.push(b(S+k/2,T.low,T.high,"var(--ink)")),T.high>0&&u.push(`<text class="val" x="${l(S+k/2)}" y="${l(d(T.high)-8)}" text-anchor="middle">${g(H(T.central))}h</text>`);let _=h.agentHours;_.central>0&&(u.push(`<rect x="${l(j)}" y="${l(d(_.central))}" width="${l(P)}" height="${l(Math.max(.5,W-d(_.central)))}" rx="2" class="agent"><title>${g(`Agents on their own: about ${H(_.central)} hours (range ${D(_)})`)}</title></rect>`),u.push(ye(j,P,_.central)),u.push(b(j+P/2,_.low,_.high,"var(--muted)")));let we=r.l+(p+.5)*f,[be,$]=y.split(" (");u.push(`<text x="${l(we)}" y="${o-30}" text-anchor="middle">${g(be)}</text>`),$&&u.push(`<text x="${l(we)}" y="${o-6}" text-anchor="middle">${g($.replace(")",""))}</text>`)}),t.innerHTML=u.join("");let w=e.map((h,p)=>`week of ${dt(h,p)}: about ${H(h.activeHours.central)} active hours (range ${D(h.activeHours)}), ${U(h.lateNightHours*60)} past ${Ne}, agent-only ${D(h.agentHours)} hours`).join("; ");t.setAttribute("aria-label",`Pace for the last ${e.length} weeks, newest first: ${w}.`)}var He="",Ce="",nn="",pt="";function Bn(e,t){let n={estimate:e,params:x,windowLabel:t,sample:v.source==="sample"};He=ze(n),nn=Me(n),pt=Ye(n);let o=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(He)}`;c("card").src=o,c("ov-share-thumb").src=o,Ce&&URL.revokeObjectURL(Ce),Ce=URL.createObjectURL(new Blob([He],{type:"image/svg+xml"})),c("card-full").href=Ce,c("post").textContent=pt,c("share-status").textContent=v.source==="sample"?"This card shows sample data. Load your own logs to make yours.":""}function Yn(e){try{return new URL(e).hostname.replace(/^www\\./,"")}catch{return"source"}}function zn(){c("method-intro").textContent="Energy = tokens \\xD7 energy per token, by model family and token type. Each parameter has a low and high bound, and they combine into the range you see.",c("method-more").textContent=`The boundary is ${x.boundary}. Labels say how solid each number is: MODELED is derived from published figures, GUESS is a best estimate with wide bounds. Method v${x.version}, parameters as of ${x.as_of}, licensed ${x.license}.`;let e=Object.entries(x.params).map(([t,n])=>`<tr><td data-label="Parameter"><code>${g(t)}</code><div class="note">${g(n.note)}</div></td><td class="num" data-label="Value">${n.value}</td><td class="num" data-label="Range">${n.low} \\u2013 ${n.high}</td><td data-label="Unit">${g(n.unit)}</td><td data-label="Label"><span class="label">${g(n.label)}</span></td><td data-label="Source"><a class="src" href="${g(n.source)}" rel="noopener noreferrer">${g(Yn(n.source))}</a></td></tr>`).join("");c("params").innerHTML=`<thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead><tbody>${e}</tbody>`}var Gn={sample:"Electricity estimates for Claude Code, the AI coding agent, from its local logs. Try it on your own logs below.",files:"Electricity estimates for Claude Code, the AI coding agent, from its local logs. You\'re looking at the files you loaded.",history:"Electricity estimates for your Claude Code use, from its local logs, with every assumption sourced."},me=null;function ge(e=!0){let t=An(v.rows,v.window);On(t,q);let n=Ut(t),o=J()?Ut(t,q):n;me=o;let r=lt(v.window,v.source),a=c("source-pill");a.textContent=v.source==="sample"?"Sample data":v.source==="history"?"Your history":"Your files",a.classList.toggle("sample",v.source==="sample"),a.hidden=R.mode==="playground";let s=v.source!=="sample";c("demo-sum-sample").hidden=s,c("demo-copy-sample").hidden=s,c("demo-sum-files").hidden=!s,c("demo-copy-files").hidden=!s,c("lede").textContent=Gn[v.source],Hn(o,r),Nn(o,r),mt(o),Bt("by-model",o.byModel,re,o),Bt("by-project",o.byProject,Fe,o),jn(o),Jn(o,n),e&&Bn(n,lt(v.window,"history")),Fn()}function Jn(e,t){let n=q.params[pe].value;c("whatif-cache").setAttribute("aria-valuetext",`${oe(n)} of fresh input`),c("whatif-value").textContent=oe(n);let r=c("whatif-note");if(r.hidden=!J(),c("whatif-reset").hidden=!J(),!J())return void(r.textContent="");let a=C(e.total),s=C(t.total),i=e.responses?` ${a.central} (range ${a.range} ${a.unit}). Published: ${s.central} (range ${s.range} ${s.unit}).`:" Not the published estimate.";r.textContent=`What-if at ${oe(n)}:${i} The share card keeps ${oe(Ie)}. Method v${x.version}.`}function zt(e){q=Math.abs(e-Ie)<1e-9?x:qe(x,{[pe]:e},{pin:!0}),ge(!1)}function ut(){let e=c("manual-result"),t=c("manual-tokens").value,n=it(t);if(e.classList.toggle("error",t.trim()!==""&&n===null),t.trim()==="")return void(e.textContent="");if(n===null)return void(e.textContent="Couldn\'t read that as a token count. Try 88.8M, 1.2k or 88800000.");let o=ct({tokens:n,model:c("manual-model").value},x),r=C(o.total);e.innerHTML=[`<span class="manual-kwh">\\u2248 <b>${g(r.central)}</b> (range ${g(r.range)})</span>`,`<span class="manual-compare">\\u2248 ${g(Y(o.total.central/1e3,x))}</span>`,`<span class="meta">Method v${g(o.methodVersion)} \\xB7 typical Claude Code mix assumed</span>`,`<span class="meta">${g(at)}</span>`].join("")}function ue(e,t=!1){let n=c("drop-status");n.textContent=e,n.classList.toggle("error",t),t&&n.scrollIntoView({block:"nearest"})}function on(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||void 0}catch{return}}async function Gt(e){ue("Reading files on this device\\u2026"),rn(await Ot(e,on()))}function rn(e){if(!e.ok)return ue(e.status,!0);let t=[];for(let o of e.texts)t.push(...te.parse(o));let n=Xe(rt(t));if(!n.length)return ue(jt(e.what),!0);v.rows=n,v.source="files",v.window="all",L.days=e.pace??[],L.source="files",ue(`Read ${I(t.length)} responses from ${e.what}. Nothing was uploaded.`),ge()}function sn(e,t){let n=document.createElement("a");n.href=URL.createObjectURL(t),n.download=e,document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(n.href),1e3)}async function De(e,t,n="share-status",o="post"){let r=c(n);r.classList.remove("error");try{return await navigator.clipboard.writeText(e),r.textContent=`Copied the ${t}.`,!0}catch{let a=c(o).closest("details");a&&(a.open=!0);let s=document.createRange();return s.selectNodeContents(c(o)),getSelection()?.removeAllRanges(),getSelection()?.addRange(s),r.textContent=`Couldn\'t reach the clipboard. The ${o==="post"?"post text":t} is selected so you can copy it.`,!1}}function qn(){let e=window.matchMedia("(max-width:600px)"),t=c("cloud"),n=c("pick-folder").closest(".controls"),o=c("export"),r=()=>{e.matches?n.before(t):o.before(t)};r(),t.open=e.matches,e.addEventListener("change",r)}var Jt=0;async function Kn(){let e=c("copy-cloud");await De(c("cloud-prompt").textContent??"","prompt","drop-status","cloud-prompt")&&(e.textContent="Copied",clearTimeout(Jt),Jt=window.setTimeout(()=>e.textContent="Copy prompt",2e3))}function Vn(){let e=new Image;e.onload=()=>{let t=document.createElement("canvas");t.width=1200,t.height=627,t.getContext("2d").drawImage(e,0,0,1200,627),t.toBlob(n=>n&&sn(`${N}-receipt.png`,n),"image/png")},e.src=c("card").src}function Zn(){for(let r of["7d","30d","all"])c(`w-${r}`).addEventListener("click",()=>{v.window=r,ge()});if(c("save-png").addEventListener("click",Vn),c("save-svg").addEventListener("click",()=>sn(`${N}-receipt.svg`,new Blob([He],{type:"image/svg+xml"}))),c("copy-line").addEventListener("click",()=>{De(nn,"share line")}),c("copy-post").addEventListener("click",()=>{De(pt,"LinkedIn post")}),R.mode==="playground"){let r=c("drop");c("ov-logs").hidden=!1,qn(),c("copy-cloud").addEventListener("click",()=>{Kn()}),c("copy-prompt").addEventListener("click",()=>{De(c("export-prompt").textContent??"","prompt","drop-status","export-prompt")}),c("read-paste").addEventListener("click",()=>{rn(Wt(c("paste-log").value,on()))});for(let s of["pick-folder","pick-files"])c(s).addEventListener("change",i=>{let m=i.target.files;m&&Gt(m)});c("use-sample").addEventListener("click",()=>{v.rows=Zt,v.source="sample",v.window="30d",L.days=Xt,L.source="sample",ue(""),ge()});let a=s=>i=>{i.preventDefault(),r.classList.toggle("over",s)};r.addEventListener("dragover",a(!0)),r.addEventListener("dragleave",a(!1)),r.addEventListener("drop",s=>{a(!1)(s),s.dataTransfer?.files&&Gt(s.dataTransfer.files)})}Qn(),eo();let e=0,t=window.innerWidth;window.addEventListener("resize",()=>{clearTimeout(e),e=window.setTimeout(()=>{window.innerWidth!==t&&(t=window.innerWidth,me&&mt(me),he.length&&gt(he))},150)});for(let r of["manual-tokens","manual-model"])c(r).addEventListener("input",ut);c("manual-model").addEventListener("change",ut),ut();let n=c("whatif-cache");n.addEventListener("input",()=>zt(Number(n.value))),c("whatif-reset").addEventListener("click",()=>{n.value=String(Ie),zt(Ie),n.focus()}),c("repo-link").href=F,c("cli-cmd").textContent=`npx ${N}`,c("built-by").href=xe,R.mode==="playground"&&to(),Oe();let o=R.generatedAt?` \\xB7 written ${R.generatedAt.slice(0,16).replace("T"," ")} UTC`:"";c("footer-version").textContent=`${N} v${je} \\xB7 method v${x.version}${o}. Electricity only, not carbon or water.`,document.title=R.mode==="dashboard"?`${N} dashboard`:`${N} playground`}var de=()=>[...document.querySelectorAll("#tabs [role=tab]")],qt=e=>de().find(t=>t.dataset.hash===e);function Xn(e,t=!1){for(let r of de()){let a=r===e;r.setAttribute("aria-selected",String(a)),r.setAttribute("tabindex",a?"0":"-1"),c(r.getAttribute("aria-controls")??"").hidden=!a}t&&e.focus({preventScroll:!0});let n=c("tabs");n.scrollWidth>n.clientWidth+1&&e.scrollIntoView({inline:"nearest",block:"nearest"});let o=e.getAttribute("aria-controls");o==="p-electricity"&&me&&mt(me),o==="pace"&&he.length&&gt(he)}function Oe(){let e=location.hash==="#drop"&&R.mode==="playground";Xn((e?void 0:qt(location.hash))??qt("")),c("ov-list").hidden=e,c("drop").hidden=!e,c("drop-back").hidden=!e}function Le(e,t=!1){if(e!==location.hash){let n=e||location.pathname+location.search;try{history[t?"replaceState":"pushState"](null,"",n)}catch{location.hash=e;return}}Oe()}function Kt(){let e=c("privacy").getBoundingClientRect().bottom+window.scrollY;window.scrollY>e&&window.scrollTo({top:e})}function Qn(){let e=c("tabs");for(let t of de())t.addEventListener("click",()=>{Le(t.dataset.hash??""),Kt()});e.addEventListener("keydown",t=>{let n=de(),o=n.indexOf(document.activeElement);if(o<0)return;let r={ArrowRight:o+1,ArrowLeft:o-1,Home:0,End:n.length-1}[t.key];if(r===void 0)return;t.preventDefault();let a=n[(r+n.length)%n.length];Le(a.dataset.hash??"",!0),a.focus({preventScroll:!0})});for(let t of["ov-energy","ov-pace","ov-share","ov-logs","drop-back"]){let n=c(t);n.addEventListener("click",o=>{o.preventDefault(),Le(t==="drop-back"?"":n.getAttribute("href")??""),Kt(),(t==="ov-logs"?c("drop-back"):t==="drop-back"?c("ov-logs"):de().find(a=>a.getAttribute("aria-selected")==="true"))?.focus({preventScroll:!0})})}c("ov-drives").addEventListener("click",t=>{t.preventDefault(),Le("#electricity"),c("drives").scrollIntoView({block:"start"}),c("tab-electricity").focus({preventScroll:!0})}),window.addEventListener("popstate",Oe),window.addEventListener("hashchange",Oe)}function Vt(e){let t=document.documentElement;e==="light"||e==="dark"?t.dataset.theme=e:delete t.dataset.theme;for(let n of document.querySelectorAll("[data-theme-pick]"))n.setAttribute("aria-pressed",String(n.dataset.themePick===(t.dataset.theme??"system")))}function eo(){Vt("system");for(let e of document.querySelectorAll("[data-theme-pick]"))e.addEventListener("click",()=>Vt(e.dataset.themePick??"system"))}function to(){let e=c("demo-bar"),t=c("demo-toggle"),n=c("demo-panel");for(let r of["demo-home","demo-back"])c(r).href=xe;c("demo-code").href=F;let o=r=>{t.setAttribute("aria-expanded",String(r)),n.hidden=!r};t.addEventListener("click",()=>o(n.hidden)),e.addEventListener("keydown",r=>{r.key==="Escape"&&!n.hidden&&(o(!1),t.focus())}),e.hidden=!1}Zn();zn();ge();})();</script>\n</body>\n</html>\n';

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
  const lines = [header(params, window), "", table([dim, "tokens", unit, "range", "share"], body, 1, { dimCols: [3], color: opts.color })];
  if (e.warnings.length) lines.push("", ...e.warnings.map((w) => `  Note          ${w}`));
  return lines.join("\n");
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
function mixLine(params) {
  const central = params.token_mix.typical_claude_code.central;
  return [...TOKEN_TYPES].sort((a, b) => central[b] - central[a]).slice(0, 3).map((k) => `${Math.round(central[k] * 1e3) / 10}% ${TYPE_LABELS[k]}`).join(", ");
}
function manual(r, params, opts = {}) {
  const { bold, dim } = styles(opts.color);
  const total2 = energy(r.total);
  const given = TOKEN_TYPES.filter((k) => r.tokens[k] > 0).sort((a, b) => r.tokens[b] - r.tokens[a]).map((k) => `${int(r.tokens[k])} ${TYPE_LABELS[k]}`).join(", ");
  const lines = [
    `${APP_NAME} v${APP_VERSION} \xB7 method v${params.version} \xB7 a token count you entered`,
    "",
    `  Electricity   ${bold(total2.central)}   ${dim(`(range ${total2.range})`)}`,
    `  \u2248 ${everyday(r.total.central / 1e3, params)}`,
    "",
    `  Model         ${clip(r.model)}${r.knownModel ? "" : ` (counted as ${r.tier})`}`,
    `  Tokens        ${int(totalTokens2(r.tokens))} \xB7 ${r.mixAssumed ? `mix assumed: ${mixLine(params)}` : given}`
  ];
  for (const w of r.warnings) lines.push(`  Note          ${w}`);
  lines.push("");
  if (r.mixAssumed) {
    lines.push(dim(`  ${MIX_GUESSED}`));
    lines.push(dim(`  Know the split? Add --output, --cache-read, --cache-write or --input to narrow it.`));
  }
  lines.push(dim(`  How this is estimated: ${APP_NAME} --method`));
  return lines.join("\n");
}
function manualJson(r, params) {
  return JSON.stringify(
    {
      app: APP_NAME,
      version: APP_VERSION,
      methodVersion: r.methodVersion,
      unit: "Wh",
      source: "manual",
      model: r.model,
      tier: r.tier,
      tokens: r.tokens,
      mixAssumed: r.mixAssumed,
      wh: r.total,
      comparisons: comparisons(r.total.central / 1e3, params).map(({ id, amount }) => ({ id, amount }))
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
  estimate          Estimate from a token count you enter (e.g. 88.8M)
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
  --model <name>    With estimate: opus, sonnet or haiku (default opus)
  --input <n>       With estimate: input tokens, if you know the split
  --cache-write <n> With estimate: cache write tokens
  --cache-read <n>  With estimate: cache read tokens
  --output <n>      With estimate: output tokens
  -v, --version     Show the version
  -h, --help        Show this help

estimate reads no logs and saves nothing. Use it for a cloud thread or chat
that shows a token total. Without a split it assumes a typical Claude Code mix,
so the range is wider. A split you give is used as-is; the rest of the total
counts as cache read.

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
var SPLIT_FLAGS = { input: "input", "cache-write": "cacheWrite", "cache-read": "cacheRead", output: "output" };
var ESTIMATE_FLAGS = ["model", "json", "help", ...Object.keys(SPLIT_FLAGS)];
var ESTIMATE_EXAMPLE = `${APP_NAME} estimate 88.8M --model opus`;
var DIMS = ["model", "day", "project", "type"];
var COMMANDS = ["summary", "estimate", "history", "pace", "receipt", "dashboard", "statusline", "nudge", "mcp", "help"];
function plainArgError(error) {
  const code = error.code;
  const message = error instanceof Error ? error.message : "";
  const option = message.match(/'(-{1,2}[\w-]+)/)?.[1];
  const help = `Run ${APP_NAME} --help to see the options.`;
  const negative = process.argv.slice(2).find((a) => /^-[\d.]/.test(a));
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && negative && process.argv[2] === "estimate")
    return new Error(`Couldn't read "${negative}" as a token count. Try 88.8M, 1.2k or 88800000.`);
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
      model: { type: "string" },
      input: { type: "string" },
      "cache-write": { type: "string" },
      "cache-read": { type: "string" },
      output: { type: "string" },
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
  if (command === "estimate") {
    const other = Object.keys(values).filter((k) => values[k] !== void 0 && !ESTIMATE_FLAGS.includes(k));
    if (other.length > 0) throw new Error(`${APP_NAME} estimate takes only --model, --json and the split options, not --${other[0]}. Try: ${ESTIMATE_EXAMPLE}`);
    if (positionals[1] === void 0) throw new Error(`Give a token count, e.g. ${ESTIMATE_EXAMPLE}`);
    if (positionals.length > 2) throw new Error(`${APP_NAME} estimate takes one token count. Try: ${ESTIMATE_EXAMPLE}`);
    const count2 = (text) => {
      const n = parseTokenCount(text);
      if (n === null) throw new Error(`Couldn't read "${text}" as a token count. Try 88.8M, 1.2k or 88800000.`);
      return n;
    };
    const tokens = count2(positionals[1]);
    const mix2 = {};
    for (const [flag, type] of Object.entries(SPLIT_FLAGS)) {
      const text = values[flag];
      if (text !== void 0) mix2[type] = count2(text);
    }
    const r = estimateFromTotal({ tokens, model: values.model ?? "opus", ...Object.keys(mix2).length ? { mix: mix2 } : {} }, params);
    if (values.json) {
      for (const w of r.warnings) console.error(`Note: ${w}`);
      return void console.log(manualJson(r, params));
    }
    return void console.log(manual(r, params, { color: useColor() }));
  }
  const estimateOnly = [values.model, values.input, values["cache-write"], values["cache-read"], values.output].some((v) => v !== void 0);
  if (estimateOnly) throw new Error(`--model and the split options work with ${APP_NAME} estimate. Try: ${ESTIMATE_EXAMPLE}`);
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
    const today = localToday(nudgeNow());
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
