Engine: sonnet

# Landing foreman — autopilot backlog bundles wave-1b (10 BACKLOG rows, 11 hand commits)

You are the landing foreman. Depth-0 accepted every row below after checking each one in git. Your job: integrate
the rows onto the latest `origin/develop` in a fresh clone, run the gates, run one final review, cut the release,
and push. Record everything in `RUN/REPORT.md`, where `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/w1b/run-land`.
Do not work in `/home/cookys/projects/autopilot`, the main checkout. Keep to ~40 tool calls in total, and combine read-only commands.

## 0. Setup
`W=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/w1b`
`git clone -q /home/cookys/projects/autopilot $W/land && cd $W/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/w1b origin/develop && git config core.hooksPath .githooks`
Add each unit clone as a remote and fetch its hands branches: `for u in rlr hlsm dlrm mrce; do git remote add $u $W/$u; git fetch -q $u 'refs/heads/hands/*:refs/remotes/'$u'/hands/*'; done`

## 1. Cherry-pick in exactly this order (hand commits ONLY)
Never pick any commit whose subject starts with `PARALLEL-RUN LOCAL ONLY`. That commit is a clone-local governance
shadow and must never land. After each pick, check that `.claude/owner-kernel-governance.json` still reads `"enforcement_mode": "enforce"`.
1. mrce 15: `b1c1465c9a8d907b8b13f03f85c0db699f28338e`
2. hlsm 139: `8064fdacf00b321ec054c59980a7636ad6e63f5a`; hlsm 140: `c4210072d6f060309e05ea3ab23e866fbfaafc6b`
3. dlrm 93: `14ef37173ef6e2874529f56b7a2f30d493e51c90`; dlrm 109: `78ff7fca` THEN its repair `a5b5fcafb0561c36d804e5ca1a4d1f77708232ee`
   (the repair deletes a stray file literally named `-` that the first commit added; after both, `git ls-files -- ./-` must be empty);
   dlrm 122: `13b5d9eaab4cedd81d087172256bebb560bc8213`; dlrm 123: `959525a219e5f3bb02aab5d2025a0a069734c646`
4. rlr 131: `a5ff00469280f5e360b045db628f2c42db1b8193`; rlr 136: `91ca8706801c27b1c9c6e54b150ae28dbc838a53`; rlr 137: `39c2a9828751cfef727c35b9eca721be24ebcbad`
Reword each picked commit to a real message, e.g. `fix(<area>): <row title> (backlog w1b row <n>)`, using the
per-unit REPORT.md at `$W/run-<unit>/REPORT.md` for content. You may squash 109 and its repair into one commit.
If a pick conflicts, stop and report the files involved; do not resolve product conflicts yourself.

## 2. Gates (run each one in the foreground, one at a time; prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`; suffix `< /dev/null`)
- `test -x` each file, then run: `hooks/tests/{review-loop-resolver-b,hooks-live-state-misc,dispatch-lifecycle-residue-mission,managed-rail-core-engine}.test.sh`
- Consumers: `hooks/tests/{hetero-review-loop,check-phase-review-receipt,dispatch-plan-review}.test.sh`, and every suite
  that `grep -l` finds for `runCampaignIntake`, `prune_tmp_residue`, `admit-backlog-follow-ups`, `dispatch-contract`, `withdrawPreparedMission`, or `depth0-delegate-gate`.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.
- A red: rerun it solo once. If it is still red, run the same suite at `origin/develop` in a throwaway worktree. Red there too
  means pre-existing; record it and move on (the mrce foreman already reported `implementation-campaign-routing.test.sh`
  / `defaultCleanroomProbe` as red at base — confirm). Red only on your branch means stop and report.

## 3. Final review (combined product diff, one call)
`git diff origin/develop..HEAD > RUN/w1b.diff`; then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/w1b.diff --spec-file $W/brief-land.md > RUN/w1b.review.json`
(If you get tool-call-shaped text or no verdict, retry once with a spec file that also contains "You have no tools. Answer only with the verdict JSON.")
Run it in the background and start a `sleep 1500; echo WAKE-land` dead-man in the same turn, then end your turn.
SHIP-AS-IS is required to continue. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, stop and report them; do not repair anything yourself.

## 4. Release (only after the gates are green and the review says SHIP-AS-IS)
- Version: read `git show origin/develop:.claude-plugin/plugin.json` right now; the next PATCH is that value + 1 (it was 2.36.94 at brief time,
  so expect 2.36.95). `node scripts/sync-version.js --version <V>` (let it keep the counts; this adds no hook or skill).
- `docs/BACKLOG.md`: delete the 10 rows (titles begin with): "Plan-loop freeze: dispatcher and checker", "`hetero-review-loop --exclude` allowlist",
  "agy seat payload overflow is discovered", "Managed rail: a non-git `--repo` still consumes", "depth0-delegate-gate `Bash` matcher",
  "live-state-dir / context-budget test strength", "`prune_tmp_residue` covers", "Recover stale backlog admission locks",
  "Verification-author seats on agy", "No supported withdraw for a never-granted DRAFT". Delete their `docs/backlog/*.md` sidecars
  if no other row points at them. Gate: `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md`.
- `CHANGELOG.md`: a new top section for V, one line per row, written for users (the problem, then what changed).
- `docs/projects/INDEX.md`: one row for V (copy the shape of the v2.36.81 wave-1 row).
- Bundle plans: for each of `docs/plans/2026-09-21-backlog-{review-loop-resolver-b,hooks-live-state-misc,dispatch-lifecycle-residue-mission,managed-rail-core-engine}.md`,
  check whether ANY row it lists is still in BACKLOG. If none is, the plan has shipped: run `node scripts/check-plan-graduation.js --repo-root . --fix`
  (or follow its instructions) so the plan is archived and its INDEX `active` row resolved. Leave `review-loop-resolver-a` (wave 2) alone.
- `bash scripts/preflight-release.sh` must pass.
- Commit. The final paragraph of the release commit message carries BOTH trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <review id from w1b.review.json> plus depth-0 row acceptance, 2026-09-24)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop` (if develop moved and the version collides, take the next free number and re-stamp
  the CHANGELOG heading, the INDEX row, and sync-version), then `git push origin HEAD:develop`. Confirm with `git ls-remote origin develop` == your HEAD.
  Do not use `--force`. If the pre-push hook refuses, report its output verbatim and stop.

## 5. Report
`RUN/REPORT.md`: the picked SHAs mapped to the landed SHAs, the gate tails, any pre-existing reds, the review verdict and id, V, the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and one line per anything NOT done.
