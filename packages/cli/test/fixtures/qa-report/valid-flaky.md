The e2e share test fails on one run in three, so this isn't green.

```qa
verdict: flaky
red: tests/x.test.mjs fails "SHARE-3 save photo" (expected 1, got 0)
suite: unit | npm test | 42/0 42/0 42/0
suite: e2e | npm run e2e | 9/0 9/1 9/0
QA-R1 | P1 | e2e share sheet | passes on retry only | tests/e2e/share.spec.ts
```
