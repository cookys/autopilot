# Closure-review context — 2026-11-02-oc-a3-writers-use-hippo.md

This plan already passed two review generations. Generation 2's accepted findings were folded into the plan
by the author without being reviewed again. This closure review checks only that fold (and any later
amendment listed below). The full current plan is the plan under review; this file lists what changed.

## Generation-2 findings and how depth-0 disposed of them

### [blocking] A3.4 step 9: scripts/hippo-git-hook.sh
- Disposition: accepted_blocker — A3.4 step 9: in a store repo every commit and merge runs hippo check whatever paths it touches; without hippo pre-commit and pre-merge-commit exit 1; post-merge/post-rewrite always mark when they cannot check; unrelated-commit and non-.hippo merge cases added; KR-A3.4 updated.
- Claim: The git-hook policy explicitly permits commits and merges without hippo check in an initialized store, contrary to R10.

### [non-blocking] A3.2 Rule A exemptions and text-gate fixtures
- Disposition: accepted_nonblocking — A3.2 rule A now judges clauses: exempt only when the verb's object is project-record.js or a hippo read; mixed read/hand-edit fixture exits 1.
- Claim: Rule A's proximity exemption can hide a direct hand-edit instruction merely because the same line mentions a hippo read command.

### [blocking] hooks/tests/lib/hippo-sandbox.sh (A3.1 onward, every suite)
- Disposition: accepted_blocker — C6 now scrubs GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_PREFIX, pins GIT_CONFIG_NOSYSTEM/GIT_CONFIG_GLOBAL/XDG_CONFIG_HOME, and pre-flights rev-parse --show-toplevel per temp repo.
- Claim: The C6 isolation recipe pins HOME, HIPPO_CONFIG_DIR, temp repos, GIT_AUTHOR_*/GIT_COMMITTER_* and HIPPO_ACTOR, but says nothing about git environment inherited from the caller. When a suite runs from inside a git hook (validate.sh or affected-suites under pre-commit/pre-push), GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE, GIT_COMMON_DIR and GIT_OBJECT_DIRECTORY point at this checkout. A 'temp repo' git init/commit, a hippo import, or hippo's self-installed guards then act on this checkout's index, objects and hooks. Separately, an operator-set XDG_CONFIG_HOME or GIT_CONFIG_GLOBAL bypasses the sandbox HOME for global git config. The exit trap only notices this after the damage is done.

### [blocking] scripts/lib/hippo.js spool + flush (A3.1), section 3.3 step contract
- Disposition: accepted_blocker — Section 3.3: spool entries record worktree, branch and target; flush replays only matching entries under an O_EXCL lock with stale-pid recovery; A3.1 adds concurrent-flush and cross-worktree tests, red-checked.
- Claim: Records live as files on git branches, one tree per worktree, but the spool is one directory per git common dir that all worktrees share, and every run in state hippo flushes first. A write spooled in worktree A (lane branch a) is replayed by whichever worktree next runs project-record.js, so it lands on an unrelated branch that may be thrown away, and the record is lost. The idempotency lookup ('hippo list --tag <key> --history') only sees the current branch's history, so a later --key retry from A creates a duplicate. Two concurrent sessions flushing the shared spool both pass the list-then-create check (TOCTOU) and both create. The plan names no flush lock and no branch binding, so KR-A3.4's 'replays every step exactly once' does not hold under worktrees or concurrency.

### [blocking] decision-ledger.js step 6 (A3.4) x project-record.js decision new files mode (A3.1) x dev-flow W20 rule C
- Disposition: accepted_blocker — Ledger is the single owner of one-way decisions: A3.4 step 6 runs only in hippo/hippo-problems/spool, skips rows with source project-record, passes --key from the ledger row id; files-mode decision new marks its row; W20 text updated; tests for one row / one record.
- Claim: The plan gives two writers for the same one-way decision, and they loop in files mode. (a) Files mode: a ledger append with reversibility one-way calls 'project-record.js decision new'. In files mode that call is defined as 'decision-ledger.js append --kind decision', which writes a second ledger row, the A1 telemetry source. If reversibility is forwarded, the two calls recurse. (b) Hippo mode: rule C requires dev-flow to contain 'project-record.js decision new', so the model files the decision, and the ledger append also auto-files it. Neither call carries a shared --key, so each one-way decision gets two decision records. Autopilot code's write path into hippo is therefore not single-writer and not idempotent.

### [blocking] check-backlog-entries.js backlog_frozen (A3.4 step 1) x A3.7 cutover commit order
- Disposition: accepted_blocker — backlog_frozen is per commit (pre-commit staged vs HEAD; pre-push each commit of the push range vs first parent), checked only when the parent tree has repo.toml; notices move into the store commit; a commit deleting repo.toml (rollback) is exempt; controls added.
- Claim: backlog_frozen blocks any diff that changes the backlog, sidecar, ADR or handoff files while .hippo/repo.toml exists, and the plan defines no diff base or exemption. In A3.7, commit 1 creates repo.toml, commit 2 wires pre-push with backlog_frozen, and commit 3 edits exactly those files to add the frozen notice. Pushing the cutover branch therefore fails its own gate. The only way through is --no-verify, a gate bypass on the very cutover that is meant to establish the rule that frozen files are never edited by hand. The rollback path has the same problem: if a partial revert leaves repo.toml in place, refiling with files mode is blocked too.

