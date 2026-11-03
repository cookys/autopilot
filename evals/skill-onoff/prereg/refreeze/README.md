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
2. With the patch all eight runners fail closed and none of them goes through the account layer yet. Each one needs its own HOME and CLAUDE_CONFIG_DIR (the five skill-onoff shells keep the OFF arm free of the operator's plugins, `run-d0gate-campaign.js` reads its cell config dir, and `run-p2-batch.js` gives every id a per-run HOME), and the account layer replaces both with the alias dirs. So: a usable registry makes them exit 2 and spawn nothing, a broken registry exits 2 before any claude is started, and a missing `scripts/lib/eval-account.sh` or `eval-account.js` exits 2 before any spawn and before any credentials copy (the same rule as the live runners). Only when there is no registry do they keep the old credentials-copy path. They stay refused with a registry until an account-backed cell design exists (the same stance as `run-d0gate-v2-campaign.js`).
3. Re-freeze: stamp the affected rows again (`evals/skill-onoff/stamp-prereg.js`), update the `FROZEN.json` digests, regenerate the p2 manifests so `hashes.wrapper` matches the new `run-p2-batch.js`, and move `tools/migrate/no-rewrite.json` to the new sha256 values. A formal run needs a new pre-registration; do not edit a digest to make a red check green.
4. In the same commit, update the eight entries of `scripts/lib/claude-spawn-sites.json`: they are no longer plain `frozen_legacy` (they refuse with a registry), so give them a `covered_by` suite that proves the refusal (`scripts/eval-account-rails.test.js`) and keep the lock check green.

## State of the patch

Checked with `git apply --check` against the tree it was committed in: it applies cleanly (all eight files, one version of the p2 hunks). If it stops applying later, regenerate the hunks by hand from the pattern: an `eval_account_probe` check (exit 2 when the helper is missing, when it fails, or when it reports an active registry) in the shell runners, and `require('../../scripts/lib/eval-account.js').gate()` at the start of the Node runners (exit 2 on `broken`, on `active`, and on MODULE_NOT_FOUND). `scripts/eval-account-rails.test.js` (case D) runs `git apply --check` on the patch.
