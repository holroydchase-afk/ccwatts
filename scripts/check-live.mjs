// Live check for the deployed playground (CCW-M2.6.6): loads the public page in headless Chromium at
// phone and laptop width and fails if it isn't the real thing: a non-200, a request to another host,
// a console error, sideways scroll, no labeled sample data, a footer version that doesn't match the
// CLI package, or a slow load. Reads only; never sends anything but the page request.
//
// Needs Playwright (not a project dependency) and network access to the playground's host.
// Run by hand after a deploy:  node scripts/check-live.mjs [url]
// Behind a proxy, HTTPS_PROXY is passed to the browser. Set PLAYWRIGHT_MODULE / CHROMIUM_PATH if needed.
import { readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.argv[2] ?? "https://chaseholroyd.com/ccwatts/";
const host = new URL(url).host;
const cliVersion = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8")).version;
const SLOW_MS = 3000;
const MAX_BYTES = 150_000;

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({
  ...(proxy ? { proxy } : {}),
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const problems = [];
const notes = [];
for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const offHost = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => { if (new URL(r.url()).host !== host) offHost.push(r.url()); });
  const started = Date.now();
  const resp = await page.goto(url, { waitUntil: "load" });
  const ms = Date.now() - started;
  const bytes = (await resp?.body())?.length ?? 0;
  const seen = await page.evaluate(() => ({
    big: document.querySelector("#hero-big")?.textContent?.trim() ?? "",
    sample: /sample data/i.test(document.body.innerText),
    footer: document.querySelector("footer")?.textContent?.replace(/\s+/g, " ") ?? "",
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  const at = `${viewport.width}px`;
  if (resp?.status() !== 200) problems.push(`${at}: status ${resp?.status()}`);
  if (offHost.length) problems.push(`${at}: requests to other hosts: ${offHost.join(", ")}`);
  if (errors.length) problems.push(`${at}: console errors: ${errors.join(" | ")}`);
  if (seen.sideways) problems.push(`${at}: sideways scroll`);
  if (!/kWh|Wh/.test(seen.big)) problems.push(`${at}: no headline number`);
  if (!seen.sample) problems.push(`${at}: sample data isn't labeled`);
  if (!seen.footer.includes(`v${cliVersion}`)) problems.push(`${at}: footer doesn't show v${cliVersion} (not deployed yet?)`);
  if (ms > SLOW_MS) problems.push(`${at}: loaded in ${ms} ms (limit ${SLOW_MS})`);
  if (bytes > MAX_BYTES) problems.push(`${at}: page is ${bytes} bytes (limit ${MAX_BYTES})`);
  notes.push(`${at}: ${resp?.status()} in ${ms} ms, ${bytes} bytes, headline ${seen.big}`);
  await page.close();
}
await browser.close();

for (const n of notes) console.log(n);
if (problems.length) {
  console.error(`Live check failed for ${url}:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Live check passed for ${url}: one host, no errors, no sideways scroll, sample data labeled.`);
