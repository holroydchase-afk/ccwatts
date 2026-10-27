// Screenshots for a visual review: every viewport in light and dark, viewport and full page.
// Returns the file paths so a reviewer (person or agent) can open each one.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_VIEWPORTS, launch } from "./check.mjs";

/**
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.outDir
 * @param {string} [o.name]  file name prefix
 * @param {{width:number,height:number}[]} [o.viewports]
 * @param {("light"|"dark")[]} [o.colorSchemes]
 * @param {(page: any) => Promise<void>} [o.prepare]  runs after load, before the shots
 * @returns {Promise<string[]>}
 */
export async function screenshots({ url, outDir, name = "page", viewports = DEFAULT_VIEWPORTS, colorSchemes = ["light", "dark"], prepare }) {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const files = [];
  try {
    for (const colorScheme of colorSchemes) {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport, colorScheme });
        await page.goto(url, { waitUntil: "load" });
        if (prepare) await prepare(page);
        for (const fullPage of [false, true]) {
          const file = join(outDir, `${name}-${viewport.width}-${colorScheme}${fullPage ? "-full" : ""}.png`);
          await page.screenshot({ path: file, fullPage });
          files.push(file);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return files;
}
