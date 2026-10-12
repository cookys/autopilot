# Worktree placement — one root per repo, a marker that follows the session, predictable handoffs

**Date:** 2026-10-12
**Status:** active — plan, awaiting plan-review
**Size:** L (one deliverable, four phases that build on each other)
**Branch:** `feat/worktree-placement-rule`
**Project:** [`docs/projects/2026-10-12-worktree-placement/`](../projects/2026-10-12-worktree-placement/README.md) — goal and the seven success criteria live there; this plan references them as C1–C7.
**Source:** [`docs/backlog/worktree-and-handoff-placement-has-no-rule.md`](../backlog/worktree-and-handoff-placement-has-no-rule.md) (gaps 1–8).
**Spike:** [`evidence/2026-10-12-worktree-placement/spike-native-worktree.md`](evidence/2026-10-12-worktree-placement/spike-native-worktree.md).
**Direction:** C (owner, decision `intent-17-2`): everything in A, plus the hetero / foreman / batch rails create their worktrees under `<main checkout>/.claude/worktrees/`. No `WorktreeCreate` takeover.

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
| D3 | Fingerprint vs worktrees under `.claude/worktrees/` | `main_checkout_fingerprint` always prunes `$MAIN_CHECKOUT/.claude/worktrees` in the stat walk. | Each worktree there is a separate checkout with its own review; the boundary protects the main checkout's files. Pruning only this run's worktree would still trip on every concurrent rail and session (the existing false positive above). Trade-off stated for plan-review: an edit by a hand into a *sibling* worktree is no longer caught by this fingerprint (it never was for siblings in `/tmp`). |
| D4 | Rail worktree names | Keep the prefixes: `hetero-<branch>-XXXXXX`, `foreman-<run_id>-XXXXXX`, `batch-integ-<run_id>-XXXXXX`, now under `<main>/.claude/worktrees/`. | Every basename matcher (`worktree-reap.sh:613`, registry, sweep) keeps working; the directory now says which repo. |
| D5 | Marker for gap 6 | `set` and `set --new-task` re-resolve `repo_root` to the cwd's toplevel when its repo identity equals the marker's; `stage-advance` measures E1 in the cwd's toplevel when its identity equals the marker's, else in `marker.repo_root` as today. | The rail consumers compare `repo_root` to the caller's toplevel; following the session's worktree makes them match where the session works. Identity check keeps a cross-repo cwd from hijacking the marker. |
| D6 | base_ref default (gap 6b) | Per pair (`develop`/`origin/develop`, then `main`/`origin/main`, then `master`): both exist → local is ancestor of remote ⇒ remote; remote ancestor of local ⇒ local; diverged ⇒ remote. One exists ⇒ that one. No fetch in `session-mode.js`. | The remote-tracking ref is the integration target; local ahead is legitimate unpushed work. |
| D7 | `orchestrator-edit-gate` | A target under `<repoRoot>/.claude/worktrees/<name>/` is **not** `inRepoRoot`; the existing `hasWorktreeMarkerAbove` decides as for any dispatch worktree. | Nested worktrees are separate checkouts; without this, D4 removes the dispatch-worktree exemption. |
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
2. `hooks/tests/session-mode.test.sh`: (a) local `develop` behind `origin/develop` ⇒ stored `base_ref` is the remote
   sha; (b) local ahead ⇒ local; (c) diverged ⇒ remote; (d) `set --new-task` from a linked worktree of the same repo
   ⇒ `repo_root` is the worktree; (e) from a different repo ⇒ `repo_root` unchanged. Red at base for a, d.
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
2. Red first: run `dispatch-hetero-contract.test.sh`, `dispatch-foreman.test.sh`, `dispatch-batch*.test.sh` with the
   rails pointed at the resolver but **without** D3 — expect `main_checkout_mutated`; this is the red that proves D3
   is needed. Repoint `dispatch-hetero-contract.test.sh:151` to `git worktree list` (vacuous otherwise) and add an
   assertion per rail that its worktree sits under `$SBX/.claude/worktrees/`.
3. Implement: the three rails take the template from the resolver (hetero `:2921`, foreman `:268`, batch `:388`);
   D3 in `main_checkout_fingerprint`; D11 exclude line; D7 in `orchestrator-edit-gate.js` with a test (target under
   `<repoRoot>/.claude/worktrees/x/` with a worktree marker ⇒ not gated as in-repo); D9 allowlist + registry reason;
   D10 in `repo-residue-sweep.js` with a test.
