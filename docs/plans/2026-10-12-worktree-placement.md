# Worktree placement — one root per repo, a marker that follows the session, predictable handoffs

**Date:** 2026-10-12
**Status:** active — plan-review done; P1–P4 implemented and reviewed, verify done; in code-review (progress: [project README](../projects/2026-10-12-worktree-placement/README.md))
**Size:** L (one deliverable, four phases that build on each other)
**Branch:** `feat/worktree-placement-rule`
**Project:** [`docs/projects/2026-10-12-worktree-placement/`](../projects/2026-10-12-worktree-placement/README.md) — goal and the seven success criteria live there; this plan references them as C1–C7.
**Source:** [`docs/backlog/worktree-and-handoff-placement-has-no-rule.md`](../backlog/worktree-and-handoff-placement-has-no-rule.md) (gaps 1–8).
**Spike:** [`evidence/2026-10-12-worktree-placement/spike-native-worktree.md`](evidence/2026-10-12-worktree-placement/spike-native-worktree.md).
**Direction:** C (owner, decision `intent-17-2`): everything in A, plus the hetero / foreman / batch rails create their worktrees under `<main checkout>/.claude/worktrees/`. No `WorktreeCreate` takeover.

Citations (`file:line`) are provenance, not reading assignments: every fact this plan needs is stated in the text.

Success criteria (from the project README, abridged):
- **C1** a marker created in the main checkout and used from a linked worktree of the same repo measures E1 in that worktree (test red at base).
- **C2** `base_ref` defaults to the newer of `develop` / `origin/develop` (then main/master) (test red at base).
- **C3** `set --new-task` prints one advisory line when worktree directory and branch share no task token, none when they match; exit code unchanged.
- **C4** both handoff routes take their path from one resolver; manual keyed by repo identity, `/clear` stays per worktree with its pinned tests unchanged.
- **C5** hetero, foreman and batch rails create worktrees under `<main checkout>/.claude/worktrees/` (also from a linked worktree) through one resolver; every reaper, the residue registry and `repo-residue-sweep` still reclaim them.
- **C6** no repo-tree walker the rails or gates run from the main checkout descends into `.claude/worktrees/`.
- **C7** the rule is written once in `references/worktree-placement.md`; each backlog gap is marked fixed or deferred.

## 1. Facts this plan stands on

Spike (official docs re-read by depth-0, plus one live run):

- Claude Code's own worktrees default to `<repo>/.claude/worktrees/<name>`; nothing but a `WorktreeCreate` hook moves
  them, and C does not take that over.
- Its periodic sweep **keeps every worktree without its own git-metadata marker**, including any made by
  `git worktree add` — rail worktrees under `.claude/worktrees/` are never swept.
- A plain `claude -p` launched inside a `git worktree add` worktree under `.claude/worktrees/` is **not** isolated
  (live run, 2.1.296: a compound command and a `git -C` into the main checkout both ran). Rail hands keep today's
  command freedom.

Repo survey (Explore subagent, file:line spot-checked where marked ✓):

- All three rails take the caller's toplevel as "the repo": hetero `_wt_repo_root` / `MAIN_CHECKOUT` /
  `IDENTITY_REPO_ROOT` (`scripts/dispatch-hetero.sh:2869`, `:3097`, `:3179`), foreman `MAIN_CHECKOUT`
  (`scripts/dispatch-foreman.sh:195`), batch `REPO="."` (`scripts/dispatch-batch.sh:93`, `--repo` at `:272`). Called
  from a linked worktree, that is the linked worktree, not the main checkout. No helper returns the main checkout
  path today (`scripts/lib/repo-identity.sh:20-30` and `src/status/task-runtime.js:36` return an identity string).
- ✓ `main_checkout_fingerprint` (`scripts/lib/main-checkout-boundary.sh:45-121`) stat-walks the whole
  `$MAIN_CHECKOUT` with `find -xdev`, pruning only `.git` and `MAIN_CHECKOUT_FP_EXCLUDE_PATHS` (`:77-87`); it ignores
  `.gitignore`. A rail worktree created under `$MAIN_CHECKOUT/.claude/worktrees/` after the before-fingerprint
  (hetero `:3106`, foreman `:260`) would end every round as `main_checkout_mutated` (hetero `:4113-4115`, foreman
  `:427-430`). The same walk already sees every other session's worktree under `.claude/worktrees/` today, so a
  rail started from the main checkout while another session edits in its worktree is discarded for an edit that
  never touched the main checkout.
