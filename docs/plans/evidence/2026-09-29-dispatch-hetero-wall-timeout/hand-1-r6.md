# dispatch-hetero.sh wall-clock watchdog — repair pass (r6)

Combined review raised one remaining 🟠 MUST-FIX, adjudicated real. Fix ONLY this in
`scripts/dispatch-hetero.sh` (`_watchdog_signal_worker`); do not touch anything already fixed in
r2/r3/r4/r5.

## Finding — bare-pid fallback in `_watchdog_signal_worker` has no legitimate use and is a hazard

```
kill "-$sig" "-$target" 2>/dev/null || kill "-$sig" "$target" 2>/dev/null || true
```

The group-kill (`kill -SIG -$target`) fails only when process group `$target` no longer exists.
Since r5 guarantees `WORKER_SID` is always a genuine session/process-group leader on every
containment path, a failed group-kill means that group is already gone — so the bare-pid fallback
(`kill -SIG $target`) can only ever hit a DEAD or RECYCLED pid, never the live worker. E.g. if the
dispatcher itself were SIGKILLed and an orphaned watchdog fired later, `$target` could since have
been recycled by the OS for an unrelated process, and the bare-pid fallback would signal that
unrelated process — exactly the hazard this whole row exists to prevent.

## Fix (do this and ONLY this)

In `_watchdog_signal_worker`, remove the bare-pid fallback entirely. The function should attempt the
group kill only; if it fails, do nothing further (fail silently, matching existing `|| true` style
elsewhere in this function). Update the comment immediately above/near this line to state plainly why
there is no pid fallback: a failed group-kill means the group is already gone, and since r5
guarantees `WORKER_SID` is always a group leader, a bare-pid kill at that point could only ever hit a
dead or recycled pid.

Mirror the same fix in `platforms/codex/plugin/scripts/dispatch-hetero.sh` via
`bash scripts/sync-codex-plugin-skills.sh`.

Do not touch the cgroup branch of this function (the `systemctl --user kill` path) — this finding is
about the pgid branch only.

## Tests (RED-first against 9d50f3186f798b318d804e5ce837ba6820f7444d)

Add a test case to `hooks/tests/dispatch-hetero-wall-timeout.test.sh` that isolates
`_watchdog_signal_worker` directly (source the script or extract/re-define the function under test —
look at how other suites in this repo source functions from `scripts/dispatch-hetero.sh` for unit-style
testing, if such a pattern exists; otherwise source the whole script with a guard so it doesn't
auto-run its main body, matching whatever convention `hooks/tests/dispatch-hetero.test.sh` already
uses for calling internal functions in isolation).

The case:
- Start a live helper process that is NOT its own process-group leader — e.g. a background `sleep`
  launched as a plain `&` job inside the CURRENT shell/subshell (sharing the test's own process
  group), so its pid is a member of a group but not the leader of one distinct from the caller.
- Set `WORKER_SID` to that helper's pid (a pid that is not a group leader, so the group-kill targeting
  `-$WORKER_SID` will not correctly hit only that helper, and MUST NOT fall back to signaling the bare
  pid).
- Call `_watchdog_signal_worker TERM` (or however the test invokes it).
- Assert the helper process is STILL ALIVE afterward (proving no bare-pid fallback fired and killed
  it via the removed fallback path).
- Then explicitly kill the helper process yourself in the test (cleanup) so it doesn't leak.

This case must fail (RED) against the r5 head `9d50f3186f798b318d804e5ce837ba6820f7444d` — record
`# RED at 9d50f3186f798b318d804e5ce837ba6820f7444d:` plus the failing output as a comment — and pass
(green) after your fix. Keep all prior cases in this suite passing unmodified.

## Verify

Same list as before, run solo/foreground with
`env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ... < /dev/null`:
`test -x hooks/tests/dispatch-hetero-wall-timeout.test.sh`;
`bash hooks/tests/dispatch-hetero-wall-timeout.test.sh`;
`bash hooks/tests/dispatch-hetero.test.sh`;
`bash hooks/tests/dispatch-hetero-contract.test.sh`;
`bash hooks/tests/dispatch-hetero-cursor-routing.test.sh`;
`bash hooks/tests/dispatch-hetero-gc.test.sh`;
`bash hooks/tests/dispatch-status.test.sh`;
`bash hooks/tests/dispatch-detach.test.sh`;
`node scripts/check-js-syntax.js`;
`bash scripts/sync-codex-plugin-skills.sh --check`.
List the exact rc of each in your commit message.

## Allowed files

Only `scripts/dispatch-hetero.sh`, `hooks/tests/dispatch-hetero-wall-timeout.test.sh`, and
`platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`. Touch nothing else.

Commit ONE commit; touch no other file; run every Verify command in the foreground before committing.
