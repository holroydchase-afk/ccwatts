# Story

Public mirror of the ccwatts build story (the private log is Chase's "Atlas Story: CCWatts"). The `story-keeper` agent appends entries, newest first: date, title, problem, Chase's call, decision and why, result, one-line angle. No personal data, secrets or links to private tools.

## 2026-11-24: cut the demo to one number and one button
Problem: Chase called the demo "very busy"; a UX and staff PM review scored clarity 5/10 on phone, 6/10 on laptop, with no call to action above the fold. Chase's call: "go with recommendations" (CCW-DEC-17). Decision: Overview cut to the number, the EV line and one "Try it on your logs" button. Result: PR #116 merged on Chase's go, clarity 7/10; PR #119 trimmed the header to 8/10, the bar. Lesson: after a `git merge` stopped on conflicts, `git add -A && git commit` committed conflict markers; caught before the PR and never reached main. Check the merge exit status and `git diff --name-only --diff-filter=U` first. Angle: scored the review, fixed to the bar, and caught our own process slip.

## 2026-11-19: a range from a total
Problem: Chase can see a thread's token total (88.8M on an Opus 5 thread) but ccwatts needed a mix. Chase's call: "I should be able to use that." Decision: `ccwatts estimate` (PR #101) applies a mix measured on his own 6 sessions, widens the range with the lightest and heaviest, and says so in one line. Result: 88.8M Opus = 4.8 kWh, range 0.51-22.8. Angle: an honest range beats a confident number.

## 2026-11-19: a silent hook is an invisible one
Problem: the counts-only save hook built Nov 1 stopped around Nov 2; project threads start above the repo, so repo hooks never load. Chase's call: "Ok add it." Decision: a setup script on the ccwatts environment installs the hooks at user level. Result: ccwatts runs in a cloud session (this thread: 26.5 Wh). Lesson: a hook that fails silently by design also fails invisibly; check its output exists. Angle: fail-safe design needs a check that the safe path still works.

## 2026-11-18: the eval that caught its own product
Problem: a three-seat portfolio review asked for an eval harness; the sanity checks were three unit tests with inputs we chose. Chase's call: review it as Anthropic or Stripe would and build the top item. Result: a generated scorecard. Its model-coverage check failed first on the newest models, which were priced at half. Its sensitivity table showed the Opus output energy, not the cache-read factor, drives most of the range. Angle: an honest eval finds things the author did not expect.

## 2026-11-01: one studio standard
Problem: every project had drifted its own rules. Chase's call: "standardize ... I don't want to deal with it." Decision: adopt the merged Product Studio + Hearth standard, with ccwatts' TypeScript tool names kept in repo notes so syncs stop overwriting them. Angle: a solo builder runs a studio by writing the rules down once.

## 2026-10-29: all TypeScript
Problem: helper scripts in plain `.mjs` made the repo read as half-typed. Chase's call: move everything to TypeScript. Result: one strict codebase, enforced by a test. Angle: reviewers judge the whole repo, not just `src/`.

## 2026-10-28: drop the path hash
Problem: project ids were an unsalted hash of the full path, linkable across outputs. Chase's call: drop them from shared outputs. Angle: the privacy story is only as good as its weakest export.
