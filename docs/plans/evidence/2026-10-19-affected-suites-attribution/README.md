# Affected-suites attribution (2026-10-19)

Base script: `git show 143fdd764:scripts/affected-suites.js` (saved under `mktemp -d`, run with `--root` set to this worktree because the copy does not live in `scripts/`). New script: `scripts/affected-suites.js` on this branch. Selection (`suites`, `alwaysRun`, `chains`) was compared by loading both copies and calling `select()` on the same head tree. Mode was taken from the CLI JSON (`mode`).

## Full rate, last 40 first-parent commits of `develop`

Command shape, for each `C` from `git log --first-parent -40 --format=%H develop`:

```text
node <bin> --root <worktree> --base C^ --head C --json
```

The old copy needs `--root`. The in-repo script was invoked the same way.

| script | commits with `mode: full` | percent |
| --- | ---: | ---: |
| old (`143fdd764`) | 25 / 40 | 62.5% |
| new | 2 / 40 | 5% |

`select()` suites, alwaysRun, and chains were identical on all 40 commits (`chainMismatch: 0`).

Commits that stay `full` after the fix:

- `53dc0ad3f70b` — five evidence scripts still unreferenced (listed below).
- `6fcfed4b19dc` — `unjudgeable change: .github/workflows/test.yml` (unchanged trigger, not attribution).

First three commits (old mode → new mode, suite count from the new `select()`):

- `143fdd7647` selective → selective, 557 suites, unreferenced `[]` → `[]`.
- `53dc0ad3f7` full → full, 574 suites, 6 unreferenced → 5.
- `ede8676383` full → selective, 578 suites, `references/evidence-discipline.md` → `[]`.

## Miss-check recall

`node docs/plans/evidence/2026-10-13-affected-suites/miss-check-wide.js` (default `--n 60`), `AFFECTED_SUITES_BIN` pointed at each copy. Exit code 0 both times.

Old summary:

```text
{"summary":true,"commits":60,"full":41,"selective":19,"mods_live_commits":5,"misses":0}
```

New summary:

```text
{"summary":true,"commits":60,"full":4,"selective":56,"mods_live_commits":5,"misses":0}
```

Misses did not increase (0 → 0).

## Seeds that stop being unreferenced

On those 40 commits the parent-chain attribution marked these changed paths unreferenced; the per-seed walk does not. One line per commit prefix + path:

