import {
  APP_NAME,
  APP_VERSION,
  PORTFOLIO_URL,
  REPO_URL,
  TOKEN_TYPES,
  TYPE_LABELS,
  claudeCodeAdapter,
  dedupe,
  defaultParams as params,
  estimate,
  everyday,
  formatEnergy,
  int,
  linkedInPost,
  num,
  projectName,
  receiptSvg,
  rollup,
  rollupRecords,
  shareLine,
  shortModel,
  type Breakdown,
  type Estimate,
  type RollupRow,
  type TokenType,
  type UsageRecord,
} from "@ccwatts/core";
import type { PagePayload } from "./inject.js";
import { readLogFiles } from "./read.js";

type WindowId = "7d" | "30d" | "all";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function readJson<T>(id: string, fallback: T): T {
  try {
    return JSON.parse($(id).textContent ?? "") as T;
  } catch {
    return fallback;
  }
}

const payload = readJson<PagePayload>("ccwatts-data", { mode: "playground", generatedAt: null, rows: [] });
const sample = readJson<RollupRow[]>("ccwatts-sample", []);

const state: { rows: RollupRow[]; source: "history" | "sample" | "files"; window: WindowId } = {
  rows: payload.mode === "dashboard" && payload.rows.length ? payload.rows : sample,
  source: payload.mode === "dashboard" && payload.rows.length ? "history" : "sample",
  window: "30d",
};

const WINDOW_LABEL: Record<WindowId, string> = { "7d": "last 7 days", "30d": "last 30 days", all: "all time" };

/** Windows count back from today for real data, and from the last day in the file for sample data. */
function windowRows(rows: RollupRow[], id: WindowId): RollupRow[] {
  if (id === "all" || rows.length === 0) return rows;
  const days = id === "7d" ? 7 : 30;
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "0000-00-00");
  // Same cut as the CLI: keep days on or after the start date.
  const anchor = state.source === "history" ? Date.now() : Date.parse(`${last}T00:00:00Z`) + 86_400_000;
  const start = new Date(anchor - days * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= start);
}

function estimateFor(rows: RollupRow[]): Estimate {
  const e = estimate(rollupRecords(rows), params);
  e.responses = rows.reduce((n, r) => n + r.responses, 0);
  return e;
}

function renderHero(e: Estimate, label: string) {
  const t = formatEnergy(e.total);
  const [value, unit] = t.central.split(" ");
  $("hero-eyebrow").textContent = `Claude Code electricity · ${label}`;
  $("hero-big").innerHTML = e.responses ? `${esc(value ?? "")}<small>${esc(unit ?? "")}</small>` : "–";
  $("hero-range").textContent = e.responses ? `Plausible range ${t.range} ${t.unit}, from the bounds on every assumption.` : "No usage in this window.";
  $("hero-compare").textContent = e.responses ? `That's like ${everyday(e.total.central / 1000, params).replace(" · ", ", or ")}.` : "";
  const tokens = TOKEN_TYPES.reduce((s, k) => s + e.tokens[k], 0);
  // One span per item, kept whole, so a phone wraps between items and never inside a date.
  const items = [`${int(e.responses)} responses`, `${int(tokens)} tokens`, ...(e.span ? [`${e.span.from} to ${e.span.to}`] : []), `method v${params.version}`];
  $("hero-meta").innerHTML = items.map((i) => `<span>${esc(i)}</span>`).join(" · ");
  for (const id of ["7d", "30d", "all"] as WindowId[]) $(`w-${id}`).setAttribute("aria-pressed", String(state.window === id));
}

