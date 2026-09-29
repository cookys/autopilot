# wdfu landing REPORT — STOPPED at final review (FIX-THEN-SHIP)
Picked (in order) -> landed in clone `$B/land` branch release/wdfu (NOT pushed, no release commit):
51def4fb->b9c622b5, b9fbc8fc->b91426d4, 39264663->3bd4614d, e577d5a6->78e0eb12, a9973f44->f9290d8c, 4543f5f1->c88b6f4b, bec1ba91->9a1061eb. No conflicts; enforcement_mode stayed enforce after every pick; a1ca251e not picked. Codex mirror sync produced no change; --check rc=0.
Gates: full suite (382 files) "ALL TESTS PASSED" incl. serial tail; the 6 FAIL [slash-entry-probe] lines are nested-fixture output (solo rerun rc=0, SKIP LLM probe gated). check-js-syntax rc=0, sync --check rc=0, validate.sh 30/30. Red count 0.
Review: claude-native claude-fable-5-1 -> FIX-THEN-SHIP. File: run-land/wdfu.review.json (findings in .findings)
 - 🟠 wdog-alive-check-fail-open: the new pre-fire `_watchdog_worker_alive` gate exits the watchdog silently if `ps` yields nothing (fork failure / non-procps ps lacking `state`), so the run can hang unbounded while reporting timeout_enforced:true. Suggested fix: fail toward firing (treat empty ps output/empty rp state as alive/unknown).
 - 🔵 x5 (ps-loop forks, reap_pid bare kill in test helper, set -e/pipefail leak in r6 tests, assert_eq arg order, set -m tty bg-pgrp SIGTTIN note).
Not done: fix of the 🟠 (depth-0 adjudication), release/version/BACKLOG/CHANGELOG/INDEX, commit, push.

## Round 2 (coordinator repair 77c371cc)
Picked 77c371cc -> 96960a81 (reworded); enforce intact; mirror sync/--check ok. Gates: full suite 382 files ALL PASSED (only nested slash-entry-probe FAIL lines), js-syntax ok, validate 30/30.
Review r2: wdfu-r2.review.json -> FIX-THEN-SHIP. (First attempt was rejected by blind-evidence K1 for narrative in spec; resubmitted as obligations only.)
 - 🟠 wdog-scope-empty-fallback-fails-closed: `_watchdog_worker_alive` SCOPE_UNIT branch with empty WORKER_FALLBACK_PGID and unusable ps: empty state falls through to `_watchdog_pgid_has_live ""`, which returns 1 at `[ -n "$target" ] || return 1` -> watchdog exits without `systemctl --user kill`; no wall enforcement while timeout_enforced:true. Suggested fix: `if [ -z "$st" ] && [ -z "${WORKER_FALLBACK_PGID:-}" ]; then return 0; fi` after the state probe + r6 test case (SCOPE_UNIT set, ps fails, WORKER_FALLBACK_PGID unset, expect rc 0).
 - 🔵 x4: pre-existing bare `kill "${sp:-}"` trap (own child, not this diff); reap_pid after confirmed-dead; assert_eq arg order; set -e/pipefail leak.
STOPPED. Not done: this 🟠 fix, release, push. Landing clone release/wdfu HEAD 96960a81 (8 commits, unpushed).

## Round 3 (coordinator repair e8c13c6b)
Picked e8c13c6b -> 46b9c531 (reworded); enforce intact; mirror ok; .opencode churn reverted. Gates: full suite 382 files ALL PASSED (only nested slash-entry-probe FAIL lines), js-syntax ok, validate ok.
Review r3: wdfu-r3.review.json -> FIX-THEN-SHIP.
 - 🟠 wdog-alive-scope-no-rp-no-fallback: SCOPE_UNIT with WORKER_RP empty AND WORKER_FALLBACK_PGID empty skips the state probe, falls to `_watchdog_pgid_has_live ""` which returns 1 -> watchdog exits without systemctl kill. Reviewer notes reachability is narrow (run_worker always sets WORKER_RP before arming; only a caller arming the watchdog directly hits it). Suggested fix: `if [ -z "$rp" ] && [ -z "${WORKER_FALLBACK_PGID:-}" ]; then return 0; fi` before the fallback pgid check + extend assert_r7_scope_unknown_state_no_fallback_fires with that shape. Plain branch analogue judged not a defect.
 - 🔵 x3 new: reap_pid after confirmed-dead (test); HETERO_TEST_* env knobs honoured unconditionally in prod script; no-setsid fallback sleeper untagged (cancel relies on TERM trap).
 - Earlier 🔵 (rounds 1-2): fork-heavy pgid_has_live loop, set -m SIGTTIN note, assert_eq arg order, set -e/pipefail leak, pre-existing bare kill trap.
STOPPED. Not done: this 🟠 fix, release, push. Clone release/wdfu HEAD 46b9c531 (9 commits, unpushed).

## Round 4 — SHIPPED
Picked cbbfdc10 (+codex mirror folded in) then rebased onto origin/develop (v2.36.103). Gates: full suite 382 files, 2 load TIMEOUTs (engine-qualify, resolve-review-loop) both rc=0 solo; js-syntax, validate ok. Review r4 wdfu-r4.review.json (raw_log dispatch-review-log-axDOqP): SHIP-AS-IS, 0 red/orange; 🔵/🟡 listed in CHANGELOG.
Release v2.36.104, commit 8b893744 pushed to origin/develop (ls-remote confirmed). BACKLOG row + sidecar removed; preflight 9/9; plan-graduation exit 0.
