# Accounts

Every outside account ccwatts uses, where the name is baked in, and what a rename would cost. **Before anything that locks the name further (a new domain, a store listing, telling users), stop and warn Chase.**

The name **ccwatts** was locked by Chase on 2026-10-22 (ANCHORS P1, PR #35) and is already public on npm, so a rename now is expensive. The single source in code is `APP_NAME` in `packages/core/src/meta.ts`, plus the `name` fields in the package.json and plugin files.

| Account | What | Name baked in | Owner | Rename cost |
|---|---|---|---|---|
| npm | package `ccwatts` (0.1.0 and 0.1.1 published; 0.1.2 bumped, not published) | package name, `npx ccwatts` in README and plugin | Chase's npm login; publishes from `.github/workflows/publish.yml` | High: published versions stay forever; deprecate and republish under a new name. Next release needs Trusted Publishing (issue #38). |
| GitHub | repo `holroydchase-afk/ccwatts` | repo URL in `REPO_URL`, README, badges, plugin marketplace | Chase | Medium: GitHub redirects renames, but the marketplace command and links change |
| GitHub Pages + DNS | playground at `chaseholroyd.com/ccwatts/` | path `ccwatts/` in `PLAYGROUND_URL` | Chase (custom domain and DNS on the portfolio) | Low to medium: new path, update portfolio links |
| Claude Code plugin marketplace | `/plugin marketplace add holroydchase-afk/ccwatts`, plugin `ccwatts@ccwatts` | marketplace and plugin names | Lives in this repo | Medium: every user re-installs |
| Portfolio | `chaseholroyd.com/ccwatts.html` case study | `PORTFOLIO_URL` | Product Studio repo | Low |

No other vendors, analytics or paid services: the CLI and page make no network calls (CLAUDE.md hard rules).
