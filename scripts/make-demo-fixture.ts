// Writes fixtures/claude-code/demo.jsonl: 30 days of synthetic, counts-only Claude Code usage
// for screenshots, the playground's "Try sample data" and tests. Deterministic (seeded).
// Run: tsx scripts/make-demo-fixture.ts
import { mkdirSync, writeFileSync } from "node:fs";

let seed = 20261021;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)]!;

const projects = ["/home/demo/code/ccwatts", "/home/demo/code/hearth", "/home/demo/code/portfolio-site", "/home/demo/code/dotfiles"];
const models = ["claude-opus-4-6", "claude-opus-4-6", "claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];
const lines = [];
let n = 0;
const start = Date.parse("2026-09-21T00:00:00Z");

for (let day = 0; day < 30; day++) {
  const weekend = [6, 0].includes(new Date(start + day * 86_400_000).getUTCDay());
  const sessions = weekend ? Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
  for (let s = 0; s < sessions; s++) {
    const cwd = pick(projects);
    const model = pick(models);
    const turns = 15 + Math.floor(rand() * 60);
    let context = 15_000 + Math.floor(rand() * 10_000);
    let t = start + day * 86_400_000 + (9 + Math.floor(rand() * 10)) * 3_600_000;
    for (let i = 0; i < turns; i++) {
      n++;
      const fresh = 1_000 + Math.floor(rand() * 6_000);
      const usage = {
        input_tokens: 1 + Math.floor(rand() * 20),
        cache_creation_input_tokens: i === 0 ? context : fresh,
        cache_read_input_tokens: i === 0 ? 0 : context,
        output_tokens: 50 + Math.floor(rand() * 900),
      };
      context = Math.min(context + fresh, 180_000);
      t += 15_000 + Math.floor(rand() * 90_000);
      lines.push(
        JSON.stringify({
          type: "assistant",
          timestamp: new Date(t).toISOString(),
          cwd,
          requestId: `req_demo_${n}`,
          message: { id: `msg_demo_${n}`, model, role: "assistant", content: [], usage },
        }),
      );
    }
  }
}

mkdirSync("fixtures/claude-code", { recursive: true });
writeFileSync("fixtures/claude-code/demo.jsonl", lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} responses to fixtures/claude-code/demo.jsonl`);
