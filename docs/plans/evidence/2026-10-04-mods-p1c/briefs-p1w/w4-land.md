# P1W hand — W4 LAND: one landing branch for v2.37.0 (no release yet)

Read `w-common.md`, `int.md`, the plan §4 P1d + P1W (W4 row) + Review log R5–R5.9, and `accepted-heads-p1w.txt` (every accepted head, every follow-up). This brief overrides them where they differ.

## Goal
A landing branch `land/v2.37.0` in a FRESH clone, ready for depth-0's one combined review and the owner's real-machine gate. No version bump, no CHANGELOG/INDEX, no push — the release commit comes after the gate.

## Build
1. `git clone /home/cookys/projects/autopilot $P/land` (read-only use of the main checkout as a remote; never write to it). Record the local develop head you cloned (`D`). `git fetch $P/clone 'refs/heads/w/*:refs/remotes/w/*' 'refs/heads/p1c/*:refs/remotes/p1c/*'`. Copy the author identity from `$P/wt-w1a`.
2. `git checkout -b land/v2.37.0 D`. Bring the integration chain over: every commit of `<base>..w/int5` where `<base>` = `git merge-base w/int w/int5`'s ancestor that is on D's history (expected `8fbc89b0`; verify with `git merge-base --is-ancestor`). Use `git cherry-pick -x <base>..w/int5` (or `rebase --onto D <base>` on a temp branch, then fast-forward land). D adds only docs commits under `docs/plans/` since `<base>` — any conflict outside `docs/plans/` → STOP.
3. `p1c/d1` (`14e44b46`, P1d D1): cherry-pick, then reconcile `hooks/hooks.json`. First find out WHY D1 removes `"//"` comment keys (read its diff, tests and `references/mods.md`/plan P1d; state the reason with evidence in the report). Apply the same rule to every `"//"` key added since (W1c, W1de, PERF, HOOKQ…): move any text not already in `hooks/README.md` there, then remove the key. Add the top-level `"modules": ["../mods/live/register.ts"]` per plan P1d order (inventory understands `modules` → codex baseline ignores it → opencode sync excludes `mods/` → add the key). Acceptance from P1d: `scripts/sync-all.sh` green; `grep -r mods platforms/codex/plugin platforms/opencode/plugin` empty; negative control: `modules` pointing to a missing file → `claude plugin validate` fails (run on a scratch copy).
4. Eval evidence from `w/eval`: cherry-pick `472a5c07`, `37880c71`, `5b311731`, `bface9ed`, `78304050`, `15709901` (harness fixes, packs, prereg amendments 1–4, results). NEVER the skill-text commits `f6379a10`, `8e3d9511`, `ee055a2e` (R5.8: not shipped). If any of the six needs one of those three to apply, STOP and report which hunk.
5. Fix-ups allowed in ONE extra commit `chore(land): reconcile counts, mirrors and catalog for the v2.37.0 landing (mods P1W W4)`: hook/skill counts at version 2.36.116 (no bump), codex/opencode mirrors, profile catalog hashes (`build-profile-payload.js catalog --check` exit 0, read directly), README parity. Nothing else.

## Verify (record every command + summary line)
- `bash scripts/validate.sh`, `node scripts/check-js-syntax.js`, `node scripts/check-hook-inventory.js --check`, `node scripts/check-claude-md-inventory.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `node scripts/check-plan-graduation.js` (report only), `bash scripts/sync-all.sh` (in check mode if it has one — read its header first).
- L1 + `hooks/tests/run.sh` once (parallel allowed; long hetero suites re-run solo if red; every red solo, then on a clean clone at D). Accepted pre-existing reds: import-aa (22), qualification-feed-adopt, qualification-scorecard-tools; review-server is a known load flake (must pass solo).
- Mod: `claude plugin validate` on `$P/land`; `claude plugin test` on a throwaway wrapper (as W3a/INT3 did); tsc; negative grep over `mods/`.
- Isolation: real `/run/user/1000/autopilot/runs` unchanged; no test watcher survives; temp-dir counts not larger after the run.

## Report
`$P/run-w/land/REPORT.md`: D, the land head, `git log --oneline D..land`, conflicts and resolutions, the D1 comment-key reason with evidence, every check, `git diff --stat D..land | tail -1`, and the exact path list for depth-0's combined review (all changed paths EXCEPT `evals/skill-onoff/packs/**`, `evals/skill-onoff/results/**`, `evals/skill-onoff/tasks/**/repo/**`, `docs/plans/**`, `platforms/codex/plugin/**`, `platforms/opencode/plugin/**`) with its diff size in bytes. Final message: report path, land head SHA, 5-line summary.