- `53dc0ad3f7` `skills/quality-pipeline/references/test-integrity-gate.md`
- `ede8676383` `references/evidence-discipline.md`
- `58afd4ecea` `evals/orchestration/analyze-t14-gate.js`
- `58afd4ecea` `evals/orchestration/run-orchestration-eval.sh`
- `58afd4ecea` `evals/orchestration/run-t14-gate-batch.js`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/bad-exit1/CONSTRAINTS.md`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/bad-exit1/cli.py`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/bad-localtime/CONSTRAINTS.md`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/bad-localtime/cli.py`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/fixtures/good/cli.py`
- `58afd4ecea` `evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js`
- `7c4a31a1c1` `references/backlog-entry.md`
- `7c4a31a1c1` `scripts/migrate-backlog-entries.js`
- `7c4a31a1c1` `scripts/next-pick.js`
- `64d26312a7` `scripts/engine-qualify.js`
- `64d26312a7` `scripts/lib/config-keys.json`
- `517fbe910a` `skills/l5/references/hetero-impl-loop.md`
- `abae3d36c0` `scripts/dispatch-hetero.sh`
- `abae3d36c0` `scripts/lib/config-keys.json`
- `abae3d36c0` `scripts/lib/gitconfig-containment.sh`
- `abae3d36c0` `scripts/lib/tmp-residue-registry.json`
- `f5aae62d71` (33 paths, all cleared; commit went selective): `evals/orchestration/tasks/t15-cache-invalidation/judge_rpc.py`, `evals/orchestration/tasks/t16-findings-triage/judge_rpc.py`, `evals/orchestration/tasks/t16-findings-triage/oracle.sh`, `evals/orchestration/tasks/t17-purity-invariant/judge_rpc.py`, `evals/orchestration/tasks/t17-purity-invariant/oracle.sh`, and these `hooks/tests/fixtures/orchestration-oracle-isolation/` files: `forge_result_dedup.py`, `hang_dedup.py`, `hang_service.py`, `hang_validate.py`, `huge_dedup.py`, `huge_service.py`, `huge_validate.py`, `mutate_iadd_dedup.py`, `mutate_imul_dedup.py`, `mutate_input_dedup.py`, `mutate_ior_dedup.py`, `n2_getframe_dedup.py`, `n2_getframe_service.py`, `n2_getframe_validate.py`, `ok_dict_copy_dedup.py`, `ok_eq_dedup.py`, `ok_except_dedup.py`, `ok_hasattr_dedup.py`, `ok_index_count_dedup.py`, `ok_list_copy_dedup.py`, `ok_mapping_dedup.py`, `ok_plus_dedup.py`, `ok_slice_dedup.py`, `outside_dedup.py`, `outside_service.py`, `outside_validate.py`, `patch_send_dedup.py`, `shallow_append_dedup.py`.
- `edd7d687f6` `skills/quality-pipeline/references/test-integrity-gate.md`
- `8930cd859d` `schemas/merge-execution-receipt.schema.json`, `src/merge/cli.js`, `src/status/task-status.js`
- `64259622fd` `scripts/dispatch-hetero.sh`, `scripts/lib/worker-containment.sh`
- `a007fa65e9` `schemas/merge-intent.schema.json`, `src/merge/cli.js`, `src/status/merge-intent.js`, `src/status/task-status.js`
- `16a406dc8f` `scripts/scaffold-mission.js`, `skills/l5/references/hetero-impl-loop.md`, `skills/l6/references/full-dispatch-pipeline.md`
- `36abe7bdd1` `scripts/engine-qualify.js`
- `6c59294335` three `hooks/tests/fixtures/review-increment-real-seat/*.txt` plus `src/engine/product-review-normalizer.js`, `src/engine/review-increment.js`, `src/engine/review-resolution.js`
- `b369366917` `mods/live/register.ts`
- `0be6405da2` `hooks/tests/lib/task-status-input-fixture.js`
- `b79bca63fe` `hooks/lib/brief-head.js`, `skills/l5/references/hetero-impl-loop.md`
- `a8dac5e62b` `evals/orchestration/tasks/t7-config-rename/repo/tests/tool.test.js`
- `fe80a11acc` `references/evidence-discipline.md`, `scripts/check-plan-graduation.js`
- `6fcfed4b19` `hooks/tests/check-l1-cache-key-parity.test.sh`, `scripts/sync-all.sh`, `scripts/sync-manifest.json` (commit stays full because of `.github/workflows/test.yml`)
- `6ed65d183f` `scripts/lib/config-keys.json`
- `48a66b5b4b` `scripts/lib/opencode-containment.js`, `scripts/lib/opencode-discovery-probe.js`, `scripts/tmp-residue-allowlist.json`
- `1456a23281` `mods/live/register.ts`, `mods/live/scroll.test.ts`, `mods/live/scroll.tsx`, `mods/live/scrollmath.ts`, `mods/viewer/assist.test.ts`, `mods/viewer/register.ts`
- `62d54529c5` `mods/live/scrollmath.ts`

`f5aae62d71` old unreferenced count was 33 and the new count was 0. The names are the `judge_rpc.py` / `oracle.sh` files for t15, t16, and t17 plus every `hooks/tests/fixtures/orchestration-oracle-isolation/*.py` in that commit (`forge_result_dedup.py`, `hang_*`, `huge_*`, `mutate_*`, `n2_getframe_*`, `ok_*`, `outside_*`, `patch_send_dedup.py`, `shallow_append_dedup.py`).

## Seeds that remain unreferenced

Only on `53dc0ad3f70b`:

- `docs/plans/evidence/2026-10-19-test-integrity-replay-v2/carryover.js`
- `docs/plans/evidence/2026-10-19-test-integrity-replay-v2/filter-replay.js`
- `docs/plans/evidence/2026-10-19-test-integrity-replay-v2/merge-set.js`
- `docs/plans/evidence/2026-10-19-test-integrity-replay-v2/sample-v2.js`
- `docs/plans/evidence/2026-10-19-test-integrity-replay-v2/stats.js`

No other changed path in the 40 commits stayed in `unreferenced`.
