# gemini-4-carbon-high on agy — local qualification smoke (2026-11-11)

Local evidence that `gemini-4-carbon-high` (agy 1.5.4) can review a planted-bug diff, a clean diff, and one tiny plan. This directory does not edit `references/official-qualification-defaults*.json` and does not claim an official qualification. The manifest field `qualification_status: qualified` is only the plan-review rail gate (`dispatch-plan-review.js` dispatches a seat only when `readiness_status` is `ready` and `qualification_status` is `qualified`).

Host clock at the runs: 2026-11-11 02:35–02:40 CST (manifest timestamps are UTC 2026-11-10 18:35–18:40). Repo tip at the runs: `491c99f1325f0d100496cf126ec59c3f32d3e954`.

## Code review (`scripts/dispatch-review.sh`)

Both calls omit `--effort`. The rail's default effort is `xhigh`; agy folds a `*-high` id to `--effort high`. Timeout 10m. Prefix on every command: `nice -n 10 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, stdin `/dev/null`.

```bash
EV=docs/plans/evidence/2026-11-11-agy-carbon-smoke
nice -n 10 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
  bash scripts/dispatch-review.sh --runner agy --model gemini-4-carbon-high \
  --diff-file "$EV/diffs/bad-charge.diff" --spec-file "$EV/diffs/bad-charge.spec.md" \
  --timeout 10m
nice -n 10 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
  bash scripts/dispatch-review.sh --runner agy --model gemini-4-carbon-high \
  --diff-file "$EV/diffs/clean-clamp.diff" --spec-file "$EV/diffs/clean-clamp.spec.md" \
  --timeout 10m
```

| diff | what it plants | exit | run id | verdict |
|---|---|---|---|---|
| `diffs/bad-charge.diff` | `charge()` drops the positive-integer guard, so a negative amount increases `balance` | 0 (`runs/bad-charge.rc`) | `review-1794335725-1585563-7028` | `FIX-THEN-SHIP`, finding `🟠 [charge-amount-validation] MUST-FIX` |
| `diffs/clean-clamp.diff` | `clamp` bounds change from `<`/`>` to `<=`/`>=`, which the spec says is equivalent | 0 (`runs/clean-clamp.rc`) | `review-1794335725-1585570-0c72` | `SHIP-AS-IS`, findings `none`, `no_finding_proof` present |

Stdout is `runs/bad-charge.stdout` and `runs/clean-clamp.stdout`. Stderr run lines are the matching `.stderr` files. Raw logs (outside the repo): `/home/team/.tmp/dispatch-review-log-JO1MGS` (bad), `/home/team/.tmp/dispatch-review-log-aBZTdW` (clean). Manifests (outside the repo): `/home/team/.tmp/autopilot-dispatch-runs/review-1794335725-1585563-7028.manifest.json`, `/home/team/.tmp/autopilot-dispatch-runs/review-1794335725-1585570-0c72.manifest.json`.

## Plan review (`scripts/dispatch-plan-review.js`)

Plan `plan/tiny-plan.md`. Rubric from `node scripts/plan-rubric-scaffold.js` (exit 0): `plan/tiny-plan.rubric.md`. Manifest `plan/manifest.json` validates against `schemas/plan-review-manifest.schema.json`. One seat, `fallbacks: []`, `--no-topology-fallbacks`, `--allow-unregistered`, `--timeout 20m`.

```bash
EV=docs/plans/evidence/2026-11-11-agy-carbon-smoke
nice -n 10 env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
  node scripts/dispatch-plan-review.js --repo-root "$PWD" \
  --plan-file "$EV/plan/tiny-plan.md" --rubric-file "$EV/plan/tiny-plan.rubric.md" \
  --ticket carbon-smoke --session-id carbon-smoke-g1 --generation 1 \
  --logical-plan-id agy-carbon-smoke-2026-11-11 --manifest-file "$EV/plan/manifest.json" \
  --state-dir "$EV/plan/state" --timeout 20m --allow-unregistered --no-topology-fallbacks
```

| item | value |
|---|---|
| exit | 0 (`runs/plan-review.rc`) |
| author run id | `author-1794335725-1585838` (role `plan-review`, model `gemini-4-carbon-high`, `final_status` `authored`, 18:35:25Z–18:40:25Z) |
| panel manifest | `panel-0354fc9d-g1-1585584` (verdict `CONDITIONAL`) |
| author log | `/home/team/.tmp/dispatch-author-log-vujlg3` |
| artifact | `plan/g1-artifact.json` (byte copy of `runs/plan-review.stdout`) |
| model / family | `gemini-4-carbon-high`, runner `agy`, family `google` |
| verdict | `CONDITIONAL` (`semantic_verdict` `CONDITIONAL`, `policy_reason` `nonblocking_conditional`, `terminal` true, `transport_status` `complete`) |
| finding | rubric `R3`, severity `non-blocking`, `candidate_blocker` false, fingerprint `38c11b3c9beb1546e6233f557b1bc737a76681cc2d6f677fff225dfe32e05a5c` |
| disposition | `plan/g1-dispositions.json` `accepted_nonblocking` on that fingerprint |

Stderr warnings are not failures: `required seat has no fallback: carbon` (the `--no-topology-fallbacks` flag) and `stage-advance: 3 marker write refused` because `AUTOPILOT_PARENT_SESSION_ID` is inherited (no file touched).

## Validators (repo tools, not a reading)

```bash
EV=docs/plans/evidence/2026-11-11-agy-carbon-smoke
node scripts/validate-json-schema.js \
  --schema schemas/plan-review-artifact.schema.json \
  --document "$EV/plan/g1-artifact.json"
node scripts/check-phase-review-receipt.js \
  --plan-artifact "$EV/plan/g1-artifact.json" \
  --dispositions "$EV/plan/g1-dispositions.json" \
  --plan-file "$EV/plan/tiny-plan.md" \
  --rubric-file "$EV/plan/tiny-plan.rubric.md"
```

Re-run in this lane after the artifacts were frozen: schema stdout `{"valid": true, "errors": []}`, `SCHEMA_RC=0`, `RECEIPT_RC=0`.
