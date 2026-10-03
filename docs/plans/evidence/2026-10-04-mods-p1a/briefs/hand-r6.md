# Row R6 — combined-review repair for P1a (ONE commit)
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r6  Branch: p1a/r6  Base: 367affdd (R1 is NOT on this base; R2–R5 are). Already checked out.
Source: the combined review `/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/run-land/p1a.review.json` (read its findings) — depth-0 re-derived each item below.

1. 🟡 MUST-FIX (plan §2.7 is binding: `--project` accepts the 16-hex `project_key` OR the full `repo_identity` string,
   normalised to project_key by the CLI): `src/status/runs-watch.js` `resolveKey` rejects a `git-common-dir:…` argument
   (`status runs --watch|--stop --project git-common-dir:/…` exits 2). Normalise via `projectKey()` when the argument is a
   repo_identity; keep rejecting anything else with the existing message. In `src/status/runs-fields.js` `applySelectors`, the
   output header must carry the normalised `project_key` (keep the raw selector only if an existing test pins it; add
   `project_key`). RED-first cases in runs-watch.test.sh and status-runs-fields.test.sh.
2. Real-store leak: `hooks/tests/manifest-repo-identity.test.sh` (R1's suite — it exists only on p1a/r1, NOT on your base) runs
   `status runs` without isolating the live dir, and wrote `/run/user/1000/autopilot/runs-enrich-cursor.json`. You cannot edit a
   file absent from your base; instead write the exact one-line fix (export AUTOPILOT_LIVE_DIR to a /dev/shm mktemp dir in that
   suite's setup + remove it in its trap) into `/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/run/r6-r1-suite-fix.txt` for depth-0 to apply as a separate pick.
   Also add defence in depth on your base: `hooks/tests/lib.sh` exports `AUTOPILOT_LIVE_DIR` to a per-run /dev/shm mktemp
   dir when the caller has not set one (so every lib.sh suite is isolated by default), cleaned up by lib.sh's existing
   cleanup if it has one (check `cleanup_test_tmp`); prove existing suites that set their own AUTOPILOT_LIVE_DIR still win.
3. Missing P1a deliverable: `schemas/runs-live.schema.json` (plan §3 file map lists runs-live under P1a). Draft 2020-12 or
   whatever dialect `scripts/validate-json-schema.js` supports (read it), describing the envelope exactly as runs-watch.js
   writes it (schema, scope, published_at, valid_for_s, writer|null, exit_reason, runs, counts, sessions, host_today_usd,
   host_today_as_of). Add a runs-watch.test.sh case validating a real envelope against it with validate-json-schema.js.
   Check whether schemas need registration anywhere (`git grep -l "schemas/" scripts/check-*.js`), and do it.
4. `writePaths` writes `{}` when `git worktree list` fails — that wipes the mod's project resolution. On failure keep the
   previous file untouched (log one line to the watcher log). One RED-first case (fake git on PATH failing worktree list).

Allowed files: src/status/runs-watch.js, src/status/runs-fields.js, hooks/tests/lib.sh, hooks/tests/runs-watch.test.sh,
hooks/tests/status-runs-fields.test.sh, schemas/runs-live.schema.json (new) + any registration the checkers require, codex
mirrors. Consumer sweep: runs-watch, runs-watch-lock, session-mode-watcher, status-runs-fields, status-cli, dispatch-lineage,
project-key, live-pointer, plus a representative 10 lib.sh suites to prove the lib.sh default is harmless (pick ones that do
NOT touch the live dir and ones that DO), plus check-js-syntax, sync --check, validate.sh.
Commit: `fix(status): --project accepts repo_identity; runs-live schema; tests isolate the live dir by default (mods P1a review repair)`
