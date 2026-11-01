# Story

Public mirror of the ccwatts build story (the private log is Chase's "Atlas Story: CCWatts"). The `story-keeper` agent appends entries, newest first: date, title, problem, Chase's call, decision and why, result, one-line angle. No personal data, secrets or links to private tools.

## 2026-11-01: one studio standard
Problem: every project had drifted its own rules. Chase's call: "standardize ... I don't want to deal with it." Decision: adopt the merged Product Studio + Hearth standard, with ccwatts' TypeScript tool names kept in repo notes so syncs stop overwriting them. Angle: a solo builder runs a studio by writing the rules down once.

## 2026-10-29: all TypeScript
Problem: helper scripts in plain `.mjs` made the repo read as half-typed. Chase's call: move everything to TypeScript. Result: one strict codebase, enforced by a test. Angle: reviewers judge the whole repo, not just `src/`.

## 2026-10-28: drop the path hash
Problem: project ids were an unsalted hash of the full path, linkable across outputs. Chase's call: drop them from shared outputs. Angle: the privacy story is only as good as its weakest export.