4. `foreman-guard.js:187-196`: grep the foreman protocol (`skills/`, `references/`, `scripts/dispatch-foreman.sh`
   brief text) for an `rm` of its own worktree. Found ⇒ allow the run's own worktree path in `isTmpSafePath` with a
   test; not found ⇒ record "no change needed" with the grep.
5. Walkers (C6): `identifier-scan.js` skips `.claude/worktrees` (one test); read `project-detect.js:651` and either
   add the skip with a test or record why it cannot reach it.
6. Suites, one at a time: the three rail suites, `dispatch-detach`, `dispatch-worktree-lifecycle`,
   `dispatch-hetero-gc`, `worktree-reap`, `repo-residue-sweep`, `repo-residue-auto`, `tmp-residue-registry`,
   `check-tmp-residue-registry`, `suite-residue-reaper`, `prune-tmp-residue`, `orchestrator-edit-gate`,
   `foreman-guard`, `test-doc-drift-gate.sh`.

### P3 — new-task advisory; handoff through the resolver (C3, C4)

1. `session-mode.js set --new-task`: when the cwd is a linked worktree, split its directory name and the current
   branch on `[-_/.]`, drop generic tokens (`feat`, `fix`, `hotfix`, `worktree`, `agent`, `wip`, digits-only); no
   shared token ⇒ one stderr line `worktree <dir> is on branch <b>, which shares no word with it — open a fresh
   worktree for a new task (references/worktree-placement.md)`. Exit code unchanged. Two-case test (match / no
   match) plus "main checkout ⇒ silent".
2. `hooks/session-handoff.js:320` and `hooks/session-start.js` reader take the `/clear` path from the resolver's
   exported function; `session-handoff.test.sh:28` and `session-start-handoff-inject.test.sh` stay green unchanged
   (same hash), which is the proof the key did not move.
3. `skills/handoff/SKILL.md:30-36`: the fallback path line points at `resolve-repo-placement.js handoff --route
   manual` instead of the prose pattern. This changes how the path is found, not what the skill asks for
   (mechanism, CLAUDE.md "機制 vs 指引"); the requirement list is unchanged.

### P4 — the rule in one place; wiring (C7)

1. `references/worktree-placement.md`: the rule (one root per repo; who creates what where; names; marker follows
   the session; handoff keys and why they differ; fallback; the owner's pull line for gap 8).
2. Backlog file: each gap marked fixed (with the phase) or deferred (5, 8-wiring) with a trigger; a `docs/BACKLOG.md`
   row for the finish-flow gap-8 line.
3. Wiring for the new script (CLAUDE.md four steps): reference doc, `docs/scripts-inventory.md` row, the grouped
   list in `CLAUDE.md` (Worktree & branch lifecycle), and `skills/handoff/SKILL.md` (P3.3).
   `check-claude-md-inventory.js` passes.
4. CHANGELOG `## Unreleased` entry. No version bump (owner: hold the 3.0.0 line).

## 4. Verification map

| Criterion | Evidence |
|---|---|
| C1 | P1.1 test red at base, green at head |
| C2 | P1.2 (a) red at base, green at head; (b)(c) green |
| C3 | P3.1 tests; exit code asserted unchanged |
| C4 | P2.1 resolver tests + P3.2 pinned hook tests unchanged |
| C5 | P2.2/P2.3 per-rail location assertions; reaper/registry suites green |
| C6 | P2.5 walker tests or recorded reasons; doc-drift/stage-vocab already skip |
| C7 | P4 reference exists; backlog file gap dispositions; inventory gate green |

## 5. Risks

- **D3 weakens nothing the fingerprint covered for `/tmp` siblings, but does stop seeing sibling worktrees under
  `.claude/worktrees/`** — flagged for plan-review.
- Sandbox repos in rail tests do not ignore `.claude/worktrees/`; a test asserting a clean `git status` of the
  sandbox may change. D11's exclude covers it; P2.2's red run shows which tests are affected before assertions move.
- Hetero rail is long and runs detached children that re-declare functions (`main-checkout-boundary.sh:42`): any new
  function the detached child calls must join the `declare -f` list.
- Editing a bash rail while a background run uses it corrupts that run (memory) — no rail dispatch from this
  branch's files while P2 is in progress.
