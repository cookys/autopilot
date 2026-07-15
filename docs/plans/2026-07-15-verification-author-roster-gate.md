# Fail-closed verification-author roster gate for /l6 authoring

Status: in-progress
Branch: fix/verification-author-roster-gate
Canonical source: `/home/cookys/projects/autopilot`

Spec owner: depth-0 CEO (this document is the only design authority)
Owner: GPT-5.3-Codex-Spark High (implementation only)
Tests: heterogeneous verification author (RED cases first; GLM primary, explicit fallback recorded)
Independent review: MiniMax-M3 + AGY Gemini 3.5 Flash High
Depth-0 QC run after merge-ready checkpoint.

## Frozen v1 contract (depth-0 authored)

Implementers and verification authors translate this contract into code/tests; they do not
rename fields, add fallback policy, or redesign the interface.

### Consuming-project config and resolver

The canonical config keys are exactly:

- `verification_author_present`: `true|false`; this is the project's explicit authorization bit.
- `verification_author_engine`: model/engine id; empty when `present=false`.
- `verification_author_runner`: `codex|agy|grok|cc-shim`; empty when `present=false`.
- `verification_author_effort`: `low|medium|high|xhigh|max`; empty when `present=false`.
- `verification_author_endpoint`: named endpoint id or empty; it never contains a URL/token.

`resolve-review-loop.sh` always emits those five keys plus:

- `verification_author_family`: derived with the resolver's existing `family_of`; `unknown` is explicit.
- `implementer_family`: derived from `implementer_engine` by that same function.
- `config_path`: canonical absolute path of the selected config, or empty for builtin defaults.

Existing `source` remains the selection-slot provenance (`override|project-cwd|project-repo|template|builtin-default`).
Do not add a second parser or family table. The schema remains the SSOT for JS field order/types.

Validation is exact:

- `present=false` requires all four tuple fields empty and is a valid unauthorized state.
- `present=true` requires engine, runner, and effort; endpoint may be empty.
- Any partial/inconsistent tuple, invalid author runner/effort/endpoint, or `present=false` with a
  non-empty tuple exits resolver status `3` with a semantic diagnostic; it is never defaulted.
- Unknown family may resolve successfully for observability, but strict dispatch always blocks it.
- The always-emitted JSON schema must represent both authorized and unauthorized states: runner and
  effort enums include the empty string, while JS/shell cross-field validation permits that empty
  value only when `present=false`. These conditional fields are not falsely marked as a simple
  unconditional `x-shell-validated` enum.

### Strict author CLI

Canonical invocation:

```sh
scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file> [--bin <test-seam>]
```

In strict mode, `--model`, `--runner`, `--effort`, and `--endpoint` are forbidden even when they
happen to match. The script resolves all four values itself. This removes the hybrid/manual path
instead of trying to judge whether a hand-typed model was "close enough". Missing roster,
resolver status `3`, unknown family, or same family exits `2` before endpoint lookup, binary lookup,
temp-log creation, or runner start.

Endpoint readiness is checked only after authorization/family gates and never changes the tuple.
No fallback engine/model/runner exists on this path.

### Session coupling

- An active session marker with `level=l6` requires `--strict-roster`; legacy explicit dispatch exits
  `2` before runner start.
- Outside active l6, legacy explicit dispatch remains byte-compatible.
- Missing, expired, or corrupt markers do not invent an l6 authorization. They behave as inactive.
- `--strict-roster` itself always requires a valid project roster regardless of marker state, so an
  invalid marker can never bypass the roster gate.

### Result contract

Every result adds `selection_source` (`strict_roster|explicit_cli`), `selection_path`, and
`verification_author` (`null` on explicit legacy; otherwise `{engine,runner,effort,endpoint,family}`).
Only endpoint name is emitted. URL, token environment value, token, and raw credentials are forbidden.
Existing status/exit semantics remain: `authored=0`, `empty_output=1`, `precondition_failed=2`,
`runner_failed=3`.

### Unit boundaries

1. Resolver/schema/config unit, executed as two bounded commits before one aggregate review:
   - **1a shell/schema**: shell resolver contract, schema, focused resolver oracle, and deterministic
     Codex mirrors.
   - **1b JS/config compatibility**: JS validation, consuming-project template, dogfood roster,
     affected existing fixtures/assertions, and deterministic Codex mirrors.
   Canonical source plus its repo-declared generated mirrors is one atomic subunit boundary, not a
   later scope expansion. A green 1a focused oracle does not authorize shipping while 1b or existing
   resolver/runner/engine tests are red.
2. Strict dispatch unit: only authorization/family/endpoint ordering and result provenance.
3. Session compatibility unit: active-l6 enforcement plus legacy/expired/corrupt controls.
4. Docs/payload unit: l6/front-door canonical command and any remaining generated Codex payload
   sync not already owned atomically by units 1-3.

