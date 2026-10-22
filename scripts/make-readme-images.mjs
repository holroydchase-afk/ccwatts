// Re-shoots the README's playground images from the built page on its sample data:
// docs/images/playground-laptop.png, playground-phone.png and receipt-sample.png (the sample share card).
// Run by hand after `npm run build` when the page changes, and commit the images. Needs Playwright,
// which is not a project dependency (same setup as check-no-network.mjs: PLAYWRIGHT_MODULE, CHROMIUM_PATH).
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const url = pathToFileURL(here("../packages/web/dist/ccwatts.html")).href;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const shots = [
  { out: "playground-laptop.png", viewport: { width: 1280, height: 1060 }, colorScheme: "light" },
  { out: "playground-phone.png", viewport: { width: 390, height: 844 }, colorScheme: "dark" },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: s.viewport, colorScheme: s.colorScheme });
  await page.goto(url);
  if ((await page.textContent("#source-pill")) !== "Sample data") throw new Error("page did not open on sample data");
  await page.screenshot({ path: here(`../docs/images/${s.out}`) });
  if (s.out === "playground-laptop.png") {
    // The share card exactly as the page renders it on sample data, at full size.
    const src = await page.$eval("#card", (img) => img.src);
    const svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    if (!svg.includes("SAMPLE DATA")) throw new Error("sample card is not labeled as sample");
    const card = await browser.newPage({ viewport: { width: 1200, height: 627 } });
    await card.setContent(`<body style="margin:0">${svg}</body>`);
    await card.screenshot({ path: here("../docs/images/receipt-sample.png"), clip: { x: 0, y: 0, width: 1200, height: 627 } });
  }
}
await browser.close();
console.log("Wrote docs/images/playground-laptop.png, playground-phone.png and receipt-sample.png");
