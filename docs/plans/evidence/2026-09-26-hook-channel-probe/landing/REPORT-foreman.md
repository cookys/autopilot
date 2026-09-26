# REPORT — hook advisories reach the model (plan `2026-09-26-hook-advisories-reach-model`)

Foreman run. Clone `$C` on branch `ha-base`, base `0a57d55e` (carries the clone-local shadow commit
`0a57d55e` "PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow (never land)", per
`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md` — never landed, untouched). All hands
dispatched via `scripts/dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low --effort low`; all
reviews via `scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high`.

Final accepted head: **`d7599e94`** (branch `hands/ha/p2-catalog-fix`).

## Per-row outcomes

### LAND p1a — `7f2919bb`
Default-on group-T hooks (cost-fuse, context-budget T1, depth0-delegate-gate, reload-watch,
dispatch-model-guard) now emit `hookSpecificOutput.additionalContext` alongside the unchanged stderr write, no
`permissionDecision`. Diff stat: 8 files, +234/-10 (new suite `hooks/tests/hook-advisory-channel.test.sh`,
re-expectations in `cost-fuse.test.sh` cases 4/4b/5d and `dispatch-model-guard.test.sh` cases 6d/12/21 — no
6e change). RED line: `# RED at 0a57d55e: all five warn/advisory paths exit 0 with empty stdout (JSON parse
fails: Unexpected end of JSON input)`.
Review verdict: **FIX-THEN-SHIP**, 1 red + 1 orange + 2 yellow + 2 blue findings. All four non-blue findings were
re-derived empirically and found FALSE:
- red "codex mirrors missing" — verified no `platforms/codex/plugin/hooks/*.js` files exist at all (the codex
  mirror only copies `hooks/_shared/`, not individual hook files); `sync-codex-plugin-skills.sh --check`
  reported "in sync" both before and after this row's diff.
- orange "reload-watch suite not re-expected" — the existing suite asserts only on stderr content, never on stdout
  emptiness; it passed unmodified (confirmed by direct run, 6/6 assertions).
- yellow "cost-fuse case 4b / context-budget T1 ranges unchanged" — neither existing assertion checks stdout
  emptiness on those paths; both suites passed unmodified (66/66 and 41/41 assertions respectively).
- yellow "TMPDIR not exported" — `hooks/tests/lib.sh` already exports `TMPDIR` globally for every suite that
  sources it.
Accepted as-is; no repair dispatched.

### LAND p1b — `ae262ac9`
`hooks/opt-in-multiplexer.js` now merges every enabled child's `additionalContext` into one JSON object
(dropping any child `permissionDecision`), and passes an exit-2 child through byte-identically without
merging. The six opt-in group-T hooks (orchestrator-edit-gate, branch-protection, large-file-warner,
design-quality, test-runner, mcp-health — both its PreToolUse and PostToolUseFailure paths) get the same
additionalContext conversion. Diff stat: 9 files, +309/-23 (appended to `hook-advisory-channel.test.sh`, one
re-expectation in `orchestrator-edit-gate.test.js`). Two RED lines recorded (row-1's plus this row's own).
Review verdict: **SHIP-AS-IS**, 3 blue non-blocking follow-ups only (a trailing-newline strip convention
mismatch in test-runner.js, a non-issue re: mcp-health's pre-branch staying exit-2 by design, cosmetic
double-RED-comment).

### LAND p2 — `d746f35d`
Group-S Stop hooks (cost-tracker default-on, check-console/batch-format opt-in) now inline-append their
advisory text to a session-keyed queue file (`<live-state base>/advisory-queue/<sid>.jsonl`, 20-entry / 8 KiB
oldest-first cap), in addition to unchanged stderr. New default-on hook `hooks/advisory-relay.js`
(UserPromptSubmit, opt-out `AUTOPILOT_ADVISORY_RELAY=off`) atomically drains (rename-then-read) and delivers
at most once, dropping entries older than 24h, fail-open on corruption. Wired into `hooks/hooks.json`
(new `UserPromptSubmit` block), README row added, `profiles/hook-classes.json` entry added. Diff stat: 10
files, +495/-6 (new suite `hooks/tests/advisory-relay.test.sh`, 53 assertions). RED line:
`# RED at ae262ac9: suite missing; group-S hooks do not enqueue; advisory-relay.js absent`.
Review verdict: **FIX-THEN-SHIP**, 1 yellow MUST-FIX ("RED marker should say `0a57d55e` not `ae262ac9`") + 5 blue
follow-ups. The yellow finding was a false positive stemming from my own hand-prompt template (copy-pasted from
row p1a) literally instructing `# RED at 0a57d55e:` — but `ae262ac9` IS this row's true dispatch base (stacked
on p1b), so the hand's RED marker is factually correct and my template text was wrong, not the hand's work.
Accepted as-is; no repair dispatched for this finding.
Post-accept discovery (final combined verify): adding the new `advisory-relay` stem to
`profiles/hook-classes.json` left `profiles/profile-catalog.json`'s `hook_classes_sha256` stale, failing
`build-profile-payload.js catalog --check` with `PROFILE_SOURCE_DRIFT` and cascading into
`codex-plugin-package.test.sh` (6 failures) and `profile-context-isolation.test.sh` (51 failures). This is a
documented, previously-solved drift class (`.claude/skills/profiles-hash-repin/SKILL.md`, "新增一個 hook 時的
釘值清單" step 3) that my p2 hand-prompt's allowed-files list omitted. Fixed by a follow-up repair row.

### LAND p2-catalog-fix — `d7599e94` (repair, not in the original 4-row brief)
Re-pinned `profiles/profile-catalog.json`'s `hook_classes_sha256` (and its codex mirror) to match
`profiles/hook-classes.json` after p2's `advisory-relay` addition. Diff stat: 2 files, +2/-2 (one hash line
each, canonical + mirror). No new test (re-pins an existing hash, no behavior change).
`build-profile-payload.js catalog --check` now exits 0; `codex-plugin-package.test.sh` and
`profile-context-isolation.test.sh` both fully green.
Review verdict: **SHIP-AS-IS**, 2 blue non-blocking notes only.

