<!-- expect: red needs -->
<!-- QA-R2 (P1): verdict red with no red: line and no failed run; the loop says keep the red output -->
```qa
verdict: red
suite: unit | node --test | 4/0 4/0 4/0
```
