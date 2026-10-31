A test vanished on run 2 (9 then 8 then 9): the runs differ, so it's flaky even with 0 failed.

```qa
verdict: flaky
suite: e2e | npm run e2e | 9/0 8/0 9/0
QA-R1 | P1 | e2e runner | One test is not collected on some runs | tests/e2e/share.spec.ts
```
