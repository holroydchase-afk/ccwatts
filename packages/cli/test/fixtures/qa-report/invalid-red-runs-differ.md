<!-- expect: flaky -->
<!-- QA-R3 (P1): runs differ (9/0, 8/1, 9/0), so qa-tdd.md says the verdict is flaky, but red hides it -->
```qa
verdict: red
red: share.spec.ts fails "SHARE-3 save photo" on run 2 only
suite: e2e | npm run e2e | 9/0 8/1 9/0
```