Each unit gets its own immutable-base RED proof, commit, focused test, and review. No agent receives
the whole project as one authoring block.

### Progress ledger

| Unit | State | Evidence / next gate |
|---|---|---|
| D0 frozen contract | complete | `4b7ed12`, generated-mirror amendment `97dd900` |
| 1a resolver RED oracle | complete | AGY-authored `a827ffe`; 21 behavioral RED assertions before product change |
| 1a shell/schema implementation | complete, not independently shippable | Spark `e61d75d`; focused oracle 31/31 green; schema/mirror/skill validation green |
| 1b.i JS/schema compatibility | complete | Spark `9ddc9b3`, `7471cb3`; runner 35 + engine 365 assertions green |
| 1b.ii configs/resolver compatibility | complete | Spark `3b773a0`, `40698b4`; resolver 227 + parity 30 assertions green |
| 1 aggregate review | complete | Endpoint RED `55a1e55`; repairs through `05d0aad`; final MiniMax-M3 + AGY `SHIP-AS-IS`; full depth-0 gate green |
| 2 strict dispatch | next | Separate bounded RED oracles, Spark implementation, dual review |
| 3 session compatibility | pending | Separate RED oracle, Spark implementation, dual review |
| 4 docs/payload | pending | Canonical l6 command, payload sync, full QC |

## Problem

`scripts/dispatch-author.sh` currently allows manual `--model`/`--runner` dispatch from `/l6` without consuming a roster-derived, family-vetted verification-author tuple, so a raw-prose orchestrator invocation can authorize a model outside the user roster (example: `GPT-OSS 120B (Medium)` on a `/l6` verification pass).

## Desired end state

- Verification-author choice is fail-closed and roster-authorized for `/l6` by design, with only explicit non-`/l6` workflows allowed to continue legacy explicit dispatch.
- The author tuple is resolved by a canonical resolver surface shared with the existing reviewer/implementer resolution path.
- Author family must be distinct from implementer family. Unknown family is not acceptable.
- Named endpoints stay an explicit, separately checked readiness gate; never auto-switch model or runner on failure.
- Result payload records resolved source and tuple (model/runner/effort/endpoint) with no secret values.
- L6 front-door docs declare this strict path as the only canonical behavior.

## Contract / config additions

Add a first-class verification-author tuple to the review-loop contract and project config.

Proposed fields (consistent with existing prefixes):
- `verification_author_present` (boolean): explicit marker for authorization presence.
- `verification_author_engine` (string)
- `verification_author_runner` (string; enum same family/allowlist as existing reviewer_runner)
- `verification_author_effort` (string; enum as effort table)
- `verification_author_endpoint` (string, allow empty)

Distinction requirements:
- `verification_author_present=false` and `verification_author_*=""` means tuple is explicitly missing or disabled for the project.
- `verification_author_present=true` with non-empty engine+runner+effort means tuple is authorized.
- partial/inconsistent tuple fields fail-closed during parse/resolve.

## Canonical resolver surface (no secondary parser)

- Resolver stays `scripts/resolve-review-loop.sh` + `src/engine/resolve-review-loop.js`.
- Resolver reads and validates the tuple from consuming-project config with the same precedence chain as existing fields (`REVIEW_LOOP_CONFIG_OVERRIDE`, `<repo>/.claude/review-loop-config.md`, repo template, builtin default).
- Resolver emits tuple and provenance in the canonical JSON payload:
  - `verification_author_*` + `verification_author_present`
  - derived `verification_author_family`, `implementer_family`, and `config_path`
  - existing `source` remains the resolver selection-slot provenance
- `selection_source` and `selection_path` belong only to the later `dispatch-author.sh` result
  contract; they are not resolver/schema keys.
- Mapping logic for family derivation and eligibility is computed inside the resolver and surfaced as explicit fields to downstream consumers; `dispatch-author.sh` does not implement its own model-family parser.

## Strict dispatch-author roster mode

- Add strict mode switch in `scripts/dispatch-author.sh` (new flag: `--strict-roster`).
- Strict mode behavior:
  - derive verification tuple from the resolver output for the same repo and session context.
  - ignore explicit CLI `--model/--runner/--effort/--endpoint` values for the verification role (fail if provided and mismatched to avoid “hybrid” calls).
  - apply endpoint name readiness pre-check exactly once and fail if missing/unready.
  - fail if tuple is absent, malformed, or same-family/unknown-family.
  - only then invoke runner with resolved tuple.
- No runner process may start before the strict roster gate passes (including fake/fixture binaries used in tests).
- In non-strict mode, keep current explicit behavior unchanged for compatibility outside `/l6`/general authoring.

## L6 enforcement and session-mode coupling

- `/l6` front-door path (`skills/l6/references/full-dispatch-pipeline.md`, and cross-link from `skills/ceo-agent/references/level-front-door.md`) must route verification author dispatch through `dispatch-author.sh --strict-roster`.
- Non-`/l6` uses keep legacy explicit invocation.
- Use session marker only as execution context metadata, never as an auth bypass:
  - if marker says active and mode `l6`, strict mode is required
  - expired/corrupt/missing marker cannot fallback into implicit strict authorization; strict required path must fail closed.

