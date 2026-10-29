#!/usr/bin/env tsx
// Private-data check (M2.6.7). Scans the repo's own files for things that must never be committed:
//   1. home paths (/Users/<name>, /home/<name>, C:\Users\<name>) unless <name> is an allowlisted placeholder
//   2. email addresses, except allowEmails, *@example.com and noreply@* addresses
//   3. tokens and keys (GitHub, npm, Anthropic/OpenAI-style sk-, AWS, Slack, PEM private keys)
//   4. any .env* file at all
// With --staged it scans the staged blobs instead (the pre-commit hook), and also bans this machine's
// login name and git user.email. Findings print as file:line and the kind, with the match masked.
// Config: studio-checks.json at the repo root, section "private":
//   { "private": { "allowUsers": ["demo"], "allowEmails": [] } }
// Usage: tsx scripts/check-private.ts [--staged]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";

const configFile = process.env.STUDIO_CHECKS || "studio-checks.json";
interface PrivateConfig {
  allowUsers?: string[];
  allowEmails?: string[];
}
const config: PrivateConfig = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")).private ?? {} : {};
const ALLOW_USERS = new Set((config.allowUsers ?? []).map((u: string) => u.toLowerCase()));
const ALLOW_EMAILS = new Set((config.allowEmails ?? []).map((e: string) => e.toLowerCase()));
const STAGED = process.argv.includes("--staged");

const SKIP = /(^|\/)(node_modules\/|package-lock\.json$)|\.(png|gif|ico|jpe?g|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;
const ENV_FILE = /(^|\/)\.env[^/]*$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mask = (s: string) => (s.length <= 4 ? "***" : s.slice(0, 3) + "***");
const safeEmail = (e: string) => {
  const l = e.toLowerCase();
  return ALLOW_EMAILS.has(l) || l.startsWith("noreply@") || /@(.+\.)?example\.(com|org|net)$/.test(l);
};

// [kind, regex, keep(match) -> true when the match is fine]
type Rule = [kind: string, re: RegExp, keep?: (m: RegExpMatchArray) => boolean];
const RULES: Rule[] = [
  ["home path", new RegExp("(?:/" + "Users/|/" + "home/|C:\\\\{1,2}Users\\\\{1,2})([\\w.-]+)", "gi"), (m) => ALLOW_USERS.has((m[1] ?? "").toLowerCase())],
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g, (m) => safeEmail(m[0])],
  ["GitHub token", /\bgh[pousr]_\w{20,}|\bgithub_pat_\w+/g],
  ["npm token", /\bnpm_\w{36}/g],
  ["API secret key", /\bsk-(?:ant-)?[\w-]{20,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Slack token", /\bxox[baprs]-[\w-]+/g],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];

if (STAGED) {
  const name = userInfo().username ?? "";
  if (name.length >= 3 && !["root", "runner"].includes(name) && !ALLOW_USERS.has(name.toLowerCase()))
    RULES.push(["this machine's login name", new RegExp(`\\b${escapeRe(name)}\\b`, "gi")]);
  let email = "";
  try { email = execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim(); } catch {}
  if (email && !safeEmail(email)) RULES.push(["your git email", new RegExp(escapeRe(email), "gi")]);
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const paths = (STAGED ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z") : git("ls-files", "-z"))
  .split("\0")
  .filter(Boolean);

const problems: string[] = [];
let scanned = 0;
for (const p of paths) {
  if (ENV_FILE.test(p)) { problems.push(`${p} is a .env file (keep it out of git)`); continue; }
  if (SKIP.test(p)) continue;
  let src: string;
  if (STAGED) src = git("show", `:${p}`);
  else if (existsSync(p)) src = readFileSync(p, "utf8");
  else continue;
  if (src.includes("\0")) continue; // binary
  scanned++;
  src.split("\n").forEach((line, i) => {
    for (const [kind, re, keep] of RULES) {
      for (const m of line.matchAll(re)) {
        if (keep?.(m)) continue;
        problems.push(`${p}:${i + 1} ${kind} (${mask(m[0])})`);
      }
    }
  });
}
if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`Private-data check: ${problems.length} problem(s). Replace with a placeholder, or allowlist a placeholder in ${configFile} "private".`);
  process.exit(1);
}
console.log(`Private-data check OK (${scanned} file(s)${STAGED ? ", staged" : ""})`);
