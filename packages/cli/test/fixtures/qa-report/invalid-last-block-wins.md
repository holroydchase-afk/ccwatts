<!-- expect: failed -->
The first block is valid; the last one (this run) is not, and the last one counts.

```qa
verdict: green
suite: unit | npm test | 42/0 42/0 42/0
```

This run:

```qa
verdict: green
suite: unit | npm test | 41/1 41/1 41/1
```
