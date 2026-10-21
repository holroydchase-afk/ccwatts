// Renders packages/web/src/og.svg to packages/web/public/og.png (the playground's link preview).
// Run by hand when the SVG changes and commit both files. Needs Playwright, which is not a
// project dependency (same setup as check-no-network.mjs: PLAYWRIGHT_MODULE, CHROMIUM_PATH).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const svg = readFileSync(fileURLToPath(new URL("../packages/web/src/og.svg", import.meta.url)), "utf8");
const out = fileURLToPath(new URL("../packages/web/public/og.png", import.meta.url));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 627 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 627 } });
await browser.close();
console.log(`Wrote ${out}`);
