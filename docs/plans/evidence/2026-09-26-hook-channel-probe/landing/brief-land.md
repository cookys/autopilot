Engine: sonnet

# Landing foreman — hook advisories reach the model (plan `2026-09-26-hook-advisories-reach-model`)

`H=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/ha`, `RUN=$H/run-land` (create it). Depth-0 accepted every row and independently re-derived the foreman's refutations.
Do NOT work in `/home/cookys/projects/autopilot`, the main checkout. For every command that may exceed 2 minutes, pass an explicit Bash timeout (600000, or 1500000 for reviews) and keep it in the FOREGROUND.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $H/land && cd $H/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/ha origin/develop && git config core.hooksPath .githooks && git remote add unit $H/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

Cherry-pick in this order:
- `7f2919bb` (p1a), `ae262ac9` (p1b);
- `d746f35d` (p2), then `d7599e94` (the p2 catalog re-pin), squashed into p2;
- `2ec5009a` (p3).

NEVER pick `0a57d55e` (PARALLEL-RUN LOCAL ONLY). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must show `enforce`.
Reword the commits to `fix(hooks): <row summary> (plan hook-advisories-reach-model <row>)`, using `$H/run/REPORT.md`. Use `exec git commit --amend -F <file>` keyed to each SHA, never sed with `/`.
Then verify each message against its diffstat. Keep each hand commit's list of re-expected assertions in the reworded message. If a pick conflicts, stop and report.

## 2. Hook count (a depth-0-authorized landing step, per plan §2.5)
The new default-on hook `hooks/advisory-relay.js` raises the default-on hook count by 1. Run `node scripts/sync-version.js --help` to see the flags. In the release step (§4), pass the new
total hook count and the default-on count so that `check-hook-inventory` agrees, and let opt-in/disabled be preserved. Derive the numbers from `hooks/hooks.json` and `hooks/opt-in-manifest.json`; do not guess them.

## 3. Gates. Many default-on hooks changed, so run the WHOLE suite.
- `bash hooks/tests/run.sh --parallel 8 > RUN/full.log 2>&1; echo rc=$?`. Read the summary and every `FAIL [` line, including the serial tail.
- Rerun each red solo. Anything still red gets run at `origin/develop` in a throwaway worktree. Red there too means pre-existing: record it. Known ones are `engine-qualify-verdict-stability` D6 and `migrate-backlog-entries`;
  the foreman also reported `hooks-live-state-misc` (missing MINIMAX_API_KEY), which must be confirmed at base. Red only on your branch: bisect, STOP, and report. Never repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`, `node scripts/doc-drift-gate.js .` (no new FAIL beyond the 3 known baseline ones).
  After the §4 version and hook-count sync, also run `node scripts/check-hook-inventory.js` and `bash hooks/tests/check-hook-inventory.test.sh`.

## 4. Final review, then release
Run `git diff origin/develop..HEAD > RUN/ha.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/ha.diff --spec-file $H/land/docs/plans/2026-09-26-hook-advisories-reach-model.md > RUN/ha.review.json`.
If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
- SHIP-AS-IS: continue.
- FIX-THEN-SHIP with 🔴/🟠: STOP and report the findings verbatim with your own evidence for or against each. Do not refute or repair them yourself; depth-0 rules.

Release:
- Version = `origin/develop` plugin.json + 1 PATCH (expect 2.36.98), with the hook counts from §2.
- `CHANGELOG.md`: a new top section for V written for users. Cover:
  - which default-on nudges were previously silent and now reach the model (cost-fuse, context-budget T1, depth0-delegate-gate, reload-watch, dispatch-model-guard warn);
  - the opt-in ones;
  - the new default-on `advisory-relay` (Stop advisories arrive on your next prompt; opt-out `AUTOPILOT_ADVISORY_RELAY=off`);
  - that the multiplexer now merges advisories and never forwards allow;
  - that advisory wording is unchanged;
  - the probe evidence dirs;
  - the review's 🔵 items as known follow-ups;
  - the plan's FULL slug `2026-09-26-hook-advisories-reach-model` inside the section.
- Run `node scripts/check-plan-graduation.js --repo-root . --fix`, then `--json` must report exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. The final paragraph holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <review run id> plus depth-0 row acceptance, 2026-09-26)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next number and re-stamp. Then `git push origin HEAD:develop` (no pipe, no --force; retry once on a 5xx). Confirm with `git ls-remote origin develop`.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary, the review verdict and id, V, the hook counts, and the pushed SHA. Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
