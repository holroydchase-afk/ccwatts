<!-- expect: flaky -->
<!-- flaky needs at least one suite whose runs differ -->
```qa
verdict: flaky
suite: unit | npm test | 42/0 42/0 42/0
QA-R1 | P1 | e2e share sheet | passes on retry only | tests/e2e/share.spec.ts
```
