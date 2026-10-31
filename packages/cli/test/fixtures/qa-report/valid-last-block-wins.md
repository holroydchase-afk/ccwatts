The format, as shown in the agent (this quoted example is not the report):

```qa
verdict: green
suite: e2e | npm run e2e | 9/0 9/1 9/0
```

This run:

```qa
verdict: flaky
suite: e2e | npm run e2e | 9/0 9/1 9/0
QA-R1 | P1 | e2e share sheet | passes on retry only | tests/e2e/share.spec.ts
```
