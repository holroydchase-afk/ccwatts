<!-- expect: duplicate -->
<!-- also: failed; two rules broken, so two reasons on two lines -->
```qa
verdict: green
suite: unit | npm test | 41/1 41/1 41/1
QA-R1 | P1 | unit | price test fails | tests/price.test.mjs
QA-R1 | P2 | unit | slow | none
```
