# contract JSON-schema SSOT (+ resolve-endpoint hermeticity)

**Status**: COMPLETE (depth-1 foreman verified; authoritative qc held at depth-0)
**Branch**: `worktree-agent-a2a954dd63356fc39` (off develop `9f193d9`)
**Run**: /l6 L6-r3. Implementer `Gemini 3.5 Flash (High)` via agy. Reviewer `gpt-5.5` xhigh via codex.

## Ledger

| Unit | Runner | Model | Verdict | Rounds | Commits |
|------|--------|-------|---------|--------|---------|
| 1 — hermeticity | agy | Gemini 3.5 Flash (High) | test 56/56 green (creds machine) | 1 | `cfdcbc1` → cherry-pick `8ab3840` |
| 2 — schema SSOT | agy | Gemini 3.5 Flash (High) | review-loop converged SHIP-AS-IS (round 4) | 4 impl + 4 review | `308e82b`/`bd320f0`/`89bab23`/`ece3abd` → cherry-picks `ea7c749`/`71c8aee`/`7a8c741`/`e267159`; mirror `517b151` |

**Review loop (gpt-5.5 xhigh, decorrelated from the gemini implementer):**
- R1 FIX-THEN-SHIP: enum check not field-specific — shared-enum fields (reviewer_effort/implementer_effort, spec_review/independent_harness) let one arm satisfy both → removed validation masked. **Fixed**: `x-shell-var` per field; gate keys the case-arm lookup on the specific shell variable.
- R2 FIX-THEN-SHIP: (Major) `x-shell-var` interpolated into `new RegExp` unescaped; (Minor) `x-field-order` assigned without validation. **Fixed**: identifier guard on `x-shell-var` (fails malformed as data); require-time invariant on `x-field-order`.
- R3 FIX-THEN-SHIP: source-text match can be satisfied by a commented-out/dead arm. **Fixed**: `case` anchored to line start (`(?:^|\n)[ \t]*`); scope boundary documented (runtime invalid→default rejection is resolver-correctness, covered by resolve-review-loop.test.sh).
- R4 SHIP-AS-IS, findings: none. **Converged.**

## Unit 1 — resolve-endpoint.test.sh hermeticity (BACKLOG quick-win)

Root cause: `dispatch-anthropic-review.js` calls `loadEndpointsEnv()` at startup → `os.homedir()` finds the real `~/.autopilot/endpoints.env` even under `env -i` (HOME cleared → POSIX getpwuid fallback), so on a machine with GLM configured `AUTOPILOT_ENDPOINT_GLM_TOKEN` becomes SET and the `is unset` fail-closed assertion fails (1/56).

Fix: added `AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"` (a nonexistent path → loader no-op) to the three section-10 JS invocations. Assertion unchanged — still proves fail-closed on a missing token. Hermetic on BOTH a creds machine and a bare machine. `hooks/tests/` is not mirrored to the codex payload → no mirror sync.

**Result on THIS machine (real GLM creds present): 56/56 green.**

## Unit 2 — contract JSON-schema SSOT

- `schemas/review-loop-contract.schema.json` — 31 always-emitted contract fields (type, enum, required, `x-field-order`, `x-shell-validated`/`x-shell-var`). Derived mechanically from current truth and self-verified: schema field-set == shell default output keys (31==31) == JS field list; 12 schema enums == JS `assertOneOf` literals byte-for-byte (order preserved → error-message parity kept).
- `src/engine/resolve-review-loop.js` — loads the schema (`fs.readFileSync` relative to `__dirname`), derives `REVIEW_LOOP_FIELDS` (`x-field-order`, validated non-empty string array) + all 12 `assertOneOf` enum tables (`schemaEnum(field)`). Hand-written lists removed. Behavior byte-identical (oracles green unmodified).
- `scripts/check-contract-schema.js` — drift gate: (a) runs the shell resolver (pinned to template config) and asserts emitted keys == schema field-set; (b) per-field `case "$<x-shell-var>"` live-arm lookup with exact set match. Exit 1 naming the field. Node built-ins only. Wired as 2 new assertions in `hooks/tests/contract-parity.test.sh` (Case F) — no new hook/pre-commit step.
- `contract-parity.test.sh` — `REVIEW_LOOP_FIELDS` extraction switched from a source regex (broke once the list became schema-derived) to a module import (symbol now exported).
- Mirror: `schemas` added to `sync-codex-plugin-skills.sh` DIRS; schema+JS+gate materialize under `platforms/codex/plugin/`; mirror JS resolves ITS sibling schema (verified standalone, len 31, resolve status 0); `--check` clean.
- CLAUDE.md scripts-inventory row added.

