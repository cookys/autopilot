# Residue auto-reap — contract (3.0.0-alpha.3)

Source: peer report from revival.3d (cuda), 2026-10-09. See `docs/backlog/peer-reported-revival3d-worktree-branch-accumulation.md`; the three BACKLOG rows close here.
Owner rulings, 2026-10-09:
- Use a SessionStart hook, default-on.
- Remind the user about whatever cannot be reaped automatically ("剩下不自動清的要找機會提醒 user 處理不然硬碟還是會堆積").
- Default retention is 72 h.
- Mechanism ships now. The finish-flow close-out step (archive, then delete this session's unintegrated dispatch branches) rides the next guidance eval (v7) together with the l4–l6 size row, because it is a guidance change.
- The 14-day branch-archive baseline was accepted through the owner's 2026-10-09 option choice.

No skill text changes in this release. Every requirement below is enforced by scripts and hooks.

## Canonical reaper

`scripts/repo-residue-sweep.js reap --auto` is the one automatic reaper.
`dispatch-hetero.sh --gc` (`gc_stale_worktrees`, gated by `stale_reaper_age_days`, which defaults to 0) stays as it is: an opt-in, rail-local fast path. Its header and the scripts-inventory row must say that the sweep's `--auto` mode is the canonical automatic reaper. Removing `--gc` is a BACKLOG row for 3.0.0 final; it is not part of this change.

## R1 — retention record on every keep path (rails)

Whenever a rail keeps a worktree, its schema-2 `.autopilot-worktree` marker carries:
- `retention_reason`: a short token, `[a-z0-9_]+`, for example `failure`, `dirty`, `no_op`, `question_suspected`, `boundary_rejected`, `main_checkout_mutated`, `escalated`, `deadline_expired`.
- `retention_expires_at`: epoch seconds. The value is now + `residue.lease_hours`, default 72.

This applies to:
- `dispatch-hetero.sh`: exit 1, boundary_rejected, main_checkout_mutated, the strict-contract post-check failure, and the detach-forced keep.
- `dispatch-foreman.sh`: every non-`completed` status.

An explicit `--keep-worktree` lease, `retention=lease` with owner, reason sha and until, keeps its own `retention_expires_at`. The default never overrides it.

Two acceptance requirements:
- `_wt_marker_valid` (`scripts/lib/worktree-reap.sh`) must accept every marker the rails now write. Prove it by running it on real rail output.
- `reap-dispatch-worktrees.sh scan` must not classify the new markers as `malformed`.

## R2 — `repo-residue-sweep.js` auto mode

New flag: `reap --auto --yes`. It does not combine with `--preserve-dir` or `--older-than-days`. `scan --json` gains the new fields below, all additive.

**Auto mode may remove only the following. Everything else is remind-only.**
1. `missing-dir` worktrees, via `git worktree prune` for that entry.
2. Worktrees that meet every condition below:
   - they carry a schema-2 `.autopilot-worktree` marker that passes the same validity rules as `_wt_marker_valid`;
   - they are not live (`flock` probe on `.autopilot-worktree.lock`, the same as the reapers);
   - no process has its cwd inside them (scan `/proc/*/cwd`; on a platform without `/proc`, treat as live);
   - they are clean;
   - **and** they are either `clean-integrated`, or **lease-expired**, meaning `retention_expires_at` (or `created_at` + lease_hours when the field is absent) is in the past;
   - **and** HEAD equals the tip of a local branch. A detached-HEAD worktree is skipped: removing it would lose commits.
   - **and** they do not belong to an unresolved campaign. When the marker's `root_run_id` names a campaign or mission that the repo's campaign or mission state reports as active or parked, the worktree is retained regardless of age. The hand must find the authoritative state, cite it in the report, and test it. If no reliable signal exists, every marker worktree whose `root_run_id` differs from its `run_id` is skipped and the report says so.
3. Dispatch branches. These match `^(hands|hetero|foreman)/` and the extra prefixes in `residue.branch_prefixes`. A branch is archived, then deleted, only when all of these hold:
   - it is not checked out in any worktree;
   - it is not integrated (integrated ones follow the existing integrated-branch path);
   - its last activity is older than `residue.archive_branch_days`, default 14 days. Last activity is the later of the tip commit's committer date and the newest reflog entry;
   - no live or unexpired-lease worktree points at it;
   - it is not part of an unresolved campaign, under the same rule as above.

   Archive means `git update-ref refs/archive/<YYYY-MM-DD>/<branch> <tip>`, then verify the ref resolves to the tip, then `git branch -D`. Refs, not bundles, because a single `git branch <name> refs/archive/...` restores them. Run `pin-evidence-anchors.js apply` before deletion, as the integrated path does. If that is provably unnecessary because the archive ref keeps the tip reachable, document why in the code comment and in the report.

Auto mode never removes a dirty worktree, never touches a worktree without a marker, never deletes a non-dispatch branch, and never deletes a checked-out branch.

**Needs-human set.** `scan --json` emits `needs_human`, a list. Each entry has `kind` (`worktree` or `branch`), `path` or `branch`, `class`, `age_days`, `bytes` (or null), `reason` (the marker's retention_reason, if any) and `command` (one exact suggested command). It includes:
- dirty worktrees;
- clean-unintegrated worktrees without a marker;
- unverifiable worktrees;
- marker worktrees that are lease-expired but dirty or detached;
- unintegrated non-dispatch branches older than archive_branch_days.

Not included:
- unexpired leases;
- `.claude/worktrees/*` whose path is the cwd of a live process.

The emitted totals are `needs_human_count` and `needs_human_bytes`.

**Sizes.** `bytes` is computed only by `reap --auto` and by `scan --sizes`. It uses `du -sk` per path, with a total budget of 60 s; on timeout the rest get `null`. A plain `scan --json` never walks trees; it may copy cached sizes from the auto run.

`reap --auto` writes its result to `<git-common-dir>/autopilot-residue-auto.json` (`{schema: "autopilot.residue-auto/1", ran_at, removed: [...], archived: [...], needs_human: [...], needs_human_count, needs_human_bytes}`). The watcher reads this file.

Config, through the existing resolver chain (project, then user `~/.autopilot/config.json`, then defaults): `residue: { auto_reap: true, lease_hours: 72, archive_branch_days: 14, archive_remind_days: 90, branch_prefixes: [] }`.

**Archive-ref aging (owner ruling, 2026-10-10).** `reap --auto` and `scan` list every `refs/archive/<YYYY-MM-DD>/...` ref whose path date is older than `residue.archive_remind_days` (default 90; env `AUTOPILOT_RESIDUE_ARCHIVE_REMIND_DAYS`) in `needs_human` as `{kind: "archive-ref", ref, class: "archive-old", age_days, bytes: null, reason, command: "git -C <repo> update-ref -d <ref> <sha>"}`. They are never deleted automatically: the archive may be the only copy of that work. The watcher publishes the entry with `ref` instead of `path`/`branch` (`schemas/residue.schema.json` kind enum gains `archive-ref`) and it counts toward `wt N`.

## R3 — SessionStart hook `hooks/residue-auto-reap.js` (default-on)

- It fires on SessionStart `startup|resume|clear|compact`. In a git repo it spawns, detached and with no wait, `node <plugin>/scripts/repo-residue-sweep.js reap --auto --yes --repo <toplevel>`, then returns immediately with no stdout context. The hook must never block or slow session start; budget under 50 ms.
- It throttles to one run per repo per 24 h. The stamp is `<git-common-dir>/autopilot-residue-auto.stamp`, taken under `flock`, so two sessions never run two sweeps.
- It is skipped when:
  - `residue.auto_reap` is false;
  - the default-on disable convention says so (`~/.autopilot/config.json` `{"hooks":{"residue-auto-reap":false}}` or `AUTOPILOT_HOOK_RESIDUE_AUTO_REAP=0`; follow how existing default-on hooks honour it);
  - not in a git repo;
  - cwd is inside a dispatch worktree (one with a marker).
- After the sweep, when `needs_human_count > 0`, it appends one advisory to `<live>/advisories/<sid>.jsonl` through the existing P7a advisory bridge, reporting the count and size and pointing at the Hygiene tab. It never injects model context.
- Wiring:
  - `hooks/hooks.json` and both Codex mirror `hooks.json`;
  - the hook-classes or inventory files that `check-hook-inventory.js` reads;
  - `hooks/README.md` counts: 37 hooks, 24 default-on, 13 opt-in;
  - CLAUDE.md "36 hooks (23 default-on" becomes 37 and 24;
  - `docs/scripts-inventory.md` sweep row (auto mode);
  - `sync-version.js --hook-count 37` at the cut, not in the hands' commits.
- Proof it fires (evidence discipline): build a fixture repo under the scratch dir with a planted lease-expired clean marker worktree on a branch, a dirty marker worktree, and a 15-day-old unintegrated `hands/x` branch. Run a real headless session there, `claude -p "say ok"` with the live plugin and no `CLAUDE_CONFIG_DIR`, then wait for the stamp. Show:
  - the expired worktree is gone, and its branch remains;
  - the dirty one remains and is listed in needs_human;
  - `hands/x` is gone and `refs/archive/<date>/hands/x` resolves to the old tip;
  - the stamp exists, and a second session within 24 h does not run again.

## R4 — watcher, band, Hygiene tab (supersedes the P7 D3 `wt N` ruling)

`src/status/residue.js` reads `autopilot-residue-auto.json`, if present, together with its existing throttled scan, and publishes these additive fields in `<live>/runs/<project_key>.residue.json`:
- `needs_human_count`;
- `needs_human_bytes`;
- `needs_human`, capped at 20 entries;
- `auto_ran_at`;
- `auto_removed_count`;
- `auto_archived_count`.

`schemas/residue.schema.json` gains these additive fields; the schema id does not change. The watcher must not start `du` itself.

No-project reminder (owner ruling, 2026-10-10): the watcher starts only in onboarded repos, so a repo without autopilot config would never show `wt N`. When the live mod finds no scope for its cwd, it reads `needs_human_count` straight from `<git-common-dir>/autopilot-residue-auto.json` and, when it is above 0, the band's no-project line and the Now tab header read `no project · wt N · run: ...`. The mod cannot run git: it walks up from the cwd to the first `.git`. A `.git` directory holds the file directly; a `.git` file (a linked worktree) names `<common>/worktrees/<name>`, and the common dir is the part before `/worktrees/`. A missing, malformed or foreign-schema file reads as 0. Tests: `mods/live/live.test.ts` ("no project still shows wt N").

Band hygiene slot: `wt N` now shows `needs_human_count`, the residue a person must act on. It is hidden when that count is 0. The owner's 2026-10-09 answer supersedes the P7 "reapable only" ruling: reapable residue is now cleared automatically within 24 h, so a reapable count would tell the user nothing. Colour and theme key are unchanged from P7.

Hygiene tab:
- One summary line: `<N> need you · <size>` plus the last auto run (`auto <age> ago: −<removed> wt, <archived> branches archived`).
- Then up to 20 rows: kind, path or branch (shortened), class, age, size, reason.
- Each row is followed by a dim line with the exact `command`.

Gate:
- Update `check.js` and `check.test.js` so the hygiene slot is judged against `needs_human_count`.
- Take one real-machine capture at 209 columns of a session in the fixture repo from R3, showing `wt N` and the Hygiene tab, with a colored screenshot.
- Do not re-run the six-mode matrix.

## Delivery

- Hand A covers R1 and R2: sweep plus rails.
- Hand B covers R3 and R4: hook, watcher, mod and gate. B codes against the field names and file paths in this contract; if A reports a deviation, B adapts.
- After both are merged, run B's real-session proof of R3 against the merged result.
- Each hand runs `bash scripts/sync-codex-plugin-skills.sh` for mirror drift. Each touched suite runs in the foreground. The full suite runs once at the cut.
- Version: 3.0.0-alpha.3. This is the version number to report to revival.3d.

## Accepted deviations (2026-10-09)

Recorded after hands A and B merged; each is accepted as shipped and supersedes the text above where they differ.

- The marker validator is `_wt_read_schema2_marker` (`scripts/lib/worktree-reap.sh`), mirrored by `parseSchema2Marker` in the sweep. The contract's `_wt_marker_valid` name is not the entry point.
- There is no project config tier. The `residue` chain is defaults, then `~/.autopilot/config.json`, then env (`AUTOPILOT_RESIDUE_AUTO_REAP`, `AUTOPILOT_RESIDUE_LEASE_HOURS`, `AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS`), resolved by `scripts/lib/residue-config.js`. The hook uses the same resolver for `auto_reap`; its own knobs (`AUTOPILOT_HOOK_RESIDUE_AUTO_REAP=0`, `hooks.residue-auto-reap=false`) stay hook-specific.
- An unexpired explicit lease (`retention=lease`) beats `clean-integrated`: the worktree stays until the lease expires.
- A fresh integrated dispatch branch is kept for 1 h after its last activity (`integrated_but_recent`) before auto mode deletes it.
- Clean-integrated worktrees without a marker are listed in `needs_human`, not removed.
- The main checkout is the first entry of `git worktree list`.
- The 24 h stamp is claimed before the sweep runs, so a failing sweep is not retried by every later session.
- The Codex package wires no SessionStart hook for this feature.
- `campaign-held` / `campaign-unknown`: a marker worktree whose lease has expired (or a dispatch branch older than `archive_branch_days`) that is retained only because its `root_run_id` is in an unresolved campaign or Mission is never removed, but is listed in `needs_human` with class `campaign-held` and `reason=root_run_id=<id>`. When the campaign signal is unreadable, the same worktrees (root differs from run) and old dispatch branches are listed as `campaign-unknown`. The `command` is the sweep scan plus the root id, because no safe one-line abort exists (`mission finalize-abort` needs a drained Mission state file). `scan --json` now loads the campaign signal too.

## Session close-out (alpha.4)

Owner ruling, 2026-10-09: at close-out, a session's merged dispatch branches are deleted and its unintegrated ones are deleted directly, instead of waiting `archive_branch_days`. Owner ruling, 2026-10-10 (supersedes the archive-then-delete half): at finish-flow close-out the round is over, and handoff is a different thing that does not run close-out, so a session's unintegrated dispatch branches are abandoned work and get no `refs/archive` ref. Mechanism only; the finish-flow text that calls it rides the next guidance eval.

**Branch-to-session ledger.** `dispatch-hetero.sh` and `dispatch-foreman.sh` append one JSON line when they create a branch (`scripts/lib/dispatch-branch-ledger.sh`) to `<git-common-dir>/autopilot/dispatch-branches.jsonl`: `{schema:"autopilot.dispatch-branch/1", branch, session_id, run_id, root_run_id, created_at, base_sha}`. `session_id` is `$CLAUDE_CODE_SESSION_ID`, else null; `AUTOPILOT_SESSION_ID` is never read. The append runs under `flock -x` on `<ledger>.lock` and is fail-open: a failure prints one stderr line and the dispatch continues. A reused worktree appends nothing (its branch already has a row).

**Ownership.** A foreman's hands run in a child Claude session with another session id, so ownership follows run ids. A branch belongs to session S when its row's `session_id` is S, or its `root_run_id` or `run_id` equals the `run_id` of a row S owns, transitively. Only `run_id` propagates; a row's `root_run_id` never pulls in siblings that share a campaign root. A branch name found in several rows belongs to whoever owns the latest row (`created_at`, then file order), and that row must describe the live ref: the ref's oldest reflog entry within 120 s of the row's `created_at` (no reflog: tip equals the row's `base_sha`, or the tip commit date is not more than 120 s older than the row), otherwise the branch is kept as `ledger_row_stale`. Deletion is `git update-ref -d refs/heads/<b> <tip>` (compare-and-swap), preceded by a fresh check that no worktree has the branch checked out (`checked_out_late` keeps it). Limitation: under a managed campaign the hand's `root_run_id` is the shared Mission root, not the foreman's `run_id`, so a hand reaches S only if some S-owned row carries that run id.

**Command.** `repo-residue-sweep.js close-session --session <sid> [--yes] [--repo <dir>] [--integration-ref <ref>] [--json]`. Without `--yes` it prints the plan and exits 0. For each ledger-owned local branch that still exists (branches without a ledger row are never touched; no age floor):
- keep, with the reason listed: the integration ref; checked out in any worktree; pointed at by a marker worktree that is live, in use (process cwd, or `/proc` unknowable) or under an unexpired lease; campaign signal unreliable (`campaign_signal_unavailable`); a row's or marker's root/run id in an unresolved campaign or Mission (`unresolved_campaign`);
- integrated: `pin-evidence-anchors.js apply`, then delete (`update-ref -d`, as above);
- unintegrated: pin anchors, then delete with the same compare-and-swap `update-ref -d`. No archive ref is written. For each such delete one recovery line goes to stderr: `git branch <branch> <tip>`. It works until `git gc` prunes the now-unreachable commits (about 2 weeks by default). `reap --auto`'s 14-day path still archives, because those are branches of sessions that never finished.

Output: `{schema:"autopilot.close-session/1", session, dry_run, deleted:[{branch,tip,integrated:true|false}], kept:[{branch,why}]}`; there is no `archived` list. Exit 0 when nothing it was asked to remove is left behind except by a keep rule; 1 when something stayed for another reason (`evidence_anchoring_failed`, `tip_changed`, a failed delete, `integration_unverifiable`); 2 for usage or an unreadable ledger.

**Compaction.** `reap --auto` drops ledger rows whose branch no longer exists, rewriting the file atomically under the same lock (`ledger.compacted` in its stdout report). Unparseable lines are kept. A failed compaction is a note in the report, not an error.

Tests: `hooks/tests/close-session.test.sh` (two sessions, foreman-owned hands, dry run, a pre-existing archive ref ignored, no archive ref written, the stderr recovery line, compaction, lock waits, mutants for the ownership rule, the checked-out guard and the lease guard) plus ledger assertions in `dispatch-hetero.test.sh` and `dispatch-foreman.test.sh`.