function renderChart(e: Estimate) {
  const svg = $("chart");
  // Draw at the chart's on-screen width (320 to 720 px) so labels keep their size on a phone.
  const W = Math.round(Math.min(720, Math.max(320, svg.getBoundingClientRect().width || 720)));
  const H = 240;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pad = { l: 44, r: 8, t: 22, b: 28 };
  const days = e.byDay;
  $("legend").innerHTML = (["cacheRead", "cacheWrite", "output", "input"] as TokenType[]).map((t) => `<span><i style="background:var(--t-${t})"></i>${TYPE_LABELS[t]}</span>`).join("");
  if (!days.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">No usage in this window</text>`;
    $("chart-note").textContent = "";
    return;
  }
  const total = formatEnergy(e.total);
  const scale = total.unit === "kWh" ? 1000 : 1;
  const max = Math.max(...days.map((d) => d.energy.central)) / scale;
  const step = niceStep(max / 3);
  const top = Math.max(step * Math.ceil(max / step), step);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const bw = (W - pad.l - pad.r) / days.length;
  const parts: string[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`);
    parts.push(`<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`);
  }
  parts.push(`<text x="0" y="10">${total.unit} per day</text>`);
  // Each day's energy split by token type, using that day's type shares of the central value.
  days.forEach((d, i) => {
    let acc = 0;
    const x = pad.l + i * bw + bw * 0.12;
    const w = Math.max(1, bw * 0.76);
    for (const type of ["cacheRead", "cacheWrite", "output", "input"] as TokenType[]) {
      const wh = typeShare(d, type);
      if (wh <= 0) continue;
      const v0 = acc / scale;
      acc += wh;
      const v1 = acc / scale;
      parts.push(`<rect x="${x.toFixed(1)}" y="${y(v1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, y(v0) - y(v1)).toFixed(1)}" fill="var(--t-${type})"><title>${d.key} ${TYPE_LABELS[type]} ${num(wh / scale)} ${total.unit}</title></rect>`);
    }
  });
  const labelIdx = days.length === 1 ? [0] : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  for (const i of new Set(labelIdx)) {
    const anchor = i === 0 ? "start" : i === days.length - 1 ? "end" : "middle";
    const x = i === 0 ? pad.l : i === days.length - 1 ? W - pad.r : pad.l + (i + 0.5) * bw;
    parts.push(`<text x="${x}" y="${H - 8}" text-anchor="${anchor}">${days[i]!.key.slice(5)}</text>`);
  }
  svg.innerHTML = parts.join("");
  $("chart-note").textContent = `Bars show the central estimate per day. The total for this window is ${total.central}, with a range of ${total.range} ${total.unit}.`;
}

/** Energy of one token type within a day row, from the day's own breakdown. */
function typeShare(day: Breakdown, type: TokenType): number {
  // Day rows carry token counts by type but energy only in total, so price the type on its own.
  const dayEstimate = dayTypeCache.get(day.key);
  return dayEstimate?.[type] ?? 0;
}
let dayTypeCache = new Map<string, Record<TokenType, number>>();

function buildDayTypeCache(rows: RollupRow[]) {
  dayTypeCache = new Map();
  for (const r of rows) {
    const e = estimate(rollupRecords([r]), params);
    let entry = dayTypeCache.get(r.date);
    if (!entry) dayTypeCache.set(r.date, (entry = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }));
    for (const b of e.byType) entry[b.key as TokenType] += b.energy.central;
  }
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function renderRank(id: string, rows: Breakdown[], label: (k: string) => string, e: Estimate) {
  const max = Math.max(...rows.map((r) => r.energy.central), 1e-9);
  const list = rows.slice(0, 6);
  $(id).innerHTML = list.length
    ? list
        .map((r) => {
          const t = formatEnergy(r.energy);
          const pct = e.total.central ? Math.round((r.energy.central / e.total.central) * 100) : 0;
          return `<li><span class="name" title="${esc(label(r.key))}">${esc(label(r.key))}</span><span class="val">${esc(t.central)} · ${pct}%</span><span class="bar"><span style="width:${((r.energy.central / max) * 100).toFixed(1)}%"></span></span><span class="val" style="grid-column:1/-1;text-align:left">range ${esc(t.range)} ${esc(t.unit)}</span></li>`;
        })
        .join("")
    : `<li><span class="name">No usage in this window</span></li>`;
}

function renderExplain(e: Estimate) {
  const share = (k: TokenType) => (e.total.central ? Math.round(((e.byType.find((b) => b.key === k)?.energy.central ?? 0) / e.total.central) * 100) : 0);
  const tokens = TOKEN_TYPES.reduce((s, k) => s + e.tokens[k], 0);
  const readTokens = tokens ? Math.round((e.tokens.cacheRead / tokens) * 100) : 0;
  $("explain").textContent = e.responses
    ? `Each time Claude Code takes a step, it re-reads the conversation so far. Most of that comes from a cache, which is cheap per token but happens constantly. Here, cache reads were ${readTokens}% of tokens and about ${share("cacheRead")}% of the electricity. Writing new context into the cache was ${share("cacheWrite")}%, and the text the model wrote back was ${share("output")}%. Long sessions grow the context the agent re-reads, so starting fresh sessions for new tasks is the simplest way to lower your number.`
    : "Load some usage to see what drives it.";
}

let currentSvg = "";
let currentLine = "";
let currentPost = "";

function renderShare(e: Estimate, label: string) {
  const input = { estimate: e, params, windowLabel: label, sample: state.source === "sample" };
  currentSvg = receiptSvg(input);
  currentLine = shareLine(input);
  currentPost = linkedInPost(input);
  ($("card") as HTMLImageElement).src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(currentSvg)}`;
  $("post").textContent = currentPost;
  $("share-status").textContent = state.source === "sample" ? "This card shows sample data. Load your own logs to make yours." : "";
}

/** "theclimatebrink.com" from a source URL, so each link names where it goes. */
function sourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function renderMethod() {
  $("method-intro").textContent = `Energy = tokens × energy per token, by model family and token type. Each parameter below has a low and high bound, and they combine into the range you see. The boundary is ${params.boundary}. Labels say how solid each number is: MODELED is derived from published figures, GUESS is a best estimate with wide bounds. Method v${params.version}, parameters as of ${params.as_of}, licensed ${params.license}.`;
  const rows = Object.entries(params.params)
    .map(
      ([id, p]) =>
        `<tr><td data-label="Parameter"><code>${esc(id)}</code><div class="meta">${esc(p.note)}</div></td><td class="num" data-label="Value">${p.value}</td><td class="num" data-label="Range">${p.low} – ${p.high}</td><td data-label="Unit">${esc(p.unit)}</td><td data-label="Label"><span class="label">${esc(p.label)}</span></td><td data-label="Source"><a class="src" href="${esc(p.source)}" rel="noopener noreferrer">${esc(sourceName(p.source))}</a></td></tr>`,
    )
    .join("");
  $("params").innerHTML = `<thead><tr><th>Parameter</th><th>Value</th><th>Range</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead><tbody>${rows}</tbody>`;
}

const LEDE: Record<typeof state.source, string> = {
  sample: "ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You're looking at sample data; try your own logs below.",
  files: "ccwatts estimates the electricity behind Claude Code, an AI coding agent, from the token counts in its local logs. You're looking at the files you loaded; nothing was uploaded.",
  history: "ccwatts estimates the electricity behind your Claude Code use from the token counts in its local logs, as a range with every assumption sourced.",
};

let lastEstimate: Estimate | null = null;

function render() {
  const rows = windowRows(state.rows, state.window);
  buildDayTypeCache(rows);
  const e = estimateFor(rows);
  lastEstimate = e;
  const label = WINDOW_LABEL[state.window];
  const pill = $("source-pill");
  pill.textContent = state.source === "sample" ? "Sample data" : state.source === "history" ? "Your history" : "Your files";
  pill.classList.toggle("sample", state.source === "sample");
  $("lede").textContent = LEDE[state.source];
  renderHero(e, label);
  renderChart(e);
  renderRank("by-model", e.byModel, shortModel, e);
  renderRank("by-project", e.byProject, projectName, e);
  renderExplain(e);
  renderShare(e, label);
}

async function loadFiles(files: FileList | File[]) {
  const status = $("drop-status");
  status.textContent = "Reading files on this device…";
  const read = await readLogFiles(files);
  if (!read.ok) {
    status.textContent = read.status;
    return;
  }
  loadTexts(read.texts, read.what);
}

/** Parses log text (from files or the paste box) on this device and shows it. */
function loadTexts(texts: string[], what: string) {
  const status = $("drop-status");
  const records: UsageRecord[] = [];
  for (const text of texts) records.push(...claudeCodeAdapter.parse(text));
  const rows = rollup(dedupe(records));
  if (!rows.length) {
    status.textContent = `${what === "pasted text" ? "That text" : "Those files"} had no Claude Code usage in them.`;
    return;
  }
  state.rows = rows;
  state.source = "files";
  state.window = "all";
  status.textContent = `Read ${int(records.length)} responses from ${what}. Nothing was uploaded.`;
  render();
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copy(text: string, what: string, statusId = "share-status", fallbackId = "post") {
  const status = $(statusId);
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = `Copied the ${what}.`;
  } catch {
    const range = document.createRange();
    range.selectNodeContents($(fallbackId));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    status.textContent = `Couldn't reach the clipboard. The ${fallbackId === "post" ? "post text" : what} is selected so you can copy it.`;
  }
}

function savePng() {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 627;
    canvas.getContext("2d")!.drawImage(img, 0, 0, 1200, 627);
    canvas.toBlob((b) => b && download(`${APP_NAME}-receipt.png`, b), "image/png");
  };
  img.src = ($("card") as HTMLImageElement).src;
}

