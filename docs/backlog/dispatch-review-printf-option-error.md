# dispatch-review printf option error (BL-0287)

## Problem
BL-0287. `scripts/dispatch-review.sh` printed `printf: --: invalid option` on stderr around line 504 on the cc-shim path. Cosmetic; the review completes. Trigger-Type ready. Effort S.

`dispatch-review.sh` with `--spec-file` leaked `printf: --: invalid option`-style errors on stderr when the spec block was emitted (cc-shim path), because a format string beginning with `-` was parsed as an option.

## Root cause
`printf '--- spec ---\n'` (and the pack/checklists headers) start with `--`, so bash's builtin `printf` treated them as options.

## Fix
Use `printf -- '--- ... ---\n'` for the leading-dash format strings in the spec/pack/checklists block, in `scripts/dispatch-review.sh` and its codex mirror.

## Assertion added
`hooks/tests/dispatch-review-opencode-quota.test.sh` runs the cc-shim path with `--spec-file` and asserts stderr does not contain `invalid option`.
