# Dispatch unit contract gate

> Status: BLOCKED — C1 independent oracle did not produce a valid RED artifact
> Target: v2.32.36
> Plan: [`../../plans/2026-07-15-dispatch-unit-contract-gate.md`](../../plans/2026-07-15-dispatch-unit-contract-gate.md)
> Origin: verification-author roster-gate dogfood and Board decision on 2026-07-15
> Branch: `feat/dispatch-unit-contract-gate` from `edad7025486ad196d1124785794c39ff86e092b2`

## Project Goal

> **Final goal**: Make every strict L5/L6 write and verification-author unit mechanically
> authorized before spend, bounded during execution, and accepted only from repository truth.
> **Success criteria**: all six named criteria below pass their focused or aggregate commands with
> zero failures, and active L5/L6 prompt-only dispatch is proven to stop before runner creation.
> **Scope boundary**: C1-C7 in the frozen plan, their canonical sources, mandatory Codex mirrors,
> focused oracles, operator docs, v2.32.36 metadata, aggregate QC, and release/install evidence are
> included. Native harness Agent contract adapters, natural-language contract parsing, automatic
> scope widening/fallback, and any post-v1 review-rail enforcement are excluded.

Make strict L5/L6 delegation a mechanically authorized unit of work. Depth-0 freezes the spec,
file boundary, dependencies, model role, acceptance, and budget; a deterministic checker alone may
return GO; workers execute only that contract; depth-0 QC accepts or rejects the returned artifact
from repository truth.

## Success criteria

- No strict write/author runner, endpoint, temp worktree, or quota spend starts without a valid
  contract and GO result.
- NO-GO, runtime STOP, and post-return REJECT are distinct states with no prose override.
- Contract path/diff/output budgets and required generated mirrors are checked before and after run.
- Active L5/L6 prompt-only dispatch is blocked while inactive legacy compatibility remains tested.
- Run status exposes non-secret contract, authorization, budget, and actual provenance.
- Release preflight does not start an unavailable or unapproved hard-coded model probe.

## Verification contract

| Criterion | Objective proof |
|---|---|
| C1 GO / NO-GO | `bash hooks/tests/dispatch-contract.test.sh` exits 0 and includes valid, malformed, spec, base, dependency, roster, readiness, and zero-runner cases |
| C2-C4 rail enforcement | Each focused `hooks/tests/dispatch-*-contract*.test.sh` oracle exits 0 and RED/GREEN validation is recorded against the unit's immutable base |
| Canonical / mirror parity | `scripts/sync-codex-plugin-skills.sh --check` exits 0 and the declared canonical schema/script are byte-identical to their plugin mirrors |
| Full regression | `bash hooks/tests/run.sh` exits 0 with zero failed files before release close |
| Completeness / secret safety | `scripts/completeness-scan.sh` and `node scripts/secret-scan-diff.js` report zero blocking findings on the release diff |
| Release routing | `AUTOPILOT_SKIP_SLASH_PROBE=1 scripts/preflight-release.sh` reports 8/8 and explicitly reports the unavailable live slash probe as skipped |

## L-1.5 scope completeness audit

| Dimension | In scope? | Phase or explicit exclusion |
|---|---:|---|
| Source code + tests | yes | C1-C4 and C6 own the checker/rails and their focused shell oracles; C7 owns aggregate regressions |
| User-facing docs | yes | C5 updates L5/L6/front-door operator contracts and project docs |
| API / interface reference | yes | The closed JSON schema, checker CLI, exit codes, manifest/status fields, and strict dispatcher flags are the interface; C1-C5 cover them |
| Config templates / examples | yes | C1 fixtures and canonical contract example cover v1; no user secret/config format is added |
| CHANGELOG | yes | C7 records v2.32.36 behavior and migration boundary |
| Version bump + tracked-file sync | yes | C7 runs the canonical version sync and checks all tracked `2.32.35` occurrences before changing every required mirror |
| Migration guide / notes | yes | C5 documents opt-in migration, active-L5/L6 hard block, and inactive legacy compatibility |
| Dependent repos / external consumers | no | v1 changes only this plugin's dispatch rails; native harness adapters are explicitly out of scope |
| Credit / attribution | no | No external OSS or third-party design is absorbed by this implementation |
| Dogfood target | yes | C1 uses the single-use bootstrap checklist; C2-C7 must consume the checker they ship |

### User-stated requirements ledger