function wire() {
  for (const id of ["7d", "30d", "all"] as WindowId[]) {
    $(`w-${id}`).addEventListener("click", () => {
      state.window = id;
      render();
    });
  }
  $("save-png").addEventListener("click", savePng);
  $("save-svg").addEventListener("click", () => download(`${APP_NAME}-receipt.svg`, new Blob([currentSvg], { type: "image/svg+xml" })));
  $("copy-line").addEventListener("click", () => void copy(currentLine, "share line"));
  $("copy-post").addEventListener("click", () => void copy(currentPost, "LinkedIn post"));

  if (payload.mode === "playground") {
    const drop = $("drop");
    drop.hidden = false;
    $("copy-prompt").addEventListener("click", () => void copy($("export-prompt").textContent ?? "", "prompt", "drop-status", "export-prompt"));
    $("read-paste").addEventListener("click", () => {
      // Pasted from a chat, the lines may sit inside a ``` code fence; the adapter skips those lines.
      loadTexts([$<HTMLTextAreaElement>("paste-log").value], "pasted text");
    });
    for (const id of ["pick-folder", "pick-files"]) {
      $<HTMLInputElement>(id).addEventListener("change", (ev) => {
        const files = (ev.target as HTMLInputElement).files;
        if (files) void loadFiles(files);
      });
    }
    $("use-sample").addEventListener("click", () => {
      state.rows = sample;
      state.source = "sample";
      state.window = "30d";
      $("drop-status").textContent = "";
      render();
    });
    const over = (on: boolean) => (e: DragEvent) => {
      e.preventDefault();
      drop.classList.toggle("over", on);
    };
    drop.addEventListener("dragover", over(true));
    drop.addEventListener("dragleave", over(false));
    drop.addEventListener("drop", (e) => {
      over(false)(e);
      if (e.dataTransfer?.files) void loadFiles(e.dataTransfer.files);
    });
  }

  let resizeTimer = 0;
  let chartWidth = $("chart").getBoundingClientRect().width;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const w = $("chart").getBoundingClientRect().width;
      if (lastEstimate && Math.round(w) !== Math.round(chartWidth)) renderChart(lastEstimate);
      chartWidth = w;
    }, 150);
  });

  ($("repo-link") as HTMLAnchorElement).href = REPO_URL;
  $("cli-cmd").textContent = `npx ${APP_NAME}`;
  ($("built-by") as HTMLAnchorElement).href = PORTFOLIO_URL;
  if (payload.mode === "playground") {
    const back = $<HTMLAnchorElement>("back-link");
    back.href = PORTFOLIO_URL;
    back.hidden = false;
  }
  const when = payload.generatedAt ? ` · written ${payload.generatedAt.slice(0, 16).replace("T", " ")} UTC` : "";
  $("footer-version").textContent = `${APP_NAME} v${APP_VERSION} · method v${params.version}${when}. Electricity only, not carbon or water.`;
  document.title = payload.mode === "dashboard" ? `${APP_NAME} dashboard` : `${APP_NAME} playground`;
}

wire();
renderMethod();
render();