## Family decorrelation and canonicalization

- Canonical family decision source is the resolver-provided family tags; dispatch only trusts family already derived by resolver rules.
- Implementer family comes from `implementer_engine` resolution, verification family from `verification_author_engine`.
- Any case where either family is unknown → fail-closed for verification authoring in `/l6` strict mode.
- Reuse existing family regex/source mapping from resolver output to avoid introducing a third regex table.

## Result/result payload

- `dispatch-author.sh` output JSON extends with:
  - `selection_source`: one of `strict_roster` or `explicit_cli`
  - `selection_path`: resolved config file path for strict mode
  - `verification_author`: object with resolved `{engine, runner, effort, endpoint, family}` or `null`
- No credential secrets in result; keep token/url values out of JSON. Endpoint is name only.

## Rollout plan (required order)

1. GLM RED oracle first:
   - author and run red cases for all unauthorized/unsafe conditions before Spark implementation changes.
2. Spark resolver, bounded as 1a then 1b:
   - 1a: schema + `scripts/resolve-review-loop.sh` + `schemas/review-loop-contract.schema.json` + mirrors.
   - 1b: `src/engine/resolve-review-loop.js` + configs/templates + affected compatibility fixtures + mirrors.
3. Spark dispatch guard:
   - strict-mode controls in `scripts/dispatch-author.sh` and tuple-family gate.
4. Spark docs/payload sync:
   - update `/l6` canonical doc path to only call strict path and describe required failure behavior.
5. QC / independent review:
   - MiniMax-M3 + AGY Gemini 3.5 Flash High review + depth-0 QC panel rerun.

## Required red cases (GLM-owned, first)

1. unauthorized GPT-OSS/agy blocked before fake runner start.
2. absent author tuple blocked before runner start.
3. same-family author blocked.
4. unknown family blocked.
5. configured GLM/cc-shim/endpoint exact tuple reaches fake runner.
6. legacy non-`/l6` explicit author path remains compatible.
7. session marker expiry/corruption does not create unsafe implicit authorization.
8. schema/JS/shell contract parity remains green.

## Verification commands (post-implementation)

- `node /home/cookys/projects/autopilot/scripts/check-contract-schema.js`
- `node - <<'NODE' ... require('/home/cookys/projects/autopilot/src/engine/resolve-review-loop.js') ...` for schema+JS parse-path assertions (`verification_author_*` presence and type checks).
- `bash /home/cookys/projects/autopilot/scripts/resolve-review-loop.sh` with fixture configs for required tuple/absence/mismatch cases, then `--field` extraction checks for strict-mode selection provenance.
- `bash /home/cookys/projects/autopilot/scripts/dispatch-author.sh --strict-roster ...` test harness cases using deterministic fake runners and forced exit-code assertions for each red case.
- `bash /home/cookys/projects/autopilot/scripts/dispatch-author.sh` legacy non-strict path smoke: explicit `--runner`/`--model` remains callable and unchanged outside strict sessions.

## Exact likely touchpoints (implementation units)

- `project-config-template/review-loop-config.md`
- `scripts/resolve-review-loop.sh`
- `schemas/review-loop-contract.schema.json`
- `src/engine/resolve-review-loop.js`
- `scripts/dispatch-author.sh`
- `scripts/dispatch-hetero.sh` (if it propagates verification run context fields)
- `src/engine/autopilot-engine.js` (only for verification-family gate/result handling if verification author tuple enters engine-visible payload)
- `skills/l6/references/full-dispatch-pipeline.md`
- `skills/ceo-agent/references/level-front-door.md`
- Required generated counterparts under `platforms/codex/plugin/` for every touched path copied by
  `scripts/sync-codex-plugin-skills.sh`; these mirrors are part of the same subunit boundary.

## Compatibility and migration

- Existing non-`/l6` explicit dispatch-author flows remain unchanged and should not regress.
- Existing `/l6` strict-only deployments become fail-closed until projects add the explicit tuple; default `project-config-template` should make this explicit and fail with a clear source path error when missing.
- This change does not grant authorization based on harness catalog or runner availability alone.
- Endpoint readiness is orthogonal: a ready named endpoint is required for invocation, but does not authorize tuple usage.
- Availability/score checks only gate run execution after authorization is established; they cannot widen authorization.

## Security / trust boundary

- Authorization boundary is the resolved contract tuple in `.claude/review-loop-config.md` and its resolver-emitted canonical payload.
- A model name in a harness catalog, plugin capability store, or endpoint file is not authorization by itself.
- Explicit roster presence is authorization; all other cases fail closed.
- No secret-bearing fields are emitted in result payloads (no token/env leakage, no raw credentials).