### [non-blocking] scripts/hippo-git-hook.sh unchecked-merge marker (A3.4 step 9)
- Disposition: accepted_nonblocking — Marker moved to the per-worktree git dir; two-worktree case added.
- Claim: The marker lives in the git common dir, which all worktrees share, and any pre-commit that passes hippo check clears it. A passing check in worktree B therefore clears the marker for an unchecked merge in worktree A, and A's commits that do not touch .hippo/ stop being refused. Pre-push hippo_unavailable and check-on-read limit the exposure, but the marker no longer means what section 3.3 says it means.

### [non-blocking] git hook wiring (A3.4 step 9, A3.7 commit 2)
- Disposition: accepted_nonblocking — post-rewrite chain line added running the post-merge logic; fast-forward covered by post-merge; rebase case added.
- Claim: Only pre-commit, pre-merge-commit and post-merge are wired. Fast-forward merges skip pre-merge-commit, and rebase or 'git pull --rebase' runs no merge hook at all. Records from another session can therefore enter the tree without the 'after merge' check. Hippo-side check-on-read and pre-push hippo_unavailable mostly cover the gap, but the plan does not name rebase as a path.

### [non-blocking] hooks/tests (A3.1 hippo-problems case, A3.4 corrupted-record case) vs C1
- Disposition: accepted_nonblocking — C1 gains a scoped exception for hippo-sandbox.sh fixtures in sandbox temp repos with a tempdir assertion.
- Claim: C1 is copied verbatim into every dispatch and says no autopilot script or shell redirection creates, appends to or rewrites a .hippo/ path. Yet two acceptance cases need the test harness to corrupt a record file under a temp repo's .hippo/. An implementer following C1 literally must refuse these cases, or will quietly treat C1 as advisory.

### [non-blocking] scripts/check-hippo-writer-text.js rule A suppression (A3.2)
- Disposition: accepted_nonblocking — Same fold as the rule A clause change; mixed writer/hand-edit fixture exits 1.
- Claim: Rule A suppresses a finding whenever the line names project-record.js or a hippo read within 80 characters. A sentence that tells the model to edit the backlog file and also mentions project-record.js therefore passes, for example a line saying to update the BACKLOG.md row and then run project-record.js. No fixture covers this mixed case.

### [non-blocking] C8 commit split vs section 3 wiring row and A3.1 step 5
- Disposition: accepted_nonblocking — C8 now puts scripts- and hook-inventory rows in the wiring commit; mechanism commits hold code and tests only.
- Claim: C8 puts 'inventory rows' in the mechanism commit. The section 3 file map and A3.1 step 5 put docs/scripts-inventory.md and the inventory row in the wiring commit. Implementers get conflicting instructions on which commit carries the inventory edit.

### [non-blocking] session-start.js warnings (A3.4 step 8), repo-layout.js mirror exclusion test (A3.7), hippo mode of admit/next-pick/migrate (A3.4 steps 2,4,5)
- Disposition: accepted_nonblocking — A3.4 acceptance adds red-checked min_plugin_version, marker, problems and spool lines and the migrate refusal; A3.7 mirror-exclusion test is red-checked.
- Claim: Several new or changed checks have no stated red-before-green control: the min_plugin_version warning (the main guard against old plugins hitting frozen files), the unchecked-marker and hippo-problems session-start lines, the release-mirror exclusion test that keeps .hippo/ out of the public mirror, and the migrate-backlog-entries refusal in hippo mode.

### [non-blocking] A3.6 headless KR1 cells and committed transcripts
- Disposition: accepted_nonblocking — A3.6 cells run with a deny rule on the credential path; the checker refuses transcripts with the path or token-shaped strings; planted negative control added.
- Claim: The Claude credential sits as a 0600 file in the sandbox HOME of a headless session that has Bash and Read. The transcripts are then committed to the evidence dir. A cell that reads files under HOME would put credential material both in the model's view and in git, and the plan has no scan for this.

### [non-blocking] hooks/hippo-edit-guard.js early exit in store-less repos; hippo ctx.rs init_store
- Disposition: accepted_nonblocking — Added to the P1.4 input list in section 7: once hippo init exists, new/import refuse without repo.toml.
- Claim: The guard exits 0 at once in repos without repo.toml, and in hippo P1.2 the first 'hippo new' or 'import' creates repo.toml implicitly. A model that runs hippo new directly in a consumer repo, outside project-record.js, still creates a store with default id and visibility, which is exactly the implicit store that C4 forbids.

## Diff under review (plan file only)

### git diff b01b94726..36529b8f1 -- docs/plans/2026-11-02-oc-a3-writers-use-hippo.md

```diff
diff --git a/docs/plans/2026-11-02-oc-a3-writers-use-hippo.md b/docs/plans/2026-11-02-oc-a3-writers-use-hippo.md
index 18295e106..ea5cc9c64 100644
--- a/docs/plans/2026-11-02-oc-a3-writers-use-hippo.md
+++ b/docs/plans/2026-11-02-oc-a3-writers-use-hippo.md
@@ -42,6 +42,7 @@ From the hippo repo `develop` (`docs/spec.md` §15.1, `docs/evidence/p1.2/decisi
 | `hippo init` | **not in hippo; new P1.4 input from A3** | today the first `hippo new`/`import` creates `.hippo/repo.toml` itself (`ctx.rs` `init_store`) with `visibility = "internal"` and an id from the directory name; nothing sets `id`/`visibility`, and only a human may hand-edit `repo.toml` (spec §2.1). A3 needs `hippo init --id <id> --visibility public\|internal`, refusing when `repo.toml` exists. **Dependency of A3.3 and A3.7** |
 | codex hook payload (D16, D20) | open in hippo | codex snippet unverified; for codex sessions the pre-commit journal and `body_sha` are the authority (D21) |
 | native Windows run | open in hippo | cross-built only (`make windows-build`); see §3.3, A3.7 |
