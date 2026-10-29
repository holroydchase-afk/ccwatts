// Screenshots for a visual review: every viewport in light and dark, viewport and full page.
// Returns the file paths so a reviewer (person or agent) can open each one.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { type ColorScheme, DEFAULT_VIEWPORTS, launch, type Viewport } from "./check.ts";

export interface ScreenshotOptions {
  url: string;
  outDir: string;
  /** File name prefix. */
  name?: string;
  viewports?: Viewport[];
  colorSchemes?: ColorScheme[];
  /** Runs after load, before the shots. */
  prepare?: (page: Page) => Promise<void>;
}

export async function screenshots({
  url,
  outDir,
  name = "page",
  viewports = DEFAULT_VIEWPORTS,
  colorSchemes = ["light", "dark"],
  prepare,
}: ScreenshotOptions): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const files: string[] = [];
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
