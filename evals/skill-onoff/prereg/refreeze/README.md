# G37 account wiring for the digest-frozen runners

`g37-account-wiring.patch` wires eight replay-only runners to the account layer (`scripts/lib/eval-account.js` and `eval-account.sh`). It is NOT applied in the tree, on purpose: the bytes of these runners are pinned, and wiring them would void the pre-registrations and manifests that pin them.

| Runner | What pins it |
|--------|--------------|
| `evals/skill-onoff/run-skill-onoff-eval.sh`, `run-skill-onoff-eval-bpack.sh`, `run-skill-onoff-eval-fbatch.sh`, `run-skill-onoff-eval-fbatch-v2.sh`, `run-skill-onoff-eval-gdorm.sh` | `evals/skill-onoff/prereg/FROZEN.json` |
| `evals/skill-onoff/run-d0gate-campaign.js` | `evals/skill-onoff/prereg/FROZEN.json` (the d0gate row) |
| `evals/orchestration/run-p2-batch.js` | the `hashes.wrapper` value in each batch manifest, compared by `hooks/tests/p2-batch-loop.test.sh` cases 4.5 and 5.5 |
| `evals/orchestration/run-p2-batch-loop.js` | the launcher of the pinned wrapper above; frozen with it |

## What they do today

They keep using the operator's logged-in credentials (a copy of `~/.claude/.credentials.json` in a scratch config dir) and never go through the account layer, even when an account registry exists. `scripts/lib/claude-spawn-sites.json` lists each as `frozen_legacy` and `scripts/check-claude-spawn-sites.js` keeps checking that the lock still names them. Plan: `project/plans/2026-11-03-g37-account-switching.md` section 15.

Use them only to replay or audit an existing campaign. Do not start a new campaign through them on a host that has an account registry.

## Before a NEW campaign through these runners

1. From the repo root: `git apply --check evals/skill-onoff/prereg/refreeze/g37-account-wiring.patch`, then `git apply` it.
2. With the patch a usable registry makes the runners use the alias token (no credentials copy), a broken registry stops them before any claude is started, and `run-d0gate-campaign.js` refuses to run with a registry (its cells need their own HOME and CLAUDE_CONFIG_DIR, which the account layer replaces).
3. Re-freeze: stamp the affected rows again (`evals/skill-onoff/stamp-prereg.js`), update the `FROZEN.json` digests, regenerate the p2 manifests so `hashes.wrapper` matches the new `run-p2-batch.js`, and move `tools/migrate/no-rewrite.json` to the new sha256 values. A formal run needs a new pre-registration; do not edit a digest to make a red check green.
4. Move the five/eight entries of `scripts/lib/claude-spawn-sites.json` from `frozen_legacy` to `wired` with `covered_by` suites in the same commit.

## State of the patch

Checked with `git apply --check` against the tree it was committed in: it applies cleanly (all eight files, one version of the p2 hunks). If it stops applying later, regenerate the hunks by hand from the pattern: a `eval_account_probe` plus PATH wrapper in the shell runners, `evalAccount.gate()` at the start of the Node runners, and `accountArgv()` in `run-p2-batch.js`.