+| P1.5 distribution | not delivered (added 2026-11-02) | **precondition of A3.7**: no host has `hippo` installed today |
 
 Fleet (D2) delivered (release `5e594f2`): `fleet task open <title...> [--parent] [--pid] [--hippo <ref>]`, `fleet
 task update <id> <progress...>`, `fleet task close <id> [--note]`, `fleet task show|list`, `fleet tasks --mine
@@ -71,7 +72,7 @@ and degrades loudly where it does not; every skill reads through `hippo search/r
 | KR-A3.1 no hand-edit text | `check-hippo-writer-text.js --enforce` exits 0 on the shipped tree: allowlist holds only reasoned read/history mentions; `pending` holds only a held unit's lines (A3.7) and only shrinks; required writers present (rule C). Negative controls (one fixture per target pattern, one file missing a required writer) exit 1; reverting any one migrated W-row hunk turns it red | `hooks/tests/check-hippo-writer-text.test.sh` + red-check transcript in `docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/` |
 | KR-A3.2 KR1 through the skills | On the imported scratch copy, each of the 10 frozen KR1 queries (hippo `bench/kr1-queries.md`) asked of a headless session with the A3 plugin: 10/10 answers pass "Answer contains"; 10/10 transcripts answer via `hippo` and never read the backlog file, `docs/backlog/` or `docs/adr/` | `scripts/check-kr1-skill-route.js` + transcripts, same dir |
 | KR-A3.3 idempotent import | second run appends nothing (`git status --porcelain -- .hippo` empty); every imported record carries `provenance {kind, value, locator}` with the old number as `value`; `hippo check` exits 0 or lists only problems also in the P1.4 evidence | import transcript |
-| KR-A3.4 degrade, never silent | the five §3.3 states behave as specified (files info line; `hippo-problems` prints the offending file; spool warning with count; `session-start` warns on a non-empty spool in any state); flush replays every step exactly once incl. after a crash at each fault point (red-checked); with the store present and hippo absent, no commit or merge touching `.hippo/` passes | `hooks/tests/project-record.test.sh`, `hooks/tests/hippo-git-hook.test.sh` |
+| KR-A3.4 degrade, never silent | the five §3.3 states behave as specified (files info line; `hippo-problems` prints the offending file; spool warning with count; `session-start` warns on a non-empty spool in any state); flush replays every step exactly once incl. after a crash at each fault point (red-checked); with a store present, no commit, merge or rebase skips `hippo check` (hippo absent: refused or marked) | `hooks/tests/project-record.test.sh`, `hooks/tests/hippo-git-hook.test.sh` |
 | KR-A3.5 no counters in git | no A3 path writes a usage count into hippo or a tracked file; closed field list (unknown field exits 2); read commands leave `git status --porcelain` unchanged | `hooks/tests/project-record.test.sh` |
 | KR-A3.6 ON/OFF before ship | each ship unit ships only with A5's report showing ON >= OFF (A3.7) | A5 evidence (`evals/skill-onoff/results/`), cited in the A3.7 merge message |
 
