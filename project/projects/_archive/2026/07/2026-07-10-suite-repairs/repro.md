# Suite Repairs — Reproduction (v2.32.16 base `8639587`)

Reproduced at worktree HEAD (base `8639587`, v2.32.16) on 2026-07-10.

The BACKLOG classification (PRE_EXISTING at v2.31.10) is **STALE for 3 of the 4 named
files** — they have since been fixed on the develop line. Only `contract-parity.test.sh`
still fails.

## Per-file status at base `8639587`

| Test file | Status | Assertions | Notes |
|-----------|--------|-----------|-------|
| `hooks/tests/autopilot-cli.test.sh` | **GREEN** | 42 pass | Already fixed on develop since v2.31.10; no work needed. |
| `hooks/tests/review-runner.test.sh` | **GREEN** | 25 pass | Already fixed on develop; no work needed. |
| `hooks/tests/intent-capture-basic-write.test.sh` | **GREEN** | 9 pass | Already fixed on develop; no work needed. |
| `hooks/tests/contract-parity.test.sh` | **RED** | 17 pass / 11 fail | Real failure — see below. |

## contract-parity.test.sh — failure detail

Recurring diagnostic line across every failing case:

```
shell emits keys unknown to JS: on_engine_unavailable
```

11 failing assertions, all one root cause:

```
FAIL JS-side validator accepts normal config and matches fields exactly: expected '0', got '1'
FAIL normal validation returns parity-ok: 'parity-ok' not found in output
FAIL JS-side validator accepts scorecard config and matches fields exactly: expected '0', got '1'
FAIL scorecard validation returns parity-ok
FAIL JS-side validator accepts density conditional fields and matches fields exactly: expected '0', got '1'
FAIL density validation returns parity-ok
FAIL JS-side validator accepts high-tier density fields and matches fields exactly: expected '0', got '1'
FAIL high-tier density validation returns parity-ok
FAIL JS-side validator accepts anthropic-compatible reviewer_runner: expected '0', got '1'
FAIL anthropic-compatible validation returns parity-ok
FAIL validation error lists bogus_key: 'shell emits keys unknown to JS: bogus_key' not found in output
```

### Root cause (one line)

The shell resolver `scripts/resolve-review-loop.sh` emits `on_engine_unavailable`
(added in `04be602`, the `oeu-impl-grok` workstream) but the JS twin
`src/engine/resolve-review-loop.js` `REVIEW_LOOP_FIELDS` array was never taught the
field → the parity harness flags it as an unknown-emitted key on every config shape,
and the `bogus_key`-only assertion fails because `on_engine_unavailable` pollutes the
unknown-keys list ahead of `bogus_key`.

### Classification: **PRODUCTION-side** (JS twin sync)

`on_engine_unavailable` is a legitimate shipped field (shell validates it
`ask|solo-fallback|wait-reset` at `resolve-review-loop.sh:212`; consumers already
receive it). The shell is correct; the JS twin is behind. Fix = add the field to
`REVIEW_LOOP_FIELDS` + a matching value-level `assertOneOf(... ['ask','solo-fallback','wait-reset'])`.
This restores twin parity; it does **not** change a shipped contract/protocol
(the field is already emitted and consumed today), so no escalation.

## Unit B note

`dispatch-author.sh --endpoint` (the other named deliverable) is **already implemented
and tested** at this base (added `2a5d7fa`, `feat/eb-w2`); `dispatch-author.test.sh`
section 8 covers it (65 assertions green). BACKLOG context stale. No work needed.