- ✓ `hooks/orchestrator-edit-gate.js:99-107` decides `inRepoRoot` by path containment under `marker.repo_root`
  and grants the dispatch-worktree exemption only when `!inRepoRoot`. A rail worktree under the main checkout's
  `.claude/worktrees/` would lose that exemption when the marker's `repo_root` is the main checkout.
- ✓ Session marker `repo_root` consumers: `scripts/stage-advance.js:236` (E1 git directory),
  `hooks/orchestrator-edit-gate.js:99-107`, `scripts/dispatch-hetero.sh:1004-1013` and `:1469-1478` and
  `scripts/dispatch-author.sh:488` (marker active iff `repo_root` equals the caller's toplevel),
  `scripts/mission-routing-admission.js:187-189` (compares repo identity), `hooks/runs-watch-autostart.js:272-276`
  (plain marker from a cache).
- `check-tmp-residue-registry.js` extracts prefixes only from `mktemp -t <template>`; a `mktemp -u -d
  "$ROOT/hetero-…"` fails it as "unextractable prefix" (`r5`, ~`:118`).
- Registry entries `hetero-*` (`scripts/lib/tmp-residue-registry.json:268`), `batch-integ-*` (`:660`), `foreman-*`
  (`:667`) match the temp root only; `hooks/tests/lib/suite-residue-reap.sh:217` keeps parity with the
  `test-lockgated` kinds (`check-tmp-residue-registry.js:20-21`).
- `scripts/lib/worktree-reap.sh:613` recovers unmarked worktrees by basename `hetero-*` (location-independent:
  it enumerates `git worktree list`). `scripts/reap-dispatch-worktrees.sh` enumerates `git worktree list` and keeps
  state under the common dir — no temp assumption.
- `scripts/repo-residue-sweep.js:644,668` skips a `cwd_busy` worktree under `<main>/.claude/worktrees/` by path.
- `hooks/foreman-guard.js:187-196` (`isTmpSafePath`) allows close-out `rm` only under `/tmp`/`$TMPDIR`.
- The marker/lock excludes are written to the shared `info/exclude` (hetero `:2929-2936`, foreman `:276-279`); a
  consumer repo that does not gitignore `.claude/worktrees/` would show rail worktrees as untracked.
- Tests: `hooks/tests/dispatch-hetero-contract.test.sh:151` counts leaked worktrees with `find "$CASE_TMP"
  -maxdepth 1 -name 'hetero-*'` — vacuous after the move. `dispatch-foreman.test.sh:113` greps `git worktree list`
  (location-agnostic). The rail suites run against sandbox repos that do not ignore `.claude/worktrees/`.
- Walkers: `doc-drift-gate.js` (`:42`, `:77-90`) and `check-stage-vocab.js` (`:68`) already skip
  `.claude/worktrees`; the `git ls-files` users are blind to it; `identifier-scan.js` (`walkDir`, `:99-112`) is not
  (no automatic caller); `project-detect.js:651` unchecked.
- session-mode: `repo_root` is `path.resolve(args['repo-root'] || gitToplevel())` (`scripts/session-mode.js:666`,
  `:766`, `:862`); `--new-task` keeps the old one through `{...current}` (`:800`); `defaultBaseRef` (`:692-705`) takes
  the first of `develop, main, master, origin/develop, origin/main` with a merge-base.
- Handoff: `/clear` hook keys `sha1(realpath toplevel)` (`hooks/session-handoff.js:320`, reader
  `hooks/session-start.js:273-277`, `:488-496`; pinned by `session-handoff.test.sh:28`,
  `session-start-handoff-inject.test.sh:10,31`); the manual fallback is prose
  `~/.autopilot/handoff-manual/<repo-or-cwd-name>.md` (`skills/handoff/SKILL.md:30-36`).

## 2. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Which "main checkout" do rails place under? | The repo's real main checkout: `dirname` of `git rev-parse --path-format=absolute --git-common-dir`, accepted only when that basename is `.git` and the parent is a non-bare work tree. Otherwise (bare repo, separate `--git-dir`) the rail keeps today's temp-dir location and says so on stderr. | One root per repo regardless of where the rail was called from (C's point). The fallback keeps exotic layouts working instead of failing. |
| D2 | What else moves to the real main checkout? | **Only the placement.** `MAIN_CHECKOUT` for the fingerprint, `IDENTITY_REPO_ROOT`, the boundary checks and the `.autopilot-worktree` root keep using the caller's toplevel, as today. | Keeps this task from silently changing what the boundary protects. |
| D3 | Fingerprint vs worktrees under `.claude/worktrees/` | `main_checkout_fingerprint` always prunes `$MAIN_CHECKOUT/.claude/worktrees` in the stat walk — the directory entry itself and everything under it. Creating the directory is not a mutation either: the resolver's `worktree` subcommand runs `mkdir -p <main>/.claude/worktrees` and every rail calls it **before** its before-fingerprint, so the `.claude` entry or mtime change on a first run lands before the snapshot. | Each worktree there is a separate checkout with its own review; the boundary protects the main checkout's files. Pruning only this run's worktree would still trip on every concurrent rail and session (the existing false positive above). Trade-off stated for plan-review: an edit by a hand into a *sibling* worktree is no longer caught by this fingerprint (it never was for siblings in `/tmp`). |
| D4 | Rail worktree names | Keep the prefixes: `hetero-<branch>-XXXXXX`, `foreman-<run_id>-XXXXXX`, `batch-integ-<run_id>-XXXXXX`, now under `<main>/.claude/worktrees/`. | Every basename matcher (`worktree-reap.sh:613`, registry, sweep) keeps working; the directory now says which repo. |
| D5 | Marker for gap 6 | `set` and `set --new-task` re-resolve `repo_root` to the cwd's toplevel when its repo identity equals the marker's; `stage-advance` measures E1 in the cwd's toplevel when its identity equals the marker's, else in `marker.repo_root` as today. | The rail consumers compare `repo_root` to the caller's toplevel; following the session's worktree makes them match where the session works. Identity check keeps a cross-repo cwd from hijacking the marker. |
| D6 | base_ref default (gap 6b) | Pairs in order `develop`/`origin/develop`, `main`/`origin/main`, `master`/`origin/master`. A ref qualifies only when it exists and has a merge-base with `HEAD` (today's filter, kept). The first pair with a qualifying member wins: both qualify → local is ancestor of remote ⇒ remote; remote ancestor of local ⇒ local; diverged ⇒ remote. One qualifies ⇒ that one. No fetch in `session-mode.js`. Behaviour change at base, pinned by a test: with only `origin/develop` and a local `main`, today's flat order picks `main`; D6 picks `origin/develop`. | The remote-tracking ref is the integration target; local ahead is legitimate unpushed work. |
| D7 | `orchestrator-edit-gate` | A target under `<repoRoot>/.claude/worktrees/<name>/` whose `<name>/` holds an `.autopilot-worktree` marker is not `inRepoRoot`, so it is a dispatch worktree: depth-0 is gated there and subagents edit freely, exactly as for a rail worktree in the temp dir today. Without the marker (a native or another session's worktree) it stays `inRepoRoot`, where the `.claude/` allowlist allows it, also as today. *(Corrected at P2: the first draft said "exempt" / "gated"; `decide()` gates depth-0 in a dispatch worktree and allows allowlisted repo paths.)* | Nested worktrees are separate checkouts; without this, D4 moves rail worktrees under the `.claude/` allowlist and depth-0 could edit them inline. |
| D8 | Handoff keying | One resolver prints both paths. Manual fallback: `~/.autopilot/handoff-manual/<basename>-<sha1(repo identity)[0:8]>.md` (one file per repo, shared by its worktrees). `/clear`: unchanged `sha1(realpath toplevel)` (per worktree — its consumer is the next session in the same worktree; keying it per repo would let a parallel session in a sibling worktree consume it). The hook calls the resolver's function instead of computing the hash itself. | Gap 4 is "a session cannot predict where the other route wrote"; one resolver fixes that. The two keys differ on purpose and the reference doc says why. The pinned `/clear` tests stay valid. |
| D9 | Registry gate | Allowlist the three new `mktemp -u -d "$ROOT/…"` lines in `scripts/tmp-residue-allowlist.json` with the reason "under `<main>/.claude/worktrees/`, not the temp root". Keep the three registry entries (old residue still sits in `/tmp`); update their `reason`. | Smallest change; teaching the gate about absolute templates is a mechanism change with no second user yet. |
| D10 | `repo-residue-sweep.js:668` busy-skip | Skip only worktrees **without** an `.autopilot-worktree` marker; rail worktrees keep marker/flock-based liveness. | Liveness of rail worktrees is the flock, not the cwd (memory: residue cleanup traps). |
| D11 | Consumer repos that do not ignore `.claude/worktrees/` | The rails add `/.claude/worktrees/` to the shared `info/exclude` next to the marker excludes. | No untracked noise in the main checkout; no edit to the consumer's tracked `.gitignore`. |
| D12 | Gap 5 (cross-repo dispatch), gap 8 (owner cannot pull from an isolated session) | Deferred. Gap 8: the resolver's `main` subcommand prints the main checkout and how far its branch is behind its upstream, and the reference doc gives the owner line; wiring it into finish-flow is a guidance change (scorecard-first) and becomes a backlog row. | Keeps L bounded. |
| D13 | verify-red-green / test-integrity-L1 scratch worktrees | Stay in temp. | Short-lived, removed by their own script, never handed to a person. |

## 3. Phases

Each phase: red tests first (shown failing at the phase base), then the change, then the affected suites one at a
time (memory: parallel suites interfere). Per-phase hetero code review (quality-pipeline per phase).

### P1 — marker follows the session; fresh base_ref (C1, C2)

1. `hooks/tests/stage-advance.test.sh`: marker created in a sandbox main checkout, linked worktree with N committed
   files on a branch, `stage-advance --to verify` from the worktree ⇒ `files = N`. Red at base (measures the main
   checkout).
2. `hooks/tests/stage-advance.test.sh` (where the `set --new-task` cases already live; `session-mode.test.sh` clones the repo per run): (a) local `develop` behind `origin/develop` ⇒ stored `base_ref` is the remote
   sha; (b) local ahead ⇒ local; (c) diverged ⇒ remote; (d) `set --new-task` from a linked worktree of the same repo
   ⇒ `repo_root` is the worktree; (e) from a different repo ⇒ `repo_root` unchanged; (f) plain `set` (no
   `--new-task`) from a linked worktree ⇒ `repo_root` follows, from a foreign repo ⇒ unchanged; (g) only
   `origin/develop` plus a local `main` ⇒ `origin/develop`; (h) only local `develop` ⇒ `develop`. Red at base for
   a, d, f (linked case), g. P1.1 also gets the negative case: `stage-advance --to verify` from an unrelated sandbox
   repo with repo A's marker measures in `marker.repo_root` and leaves the marker unchanged.
3. Implement D5 in `session-mode.js` (`applyInitFields` / new-task path, reusing the identity function the marker
   already stores) and `stage-advance.js:231-236`; D6 in `defaultBaseRef`.
4. Suites: `session-mode.test.sh`, `session-mode-phase`, `session-mode-watcher`, `session-mode-bind-campaign-root`,
   `stage-advance.test.sh`, `hooks/plain-session-marker.test.js`, `mission-routing-admission.test.sh`.

### P2 — one placement resolver; rails move under `<main>/.claude/worktrees/` (C5, C6)

1. New `scripts/resolve-repo-placement.js` (Node, built-ins only — it runs on rail paths; CLAUDE.md language rule):
   - `main [--from <dir>]` → JSON `{main_checkout, repo_identity, fallback, behind}` (D1, D12).
   - `worktree --prefix <p> --slug <s> [--from <dir>]` → the `mktemp -u` template
     `<main>/.claude/worktrees/<p>-<slug>-XXXXXX`, or the temp-dir template on fallback.
   - `handoff --route manual|clear [--from <dir>]` → the path (D8).
   Exports the same functions for hooks. Test file pins: call from the main checkout, from a linked worktree (same
   answer), bare-repo fallback, two repos with the same basename (different manual paths), two worktrees of one repo
   (same manual path, different `/clear` paths).
0. Before any change: grep the rail and reaper suites for `git status` / `--porcelain` cleanliness assertions on the
   sandbox and record each hit in `docs/plans/evidence/2026-10-12-worktree-placement/moved-assertions.md` with why it
   moves or why D11's exclude keeps it. That file is the list of moved assertions; the red run in step 2 must not
   add one that is not on it.
2. Red first: run `dispatch-hetero-contract.test.sh`, `dispatch-foreman.test.sh`, `dispatch-batch*.test.sh` with the
   rails pointed at the resolver but **without** D3 — expect `main_checkout_mutated`; this is the red that proves D3
   is needed. Repoint `dispatch-hetero-contract.test.sh:151` to `git worktree list` (vacuous otherwise) and add an
   assertion per rail that its worktree sits under `$SBX/.claude/worktrees/`.
3. Implement: the three rails take the template from the resolver (hetero `:2921`, foreman `:268`, batch `:388`),
   each passing `--from` its own resolved repo root (batch `$REPO`, hetero and foreman their caller toplevel) — the
   resolver never falls back to the process cwd when a rail calls it — and calling it before the before-fingerprint
   (D3). Batch test: run from an unrelated cwd with `--repo` at the sandbox ⇒ worktree under the sandbox's
   `.claude/worktrees/`. First-run test per rail: sandbox with no `.claude/` ⇒ round is not `main_checkout_mutated`.
   D3 in `main_checkout_fingerprint`; D11 exclude line; D7 in `orchestrator-edit-gate.js` with two tests (target
   under `<repoRoot>/.claude/worktrees/x/` with a worktree marker ⇒ depth-0 gated as a dispatch worktree; same
   without a marker ⇒ allowed by the `.claude/` allowlist as today); D9 allowlist + registry reason; D10 in `repo-residue-sweep.js` with a test.
4. `foreman-guard.js:187-196`: grep the foreman protocol (`skills/`, `references/`, `scripts/dispatch-foreman.sh`
   brief text) for an `rm` of its own worktree. Found ⇒ allow the run's own worktree path in `isTmpSafePath` with a
   test; not found ⇒ record "no change needed" with the grep.
5. Walkers (C6): enumerate first, reproducibly — a recorded grep over `scripts/`, `hooks/` and `bin/` + `src/` for
   recursive walkers (`find` not scoped to `.git`, `readdirSync`/`readdir` with recursion or `{recursive: true}`,
   recursive globs, `walk` helpers), kept as `walkers.md` in the evidence dir with the command. Each hit is
   dispositioned `skips .claude/worktrees` / `uses git ls-files` / `cannot run from the main checkout (why)` /
   `fixed here (test)`. Known so far: `identifier-scan.js` needs the skip (one test); `project-detect.js:651` to be
   read; doc-drift-gate and check-stage-vocab already skip.
6. Suites, one at a time: the three rail suites, `dispatch-detach`, `dispatch-worktree-lifecycle`,
   `dispatch-hetero-gc`, `worktree-reap`, `repo-residue-sweep`, `repo-residue-auto`, `tmp-residue-registry`,
   `check-tmp-residue-registry`, `suite-residue-reaper`, `prune-tmp-residue`, `orchestrator-edit-gate`,
   `foreman-guard`, `test-doc-drift-gate.sh`.

### P3 — new-task advisory; handoff through the resolver (C3, C4)

1. `session-mode.js set --new-task`: when the cwd is a linked worktree, split its directory name and the current
   branch on `[-_/.]`, lowercase every token, drop generic tokens (`feat`, `fix`, `hotfix`, `worktree`, `agent`,
   `wip`, digits-only). Either filtered set empty ⇒ silent (nothing to compare). Both non-empty and no shared token ⇒
   one stderr line `worktree <dir> is on branch <b>, which shares no word with it — open a fresh worktree for a new
   task (references/worktree-placement.md)`. Exit code unchanged. Tests: match ⇒ silent; no match ⇒ one line; main
   checkout ⇒ silent; `feat-1234` vs `feat/1234` (only generic/digit tokens) ⇒ silent; `Foo-bar` vs `foo-bar` ⇒
   silent; exit code asserted equal in every case.
2. `hooks/session-handoff.js:320` and `hooks/session-start.js` reader take the `/clear` path from the resolver's
   exported function; `session-handoff.test.sh:28` and `session-start-handoff-inject.test.sh` stay green unchanged
   (same hash), which is the proof the key did not move.
3. `skills/handoff/SKILL.md:30-36`: the fallback path line points at `resolve-repo-placement.js handoff --route
   manual` instead of the prose pattern. This changes how the path is found, not what the skill asks for
   (mechanism, CLAUDE.md "機制 vs 指引"); the requirement list is unchanged.
4. Suites, one at a time: `session-mode.test.sh`, `session-handoff.test.sh`, `session-start-handoff-inject.test.sh`,
   the resolver test, `stage-advance.test.sh`.

### P4 — the rule in one place; wiring (C7)

1. `references/worktree-placement.md`: the rule (one root per repo; who creates what where; names; marker follows
   the session; handoff keys and why they differ; fallback; the owner's pull line for gap 8).
2. Backlog file: each gap marked per the table below; a `docs/BACKLOG.md` row for the finish-flow gap-8 line.

   | Gap | Disposition |
   |---|---|
   | 1 two unrelated roots | fixed — P2 (rails under `<main>/.claude/worktrees/`), P4.1 rule |
   | 2 no per-repo grouping | fixed — P2 (the path names the repo's main checkout) |
   | 3 name ↔ branch ↔ task unrelated | fixed as far as this plan goes — P3.1 advisory (never blocks) + P4.1 rule |
   | 4 handoff keying | fixed — P2.1 resolver, P3.2/P3.3 |
   | 5 cross-repo dispatch | deferred — trigger: a session in repo A dispatches a rail at repo B (BACKLOG row) |
   | 6 marker `repo_root` fixed at creation | fixed — P1 (D5) |
   | 6b stale `base_ref` | fixed — P1 (D6) |
   | 7 orphan worktrees not discovered | out of scope — already filed (BACKLOG "Orphan leaf liveness…"); D10 keeps the sweep's `.claude/worktrees/` review flag from catching rail worktrees |
   | 8 owner cannot pull from an isolated session | partly fixed — resolver `main` prints how far behind, P4.1 owner line; finish-flow wiring deferred (BACKLOG row, scorecard-first) |
3. Wiring for the new script (CLAUDE.md four steps): reference doc, `docs/scripts-inventory.md` row, the grouped
   list in `CLAUDE.md` (Worktree & branch lifecycle), and `skills/handoff/SKILL.md` (P3.3).
   `check-claude-md-inventory.js` passes.
4. CHANGELOG `## Unreleased` entry. No version bump (owner: hold the 3.0.0 line).
5. Gates: `check-claude-md-inventory.js`, `check-tmp-residue-registry.js`, `check-reference-sizes.js`,
   `check-plan-graduation.js`, `doc-drift-gate.js`, `check-backlog-entries.js`.

## 4. Verification map

| Criterion | Evidence |
|---|---|
| C1 | P1.1 test red at base, green at head |
| C2 | P1.2 (a) red at base, green at head; (b)(c) green |
| C3 | P3.1 tests; exit code asserted unchanged |
| C4 | P2.1 resolver tests + P3.2 pinned hook tests unchanged |
| C5 | P2.2/P2.3 per-rail location assertions; reaper/registry suites green |
| C6 | P2.5 walker tests or recorded reasons; doc-drift/stage-vocab already skip |
| C7 | P4 reference exists; backlog file matches the P4.2 gap table; P4.5 gates green |
| D3 | P2.2 red (`main_checkout_mutated` without D3) → green; P2.3 first-run test (no `.claude/`) green |
| D7 | P2.3 marked ⇒ depth-0 gated as a dispatch worktree, unmarked ⇒ allowed as today (both directions) |
| D10 | P2.3 sweep test: marked rail worktree not busy-skipped, unmarked one skipped |
| D11 | sandbox `git status --porcelain` empty after a rail run; entries in `moved-assertions.md` (P2.0) |
| P2.4 | `foreman-guard` test for the allowed path, or the recorded grep showing no change is needed |

## 5. Risks

- **D3 weakens nothing the fingerprint covered for `/tmp` siblings, but does stop seeing sibling worktrees under
  `.claude/worktrees/`** — flagged for plan-review.
- Sandbox repos in rail tests do not ignore `.claude/worktrees/`; a test asserting a clean `git status` of the
  sandbox may change. D11's exclude covers it; P2.0 lists them before any change, and the red run must not add one.
- Hetero rail is long and runs detached children that re-declare functions (`main-checkout-boundary.sh:42`): any new
  function the detached child calls must join the `declare -f` list.
- Editing a bash rail while a background run uses it corrupts that run (memory) — no rail dispatch from this
  branch's files while P2 is in progress.
