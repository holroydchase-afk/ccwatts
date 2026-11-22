# Story

Public mirror of the ccwatts build story (the private log is Chase's "Atlas Story: CCWatts"). The `story-keeper` agent appends entries, newest first: date, title, problem, Chase's call, decision and why, result, one-line angle. No personal data, secrets or links to private tools.

## 2026-11-19: a range from a total
Problem: Chase can see a thread's token total (88.8M on an Opus 5 thread) but ccwatts needed a mix. Chase's call: "I should be able to use that." Decision: `ccwatts estimate` (PR #101) applies a mix measured on his own 6 sessions, widens the range with the lightest and heaviest, and says so in one line. Result: 88.8M Opus = 4.8 kWh, range 0.51-22.8. Angle: an honest range beats a confident number.

## 2026-11-19: a silent hook is an invisible one
Problem: the counts-only save hook built Nov 1 stopped around Nov 2; project threads start above the repo, so repo hooks never load. Chase's call: "Ok add it." Decision: a setup script on the ccwatts environment installs the hooks at user level. Result: ccwatts runs in a cloud session (this thread: 26.5 Wh). Lesson: a hook that fails silently by design also fails invisibly; check its output exists. Angle: fail-safe design needs a check that the safe path still works.

## 2026-11-01: one studio standard
Problem: every project had drifted its own rules. Chase's call: "standardize ... I don't want to deal with it." Decision: adopt the merged Product Studio + Hearth standard, with ccwatts' TypeScript tool names kept in repo notes so syncs stop overwriting them. Angle: a solo builder runs a studio by writing the rules down once.

## 2026-10-29: all TypeScript
Problem: helper scripts in plain `.mjs` made the repo read as half-typed. Chase's call: move everything to TypeScript. Result: one strict codebase, enforced by a test. Angle: reviewers judge the whole repo, not just `src/`.

## 2026-10-28: drop the path hash
Problem: project ids were an unsalted hash of the full path, linkable across outputs. Chase's call: drop them from shared outputs. Angle: the privacy story is only as good as its weakest export.
