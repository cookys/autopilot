# Rubric — 2026-09-11-kimi-implementer-rail.md

> Source plan: docs/plans/2026-09-11-kimi-implementer-rail.md (§2.5 Global Constraints, frozen)

R1: The rail is grok/qoderclicn/opencode-shaped: EDIT-ONLY directive prepended to the prompt, `cd "$WT" && exec "$KIMI_BIN" -m "$MODEL" -p "<directive+prompt>"`, wrapper commits, verdict from git artifacts. No `--auto`, no `-y` (they cannot combine with `-p`).
R2: The prompt travels as one argv string; bytes are measured before spawn and `die_precondition` fires above `KIMI_ARGV_LIMIT` (default 120000, env-overridable like the review rail's). Never truncate, never split silently.
R3: `--runner kimi` is explicit-only; `auto` must not route to it. `--kimi-bin` is the test seam. `log_format: plain`, `usage: null`.
R4: Every place a runner token lives is updated in the same change: dispatch-hetero.sh (flags, IS_KIMI, labels, enum, precondition, cleanup, detach declare -p), scripts/lib/runner-binary.js, scripts/engine-qualify.js implRunnerBinFlag, src/engine/implementer-ladder.js, scripts/resolve-review-loop.sh implementer_runner enum. Reviewer/author rails are untouched.
R5: resolve-dispatch.sh's token grammar becomes `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$` — one optional slash-separated namespace, nothing more; the value is passed verbatim to `--model`.
R6: Mirrors under platforms/codex/plugin/ are re-synced; the pre-commit ritual enforces it.
R7: No test touches process-global state; stub binaries live in the test's temp dir and are passed via `--kimi-bin`.
