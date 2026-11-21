=== SCAFFOLD ENVELOPE (tier T2 — references/scaffold-tiers.md) ===
You own this task end-to-end. Contract:
- GOAL: (caller's prompt body below)
- DONE means: every obligation in the evidence contract is green, and your work
  will be independently reviewed by an engine from another model family.
- RED LINES: the red lines stated in the task prompt below and any campaign boundary above
- EVIDENCE: bind every claim to an artifact (commit, diff, receipt path).
  Unverifiable claims are treated as false.
Method is yours. Do not narrate completion — deliver evidence.

OBLIGATIONS (each must end green, in any order):
- run the named verify command(s) and record exit codes
- list every file you changed and why in one line each
- state what you did NOT do (deferred/out of scope)
Verify-first ordering is recommended: reproduce/red-case before fixing.

PROCESS (follow in order, report each step):
1. Restate the task in your own words; list acceptance criteria.
2. Locate the relevant files; quote the exact lines you will change.
3. Make the smallest change that satisfies one criterion; run the verify
   command; record the result.
4. Repeat 3 per criterion. Never batch unverified changes.
5. Final pass: re-run ALL verify commands; report each exit code; list
   changed files; state deferred items.
Do not deviate from this sequence. If a step is impossible, stop and say so.

=== END SCAFFOLD ENVELOPE ===

Fleet-Task: 01M7YHMENXK58FK99D5544R28T
Role: implementer | Lane: autopilot | Size: S

Problem: long-running Claude seats burn CPU because the live mod stats every session-mode marker on each poll. On real hosts ~/.autopilot/session-mode/ holds 2,615 files (oldest from July, never cleaned); a seat does 468–765 statx/s (11–22% of one core).

Confirmed path:
- `src/status/runs-watch.js:441` `sourceFingerprint` records, in the published envelope's `sources`, a `marker` group whose `files` are ALL markers of this project (`readLiveMarkers(markerDir, key, nowMs).paths`), expired ones included.
- `mods/live/register.ts:552` `judgeByChange` runs on every poll (called from `findEnvelope` ~line 603, twice per scope: tmpfs path then SSD copy) and does `$.fs.stat(f.path)` for every listed file (lines ~558-561), then stats the dir.

Fix all three:
1) runs-watch.js: `readLiveMarkers` / `sourceFingerprint` lists only markers that are still live (marker `expires_at` in the future, or no expires_at and mtime within 24 h). Expired markers cannot change anything the snapshot shows.
2) register.ts `judgeByChange`: memoize per envelope. Keep a module-level map keyed by envelope identity (path + envelope generated_at/sequence, whatever uniquely identifies one publish) holding the last `fresh` verdict and the dir mtimes seen. On the next poll, stat each group's DIR first; if every dir mtime equals the memoized one, return the memoized fresh verdict without per-file stats. Only when a dir mtime moved (writers use tmp+rename, so any create/replace/delete moves it) run the full per-file check as today. Keep every existing semantics in the long comment above judgeByChange (absent dir, EACCES, unreadable new files, notOurs). Bound the map (e.g. clear above 256 entries).
3) Cleanup: in `scripts/session-mode.js` where a marker is written (set), also remove, best-effort, markers in the same dir whose expires_at is more than 24 h in the past (or, if unparsable/no expires_at, mtime older than 7 days). At most 500 removals per call; never remove the marker being written or any file not ending in .json; ignore errors. Removal only via fs.unlinkSync on paths built from readdir of that one directory.

Tests (red before green):
- mods/live (same test runner and fake world the existing live.test.ts uses, see the "old publish whose writer left" cases around line 666): a world with 2,000 marker files for this project in the envelope sources; advance the fake clock 60 s of polling with no dir change; assert the number of `$.fs.stat` calls is below a small threshold (≤ 2 per group per poll, i.e. dir stats only, plus one full pass). Also keep: a dir mtime change still makes a changed marker read as stale.
- runs-watch: an expired marker is not in `sources`.
- session-mode.js: set with 3 expired-old markers and 1 live one removes the 3, keeps the live one and the new one.
Run: the mod test command used by mods/live (see mods/live/CLAUDE.md or package.json scripts; e.g. `cd mods/live && npx` is NOT allowed to download — use the repo's existing runner), `node --test` on the touched scripts tests, and `node --test hooks/session-root-liveness.test.js`. All previously green tests stay green.

Mirror: copy changed files to their platforms/codex/plugin/ mirrors byte-identical where a mirror exists.

Report in the commit body: per-poll stat count before vs after in the 2,000-marker test.

Commit with trailer `Fleet-Task: 01M7YHMENXK58FK99D5544R28T`.

Rules: Never run a real grok/codex/agy/opencode/kimi/cursor/claude CLI, a real `fleet` command, or call any real HTTP model endpoint (stubs only). Never read, list or modify the real ~/.autopilot (tests use temp dirs / the fake world). Never run find, grep -r or rg starting at /. Do not read ~/.claude, ~/.codex, ~/.config, ~/.local/state. File deletion in tests only on literal temp paths. Never run the full hooks/tests/run.sh. Edit nothing outside this repo. No force-push, no --no-verify. No zsh-only expansions. No network installs.
