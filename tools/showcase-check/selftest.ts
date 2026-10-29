// Self-test for the kit: the good fixture passes and the bad fixture trips every check.
// Run: tsx tools/showcase-check/selftest.ts   (needs Playwright, see README.md)
import { fileURLToPath, pathToFileURL } from "node:url";
import { showcaseCheck } from "./check.ts";

const fixture = (name: string) => pathToFileURL(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))).href;
const failures: string[] = [];

const good = await showcaseCheck({ url: fixture("good.html"), keyboardReach: ["go"], minTextPx: 12 });
if (good.length) failures.push(`good.html should pass but got:\n  ${good.join("\n  ")}`);

const bad = await showcaseCheck({ url: fixture("bad.html"), keyboardReach: ["small", "unreachable"], minTextPx: 12 });
const expected: Record<string, RegExp> = {
  "network request": /network request: https:\/\/example\.com\/track/,
  "console error": /console error: boom/,
  "sideways scroll on a phone": /horizontal scroll: .*\[390px light\]/,
  "short tap target": /tap targets under 44px: small/,
  "keyboard reach": /Tab never reaches #unreachable/,
  "unfinished text": /unfinished text "TODO/,
  "broken image": /broken image: missing-image\.png/,
  "tiny text": /text under 12px/,
  "dark mode covered": /\[1280px dark\]/,
};
for (const [what, pattern] of Object.entries(expected)) {
  if (!bad.some((p) => pattern.test(p))) failures.push(`bad.html: missed ${what} (${pattern})`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Showcase kit self-test passed: good page clean, bad page caught ${Object.keys(expected).length} kinds of problem.`);
