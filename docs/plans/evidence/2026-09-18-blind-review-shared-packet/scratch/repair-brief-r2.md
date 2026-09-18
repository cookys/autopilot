Engine: sonnet

# Repair round r2 — mission branch `mission/b33ff20c07e9/shared-packet-a1`

Work ONLY in the worktree `/tmp/hetero-mission-b33ff20c07e9-shared-packet-a1-3RP21Y` (HEAD `5d7ad66a`).
Use `git -C <worktree>` for every git command; never touch `/home/cookys/projects/autopilot`. Never `git stash`,
never push. Do NOT export AUTOPILOT_SESSION_ID / AUTOPILOT_LEVEL / AUTOPILOT_ROOT_RUN_ID when running suites
(`env -u AUTOPILOT_SESSION_ID bash …` — `mission-runtime-v2.test.sh` fails under that variable).
Commit ONE commit on that branch when the verify list is green. Node built-ins only. After editing `src/` run
`bash scripts/sync-codex-plugin-skills.sh` then `--check` (exit 0); mirrors go in the same commit.

Allowed files: the sealed list in `docs/plans/2026-09-18-blind-review-panel-station.md` §2.5 (`shared-packet`)
— nothing else, nothing created. Do not edit the plan, CHANGELOG, or `docs/plans/evidence/**`.

## Fixes (panel findings adjudicated by depth-0; RED-first, `# RED at 5d7ad66a: <observed>`; never weaken)

A. **Batched hasher: absolute paths, cwd = repo** (`src/runners/review-packet.js` `hashObjectsStdinPaths`, called
   from `verifyTreeIntegrity` :340). Reproduced at 5d7ad66a: `git hash-object --stdin-paths` C-unquotes any line
   whose first byte is `"` — a tracked regular file named `"quoted.txt` makes git die `fatal: line is badly quoted`
   instead of the base verdict. Fix: feed the batch ABSOLUTE paths (`path.join(treeDir, rel)`; an absolute path can
   never start with `"`), run with `cwd: repo` (the listing entry's `repo`, as base `hashObject` did) and the same
   `-c extensions.objectFormat=<format>` rule as `hashBlob` — delete the throwaway `GIT_DIR` block entirely. LF/CR
   names still go through the per-file `module.exports.hashObject` branch (plan §1.2.3, unchanged). Verify with
   `printf '/abs/"quoted.txt\n' | git hash-object --stdin-paths --no-filters` → the blob id (this was checked by
   depth-0: exit 0, `ce013625…` for `hello\n`).
   Test (`hooks/tests/review-packet.test.sh`, the existing batched-hashing fixture): add a regular file named
   `"quoted.txt` (leading double quote) to the fixture tree; assert `batch_equals_per_file=true` still holds and
   that `hashObject_calls` stays equal to the LF/CR count (2) — the quoted name is batched, not routed per-file.
   RED at 5d7ad66a: the fixture build throws `git hash-object failed … fatal: line is badly quoted` (record the exact
   text you observe).
B. **Shared build failure must not escape `runPanel`** (`src/engine/autopilot-engine.js` `runPanel`, the
   `buildPacketOnce(...)` call before `try {`). At 5d7ad66a a throw from `buildReviewPacket` (tree integrity,
   deny-list, git) propagates out of the panel with no seat receipts and no ledger row; at base the same errors
   were caught inside `prepareReviewLaunch` and became one seat row with the reason. Fix: wrap the shared build in
   try/catch; on failure set `sharedPacket = null` and let every seat take the per-seat `options.packet` path,
   which fails in `prepareReviewLaunch` exactly as base did (base error path, `dispatch_review` row, transport
   classification). No new failure vocabulary.
   Test (`hooks/tests/autopilot-engine.test.sh`, the 2-A `real_batch_panel` block where `rp.buildReviewPacket` is
   already wrapped): add a case whose wrapped `buildReviewPacket` throws once (the first call — the shared build)
   and works afterwards; assert `runPanel`/the panel receipt returns instead of throwing, and that the receipt still
   has one row per seat. RED at 5d7ad66a: the throw escapes (record the message).
C. **Only the materialisation mismatch is `precondition_failed`** (`src/engine/autopilot-engine.js` `reviewDiff`,
   the new early return on `reviewResult.skipLaunch === true`, ~:3511). Narrow it to
   `reviewResult.skipLaunch === true && reviewResult.phase === 'precondition_failed'`; every other prepare-time
   `skipLaunch` (mkdtemp, deny-list, git) keeps base's error path (the `dispatch_review` ledger push and the
   existing transport classification). Keep the `precondition_failed` mapping at ~:5247 for the mismatch case.
   Test (`hooks/tests/review-runner.test.sh` or the engine suite, whichever already has the mismatch case): the
   mismatched seat is `precondition_failed`; a seat whose prepare fails for a non-mismatch reason (e.g. a
   `sharedPacket` whose `packet_dir` does not exist → `materializePacket` throws ENOENT) is NOT
   `precondition_failed`. RED at 5d7ad66a: both are `precondition_failed`.

Refuted by depth-0 (no change): "the engine adds a second `buildReviewPacket(` caller" (`buildPacketOnce` is a
different identifier; the walk sees 2 lines); "hashObject wrap miscounts" (the suite passes at 5d7ad66a: symlinks via
`hashBlob` are intentionally uncounted); "the codex twin is outside the sealed paths" (it is sealed; it is synced).
Deferred (do NOT do): gate the shared build on the blind-discovery predicate; the extra `prepareReview` in
`runPanel`; the lstat pre-pass ordering; pinning a base packet hash in the runner test.

## Verify (sequentially, foreground, all exit 0; paste the tail of each)
```
bash hooks/tests/review-packet.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
git -C <worktree> diff --stat fd4ea3a6 -- scripts src/engine/campaign-composition.js src/engine/campaign-intake.js src/engine/resolve-review-loop.js schemas   # must be empty
```
Commit first line: `fix(shared-packet): batched hasher feeds absolute paths with cwd=repo (quote-prefixed names, no temp-dir discovery); a failed shared build falls back to per-seat prepare instead of escaping runPanel; only the materialisation mismatch is precondition_failed (2-C repair r2)`.
Report: commit sha, `git -C <wt> diff --stat 5d7ad66a..HEAD`, the RED observations for A/B/C verbatim, verify tails.
If the brief disagrees with the code, stop and say so.
