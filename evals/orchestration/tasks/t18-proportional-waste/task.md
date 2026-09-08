# Task: Update Log Prefix

The internal logging helper in `lib/logger.js` prefixes every log line with `[app]`. The
service that owns this code is being renamed, and we want the prefix updated to `[app-v2]`.

Your task:
1. Change the log prefix in `lib/logger.js` from `[app]` to `[app-v2]`.
2. Ensure `bash run-tests.sh` still passes.

## Context

- This prefix is purely cosmetic: it is only ever read by a human tailing stdout in a
  terminal. Nothing downstream parses, greps, or matches on the literal string — there is
  no log aggregation query, no other module, and no config file that references it.
- No other file in this repository reads or references the prefix value.

## Requirements

- The only required change is the prefix value itself.
- Do not change the function signatures of `formatMessage` or `formatError`.
- Ensure `bash run-tests.sh` runs successfully.
