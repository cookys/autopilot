# Triage BL-0432 group C

Suites: `dispatch-detach`, `dispatch-gitconfig-containment`, `dispatch-hetero`.
Base tip for bisect bad end: `HEAD~1` (`77c3497ad`, parent of local-only shim). Local shim did not cause these reds (same failures at `HEAD~1`).

Candidate good merge `9a0d2e409` (2026-11-08 ≤20:00 +0800) was **also red** on this host for detach/gitconfig (environment-sensitive fixtures). Bisect good end for detach was pushed back to `9dbe88a7b` (green, 74 assertions); first bad confirmed at `2f9e21d6b`.

## Table

| suite | failing tests | first bad commit (short sha + subject) | cause | wrong side | fix commit or "needs decision" | green after fix |
|---|---|---|---|---|---|---|
| hooks/tests/dispatch-detach.test.sh | same-tuple without setsid: inline runner never started; no-setsid duplicate fails at precondition rail; no-setsid duplicate is fenced by the parent-owned tuple lease; no-setsid same tuple dispatches inline runner exactly once; no-setsid inline path reaps its sole worktree after completion; no-setsid fenced tuple creates no second branch | `2f9e21d6b` fix(dispatch-hetero): enforce --timeout on every rail with a central run_worker watchdog (explicit bounds only) | Product plain path began launching via bare `setsid env ...` when `HAVE_SETSID=0` but `setsid` exists. The h2 fixture was a no-op `setsid` (print + exit 0), so the worker never started. On hosts with working user cgroup the cgroup branch hid the bug. | test | uncommitted (harness commits): wrap real `setsid`, omit `--wait` from `--help` (sibling: dispatch-runner-session-id-scrub) | yes (EXIT 0, 74 assertions) |
| hooks/tests/dispatch-gitconfig-containment.test.sh | lib_restore_failed_warning; lib_restore_failed_names_key | `6f82f6021` dispatch-hetero(grok): edits on hands/bl0074/2 (introduces `>/tmp/gc-restore-out.txt`) | Restore-failure case redirects stdout to a world-shared `/tmp/gc-restore-out.txt`. When that path is owned by another uid, bash refuses the redirect (`Permission denied`), the restore body never runs, and `$FAIL_ERR` is never created — so the WARNING assertions fail. | test | uncommitted: redirect to `$TEST_TMP/gc-restore-out.txt` | yes (EXIT 0, 32 assertions) |
| hooks/tests/dispatch-hetero.test.sh | missing setsid support falls back to inline dispatch; setsid-unavailable fallback still returns committed outcome; **plus** (embedded) mission-routing-campaign-bridge oracle `no_session_id_aborted_l5_no_routing_still_blocks` | setsid cases: `2f9e21d6b` (same as detach). Bridge case: exposed by host `AUTOPILOT_PARENT_SESSION_ID` leak under inherited-id refusal from `ef2a1b3e2` feat(dispatch-tree): 3b session-marker write-target resolver; oracle case itself from `803b9b89d` | (1) Case 21 stubbed `setsid` as always-exit-1; after `2f9e21d6b` the plain fallback still calls bare `setsid`, so the worker dies (`question_suspected`) instead of committing. (2) Bridge oracle `dispatch()` spreads `process.env`; a host-exported parent session id makes `no_session_id_*` die at `dev_flow_admission` (inherited id read-only) before the marker bridge under test. | test | uncommitted: (1) nowait `setsid` shim that execs; (2) scrub `AUTOPILOT_PARENT_SESSION_ID` / `AUTOPILOT_CHILD_SESSION_ID` in bridge oracle spawn env | yes (EXIT 0, 392 assertions) |

## Verify commands (final pass, one at a time)

```text
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash hooks/tests/dispatch-detach.test.sh < /dev/null
→ EXIT 0  PASS [dispatch-detach] 74 assertions

env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash hooks/tests/dispatch-gitconfig-containment.test.sh < /dev/null
→ EXIT 0  PASS [dispatch-gitconfig-containment] 32 assertions

env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash hooks/tests/dispatch-hetero.test.sh < /dev/null
→ EXIT 0  PASS [dispatch-hetero] 392 assertions
```

## Files changed (one line each)

- `hooks/tests/dispatch-detach.test.sh` — h2 no-wait setsid fixture wraps real setsid and omits `--wait` from help.
- `hooks/tests/dispatch-gitconfig-containment.test.sh` — restore-failure stdout redirect uses `$TEST_TMP` instead of `/tmp/gc-restore-out.txt`.
- `hooks/tests/dispatch-hetero.test.sh` — case 21 setsid-unavailable fixture same nowait-exec pattern as detach.
- `hooks/tests/mission-routing-campaign-bridge.test.sh` — oracle `dispatch()` / off-mode spawn delete parent/child session env leaks so `no_session_id_*` reaches the marker bridge.
- `project/backlog/triage-bl0432-C.md` — this triage record.

## Deferred / out of scope

- No product-code changes (fixtures/env scrub only).
- No git commit / push / PR (harness directive).
- Other BL-0432 groups (A/B/…) untouched.
- Full `git bisect run` for detach aborted mid-range on a dirty bisect worktree; first bad pinned by green-at-`9dbe88a7b` / red-at-`2f9e21d6b` verification instead.
- Did not delete the foreign-owned `/tmp/gc-restore-out.txt` leftover on the host (test no longer depends on it).
