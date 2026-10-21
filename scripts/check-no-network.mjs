// Browser check for the playground: loads the built page in headless Chromium, uses sample data,
// loads a log file through the file picker, and fails if the page makes any network request,
// logs an error, or scrolls sideways on a phone.
//
// Needs Playwright, which is not a project dependency:  npx playwright@1 install chromium
// Run after `npm run build`:                            node scripts/check-no-network.mjs
// Set PLAYWRIGHT_MODULE to a Playwright path and CHROMIUM_PATH to a browser binary if needed.
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const page_ = fileURLToPath(new URL("../packages/web/dist/ccwatts.html", import.meta.url));
const log = fileURLToPath(new URL("../fixtures/claude-code/sample.jsonl", import.meta.url));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(`network request: ${r.url()}`);
  });
  page.on("console", (m) => m.type() === "error" && problems.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e}`));
  await page.goto(pathToFileURL(page_).href);

  if ((await page.textContent("#source-pill")) !== "Sample data") problems.push("did not open on sample data");
  const sampleHeadline = await page.textContent("#hero-big");
  await page.setInputFiles("#pick-files", log);
  await page.waitForFunction(() => document.querySelector("#source-pill")?.textContent === "Your files");
  if ((await page.textContent("#hero-big")) === sampleHeadline) problems.push("headline did not change after loading a file");
  await page.click("#w-7d");
  await page.click("#use-sample");

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > viewport.width) problems.push(`horizontal scroll at ${viewport.width}px (${width}px wide)`);
  await page.close();
}
await browser.close();

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Playground check passed: no network requests, no errors, no sideways scroll.");
