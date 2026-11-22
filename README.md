# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/rizkyandyfany4-debug/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/rizkyandyfany4-debug/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's csv-reader 1.0.0: it reads broken CSV files and
returns exactly what csv-reader returns — `{columns, rows, errors}` for each
`{text, header}` input — but faster.

## How it works

The reference reads one character at a time and builds every field up a
character at a time. This parser instead scans each field once for its end
and takes the field with a single `slice`, so the hot loop never allocates:

- **Unquoted fields** are scanned with `charCodeAt` to the next comma, LF or
  CR, then sliced once. A lone CR is the only thing that ever forces a second
  look at a field (it is dropped with a `stray_cr` error).
- **Quoted fields** are scanned the same way to the closing quote. A field
  with no doubled quote and no CR inside is one slice; only a field that
  actually holds `""` or a CR pays for assembling its value from parts
  (`""` becomes one `"`, each CRLF or lone CR inside becomes one LF).
- The broken-row policy is csv-reader's own, kept line for line: a U+FEFF at
  the very start is dropped, empty lines are no records, a quote that never
  closes is read again as an unquoted field (`unterminated_quote`), what
  follows a closing quote is appended as it stands (`quote_junk`), and rows
  are padded (`short_row`) or cut (`long_row`) to the first record's width.

## How to run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every case from `cases.json`, answers each with `run` from
`solve.js`, and writes `answers.json` — one answer per case, in order.

<sub>Entered on [make.fun](https://make.fun/?ref=0adx9fja&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
