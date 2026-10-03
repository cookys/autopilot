Engine: sonnet

# Landing foreman — mods plan P1a (5 rows, 9 commits to pick) → v2.36.115

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a`, `RUN=$B/run-land` (create it). Depth-0 accepted every row from git evidence and per-row reviews
(`$B/run/accepted-heads.txt`, `$B/run/*.review.json`). Do NOT work in `/home/cookys/projects/autopilot` (the main checkout).
Run every long command in the FOREGROUND (Bash timeout 600000) so you don't park. Prefix every suite, rail and review
command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.
zsh is the Bash tool's shell: use `bash -c` for bash semantics; `ls` may hang (use find/wc); pgrep/pkill -f match
themselves (use PIDs). The tool guard blocks destructive-looking words even in heredocs — write scripts to files.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/v2.36.115 origin/develop && git config core.hooksPath .githooks && git config user.name cookys && git config user.email 2537196+cookys@users.noreply.github.com && git remote add unit $B/clone && git fetch -q unit 'refs/heads/p1a/*:refs/remotes/unit/p1a/*'`
(hooksPath MUST be set in that same line, before any pick.) Author identity: name `cookys`, email the GitHub noreply
address above — never gmail, never a test identity, never `--no-verify`.

Cherry-pick in this order (keep the existing commit messages; no reword):
`c5da805a` (docs: plan records D3 — from the main checkout's local develop, reachable in this clone),
`b6199c18` (R1), `ce5398b1` (R2), `e0ea329a` `c51f901f` (R3 + repair), `cab0e6ed` `7caa7e17` `95634d0c` (R4a, R4b, repair),
`367affdd` (R5). There is no shadow commit in this bundle. After every pick, `grep enforcement_mode
.claude/owner-kernel-governance.json` must still show `enforce`. If a pick conflicts, STOP and report the files.

## 2. Gates
- BEFORE the suite: snapshot the real stores — `find ~/.autopilot /run/user/1000/autopilot -type f -printf '%p %T@\n' 2>/dev/null | sort > $RUN/store-before.txt`.
  Check no other full suite is running on this host (look for a running `hooks/tests/run.sh` by PID listing, pattern spelled
  via variables; if one runs, wait for it — oracle lock).
- Full suite ONCE, DETACHED (foreground Bash is capped at 10 min; the suite takes ≈20 min): write `$RUN/full.sh` containing
  `cd $B/land && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash hooks/tests/run.sh --parallel 16 < /dev/null; echo "SUITE-RC=$?"`,
  start it with `setsid nohup bash $RUN/full.sh > $RUN/full.log 2>&1 &`, then wait in foreground calls of ≤ 9 min each:
  `i=0; until grep -q 'SUITE-RC=' $RUN/full.log || [ $i -ge 520 ]; do sleep 20; i=$((i+20)); done; tail -5 $RUN/full.log` — re-issue until SUITE-RC appears.
  Judge red ONLY from the Summary section at the end (nested fixture `FAIL [` lines appear in green runs too); the parallel
  section's ALL PASSED line does not cover the serial tail.
- The new process-starting suites (`runs-watch`, `runs-watch-lock`, `session-mode-watcher`) use 15 s envelope timeouts and may
  flake under --parallel 16 at load 40: rerun them solo before calling them red. A leftover `status runs --watch` process whose
  cmdline points at a /dev/shm fixture is suite noise: kill it by PID and record it, not a red.
- Rerun reds solo. A red "L1 unit suite" line = rerun the whole L1 layer
  (`node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js`). Still red → run it at origin/develop in a
  throwaway worktree (`git worktree add $RUN/base origin/develop`). Red at base = pre-existing, record it (expected:
  `qualification-scorecard-tools` r51/r52 seat_hash — hands saw it red at base). Red only on the branch → `git bisect
  run` and STOP with the first-bad commit and failing assertions. Never repair anything yourself.
- After the suite (and solo reruns): `find ~/.autopilot /run/user/1000/autopilot -type f -printf '%p %T@\n' 2>/dev/null | sort > $RUN/store-after.txt`
  and `diff $RUN/store-before.txt $RUN/store-after.txt > $RUN/store.diff`. Live sessions on this host legitimately touch some
  files (e.g. context/, depth0-gate/, costs, session-mode markers of real sessions) — classify every changed/new path as
  real-session activity or test-created (fixture-looking names, temp-dir keys, null-admission-test-*, live-pointer.json,
  runs/<key>.json, runs/paths/*, runs-enrich-cursor.json). Report test-created paths verbatim as a finding; do NOT clean them
  up yourself. Also confirm no `status runs --watch` process is left (pattern via variables).
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`,
  `node scripts/check-claude-md-inventory.js`.

## 3. Combined review (ONE, over the whole range)
`git diff origin/develop..HEAD > $RUN/p1a.diff` (do NOT exclude platforms/codex mirrors), then
`bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 25m --diff-file $RUN/p1a.diff --spec-file $B/run/combined.spec > $RUN/p1a.review.json`
DETACHED the same way as the suite (write `$RUN/review.sh`, start with setsid nohup, then wait in ≤ 9-min foreground loops
until `$RUN/p1a.review.json` is non-empty and the script printed its exit line). No verdict → read the envelope's raw_log first; retry once with a spec copy that
appends "You have no tools. Answer only with the verdict JSON." SHIP-AS-IS required. FIX-THEN-SHIP with any 🔴/🟠 →
STOP and report them verbatim; do not self-adjudicate.

## 4. Release (only with green gates and SHIP-AS-IS)
- Confirm `git show origin/develop:.claude-plugin/plugin.json` is still 2.36.114 → V = 2.36.115 (else next free PATCH).
  `node scripts/sync-version.js --version <V>` (hook/skill counts unchanged — omit them).
- BACKLOG: this bundle resolves no existing row; do not delete any. (Depth-0's closeout adds follow-up rows.)
- `CHANGELOG.md`: new top section for V in the file's existing style: what an operator gains — `autopilot status runs`
  reports elapsed/rc/scope/freshness with bounded-rotation probing; dispatch manifests carry `repo_identity`; a per-project
  watcher (`autopilot status runs --watch --project <key>`, started by `session-mode.js set`, switch
  `AUTOPILOT_RUNS_WATCH_AUTOSTART`) publishes scoped `autopilot.runs-live/1` snapshots to the tmpfs live dir under a single
  flock writer; the live pointer and `references/mods.md` prepare the first mod (P1c). Then a "Known follow-ups" list from
  `$B/run/followups.md` plus any 🔵 from the combined review.
- `docs/projects/INDEX.md`: one row for V in the existing format (merge column: the release SHA after commit, or `—`).
  The mods plan stays `active` (P1b–P4 remain) — do NOT run graduation --fix.
- `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0; `node scripts/check-plan-graduation.js
  --repo-root . --json` exit 0; `bash scripts/preflight-release.sh` pass.
- Commit `release(v2.36.115): status runs and a per-project watcher publish scoped live snapshots (mods P1a)`. The final
  paragraph holds both trailers, no blank line between:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <real review run id from $RUN/p1a.review.json> plus depth-0 row acceptance, 2026-10-04)`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop` (version collision → take the next free number and re-stamp CHANGELOG,
  INDEX, sync-version, branch name). Then `git push origin HEAD:develop` (no pipe, no --force; retry once on GitHub 5xx).
  Confirm `git ls-remote origin develop` equals HEAD.

## 5. Report
`$RUN/REPORT.md`: picked → landed SHAs, gate summary (total, red, pre-existing, real-store proof), review verdict and
id, V, pushed SHA. Final message: REPORT path, V, pushed SHA, anything NOT done.
