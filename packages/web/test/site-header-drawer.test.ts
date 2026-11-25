import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SPEC-SITE-HEADER Part B (Chase said yes, Nov 25): the #demo-bar strip becomes an info button in the
// header (#demo-toggle) that opens a dialog drawer. Static checks on the built page. Opening, the
// panel/sheet layout, the scrim, Esc/close/scrim closing, focus and reduced motion are checked in a
// real browser by scripts/check-no-network.ts (npm run check:browser), block "SITEHDR Part B".
//
// API pinned here for the engineer:
//  - #demo-toggle is a <button> inside <header id="site-bar">, after the "ccwatts demo" label, with
//    aria-label="About this demo", aria-expanded="false" and aria-controls naming the dialog.
//  - The dialog is markup in template.html: role="dialog" (or a <dialog>), aria-modal="true",
//    aria-labelledby naming its title. It holds the "Demo" pill, #demo-copy-sample, #demo-copy-files,
//    #demo-back, #demo-code and a "Case study" link. Hrefs are set by script (no absolute URL in markup).
const html = readFileSync(new URL("../dist/ccwatts.html", import.meta.url), "utf8");
const header = /<header[^>]*id="site-bar"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
const toggle = /<button[^>]*id="demo-toggle"[^>]*>/.exec(header)?.[0] ?? "";
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const dialogId = attr(toggle, "aria-controls") ?? "";

/** The element with this id and everything up to its matching close tag (same tag name, counted). */
function element(src: string, id: string): string {
  const open = new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>`).exec(src);
  if (!open) return "";
  const tag = open[1]!;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return src.slice(open.index, m.index + m[0].length);
  }
  return "";
}
const dialog = dialogId ? element(html, dialogId) : "";
const dialogOpen = /^<[^>]*>/.exec(dialog)?.[0] ?? "";

const SAMPLE_COPY = "This is the real ccwatts, running on made-up sample data. Nothing you do is saved or sent anywhere; reload to start over.";
const FILES_COPY = "This is the real ccwatts, now showing the files you picked. They were read in this browser and never uploaded; nothing is saved, so reload to start over.";

describe("SITEHDR Part B: info button and drawer (static)", () => {
  it("SITEHDR-12 the #demo-bar strip is gone", () => {
    expect(html).not.toContain('id="demo-bar"');
    expect(html).not.toMatch(/<section[^>]*aria-label="Demo"/);
    expect(html).not.toContain('aria-label="Demo details"');
  });

  it("SITEHDR-12 #demo-toggle is a button in #site-bar after \"ccwatts demo\", labelled, collapsed, controlling the dialog", () => {
    expect(header, "#site-bar markup").not.toBe("");
    expect(toggle, "<button id=\"demo-toggle\"> inside #site-bar").not.toBe("");
    expect(attr(toggle, "aria-label")).toBe("About this demo");
    expect(attr(toggle, "aria-expanded")).toBe("false");
    expect(dialogId, "aria-controls").not.toBe("");
    expect(header.indexOf("ccwatts demo"), "label before the button").toBeGreaterThan(-1);
    expect(header.indexOf("ccwatts demo")).toBeLessThan(header.indexOf('id="demo-toggle"'));
    expect(html.match(/id="demo-toggle"/g)?.length).toBe(1);
  });

  it("SITEHDR-12 the controlled element is a modal dialog labelled by its title", () => {
    expect(dialog, `element #${dialogId}`).not.toBe("");
    expect(dialogOpen.startsWith("<dialog") || attr(dialogOpen, "role") === "dialog", `role=dialog: ${dialogOpen}`).toBe(true);
    expect(attr(dialogOpen, "aria-modal")).toBe("true");
    const titleId = attr(dialogOpen, "aria-labelledby") ?? "";
    expect(titleId, "aria-labelledby").not.toBe("");
    const title = element(dialog, titleId);
    expect(title, `title #${titleId} inside the dialog`).not.toBe("");
    expect(title.replace(/<[^>]+>/g, "").trim()).not.toBe("");
  });

  it("SITEHDR-14 the dialog holds the Demo pill, both copy lines, #demo-back, #demo-code and Case study", () => {
    expect(dialog, "dialog markup").not.toBe("");
    expect(dialog, '"Demo" pill').toMatch(/>\s*Demo\s*</);
    expect(element(dialog, "demo-copy-sample")).toContain(SAMPLE_COPY);
    expect(element(dialog, "demo-copy-files")).toContain(FILES_COPY);
    expect(element(dialog, "demo-copy-files"), "own-files copy hidden on load").toMatch(/^<[^>]*\shidden[\s>=]/);
    expect(element(dialog, "demo-back")).toContain("Chase Holroyd's portfolio");
    expect(element(dialog, "demo-code")).toContain("Code on GitHub");
    expect(dialog).toMatch(/<a[^>]*>\s*Case study\s*<\/a>/);
    expect(dialog, "absolute href in the dialog markup").not.toMatch(/href="https?:/);
    expect(dialog).not.toContain("Reset demo");
  });
});