@@ -94,14 +95,14 @@ and degrades loudly where it does not; every skill reads through `hippo search/r
 
 Plan-local constraints (A3; copied verbatim into every A3 dispatch):
 
-- **C1 CLI-only writes.** Nothing writes under `.hippo/` except the `hippo` CLI, including store bootstrap and `.hippo/repo.toml`: no autopilot script, hook, shell redirection or model edit creates, appends to, renames or deletes a `.hippo/` path. autopilot runs the binary with an argv array (no shell string). A missing hippo capability is named as a hippo P1.x dependency, never worked around.
+- **C1 CLI-only writes.** Nothing writes under `.hippo/` except the `hippo` CLI, including store bootstrap and `.hippo/repo.toml`: no autopilot script, hook, shell redirection or model edit creates, appends to, renames or deletes a `.hippo/` path. autopilot runs the binary with an argv array (no shell string). A missing hippo capability is named as a hippo P1.x dependency, never worked around. Sole exception: a `hippo-sandbox.sh` fixture may corrupt a record in a sandbox temp repo after asserting the path is under its tempdir.
 - **C2 no check bypass.** In a checkout with `.hippo/repo.toml`, no commit and no merge skips `hippo check`: without hippo, the guard and git hooks fail closed for `.hippo/` paths; a `hippo check` exit 3 surfaces the offending file unmodified.
 - **C3 no hand-edit text.** Skill, reference, agent and config-template text never tells a model to edit `docs/BACKLOG.md`, `docs/backlog/*`, an ADR file, a `HANDOFF*.md` or a knowledge file, in either store state; writes name `scripts/project-record.js` (which writes the files itself in files mode), reads name `hippo search|related|show|list`.
 - **C4 no implicit store.** `project-record.js` writes through hippo only where `.hippo/repo.toml` exists and never calls `hippo new`/`import` in a repo without one; a store is created only by the operator's `hippo init` (A3.7) or the A3.3 rehearsal in a scratch clone.
 - **C5 counters.** Usage counters never go to git or a hippo field; they go to A1 events or the hub.
-- **C6 isolation.** Every test and rehearsal runs under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos, with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and `HIPPO_ACTOR` set; none targets this checkout (a plugin-directory case uses a temp copy of the plugin tree); each suite asserts on exit that this checkout's `git status --porcelain` and `.hippo/` are unchanged.
+- **C6 isolation.** Every test and rehearsal runs under a sandbox `HOME`, a temp `HIPPO_CONFIG_DIR` and temp git repos, with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and `HIPPO_ACTOR` set and the caller's git env scrubbed (unset `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_PREFIX`; `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=$HOME/.gitconfig`, `XDG_CONFIG_HOME=$HOME/.config`); before any write a pre-flight asserts `git rev-parse --show-toplevel` in each temp repo equals the temp path; none targets this checkout (a plugin-directory case uses a temp copy of the plugin tree); each suite asserts on exit that this checkout's `git status --porcelain` and `.hippo/` are unchanged.
 - **C7 full ids.** hippo ids that leave hippo (fleet `--hippo`, resume lines, `--relates`/`--decides`, spool files) are full 26-character ULIDs; prefixes are display-only.
-- **C8 commit split.** Each phase lands as at least two commits: mechanism (scripts, hooks, tests, inventory rows) and wiring/guidance (CLAUDE.md grouped list, references, README, `sync-codex-plugin-skills.sh` docs, skill text); a mechanism commit never edits requirement text (CLAUDE.md "機制 vs 指引").
+- **C8 commit split.** Each phase lands as at least two commits: mechanism (scripts, hooks, tests only) and wiring/guidance (scripts- and hook-inventory rows, CLAUDE.md grouped list, references, README, `sync-codex-plugin-skills.sh` docs, skill text); a mechanism commit never edits requirement text (CLAUDE.md "機制 vs 指引").
 - **C9 negative controls.** Every new or changed check ships with a negative control shown red before green (`references/evidence-discipline.md` §58).
 - Node >= 20.10, built-ins only, no new npm dependency.
 
@@ -135,7 +136,7 @@ Plan-local constraints (A3; copied verbatim into every A3 dispatch):
 | `scripts/admit-backlog-follow-ups.js`, `check-plan-graduation.js` (check + `--fix`), `next-pick.js`, `migrate-backlog-entries.js`, `decision-ledger.js` | hippo mode (A3.4 steps 2-6) | A3.4 |
 | `scripts/resolve-project-paths.sh`, `resolve-knowledge-routing.sh`, `project-detect.js` | new field `record_store` (`files`/`hippo`/`hippo-problems`/`spool`) | A3.1 |
 | `references/project-memory.md` (new), `references/backlog-entry.md`, `references/knowledge-routing.md`, skills of §3.1 | reader contract, hippo mapping, sinks, migrated text | A3.5 |
-| `.githooks/pre-commit`, `pre-merge-commit`, `post-merge` | one chain line each `sh scripts/hippo-git-hook.sh <name> \|\| exit $?` (D22 foreign-hook policy) | A3.7 |
+| `.githooks/pre-commit`, `pre-merge-commit`, `post-merge`, `post-rewrite` | one chain line each `sh scripts/hippo-git-hook.sh <name> \|\| exit $?` (D22 foreign-hook policy) | A3.7 |
 | `.hippo/`, `.gitattributes`, `.gitignore` | store (operator's `hippo init`, then `hippo import`); guards installed by hippo | A3.7 |
 | `scripts/lib/repo-layout.js` | `.hippo/` registered dev-repo-only so the 3.0.0 release mirror excludes it (§8 Q3) | A3.7 |
 | `.claude/record-store.json` (new) | `{ "min_plugin_version": "<A3 version>" }` for `session-start` | A3.7 |
@@ -172,7 +173,7 @@ legacy target and are checked by rule C. All writes below go through `project-re
 | W17 | `references/knowledge-routing.md:98-101, :123` | `backlog_path` sink = row | sink = `backlog new` |
 | W18 | `references/acceptance-patterns.md:79`, `references/probe-playbook.md:120` | "record + BACKLOG with trigger" | `backlog new` |
 | W19 | `project-config-template/{doc-drift-config.md:67, dev-flow-config.md:21, :52-55, next-config.md:7, project-lifecycle-config.md:8, knowledge-routing-config.md:16, :26, backlog-config.md}` | backlog path knobs | knobs stay (files mode) + "with a hippo store this path is read-only provenance" |
-| W20 | `skills/dev-flow/SKILL.md:44-48` + `decision-ledger.js` | owner-proxy decision -> ledger row (untracked telemetry) | ledger unchanged (A1 source); `reversibility: one-way` rows also `decision new` (A3.4 step 6); dev-flow names it (rule C) |
+| W20 | `skills/dev-flow/SKILL.md:44-48` + `decision-ledger.js` | owner-proxy decision -> ledger row (untracked telemetry) | ledger unchanged (A1 source) and the single owner of one-way decisions (A3.4 step 6); dev-flow says so and names `decision new` only for decisions outside the ledger (rule C) |
 | W21 | `skills/think-tank/SKILL.md`, `skills/think-tank-dialectic/SKILL.md` | verdict only in chat | once accepted: `decision new --title <question -> choice> --rationale-file -` (rule C) |
 
 Readers to move to hippo: `skills/next/SKILL.md:33, :52, :60, :68-73, :91, :123, :131`; handoff Resume; learn Flow 1
@@ -214,13 +215,13 @@ plugin's own install directory. Binary: `$HIPPO_BIN` when set, else `hippo` on `
 | `files` | no `.hippo/repo.toml` | files-mode matrix (A3.1); stderr info `record store: files (no .hippo store in <repo>)` | today's files |
 | `hippo` | store, `hippo --json check` exits 0 | hippo commands (§3.1/§3.2) | `hippo list/search/related/show` |
 | `hippo-problems` | store, `check` exits 3 | through hippo (hippo applies its rules per write); `detect` prints `check`'s offending-file lines unmodified; `session-start` repeats them until `check` exits 0 | as `hippo` + problem lines |
-| `spool` | store, binary missing or exit 5 (unsupported format, lock timeout, no actor) | write saved as `<git common dir>/autopilot/hippo-spool/<ulid>.json` (per clone, never committed); exit 0 with `WARNING record store degraded: <reason>; <n> write(s) spooled; run project-record.js flush once hippo works` | warning; frozen files readable, answers labelled `stale since <import commit>` |
+| `spool` | store, binary missing or exit 5 (unsupported format, lock timeout, no actor) | write saved as `<git common dir>/autopilot/hippo-spool/<ulid>.json` (never committed) with worktree top level, branch and target repo; exit 0 with `WARNING record store degraded: <reason>; <n> write(s) spooled; run project-record.js flush once hippo works` | warning; frozen files readable, answers labelled `stale since <import commit>` |
 | `refused` (per write) | hippo exit 2/3/4 on a write step (usage, rule incl. `leak`, not found) | no spool; error, `hint`, rule printed; step contract applies; exits with hippo's code | — |
 
 Why spool: parent design principle 2 says degrade and warn between our own components and fail closed only on
 credentials, cert pins and `_access`. Failing would lose a lesson or deferred item at session close; editing the
 frozen file would split the truth. Spool is for writes only: validation of existing records is never spooled or
-waived (C2; A3.4 steps 7, 9). Every run in state `hippo`/`hippo-problems` flushes first. `flush` in state `files`
+waived (C2; A3.4 steps 7, 9). Every run in state `hippo`/`hippo-problems` flushes first. Flush replays only entries whose worktree and branch match the current ones (records live per branch; others are listed in the warning, not replayed) and holds an exclusive lock (`O_EXCL` lockfile in the spool dir, stale-pid recovery) across list, create and spool-file removal. `flush` in state `files`
 (store removed, e.g. rollback) exits 2 with `<n> spooled write(s) target a hippo store that no longer exists; see
 the rollback note`, never replays into files, never creates `repo.toml`. `session-start` warns on a non-empty spool
 in any state.
@@ -304,7 +305,7 @@ Steps:
    | `backlog close … done` | peer check, delete row and sidecar (today's Done handling) |
    | `backlog close … cancelled` | peer check, `Status: dropped <date>` in place |
    | `backlog close … superseded --by <ref>` | peer check, delete the row (W14), print `superseded by <ref>` for the commit message |
-   | `decision new` / `decision supersede <old>` | decision-ledger entry only (`decision-ledger.js append --kind decision`, `supersedes: <old>` when superseding; untracked) + info line `record store: files; decision kept in the ledger only` |
+   | `decision new` / `decision supersede <old>` | decision-ledger entry only (`decision-ledger.js append --kind decision --source project-record`, `supersedes: <old>` when superseding; untracked) + info line `record store: files; decision kept in the ledger only` |
    | `adr new` | `<adr dir>/NNNN-<slug>.md` from the template, next free number |
    | `adr supersede <old>` | `adr new` with `Supersedes: ADR-<old>`, old file's status line -> `Superseded by ADR-<new>` |
    | `lesson new` | append to `<knowledge_dir>/<category>.md` + INDEX line (today's format); no `git add -f` (separate asked step) |
@@ -327,7 +328,8 @@ import` of a one-row fixture, P1.2's only store-creating command, until `hippo i
   with hippo, then the harness corrupts one record file (a fixture simulating a hand edit, temp repo only) and
   asserts the file name on stderr;
 - spool: two writes with `HIPPO_BIN` unset and `PATH` without hippo -> 2 spool files + warning; set `HIPPO_BIN`,
-  run once -> 2 records, 0 spool files;
+  run once -> 2 records, 0 spool files; two concurrent flushes of one spool -> exactly one record; an entry spooled
+  in worktree A is not replayed from worktree B (each red-checked by removing the lock / the branch filter);
 - step contract: `PROJECT_RECORD_FAULT=after-create|after-first-link|after-first-child|before-spool-remove` on
   `backlog new` (2 relates), `handoff new` (2 children), `decision supersede`: each rerun (flush or `--key` retry)
   ends with exactly the full set, no duplicate; each red-checked by removing the per-step key or edge lookup;
@@ -348,8 +350,9 @@ scans `skills/**/*.md`, `references/**/*.md`, `agents/**/*.md`, `project-config-
 - **Rule A (hand-edit text)**, case-insensitive: an imperative verb (`add|append|write|record|open|file|create|
   edit|update|delete|remove|replace|move|register|put`) within 80 characters of a target: `BACKLOG(\.md)?`,
   `docs/backlog/`, `(the |project |a |an |to |in |into )backlog\b`, `backlog (row|entry|item|file)`, `docs/adr`,
