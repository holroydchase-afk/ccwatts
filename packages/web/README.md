# @ccwatts/web

One static HTML page with two modes, built from the same `@ccwatts/core` as the CLI, so the numbers can't drift apart.

| Mode | How it opens | Data |
|---|---|---|
| Dashboard | `ccwatts dashboard` writes `~/.ccwatts/dashboard.html` | Your local history, embedded in the file |
| Playground | Host `dist/ccwatts.html` anywhere static | Sample data, or `.jsonl` files you pick, parsed in the browser |

`npm run build -w packages/web` writes `dist/ccwatts.html` (about 40 KB). No framework or chart library.

**No network.** The page's Content-Security-Policy is `default-src 'none'` with a hash-pinned inline script, so the browser itself refuses any request after load. `test/page.test.ts` checks the CSP and that the bundle contains no request APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` and others).