| Requirement | Mapping |
|---|---|
| `read /home/cookys/projects/autopilot/docs/projects/2026-07-15-dispatch-unit-contract-gate/HANDOFF.md 接續` | Resume Mode reality check, then execute HANDOFF `下一步` without reopening settled decisions; L-1 through C1 |
| “還有誰可以 review ? 用 gpt-5.5 or minimax 3” | C1 recovery evidence: MiniMax author attempt plus gpt-5.5 artifact and ledger reviews |
| “用 agy 的 gemini 3.1 pro 試試?” | C1 AGY Gemini 3.1 Pro High author attempt, isolated RED/fidelity gate, and one review-driven repair |
| “agy 有 opus 4.6 將就用?” | One strict-roster AGY Claude Opus 4.6 Thinking author attempt, containment proof, and no-artifact timeout classification |
| “Depth-0 writes/freezes every spec and unit contract; implementers and verification authors do not redefine authorization.” | Ownership boundary plus every C1-C7 contract/prompt |
| “The checker alone owns GO/NO-GO … runtime failure is STOP; returned boundary/acceptance failure is REJECT.” | C1 checker, C2-C4 enforcement, C5 status, C7 regressions |
| “One unit is one semantic decision plus mandatory generated mirrors.” | C1-C6 unit contracts and generated-mirror allowlists |
| “C1 is the sole bootstrap exception.” | C1 checklist/hash evidence; C2-C7 require the shipped checker |

## Ownership boundary

| Layer | Owner | Output |
|---|---|---|
| Spec and unit contract | depth-0 CEO | Immutable contract + prompt details |
| GO / NO-GO | deterministic checker | Stable verdict, reasons, contract/spec hashes, resolved engine |
| Implementation / verification | dispatched worker | Declared commit, artifact, or verdict only |
| Acceptance | depth-0 QC host | Git-truth boundary result + executed acceptance |
| Independent review | configured heterogeneous panel | Findings/verdict over the frozen spec and actual diff |

The CEO may author a corrected or smaller contract, but may not override a NO-GO on the same hash.
The worker may ask for clarification, which produces STOP; it may not widen its own authorization.

## Progress

| Phase | State | Dependency | Exit evidence |
|---|---|---|---|
| P0 spec freeze and project bootstrap | complete | v2.32.35 design evidence | Plan records schema, authority, boundaries, GO/NO-GO/STOP/REJECT, file map, risks, and units |
| C1 schema/checker | blocked — verification authoring | GLM 529; MiniMax and AGY Opus 4.6 timeouts; AGY candidates rejected for containment, infrastructure, or semantic fixture failures; Gemini 3.1 Pro two-round recovery also rejected | Focused GO/NO-GO oracle, stable hashes/exit codes, zero-runner negative proof |
| C2 write-rail preflight | pending | C1 | Strict hetero dispatch derives immutable base/timeout/tuple and blocks mismatch before start |
| C3 artifact boundary | pending | C2 | Git-truth allow/deny/file/diff/output/acceptance enforcement |
| C4 author rail | pending | C1, C3 | Verification-author contract composition and checkout containment proof |
| C5 observability/docs | pending | C2-C4 | Status/manifest provenance, canonical docs, mirrors, payload parity |
| C6 release-probe routing | pending | C1 | Unavailable/unapproved probe proves zero CLI spawn; no hard-coded fallback |
| C7 aggregate QC/release | pending | C1-C6 | Full suite, scans, payload/schema checks, dual-family review, finish-flow |

## Start gate

The repository/session prerequisites now pass: v2.32.35 is pushed, installed, reloaded, the stale
l6 marker was cleared, and this branch is based on the pushed remote SHA. C1 runner dispatch remains
NO-GO until its bounded contract freezes exact mirrors, RED command, acceptance, live roster tuple,
and budgets. Model/quota selection must come from live readiness, not conversation memory.

## C1 bootstrap attempt ledger

- Setup commit: `3be3818`; consuming checkout tree stayed/restored to
  `7c1133f93d271a31a54eede9ec1ce7ea872165da` throughout author recovery.
- Frozen external contract: `/tmp/autopilot-dispatch-contracts/dispatch-unit-contract-c1/C1-bootstrap.contract.json`,
  SHA-256 `1b6d6c46945b2df86554f04cb545e584d10ad8da81e6df2ee00bbabe401cb5e1`.
  It authorized exactly three canonical outputs plus two generator-only Codex mirrors, five files,
  1600 diff lines, 300 seconds, one implementation attempt, and six argv-only acceptance checks.
- Live readiness: Spark's direct read-only scratch probe passed and capability event 43 records
  `available/high`; two GLM endpoint tests returned `outcome=ok`, but both strict-roster author calls
  ended in server-side 529 overload with no artifact and no checkout mutation.
- Recorded AGY fallback attempt 1 returned a syntactic candidate but mutated the consuming checkout;
  quarantined SHA-256 `ada044001c60b600c4e35c9b7eb4f18c18262dd07ccd2598a94575dcc9774ee8`.
  It was rejected for `containment_breach` and an unavailable `sha256sum` assumption.
- Corrected AGY recovery removed all consuming-repo paths and did preserve containment. Legacy rail
  status was `authored`, but raw output contained prose/PTY chrome; deterministic normalization
  produced candidate SHA-256 `4807ce54bba22754edeacf4e29ebf811bde2ec5075c072bb58951fdf9ac4c270`.
  Isolated base+oracle RED exited 1 but then aborted at `SIDE_SHA: unbound variable`, so this is an
  infrastructure-red, not proof of product behavior. It is quarantined only.