### LAND p3 — `2ec5009a`
`hooks/README.md` updated: one-clause channel additions to all touched Tier A/B rows, new `advisory-relay`
row, `dirty-protected-paths` row notes it deliberately keeps `systemMessage` (KR4, by design, not relayed),
and a new "## Hook Output Channels" section (after "## Exit Code Convention") documenting the three
model-visible channels and the per-event-type table, citing
`docs/plans/evidence/2026-09-26-hook-channel-probe/`. Diff stat: 1 file, +37/-16 (docs only, no test file, no
RED line — per plan, docs-only row). No hook-count numbers, CHANGELOG, version, or `.claude-plugin/plugin.json`
touched.
Review verdict: **SHIP-AS-IS**, no findings.

## Aggregate final verify (throwaway worktree at `d7599e94`, one suite at a time, solo)

| Suite | rc | Note |
|---|---|---|
| hook-advisory-channel.test.sh | 0 | |
| advisory-relay.test.sh | 0 | |
| cost-fuse.test.sh | 0 | |
| dispatch-model-guard.test.sh | 0 | |
| reload-watch-detects-mtime-change.test.sh | 0 | |
| all-hooks-fail-open.test.sh | 0 | |
| context-budget-window-memory.test.sh | 0 | |
| hooks-live-state-misc.test.sh | 1 | 2 pre-existing fails (missing `MINIMAX_API_KEY`), confirmed identical at base `0a57d55e` |
| autopilot-engine-resilience.test.sh | 0 | |
| codex-plugin-package.test.sh | 0 | fixed by p2-catalog-fix |
| check-hook-inventory.test.sh | 1 | expected — hook count 31→32, deferred to depth-0 landing (sync-version.js + count reconciliation) |
| execution-profile.test.sh | 0 | |
| exec-boundary.test.sh | 0 | |
| reenabled-blockers.test.sh | 0 | |
| capability-evidence.test.sh | 0 | |
| resolve-dispatch.test.sh | 0 | |
| profile-context-isolation.test.sh | 0 | fixed by p2-catalog-fix |
| engine-qualify-verdict-stability.test.sh | 1 | 2 pre-existing fails ("D6 honest solver + other-role parity"), confirmed identical at `7f2919bb` |
| cost-tracker-warn.test.sh | 0 | |
| check-optin-changelog.test.sh | 0 | |
| sync-version-preserve-counts.test.sh | 0 | |
| context-budget.test.js | 0 | (node --test) |
| depth0-delegate-gate.test.js | 0 | (node --test) |
| orchestrator-edit-gate.test.js | 0 | (node --test) |
| cost-tracker.test.js | 0 | (node --test) |
| check-js-syntax.js | 0 | |
| sync-codex-plugin-skills.sh --check | 0 | |
| validate.sh | 0 | |
| doc-drift-gate.js . | 1 | 3 pre-existing unrelated FAILs (docs/backlog fence balance, a stale script-ref in references/evidence-discipline.md, dead-link rows) confirmed identical at base `d746f35d` |

No new failure anywhere versus each row's own base. The only two non-deferred, non-pre-existing failures found
mid-run (codex-plugin-package, profile-context-isolation) were fixed by p2-catalog-fix and are now green.

## Not done (explicitly out of scope for this foreman run)
- `sync-version.js`, hook-count reconciliation across `.claude-plugin/plugin.json` / `marketplace.json` /
  `CLAUDE.md` / README badges / `hooks/README.md` header / `check-hook-inventory.js` — per plan section 2.5, deferred
  to depth-0 landing.
- CHANGELOG entry, version bump, merge, push — per brief, depth-0's job.

## Branches for depth-0 to cherry-pick / land
`hands/ha/p1a` (`7f2919bb`) then `hands/ha/p1b` (`ae262ac9`) then `hands/ha/p2` (`d746f35d`) then
`hands/ha/p3` (`2ec5009a`) then `hands/ha/p2-catalog-fix` (`d7599e94`, final head).