-  `ADR(\.md| file)`, `HANDOFF(\.md)?`, `\.claude/knowledge/`, `knowledge (file|entry)`. Not a finding: a line
-  naming `project-record.js` or `hippo search|related|show|list|export` within the same 80 characters.
+  `ADR(\.md| file)`, `HANDOFF(\.md)?`, `\.claude/knowledge/`, `knowledge (file|entry)`. Lines split into clauses
+  (`;`, `.`, `then`, `and`); a clause is not a finding only when its verb's object is `project-record.js` or
+  `hippo search|related|show|list|export`, so a mixed line ("run `hippo show`, then edit HANDOFF.md") still is.
 - **Rule B (counters)**: `hippo set` or `project-record.js` with `count|hits|uses|views`.
 - **Rule C (required writers)**: the JSON's `required` list: `skills/dev-flow/SKILL.md`, `skills/think-tank/
   SKILL.md`, `skills/think-tank-dialectic/SKILL.md` must contain `project-record.js decision new` (W20, W21), and
@@ -365,7 +368,8 @@ scans `skills/**/*.md`, `references/**/*.md`, `agents/**/*.md`, `project-config-
   required writer present. `validate.sh` runs report mode from A3.2 and `--enforce` from the A3.7 merge.
 Acceptance (`hooks/tests/check-hippo-writer-text.test.sh`, fixture trees in a tempdir): one fixture per target
 form (incl. W4, W12 wordings) exits 1 in both modes naming file:line; a file missing a required writer exits 1
