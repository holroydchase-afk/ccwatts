# Hosting the playground

The playground is `packages/web/dist/ccwatts.html`, built by `npm run build`. It's one self-contained file with no server code, so any static host works. Hosting (Chase, Oct 21): GitHub Pages via `.github/workflows/pages.yml`, which builds, tests and publishes after CI passes on a push to `main`, at https://holroydchase-afk.github.io/ccwatts/. The portfolio at chaseholroyd.com links to it.

## What a visitor gets
- The page opens on **sample data** (synthetic, clearly labeled), so a phone visitor understands it in about 10 seconds without installing anything.
- "Choose folder" or "Choose files" reads `.jsonl` logs in the browser. Nothing is uploaded.
- The share card with Save PNG, and the full parameter table with sources.

## Why it can't phone home
- The CSP is `default-src 'none'`, and the one inline script is pinned by its SHA-256 hash. The browser refuses any fetch, image, font, frame or form post that isn't already inline.
- `npm test` checks the CSP and that the bundle contains no request APIs.
- `npm run check:browser` loads the page in headless Chromium, loads sample data and a log file, and fails on any network request, console error or sideways scroll at phone width.

## Options when it's time (pick one)
1. **GitHub Pages from a `gh-pages` branch:** copy `ccwatts.html` to `index.html` on that branch. Free, and it sits next to the code.
2. **GitHub Pages via an Actions workflow** that builds on each push to `main`. Always current, but it's more to review.
3. **chaseholroyd.com/ccwatts:** upload the one file to the portfolio site. Best for the portfolio story.

Whichever host you use, avoid adding analytics snippets, because that would break the "nothing leaves this browser" promise. The CSP would block them anyway.

## Checking the live page
After a deploy, `npm run check:live` loads https://chaseholroyd.com/ccwatts/ in headless Chromium at phone and laptop width. It fails on a non-200, a request to another host, a console error, sideways scroll, unlabeled sample data, a footer version that doesn't match `packages/cli/package.json`, a load over 3 s, or a page over 150 KB. Needs Playwright (not a dependency; set `PLAYWRIGHT_MODULE`), and passes `HTTPS_PROXY` to the browser.
