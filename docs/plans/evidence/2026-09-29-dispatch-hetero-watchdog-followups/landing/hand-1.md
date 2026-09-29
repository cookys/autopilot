Engine: cursor-grok-4.6-low

# Hand 1 (R1) — no-setsid / no-job-control degrade in scripts/dispatch-hetero.sh

You are working in the git clone you were launched in (a worktree of a clone; never touch any other checkout). Read scripts/dispatch-hetero.sh around the functions run_worker, _wait_worker_with_watchdog, _arm_worker_watchdog, _watchdog_signal_worker, emit (search for the timeout_fields block), and the manifest writer that sets mf_timeout_enforced (search for mf_timeout_enforced). Background: docs/backlog/dispatch-hetero-watchdog-followups.md items 1 and 9.

## Product
Two defects, both only reachable on hosts with no setsid binary (or when the detached child has no setsid).

Item 1. In run_worker, both no-setsid fallback branches (the detached-child branch and the plain branch) run set -m, start the worker with env in the background, and read its pgid into WORKER_SID. When job control did not actually turn on (set -m failed, or the shell options do not contain the m flag afterwards), the worker stays in the dispatcher's own process group. The signal helper then correctly refuses to signal it (self-pgid guard), yet the run still reports timeout_enforced true. Fix: introduce a global flag WATCHDOG_DISARMED (reset to 0 at the top of run_worker). On the no-setsid branches, after set -m, verify job control really is on (inspect the dollar-dash option string for m) and verify the worker pgid differs from the dispatcher's own pgid; if either check fails, set WATCHDOG_DISARMED=1 and skip arming the watchdog for that run (do not arm a watchdog that cannot signal anything). Then both the result-JSON emit block and the manifest writer must report timeout_enforced false when WATCHDOG_DISARMED is 1 (keep timeout_seconds and timeout_source as recorded, only the enforced flag flips; also print one line on stderr saying the wall timeout could not be enforced on this host). Never add a bare-pid kill fallback anywhere.

Item 9. On those same fallback branches set -m stays on for the rest of the run, so bash prints job-status notices on stderr for every background job afterwards. Scope it tightly: turn job control back off with set +m right after the worker has been launched and its pgid read (the worker keeps its own group), before waiting. The watchdog must keep working when the caller has set -e and pipefail active: every new command that can return non-zero must be guarded.

Because a host without setsid is hard to reproduce, add one tiny test seam: an environment variable HETERO_TEST_NO_SETSID=1 honoured in run_worker only, which makes the code behave as if command -v setsid failed (for the branch selection in run_worker AND for HAVE_SETSID / the arm helper's own setsid use, so the whole run is setsid-free), plus HETERO_TEST_NO_JOBCONTROL=1 which makes the job-control verification report failure. Document both seams in a comment next to their use, marked test-only.

## Tests (RED-first)
Create the NEW suite hooks/tests/dispatch-hetero-watchdog-followups.test.sh (bash, chmod +x). Model its scaffolding (sandbox repo, stub worker that writes a pidfile then sleeps, helper assertions, finalize) on hooks/tests/dispatch-hetero-wall-timeout.test.sh: copy the helper prelude you need instead of sourcing that suite. Add case functions:
- assert_r1_nojobcontrol_reports_unenforced: plain (inline, no ledger) run through the real scripts/dispatch-hetero.sh with HETERO_TEST_NO_SETSID=1 and HETERO_TEST_NO_JOBCONTROL=1, a short --timeout, a stub worker that exits quickly on its own; assert the result JSON has timeout_enforced false, and the manifest under the runs dir has timeout_enforced false.
- assert_r1_nojobcontrol_detached_real_path: the same through the REAL detached path (pass --ledger, --run-id, --stage implement together, poll the durable result file as the existing detached case in the wall-timeout suite does); assert timeout_enforced false in the durable result JSON.
- assert_r1_nosetsid_with_jobcontrol_still_enforces: HETERO_TEST_NO_SETSID=1 only, stub sleeps 120, --timeout 3s; assert timed_out true, timeout_enforced true, and the stub pid is dead, all within 30s. (If job control cannot be turned on in this environment, the case may report skipped inside itself with a printed reason, but try first.)
- assert_r9_no_job_notices_on_stderr: in the previous scenario, capture stderr of the dispatch and assert it contains no bash job-status notice lines (lines that contain the words Terminated or Killed or Done at the start after a bracketed job number).
Before fixing, run the new suite against the unmodified code and record the red output as a comment at the top of the file in the form: a hash line reading RED at a1ca251e, followed by the failing lines. Then implement the fix so it is green.

## Verify
Run each command in the foreground, with the env prefix env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID and stdin from /dev/null, one at a time:
- test -x hooks/tests/dispatch-hetero-watchdog-followups.test.sh, then run that suite;
- hooks/tests/dispatch-hetero-wall-timeout.test.sh (the existing watchdog suite);
- every consumer suite: hooks/tests/dispatch-hetero.test.sh, hooks/tests/dispatch-hetero-contract.test.sh, hooks/tests/dispatch-hetero-cursor-routing.test.sh, hooks/tests/dispatch-hetero-gc.test.sh, plus every suite that grep -l finds for the symbols run_worker, hetero-wall-watchdog, timeout_enforced under hooks/tests and scripts;
- node scripts/check-js-syntax.js;
- bash scripts/sync-codex-plugin-skills.sh --check (if dispatch-hetero.sh has a mirror under platforms/codex/plugin/, run bash scripts/sync-codex-plugin-skills.sh to sync it, then re-check).

## Allowed files
scripts/dispatch-hetero.sh, hooks/tests/dispatch-hetero-watchdog-followups.test.sh (new), and any platforms/codex/plugin/ mirror of dispatch-hetero.sh produced by the sync script. Nothing else: no CHANGELOG, BACKLOG, version files.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
