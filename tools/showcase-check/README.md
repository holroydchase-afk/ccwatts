# Showcase check kit

A small TypeScript browser check, with no runtime dependencies, for any page you show people: a playground, a demo, a
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

Runs with [`tsx`](https://tsx.is) (a dev dependency; works on Node 20). Needs Playwright with Chromium,
which is not a dependency; its types come from the `playwright-core` dev dependency. If
`import("playwright")` doesn't resolve, set `PLAYWRIGHT_MODULE` to its `index.mjs`, and `CHROMIUM_PATH`
to a browser binary if needed.

Code that runs inside the page (`page.evaluate`, `$eval`) must not declare named functions such as
`const f = () => …`: tsx keeps function names with an esbuild `__name()` helper that the browser
doesn't have, so the call fails with `__name is not defined`. Use anonymous callbacks inline.

From the command line, on any built file or URL:

```sh
npx tsx tools/showcase-check/cli.ts dist/index.html --reach start,upload --min-text 12 --shots shots/
```

From a script, with checks for your own page:

```ts
import { showcaseCheck } from "./tools/showcase-check/check.ts";

const problems = await showcaseCheck({
  url: "file:///…/dist/index.html",
  keyboardReach: ["upload"],
  minTextPx: 12,
  extra: async (page, { viewport, problem }) => {
    if (!(await page.isVisible("h1"))) problem("no headline");
  },
});
```

`screenshots({ url, outDir })` in `shots.ts` writes viewport and full-page PNGs for every size and
color scheme and returns their paths, so a reviewer can open each one.

## Test

`npm run check:kit` runs `selftest.ts`: a clean fixture must pass, and a fixture with one of every
problem must trip every check.
