import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultParams } from "@ccwatts/core";

// End-to-end, the way Claude Code runs it: bundle the CLI like tsup does (index.js plus mcp.js),
// start `ccwatts mcp` as a child process and talk to it over stdio with the official MCP client.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const demo = join(root, "fixtures/claude-code/demo.jsonl");
const work = mkdtempSync(join(tmpdir(), "ccwatts-mcp-"));
const bin = join(work, "dist", "index.js");

const TOOLS = ["energy_by_project", "energy_summary", "energy_weekly", "methodology"];

// Raw log lines with real-looking content and a full path. None of it may reach a tool answer.
const SECRET_PROMPT = "please refactor the zebra-giraffe billing module";
const SECRET_REPLY = "Here is the refactored zebra-giraffe code";
const SECRET_DIR = "/home/secret-person/clients/acme-confidential";
const now = new Date().toISOString();
const secretLog = [
  { type: "user", timestamp: now, cwd: SECRET_DIR, message: { role: "user", content: SECRET_PROMPT } },
  {
    type: "assistant",
    timestamp: now,
    cwd: SECRET_DIR,
    requestId: "req_S1",
    message: {
      id: "msg_S1",
      model: "claude-opus-4-6",
      role: "assistant",
      content: [{ type: "text", text: SECRET_REPLY }],
      usage: { input_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 40000, output_tokens: 800 },
    },
  },
]
  .map((l) => JSON.stringify(l))
  .join("\n");

beforeAll(async () => {
  await build({
    entryPoints: [join(root, "packages/cli/src/index.ts"), join(root, "packages/cli/src/mcp.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: join(work, "dist"),
    loader: { ".html": "text" },
    alias: { "@ccwatts/core": join(root, "packages/core/src/index.ts") },
    logLevel: "silent",
  });
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
function home() {
  const dir = join(work, `home-${n++}`);
  mkdirSync(dir);
  return dir;
}

async function connect(args: string[], env: Record<string, string> = {}) {
  const h = home();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "mcp", ...args],
    env: { PATH: process.env.PATH ?? "", HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "ccwatts-test", version: "0" });
  await client.connect(transport);
  return { client, home: h };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join("\n");
  return { text, isError: Boolean(r.isError), json: () => JSON.parse(text) };
}

const ordered = (r: { low: number; central: number; high: number }) => r.low > 0 && r.low <= r.central && r.central <= r.high;

describe("ccwatts mcp (CCW-M2.5)", () => {
  it("lists the four tools, all read-only", async () => {
    const { client } = await connect(["--path", demo]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    expect(client.getServerVersion()?.name).toBe("ccwatts");
    await client.close();
  });

  it("answers all four tools with ranges and the method version", async () => {
    const { client } = await connect(["--path", demo]);

    const summary = (await call(client, "energy_summary", { since: "all" })).json();
    expect(summary.methodVersion).toBe(defaultParams.version);
    expect(summary.unit).toBe("Wh");
    expect(ordered(summary.wh)).toBe(true);
    expect(summary.responses).toBeGreaterThan(0);
    expect(summary.summary).toMatch(/range .* method v/i);
    for (const m of summary.byModel) expect(ordered(m.wh)).toBe(true);

    const projects = (await call(client, "energy_by_project", { since: "all" })).json();
    expect(projects.methodVersion).toBe(defaultParams.version);
    expect(projects.projects.length).toBeGreaterThan(0);
    for (const p of projects.projects) {
      expect(ordered(p.wh)).toBe(true);
      expect(p.name).not.toContain("/");
      expect(p.projectId).toMatch(/^[0-9a-f]+$/);
    }
    // Same total either way you slice it.
    expect(projects.wh).toEqual(summary.wh);

    const weekly = (await call(client, "energy_weekly")).json();
    expect(weekly.methodVersion).toBe(defaultParams.version);
    expect(weekly.window).toBe("all time");
    expect(weekly.weeks.length).toBeGreaterThan(1);
    expect(weekly.heaviestWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const weekTotal = weekly.weeks.reduce((s: number, w: { wh: { central: number } }) => s + w.wh.central, 0);
    expect(weekTotal).toBeCloseTo(summary.wh.central, 0);

    const method = (await call(client, "methodology")).json();
    expect(method.methodVersion).toBe(defaultParams.version);
    expect(method.parameters.length).toBe(Object.keys(defaultParams.params).length);
    for (const p of method.parameters) {
      expect(p.low).toBeLessThanOrEqual(p.value);
      expect(p.high).toBeGreaterThanOrEqual(p.value);
      expect(p.source).toBeTruthy();
    }
    await client.close();
  });

  it("never returns prompt text, response text or a full path", async () => {
    const logs = join(home(), "logs");
    mkdirSync(logs);
    writeFileSync(join(logs, "session.jsonl"), secretLog);
    const { client } = await connect(["--path", logs]);
    const answers = await Promise.all([
      call(client, "energy_summary", { since: "all" }),
      call(client, "energy_by_project", { since: "all" }),
      call(client, "energy_weekly"),
      call(client, "methodology"),
    ]);
    const all = answers.map((a) => a.text).join("\n");
    expect(answers.every((a) => !a.isError)).toBe(true);
    expect(all).toContain("acme-confidential"); // the folder's basename is fine
    for (const secret of ["zebra-giraffe", "/home/secret-person", "clients/", logs, work, root]) expect(all).not.toContain(secret);
    await client.close();
  });

  it("defaults to the last 7 days and reports a bad window as a tool error", async () => {
    const logs = join(home(), "logs");
    mkdirSync(logs);
    writeFileSync(join(logs, "session.jsonl"), secretLog);
    const { client } = await connect(["--path", logs]);
    const week = (await call(client, "energy_summary")).json();
    expect(week.window).toBe("last 7 days");
    expect(week.responses).toBe(1);
    const bad = await call(client, "energy_summary", { since: "last tuesday" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Can't read --since");
    await client.close();
  });

  it("with no logs, says so without printing where it looked", async () => {
    const { client, home: h } = await connect([]);
    const r = await call(client, "energy_summary");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("No Claude Code logs found");
    expect(r.text).not.toContain(h);
    await client.close();
  });

  it("--demo answers on labeled sample data and leaves history alone", async () => {
    const { client, home: h } = await connect(["--demo"]);
    const r = (await call(client, "energy_summary", { since: "all" })).json();
    expect(r.sample).toBe(true);
    expect(r.note).toMatch(/sample data/i);
    expect(ordered(r.wh)).toBe(true);
    await client.close();
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
  });

  it("a copy without mcp.js (like the plugin's bundle) says how to get the server", () => {
    const solo = join(work, "solo");
    mkdirSync(solo);
    copyFileSync(bin, join(solo, "index.js"));
    const r = spawnSync(process.execPath, [join(solo, "index.js"), "mcp"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home() } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("claude mcp add ccwatts -- npx ccwatts mcp");
  });

  it("CCW-F4: `ccwatts mcp --help` prints MCP help with the install line and exits without serving", () => {
    const start = Date.now();
    const r = spawnSync(process.execPath, [bin, "mcp", "--help"], {
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: process.env.PATH ?? "", HOME: home() },
    });
    expect(r.error).toBeUndefined(); // a timeout means it started the server instead
    expect(Date.now() - start).toBeLessThan(5000);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("claude mcp add");
    expect(r.stdout).toMatch(/MCP/);
  });
});

