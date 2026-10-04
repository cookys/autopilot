# P1W hand — INT: integration branch of the accepted wave-1 rows

Read `w-common.md` first (paths, isolation, suite discipline, commit rules). This brief overrides it where they differ.

## Goal
One branch `w/int` in the clone, worktree `$P/wt-int`, based on `refs/remotes/main/develop` (local develop, docs-only commits ahead of origin), carrying exactly the 10 accepted P1W commits in this order, conflicts resolved, full suite run once.

Setup (you do it): `cd $P/clone && git fetch -q /home/cookys/projects/autopilot develop:refs/remotes/main/develop && git worktree add -b w/int $P/wt-int refs/remotes/main/develop`, then copy the author identity from `$P/wt-w1a` (`git -C $P/wt-w1a config user.name/user.email`) into the new worktree config.

## Cherry-pick list (exact, in order; use `git cherry-pick -x`)
1. `6e40bcc4` (p1c/r, C3b-R)
2. `5118dcfd` (W1a; the single commit of `p1c/r..w/w1a`)
3. `c6af5401` (W1i; the single commit of `p1c/r..w/w1i`)
4. `fcdfa106` (W1c)
5. `7713fbed` (W1de)
6. `250b2576` (W1b)
7. `1b5a3af4` (W1f)
8. `9a98e993` (W1h)
9. `4cc9933f` (W2f)
10. `ebb70af3` (EVALX)

NOT included: `p1c/c` and `p1c/d1` (they join at W4; W3a will rebase onto `w/int`). Do not add any other commit. End state: `git rev-list --count refs/remotes/main/develop..HEAD` = 10 plus at most ONE extra commit `chore(int): reconcile counts and mirrors after P1W integration (mods P1W INT)` holding only derived-file fixes (counts, mirrors, catalog hashes) that no single cherry-pick could carry. Each cherry-pick keeps its original message (plus the `-x` line); conflict resolution goes into that cherry-pick's commit.

## Authorized conflict sites and how to resolve them
- Version/count mirrors (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.json`, `README.md`, `README.zh-TW.md`, `CLAUDE.md` counts line): W1c and W1de each add hooks. Recompute with `node scripts/sync-version.js --version 2.36.116 --hook-count <N> --skill-count <M>` — SAME version 2.36.116, counts only (no bump). Derive N from hooks/hooks.json the way `scripts/check-hook-inventory.js` does; read its header.
- `hooks/hooks.json`, `profiles/hook-classes.json`, `profiles/profile-catalog.json` (+ codex mirrors, `platforms/codex/plugin/profiles/baselines/claude-hooks.json`): union of both rows' additions; recompute catalog hashes with the repo's own tooling (find it via `docs/scripts-inventory.md`; the `profiles-hash-repin` procedure if the catalog chain needs it). Then `node scripts/check-hook-inventory.js --check`.
- `hooks/README.md`, `CLAUDE.md` inventory, `docs/scripts-inventory.md`: union of rows (W1b, W1c, W1de, W1f, W2f).
- `src/status/runs-watch.js` (+ codex mirror): W1a then W1c. Resolve ONLY if one side is a pure addition that does not change the other side's lines; otherwise STOP and report both hunks verbatim.
- `scripts/render-review-page.js`, `hooks/tests/render-review-page.test.sh` (+ mirror): C3b-R → W1a → W1i, same superset rule.
- `src/engine/autopilot-engine.js` (+ codex mirror): W1b and W1h, same superset rule.
- Codex mirror: after resolving, `rm -f scripts/dispatch-contract.pre.js` (contract-pin test residue), `bash scripts/sync-codex-plugin-skills.sh` then `--check`.

Any conflict outside these sites, or any semantic decision (choosing one row's behaviour over another's): STOP, `git cherry-pick --abort` is NOT needed — leave the state, write the report with both hunks, and return.

## Per-row fidelity check (mandatory, record in the report)
For each row i with original head H_i and original base B_i (B for 1 = `6e40bcc4~1`, for 2 and 3 = `6e40bcc4`, otherwise `git merge-base H_i refs/remotes/main/develop`):
`git diff H_i HEAD -- $(git diff --name-only B_i..H_i)` at the END state must differ only in (a) files listed in the conflict sites above, or (b) hunks that are another row's lines. Print a summary table: row, files, files-with-differences, and for every difference one line saying which other row it belongs to. A difference you cannot attribute = report it, do not fix.

## Verify (foreground, Bash timeout 600000, one long suite at a time)
- `node scripts/check-js-syntax.js`; `node scripts/check-hook-inventory.js --check`; `node scripts/check-claude-md-inventory.js`; `bash scripts/sync-codex-plugin-skills.sh --check`; `bash scripts/validate.sh` if it exists and is the repo's full gate (read its header).
- L1: `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js < /dev/null` — read the final summary lines only for the verdict (nested fixtures print FAIL lines in green runs).
- L2: every `hooks/tests/*.test.sh` once (find the repo runner — `hooks/tests/run-all*` or the one CI uses in `.github/workflows/`; use it). Long suites (`dispatch-hetero*`, `resolve-review-loop`, `hetero-review-loop*`) strictly sequential.
- For every red: re-run that suite alone; if still red, run the SAME suite on a clean worktree of `refs/remotes/main/develop` (`git worktree add $P/wt-int-base refs/remotes/main/develop`, remove it afterwards) and record both results. Accepted pre-existing reds: `scripts/import-aa-capabilities.test.js` (22), `hooks/tests/qualification-feed-adopt.test.sh`, `hooks/tests/qualification-scorecard-tools.test.sh`.
- Do NOT start any eval run (`evals/`), do not run anything that calls a model.

## Report
`$P/run-w/int/REPORT.md`: the final `git log --oneline refs/remotes/main/develop..HEAD`, each conflict and its resolution (file, hunk summary, rule applied), the fidelity table, every check with command + summary line, every red with solo + base results, the hook/skill counts used. Final message: report path, head SHA, 5-line summary.