## Drift-probe transcripts (acceptance, run on the FINAL committed tree)

```
(a) ADD bogus field to schema:
    check-contract-schema: DRIFT — shell output is MISSING schema field(s): bogus_added_field   exit=1
(b) REMOVE field on_engine_unavailable from schema:
    check-contract-schema: DRIFT — shell output emits field(s) NOT in schema: on_engine_unavailable   exit=1
(b2) SHARED-ENUM field-specific removal (R1 scenario) — drop IMPL_EFFORT shell case, keep REV_EFFORT:
    check-contract-schema: DRIFT — shell has no `case "$IMPL_EFFORT"` validation arm for schema field implementer_effort   exit=1
(enum-value) mutate schema reviewer_runner enum:
    check-contract-schema: DRIFT — enum drift for reviewer_runner (shell $REV_RUNNER): shell={...} vs schema={...|bogus-x}   exit=1
(metachar x-shell-var, R2) x-shell-var="RE.*|X":
    check-contract-schema: DRIFT — schema field reviewer_runner has a non-identifier x-shell-var: RE.*|X   exit=1
(malformed x-field-order, R2) x-field-order="notarray":
    JS threw: review-loop-contract schema x-field-order must be a non-empty array of field-name strings
(commented-arm, R3) comment out `case "$REV_RUNNER"`:
    check-contract-schema: DRIFT — shell has no `case "$REV_RUNNER"` validation arm for schema field reviewer_runner   exit=1
(c) RESTORE: contract-schema-ok (31 fields, field-set + enum parity verified)   exit=0
```

Schema field count == shell default output key count: **31 == 31**.

## Full battery (final integrated tree)

| Suite | Result |
|-------|--------|
| contract-parity | PASS 30 (was 28; +2 Case F) |
| autopilot-engine | PASS 320 |
| review-loop-runner | PASS 35 |
| resolve-review-loop | PASS 191 |
| resolve-review-loop-engine-unavailable | PASS 10 |
| dispatch-review | PASS 129 |
| dispatch-review-prompt-skeleton | PASS 11 |
| resolve-endpoint | PASS 56 |
| autopilot-engine-resilience | PASS 12 |
| codex mirror `--check` | in sync |

## Deviations from the CEO design frame

1. **`contract-parity.test.sh` was modified** (beyond adding Case F): its `REVIEW_LOOP_FIELDS` extraction was switched from a source regex to a module import. Forced — the regex matched the literal `const REVIEW_LOOP_FIELDS = [...]`, which no longer exists once the list is schema-derived. All 28 pre-existing assertions still pass with identical semantics; the change is mechanical (import vs regex), not a weakened oracle.
2. **`schemas/` added to the codex-mirror DIRS** (frame item 4 said "schema syncs to the payload" but the mechanism was unspecified). Necessary so the mirror JS resolves its sibling schema at `../../schemas/`. Pulls the 4 pre-existing schemas into the payload too (harmless — they are contract surface).
3. **Schema derivation scoped to `x-field-order` + enum tables** (per the frame's literal ask "REVIEW_LOOP_FIELDS + the enum tables"). The JS non-empty-string group, boolean group, integer/array/min-checks, and optional paired-field logic remain hand-written — deriving the FULL type system would risk behavior divergence, and the drift incident that motivated this ship was field-PRESENCE (`on_engine_unavailable`), fully addressed by field-list derivation + the field-set gate.

## Residual / BACKLOG

- The enum gate reconciles the DECLARED allowed-value set (schema ↔ live shell arm). It does not behaviorally prove the shell REJECTS an out-of-enum value at runtime (invalid→default) — that resolver-correctness is covered by `resolve-review-loop.test.sh` (191 assertions). A fully-behavioral per-field enum gate (drive the resolver with a bad value per field, assert fallback) was deliberately out of scope (the CEO frame honored the 2026-07-04 panel's deferral of bash behavioral plumbing cost). BACKLOG candidate if a third enum-drift incident occurs.
