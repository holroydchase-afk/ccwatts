// Task EVAL, criterion EVAL-3: the --by model table says when a model was unknown.
// The summary already prints the Note; the breakdown table printed nothing, so a model priced at
// the fallback tier looked like any other row. Synthetic counts only.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultParams as params, estimate, type UsageRecord } from "@ccwatts/core";
import { breakdown } from "../src/render.js";

const window = { start: null, label: "all time" };
const record = (model: string): UsageRecord => ({
  source: "test",
  key: `k-${model}`,
  timestamp: "2026-10-01T10:00:00.000Z",
  model,
  project: null,
  tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 50 },
});
const NOTE = 'Unknown model "mystery-1"';

describe("EVAL-3 The breakdown table says when a model was unknown (render)", () => {
  it("EVAL-3 breakdown --by model carries the Unknown model note", () => {
    const out = breakdown(estimate([record("mystery-1")], params), params, window, "model");
    expect(out).toContain(NOTE);
    expect(out).toContain(`estimated as ${String(params.tiers.fallback)}`);
  });

  it("EVAL-3 the note still comes with the range and the method version", () => {
    const out = breakdown(estimate([record("mystery-1")], params), params, window, "model");
    expect(out).toContain(NOTE);
    expect(out).toMatch(/[\d.]+–[\d.]+/);
    expect(out).toContain(`method v${params.version}`);
  });

  it("EVAL-3 other direction: a table of known models has no Unknown model note", () => {
    const out = breakdown(estimate([record("claude-opus-4-6"), record("claude-haiku-4-5")], params), params, window, "model");
    expect(out).not.toContain("Unknown model");
  });

  it("EVAL-3 a mixed table names only the unknown model", () => {
    const out = breakdown(estimate([record("claude-opus-4-6"), record("mystery-1")], params), params, window, "model");
    expect(out).toContain(NOTE);
    expect(out).not.toContain('Unknown model "claude-opus-4-6"');
  });
});

// End to end, the way packages/cli/test/cli.test.ts does it: bundle the CLI, run it in a throwaway home.
describe("EVAL-3 The breakdown table says when a model was unknown (CLI)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "ccwatts-evals-"));
  const bin = join(work, "cli.mjs");

  beforeAll(async () => {
    await build({
      entryPoints: [join(root, "packages/cli/src/index.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bin,
      loader: { ".html": "text" },
      alias: { "@ccwatts/core": join(root, "packages/core/src/index.ts") },
      logLevel: "silent",
    });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  let n = 0;
  const home = () => {
    const dir = join(work, `home-${n++}`);
    mkdirSync(dir);
    return dir;
  };
  const cli = (args: string[], env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: work, env: { PATH: process.env.PATH ?? "", ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const line = (id: string, model: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-01T10:00:00.000Z",
      cwd: "/synthetic/proj",
      requestId: `req_${id}`,
      message: { id: `msg_${id}`, model, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } },
    });
  const logs = (...lines: string[]) => {
    const dir = join(home(), "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), lines.join("\n") + "\n");
    return dir;
  };

  it("EVAL-3 ccwatts --by model on a log with mystery-1 prints the Unknown model note", () => {
    const r = cli(["--path", logs(line("a", "mystery-1")), "--since", "all", "--by", "model"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("mystery-1");
    expect(r.out).toContain(NOTE);
  });

  it("EVAL-3 other direction: ccwatts --by model on known models prints no Unknown model note", () => {
    const r = cli(["--path", logs(line("a", "claude-opus-4-6"), line("b", "claude-sonnet-4-6")), "--since", "all", "--by", "model"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("Unknown model");
  });

  it("EVAL-1/EVAL-3 claude-fable-5-2 and claude-mythos-5-2 are priced as known models, with no note", () => {
    const dir = logs(line("a", "claude-fable-5-2"), line("b", "claude-mythos-5-2"));
    const table = cli(["--path", dir, "--since", "all", "--by", "model"], { HOME: home() });
    const summary = cli(["--path", dir, "--since", "all"], { HOME: home() });
    expect(table.code).toBe(0);
    expect(table.out).not.toContain("Unknown model");
    expect(summary.out).not.toContain("Unknown model");
    // Priced as Opus: the same two responses logged as claude-opus-4-6 come to the same energy.
    const fable = JSON.parse(cli(["--path", dir, "--since", "all", "--json"], { HOME: home() }).out);
    const opus = JSON.parse(cli(["--path", logs(line("a", "claude-opus-4-6"), line("b", "claude-opus-4-6")), "--since", "all", "--json"], { HOME: home() }).out);
    expect(fable.wh).toEqual(opus.wh);
  });
});