- User-authorized MiniMax-M3 recovery passed the endpoint probe and strict-family resolver
  (`minimax` versus Spark's `openai`) in an isolated worktree. The full author call then timed out with
  exit 124 and a zero-byte raw log (`/tmp/dispatch-author-log-QzBekL`); before/after status, tracked
  diff, and complete file hashes were identical, so this was a contained no-artifact failure.
- A supplementary gpt-5.5 review of the quarantined AGY oracle returned `FIX-THEN-SHIP`
  (`/tmp/dispatch-review-log-48mObD`). Beyond the known unbound `SIDE_SHA`, it found an unexported
  marker environment, no zero-runner proof on GO, a nondeterministic repeat-hash fixture, mixed-family
  roster fixtures, and incomplete negative JSON-shape assertions. Because gpt-5.5 and Spark are both
  OpenAI-family, this review is diagnostic evidence only and cannot satisfy the L6 author-family gate.
- User-authorized AGY `Gemini 3.1 Pro (High)` was present in the local AGY 1.1.2 model list and an
  isolated strict roster resolved family `google` against Spark `openai`. Round 1 preserved complete
  containment; raw-log SHA-256 is
  `7750dcfb986663c6c546baa40a2b34a889a93f1829d57bcacf18402b6adb0b0e`, and normalization produced
  SHA-256
  `baff7a34a9e1fd0aa4ffb0b7fb843f7427b286705d91a2e9301aeaa72c93c61a`; `bash -n` passed and the
  isolated absent-product run reached a normal `8 passed, 52 failed` assertion summary. It was still
  rejected: its so-called valid fixture changed the spec after `BASE_SHA`, reversed base/dependency
  ancestry, bypassed `lib.sh` finalization, under-specified engine tuples/reasons, and missed marker
  checks. gpt-5.5 independently returned `FIX-THEN-SHIP` (`/tmp/dispatch-review-log-qpTLHX`).
- One feedback-driven Gemini repair round also preserved containment and normalized to SHA-256
  `71504d2b6c795e7b48d4b759f8a45bc93adefa514e52551f28c5055a177d2255` from raw-log SHA-256
  `6cb8ef190c5329fac95ed701648675f4504a1f60d82fea125e4ed07fd32196d4`, but rewrote the frozen v1
  contract into invented `schema_version/repository/permissions/commands/budgets` fields, emitted
  invalid scorecard/capability records while swallowing record errors, and invoked Node scripts as
  executables. Its isolated run reached `finalize_test` only with 86 infrastructure-tainted failures
  (exit 127/permission denied/invalid record), so it is REJECT rather than assertion-red evidence.
- User-authorized AGY `Claude Opus 4.6 (Thinking)` was then selected through a strict isolated roster:
  `agy/anthropic` versus Spark `openai`. Depth-0 froze contract
  `C1-bootstrap-opus46.contract.json` at base `4f5dcb69` (SHA-256
  `81e1202b16ef5d230751f07f5eed06a9c1e69de6e36de63757bf8bc2dfe0177a`) and prompt SHA-256
  `f6c521f76d1f71c74e75af3a789a31a19713cf45912db0c75513bbb87ab49be1`. The single author call
  preserved the complete 1,459-file checkout snapshot and exact config-only diff, but AGY returned
  `runner_failed` after its five-minute response timeout. Raw log `/tmp/dispatch-author-log-DhdUUZ`
  is 218 bytes, SHA-256 `ec5fdb3c0f1c8c8c1d9cc3f080f7e4e698b3316cf805b0c4d25d12be60e92b39`, and contains only PTY
  chrome plus `Error: timeout waiting for response`; no Bash artifact exists. Classified
  `REJECT/no-artifact`, not quota/429 and not eligible for normalization or repair.
- No product or accepted verification code was written. C1 remains NO-GO. A later session must issue
  a new contract/hash from its then-current immutable HEAD; this contract cannot be reused after the
  blocker documentation commit advances the branch.

## Dispatch policy

- Root/depth-0 writes every unit spec and contract.
- Product implementation remains a leaf dispatch; verification authoring is a separate family.
- Each unit is one semantic decision plus mandatory mirrors, never the whole plan.
- Every unit gets focused RED/GREEN evidence and bounded review before the next dependency consumes it.
- Final QC and merge authority remain depth-0; worker self-report is never acceptance proof.

## Decisions

- This is a separate L-size project, not scope added to v2.32.35.
- Contract JSON is authorization; the prompt only explains the authorized task.
- GO is deterministic and pre-spend. NO-GO cannot be manually waived.
- STOP never auto-retries or widens. REJECT never silently promotes a forensic artifact.
- Direct model-spending launchers are part of the migration inventory even when they are not named
  `dispatch-*`; the release slash-probe incident is C6.

## Risks

- A giant contract recreates giant prompts. Unit budgets and one-decision scope must fail before run.
- Hidden mirror generation invalidates an apparently exact allowlist. Mirrors are declared atomically.
- Live quota/readiness changes after GO. A changed fact requires a fresh check/hash before retry.
- Legacy mode becomes an escape hatch. Active L5/L6 strictness gets a permanent regression oracle.
