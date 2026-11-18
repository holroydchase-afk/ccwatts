#!/usr/bin/env tsx
// Eval scorecard runner. Reads evals/models.json, evals/cases.json and the shipped params, and
// writes docs/EVALS.md. Local files only: no network, counts only.
// Usage:
//   npx tsx scripts/run-evals.ts           rewrite docs/EVALS.md; exit 1 if any check fails
//   npx tsx scripts/run-evals.ts --check   write nothing; exit 1 if docs/EVALS.md is stale or any check fails
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultParams } from "../packages/core/src/index.ts";
import { buildScorecard, renderScorecard, type EvalCase, type ModelEntry } from "../evals/scorecard.ts";

const REPORT = "docs/EVALS.md";
const file = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(file(rel), "utf8"));

const check = process.argv.includes("--check");
const card = buildScorecard(defaultParams, readJson<EvalCase[]>("evals/cases.json"), readJson<ModelEntry[]>("evals/models.json"));
const report = renderScorecard(card);
const problems: string[] = [];

for (const m of card.models) if (!m.pass) problems.push(`model ${m.id}: got ${m.tier}${m.known ? "" : " (fallback)"}, expected ${m.expected}`);
for (const c of card.cases) for (const r of c.results) if (!r.pass) problems.push(`case ${c.id}: failed against "${r.name}"`);

if (check) {
  const current = existsSync(file(REPORT)) ? readFileSync(file(REPORT), "utf8") : null;
  if (current !== report) problems.push(`${REPORT} is ${current === null ? "missing" : "stale"}: run npm run evals`);
} else {
  writeFileSync(file(REPORT), report);
}

const modelsOk = card.models.filter((m) => m.pass).length;
const casesOk = card.cases.filter((c) => c.pass).length;
console.log(`evals (method v${card.methodVersion}): ${modelsOk}/${card.models.length} models, ${casesOk}/${card.cases.length} cases${check ? "" : `, wrote ${REPORT}`}`);
for (const p of problems) console.error(`FAIL ${p}`);
process.exitCode = problems.length ? 1 : 0;