-under `--enforce`; a "names `project-record.js`" fixture and a clean fixture exit 0; an allowlist addition and a
+under `--enforce`; a "names `project-record.js`" fixture and a clean fixture exit 0, while mixed read/hand-edit and
+writer/hand-edit fixtures exit 1; an allowlist addition and a
 `--repin` to a line that now has a write verb are refused; on the current tree report mode lists exactly the §3.1
 set as `pending` and exits 0, `--enforce` exits 1. Each rule red-checked by deleting it.
 Verify: `bash hooks/tests/check-hippo-writer-text.test.sh`; `node scripts/check-hippo-writer-text.js --enforce
@@ -393,9 +397,11 @@ Acceptance: KR-A3.3 on the scratch copy; transcript and skipped list in the evid
 ### A3.4 — scripts and hook in hippo mode (M)
 
 1. `check-backlog-entries.js --hippo [--target <dir>]`: `backlog-rules.js` over `hippo export --json` (tags,
-   bullets, caps, `bad_trigger_type`, peer rules incl. `peer_closed_unanswered`). `backlog_frozen` (block): any
-   diff changing or adding the backlog file, a sidecar, an ADR or a handoff file while `.hippo/repo.toml` exists,
-   whatever `detect` says. Pre-push passes `--hippo` whenever `repo.toml` exists; without hippo, rules needing
+   bullets, caps, `bad_trigger_type`, peer rules incl. `peer_closed_unanswered`). `backlog_frozen` (block): each
+   commit (pre-commit: staged vs `HEAD`; pre-push: every commit of `<remote sha>..<local sha>`, `origin/develop..`
+   for a new branch, against its first parent) whose parent tree has `.hippo/repo.toml` and that changes or adds
+   the backlog file, a sidecar, an ADR or a handoff file, whatever `detect` says; a commit deleting `repo.toml`
+   (rollback) is exempt. Pre-push passes `--hippo` whenever `repo.toml` exists; without hippo, rules needing
    `export` report `hippo_unavailable` and block. `--reconcile`: every `BL-`/`ADR-` id in the frozen files needs a
    record with that provenance `value`, else `backlog_unimported` (block) naming ids; repair = provenance-keyed
    import of only those ids (P1.4 importer, idempotent, touches no existing record).
@@ -406,8 +412,10 @@ Acceptance: KR-A3.3 on the scratch copy; transcript and skipped list in the evid
 4. `next-pick.js`: `hippo list --kind issue --status open --json --limit 1000`, tags mapped back to
    Effort/Trigger-Type; `backlog_digest` = SHA-256 of `data`.
 5. `migrate-backlog-entries.js`: exits 2 in hippo mode ("the backlog is a hippo store; nothing to migrate").
-6. `decision-ledger.js append --kind decision` with `reversibility: one-way`: then `project-record.js decision new`
-   (ledger row id in the body); a failure warns and never fails the append.
+6. `decision-ledger.js append --kind decision` with `reversibility: one-way`, only when `record_store` is `hippo`,
+   `hippo-problems` or `spool` and the row lacks `source: project-record`: then `project-record.js decision new --key
+   <sha256(ledger row id)[0:16]>` (row id in the body), so a repeat or dev-flow's own call is a no-op; a failure
+   warns and never fails the append.
 7. `hooks/hippo-edit-guard.js` (matcher `Edit|MultiEdit|Write|NotebookEdit|Bash`): exits 0 at once unless the
    target repo (top level of the tool path or Bash cwd) has `.hippo/repo.toml`, so store-less repos never spawn
    hippo. With hippo available: pipe the payload to `hippo hook claude-pretooluse`, return its verdict. Without:
@@ -418,23 +426,28 @@ Acceptance: KR-A3.3 on the scratch copy; transcript and skipped list in the evid
 8. `hooks/session-start.js`: one line each for a non-empty spool (any state, count), `hippo-problems` (offending
    files), an unchecked-merge marker (step 9), a loaded plugin older than `.claude/record-store.json`
    `min_plugin_version`.
-9. `scripts/hippo-git-hook.sh <pre-commit|pre-merge-commit|post-merge>` (POSIX sh). No `repo.toml`: exit 0. Hippo
-   available: `exec hippo hook <name>` (stderr incl. exit-3 offending file passed through, exit code kept). Hippo
-   missing: pre-commit exits 1 (`hippo not found ($HIPPO_BIN / PATH); refusing a commit that touches .hippo/`) when
-   staged paths include `.hippo/` or the unchecked-merge marker exists, else warns and exits 0 (a commit touching
-   no record cannot invalidate the store); pre-merge-commit exits 1 when the merge changes `.hippo/`; post-merge
-   (cannot block), when the merge changed `.hippo/`, writes `<git common dir>/autopilot/hippo-unchecked` with the
-   merge sha and prints an error; the next pre-commit with hippo runs `hippo check` and clears it on exit 0,
-   without hippo every commit is refused while it exists.
+9. `scripts/hippo-git-hook.sh <pre-commit|pre-merge-commit|post-merge|post-rewrite>` (POSIX sh). No `repo.toml`:
+   exit 0. Otherwise every commit and merge is checked, whatever paths it touches (C2). Hippo available: `hippo
+   --json check` (exit 3: offending file passed through, refuse) then `exec hippo hook <name>` (exit code kept).
+   Hippo missing: pre-commit and pre-merge-commit exit 1 (`hippo not found ($HIPPO_BIN / PATH); refusing a commit
+   in a hippo store`); post-merge and post-rewrite (rebase, `pull --rebase`; cannot block) write `<git dir>/autopilot/
+   hippo-unchecked` (per worktree, `git rev-parse --git-dir`) with the sha and print an error whenever they cannot
+   check or the check fails (fast-forwards reach post-merge too); the next pre-commit in that worktree runs
+   `hippo check` and clears it on exit 0, and every commit there is refused while it exists. A host without a
+   working hippo cannot commit in a store repo (accepted cost; writes still spool).
 Acceptance (`backlog-hippo-mode`, `hippo-edit-guard`, `hippo-git-hook` tests + existing suites, all on
 `hippo-sandbox.sh`): each step has a hippo-mode case and an unchanged files-mode case. Negative controls, each
 red-checked by reverting its hunk: bare `hippo close` on an unanswered peer record -> `peer_closed_unanswered`;
-edits to the frozen backlog, an ADR and a handoff file, with hippo present and hidden -> `backlog_frozen`; a row
+edits to the frozen backlog, an ADR and a handoff file after the store commit, with hippo present and hidden ->
+`backlog_frozen`, while the store commit carrying the notices and a commit deleting `repo.toml` pass; a row
 added after import -> `backlog_unimported`; graduation check mode reports an open issue pointing at a shipped plan;
 Edit on `.hippo/ops/x.jsonl`, Bash `echo >> .hippo/ops/x.jsonl` and `sed -i` on a record, with and without hippo ->
-refused; Bash in a repo without `repo.toml` -> allowed, no hippo spawned (spy binary); hippo hidden: commit staging
-`.hippo/` refused, merge changing `.hippo/` refused at pre-merge-commit, post-merge marker then next commit
-refused; hippo present: corrupted record -> pre-commit exit 3 naming the file. Hook inventory and counts updated
+refused; Bash in a repo without `repo.toml` -> allowed, no hippo spawned (spy binary); hippo hidden: a commit
+staging `.hippo/` and one staging only an unrelated file refused, merges changing and not changing `.hippo/`
+refused at pre-merge-commit, fast-forward and rebase write the marker and the next commit is refused, a check in
+worktree B leaves worktree A's marker; hippo present: corrupted record -> pre-commit exit 3 naming the file; one-way ledger append: files mode one ledger
+row, no recursion, hippo mode plus dev-flow's call one decision record; migrate in hippo mode exits 2;
+session-start spool, problems, marker and `min_plugin_version` lines each red-checked by removing their check. Hook inventory and counts updated
 (`scripts/check-hook-inventory.js`, `sync-version.js --hook-count`).
 Verify: `bash hooks/tests/backlog-hippo-mode.test.sh`; `bash hooks/tests/hippo-edit-guard.test.sh`; `bash
 hooks/tests/hippo-git-hook.test.sh`; `node scripts/affected-suites.js --run --files <every file of this phase>`;
@@ -482,10 +495,11 @@ A3.5 plugin via `--plugin-dir`, cwd = the A3.3 scratch copy, one question each,
 Isolation (C6): sandbox `HOME` with no installed plugins or user settings; the Claude credential placed there by an
 operator-run script as a 0600 file, never via chat or a model's view; `HIPPO_CONFIG_DIR` = the A3.3 temp dir. Each
 transcript header records `HOME`, `HIPPO_CONFIG_DIR`, plugin dir and version; the checker refuses a transcript
-lacking them or naming the operator's real `HOME`.
+lacking them, naming the operator's real `HOME`, or containing the credential file path or a token-shaped string;
+cells run with a tool deny rule on the credential path.
 Acceptance: KR-A3.2. Negative control: the same cells with the pre-A3 plugin fail (b);
 `hooks/tests/check-kr1-skill-route.test.sh` (sandbox harness, planted transcripts: grep route, missing id, missing
-header) is red on each.
+header, credential path) is red on each.
 
 ### A3.7 — A5 handoff, ship and cutover (M)
 
@@ -503,15 +517,15 @@ mirror (§8 Q3 = A; until then the cutover waits, and committing the store to to
 operator decision); the operator's go. Commits on a branch from `origin/develop`, in order:
 1. **store**: the operator runs `hippo init --id autopilot --visibility public` at a tty; the depth-0 session never
    runs it in the real checkout (the guard refusing its attempt is expected); depth-0 then runs A3.3 steps 2-4 and
-   commits `.hippo/` + hippo's guard files.
-2. **githooks**: the three chain lines; pre-push -> `check-backlog-entries.js --hippo --reconcile` with
+   commits `.hippo/`, hippo's guard files and the frozen notices (one line atop the backlog file, each ADR and
+   handoff file: "frozen at <commit>; live records are in `.hippo/` (`hippo search`, `project-record.js`). A push
+   refused with `backlog_frozen` came from a session on an older autopilot plugin: update the plugin, then refile
+   each named row with `project-record.js backlog new`."); its parent has no `repo.toml`, so `backlog_frozen` passes.
+2. **githooks**: the four chain lines; pre-push -> `check-backlog-entries.js --hippo --reconcile` with
    `backlog_frozen`; `.hippo/` dev-repo-only in `repo-layout.js` + a test that the release-mirror path list
-   excludes it; `.claude/record-store.json` with this release's version.
-3. **frozen notices** on the backlog file, each ADR and handoff file: "frozen at <commit>; live records are in
-   `.hippo/` (`hippo search`, `project-record.js`). A push refused with `backlog_frozen` came from a session on an
-   older autopilot plugin: update the plugin, then refile each named row with `project-record.js backlog new`."
-4. **guidance**: one commit per shipping unit + `validate.sh` -> `--enforce`.
-5. **version**: PATCH bump + CHANGELOG, same merge.
+   excludes it (red-checked by removing the registration); `.claude/record-store.json` with this release's version.
+3. **guidance**: one commit per shipping unit + `validate.sh` -> `--enforce`.
+4. **version**: PATCH bump + CHANGELOG, same merge.
 Before the merge, re-run the imports (idempotent). The merge's pre-merge-commit and post-merge run `--reconcile`,
 so a row landing in the frozen file after that re-import, or with the merge, blocks or is reported as
 `backlog_unimported`; repair as A3.4 step 1. No whole-file re-import after the freeze (it could overwrite hippo-side
@@ -519,8 +533,10 @@ changes).
 Old plugins: skill text comes from the loaded plugin, not `develop`; hosts working in this repo install the bump as
 part of the cutover; until then `session-start` warns (A3.4 step 8) and `backlog_frozen` at pre-push catches file
 edits, with refile steps in the notice.
+Hippo on every committing host (precondition, checked first): hippo P1.5 ships the binary to every account that commits
+in this repo, native Windows included; `hippo --version` transcript per host in the cutover evidence. One host short = no cutover.
 Windows: `project-record.js where` + one `backlog new` + `flush` on a native Windows host (host from env/config),
-transcript saved; while hippo's native run is open it shows `spool` and the warning, not silence.
+transcript saved; while hippo's native run is open it shows `spool` and the warning, not silence (and commits there are refused).
 Rollback, in order: (1) `hippo list --since <cutover date> --history --json > <evidence dir>/rollback-records.json`
 before the revert; (2) `git revert -m 1 <merge>` (skill text, hooks, gates); (3) the operator refiles the export
 with `project-record.js backlog new` (files mode); (4) spool: `flush` exits 2 in files state, `session-start` keeps
@@ -552,7 +568,7 @@ skill text against a frozen backlog; importer and writer disagreeing; shipping g
 | Hand-edit text survives | text gate rules A/C, per-W-row red-check; allowlist only shrinks |
 | Bare `hippo close`/`set` skips autopilot rules | `check-backlog-entries.js --hippo` at pre-push |
 | `.hippo/` edited by hand or shell | guard (delegates; refuses itself without hippo) + hippo journal/`body_sha` (D21) |
-| hippo missing / Windows | writes spool loudly; validation fails closed for `.hippo/` paths; unchecked-merge marker |
+| hippo missing / Windows | writes spool loudly (branch-bound, locked); commits and merges in a store repo fail closed; per-worktree marker |
 | Bootstrap bypasses the CLI | only the operator's `hippo init` (P1.4 input); guard refuses a session's attempt |
 | Replay duplicates or loses a step; partial write after refusal | step contract (§3.3), fault points per step type |
 | Importer/writer drift | one mapping (§3.2); parity test blocks A3.7 |
@@ -576,7 +592,7 @@ skill text against a frozen backlog; importer and writer disagreeing; shipping g
 - The `/clear` machine-snapshot hook; importing `.claude/knowledge/` (§8 Q2).
 - hippo in repos other than autopilot (each runs A3.3 itself; parent §8 order).
 - Any change to hippo itself; gaps go to hippo as P1.4 inputs (so far: §3.2 mapping incl. `superseded`, handoff
-  `HANDOFF*` filter and `area`, `hippo init --id --visibility`).
+  `HANDOFF*` filter and `area`, `hippo init --id --visibility`; once `init` exists, `new`/`import` refuse without `repo.toml`).
 
 ## 8. Open questions
 
@@ -603,3 +619,8 @@ No open questions remain.
 - R1.1 2026-11-02: size trim for the generation-2 growth limit (constraints labelled C1-C9 and cited instead of
   restated; tables and prose condensed). No requirement, acceptance item, verify command or dependency dropped;
   §2.5 global block, rubric and dispositions untouched.
+- G2 2026-11-02: plan review generation 2 (terminal, at cap) = CONDITIONAL (openai STOP, google READY, anthropic
+  CONDITIONAL); 14 findings, 5 blocking. Depth-0 accepted all 5 blockers; all 9 non-blocking folded, none refuted.
+  Dispositions: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g2-dispositions.json`. Rubric and §2.5 unchanged.
+- Review artifacts: `docs/plans/2026-11-02-oc-a3-writers-use-hippo.g1-artifact.json`, `.g2-artifact.json`. A first g2 dispatch stopped on `plan_growth_hard_stop` (1.506x, zero seats); plan shrunk in b01b94726 and the lock reopened per the dispatch-plan-review.js recipe. Receipt: `check-phase-review-receipt.js --plan-file <plan at b01b94726> --plan-artifact <g2 artifact> --dispositions <g2 dispositions>` exit 0 (2026-11-02). Generation 2 terminal at the cap: sol STOP, argon READY, opus CONDITIONAL; all 5 g2 blockers accepted and folded in 257f0a573 (not seat-reviewed).
+- 2026-11-02 depth-0 addition after the receipt (not seat-reviewed): precondition for A3.7: hippo P1.5 installs `hippo` on every committing host, native Windows included, with a per-host `hippo --version` transcript.

```
