# Showcase check kit

A small, dependency-free browser check for any page you show people: a playground, a demo, a
portfolio page or a generated report. It loads the page in headless Chromium at phone and laptop
sizes (390 and 1280px), in light and dark mode, and returns plain-sentence problems. It also takes
the screenshots a visual review needs.

Built for ccwatts (where `npm run check:browser` uses it) and written to be lifted into
`studio-agents` for every studio product. Nothing in this folder imports ccwatts code.

## What it catches

| Check | Default |
|---|---|
| Network requests | anything but `file:`, `data:`, `blob:`, `about:` and the page's own origin |
| Console and page errors | always |
| Sideways scroll | page wider than the viewport |
| Tap targets | buttons and button-like controls under 44px tall (WCAG 2.5.5 / Apple HIG) |
| Keyboard reach | ids you list that Tab never reaches |
| Unfinished text | TODO, TBD, FIXME, lorem ipsum, coming soon, example.com |
| Broken images | `<img>` that failed to load |
| Tiny text | rendered font size under `minTextPx` (off unless set) |

Each problem ends with where it happened, for example `tap targets under 44px: save [390px dark]`.

## Use it

Needs Playwright with Chromium, which is not a dependency. If `import("playwright")` doesn't resolve,
set `PLAYWRIGHT_MODULE` to its `index.mjs`, and `CHROMIUM_PATH` to a browser binary if needed.

From the command line, on any built file or URL:

```sh
node tools/showcase-check/cli.mjs dist/index.html --reach start,upload --min-text 12 --shots shots/
```

From a script, with checks for your own page:

```js
import { showcaseCheck } from "./tools/showcase-check/check.mjs";

const problems = await showcaseCheck({
  url: "file:///…/dist/index.html",
  keyboardReach: ["upload"],
  minTextPx: 12,
  extra: async (page, { viewport, problem }) => {
    if (!(await page.isVisible("h1"))) problem("no headline");
  },
});
```

`screenshots({ url, outDir })` in `shots.mjs` writes viewport and full-page PNGs for every size and
color scheme and returns their paths, so a reviewer can open each one.

## Test

`npm run check:kit` runs `selftest.mjs`: a clean fixture must pass, and a fixture with one of every
problem must trip every check.
