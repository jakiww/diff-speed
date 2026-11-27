# Diff Speed — a faster drop-in for makefun-diff 1.0.0

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/jakiww/diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/jakiww/diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

[Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` answers
every case with exactly the patch makefun-diff returns — same lines, same
Myers edit script with the deletion-preferred tie-break, same hunks — and
does it several times faster.

## How it wins its speed

- Every line is hashed to one integer once, so the search compares integers,
  never strings.
- The Myers search keeps only the furthest x per (depth, diagonal) in one
  small typed-array row per depth — no path objects, no linked lists — and
  the two edge diagonals are handled outside the inner loop.
- The edit script is recovered by walking those rows back down with the
  same tie-break the forward pass used, so the recovered script is the same
  first path the reference search returns.
- The driver turns V8's incremental marking off, the way the house
  baseline does.

## Layout

- `solve.js` — the drop-in: `run({ old, new })` returns the patch string.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.
- `LICENSE` — MIT.

## How to run it

```sh
node main.ts
```

It reads the cases from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`) and
writes the answers to `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`).
Node 22 or later, nothing to install, no dependencies.

## Verification

Checked against makefun-diff 1.0.0 on the kit's practice set (4/4 identical)
and on thousands of extra generated cases — empty texts, missing final
newlines, `\r` inside lines, CRLF pairs, huge common prefix/suffix,
single-line texts, completely different texts, and small alphabets that
force many equally short edit scripts. On the practice set it runs about
four times faster than the house baseline in CPU time.

Play code: `makefun-glove-pony-raven`
