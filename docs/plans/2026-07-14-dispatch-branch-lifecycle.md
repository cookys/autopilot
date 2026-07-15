# Plan — Dispatch-branch lifecycle: session-end integration-candidate gate + preserve-first branch reaper + intermediate-round convergence

> Status: DRAFT (pending hetero loop review) · Owner: CEO (depth-0, Fable) · Branch: `feature/dispatch-branch-lifecycle` · Frame: Hold scope
> Source: 2026-07-14 codex-worktree audit (`/home/twgs-dev/reports/2026-07-14-codex-worktree-audit.md`) §5; BACKLOG「Dispatch-branch lifecycle」.

## 0. Context / thesis

The 2026-07-14 audit of TWGameProject's 2026-07-10 codex-orchestrated hetero run found ~70 orphan
branches (O(engines×tasks×rounds)) plus a 46-commit integration candidate
(`ceo-integration-candidate-r1`) that was never merged into develop. Verdict: the structural main
cause is autopilot's — "merge-back + branch GC is owned by depth 0" exists only as prose
(`skills/ceo-agent/references/level-front-door.md` §4/§5, `l4/SKILL.md`), with **no deterministic
backstop**: `dispatch-hetero.sh --gc` / `dispatch-status.js --reap` clean `/tmp` worktrees only,
and `scripts/` contains no repo-branch reaper of any kind. Even a fully obedient orchestrator has
no tool to clean these branches, and nothing blocks a session from ending with an unlanded
integration candidate.

This plan degrades that iron law into deterministic tooling + a gate, per the repo's
`ironlaw-to-gate` methodology: prose responsibility → machine-checkable stopping condition.

## 1. Problem

Depth-0 orchestration runs create three families of repo-local branches —
`ceo-integration-candidate-r<N>` (final integration), `agent/<unit>-r<N>-<date>` (unit
integration), `ceo-<engine>-<task>-r<N>-<date>` (per-engine×task×round intermediates) — and
nothing in the lifecycle (a) forces an explicit merge/keep/discard adjudication of integration
candidates before clean session exit, (b) can reap branches whose content is already contained
elsewhere, or (c) converges superseded intermediate rounds. Result: silent work loss risk (the
most valuable output is the thing that never lands) and unbounded branch accumulation.

## 2. OKR / KRs

**Objective**: TWGameProject-style residue becomes structurally impossible to happen *silently*.

- **KR1 (gate)**: A deterministic check exists — dispatch-owned integration-candidate branches
  ahead of the integration target ⇒ non-zero exit demanding explicit adjudication — and is wired
  into finish-flow L-5.6 and level-front-door §5.
- **KR2 (reaper)**: `scripts/reap-dispatch-branches.sh` exists, preserve-first: contained branches
  are bundled (verified) then deleted; un-contained branches are NEVER deleted, only listed.
- **KR3 (convergence)**: superseded intermediate rounds (`-r<n-1>` with a higher-round sibling of
  the same engine+task+date) have an explicit lifecycle: detectable by `scan`, reapable only via
  opt-in `--reap-superseded` (bundle-first), wired as prose into the front-door integration step.
- **KR4 (quality)**: plan converges through hetero loop review (no open Critical/Major);
  implementation ships with fixture-repo red/green tests; `preflight-portability.sh` passes;
  PATCH version bump + CLAUDE.md/reference/CHANGELOG wiring complete.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Bash + git built-ins only for the new script (dev/CI-time git-artifact glue, never on the agy
  sandbox path); Node not required; jq FORBIDDEN (repo convention: JSON emitted by hand like
  `check-disjointness.sh`).
- The reaper NEVER touches remotes: no `git push`, no `--delete` on origin, local branches only.
- Preserve-first is non-waivable: a branch may be deleted ONLY after `git bundle create` +
  `git bundle verify` both exit 0 for that branch; bundle-verify failure ⇒ branch kept + finding
  reported + exit 1.
- Un-contained AND un-superseded branches are never deleted regardless of flags.
- `check` (the gate) is read-only: it never mutates git state; adjudication is the caller's.
- Exit codes: 0 clean / 1 adjudication-needed-or-violation / 2 usage-or-environment. JSON on
  stdout, diagnostics on stderr.
- No new config file and no new hook in this plan; patterns ship as documented defaults +
  additive `--pattern` flags.
- Branch-name matching MUST be anchored to the dated dispatch grammar (see §4 Phase A); a
  user's hand-made branch that merely resembles it (no date suffix) must not match.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/reap-dispatch-branches.sh` (NEW) | The engine: `scan` (read-only classify+containment JSON) / `check` (session-end gate, exit 1 on unadjudicated candidates) / `reap` (bundle-verify-then-delete contained; `--reap-superseded` opt-in) |
| `hooks/tests/reap-dispatch-branches.test.sh` (NEW) | Fixture-repo red/green: containment, supersession, gate exits, bundle-verify failure path, ack behavior, non-git env |
| `scripts/dispatch-hetero.sh` + `scripts/lib/worktree-reap.sh` | Orphan-log hygiene: `--gc` prunes `$ORPHAN_LOG` entries whose path no longer exists; own-user retry once (append site: `worktree-reap.sh:267-269`) |
| `skills/finish-flow/SKILL.md` | L-5.6 row: add the gate call (`reap-dispatch-branches.sh check`) to the session-end checklist |
| `skills/ceo-agent/references/level-front-door.md` | §4/§5: replace bare `git branch -D` prose with reaper invocations; add the post-integration `--reap-superseded` step |
| `references/hetero-dispatch.md` | New § "Repo-branch lifecycle" — recipe + outcome table for the reaper (sibling of the existing worktree-GC §) |
| `CLAUDE.md` | Scripts inventory row |
| `CHANGELOG.md` + version mirrors | v2.32.37 (PATCH: new script + gate wiring) via `sync-version.js` |
| `platforms/codex/plugin/**` | Payload sync via `sync-codex-plugin-skills.sh` (pre-commit gate enforces) |
| `docs/BACKLOG.md` | Mark the entry shipped at finish |

## 4. Phases

### Phase A — `scan` + `check` (read-only core) · size S
**Steps**:
1. Branch grammar (anchored regex, all require the 8-digit date or `-r<N>` round suffix per family):
   - integration candidate: `^ceo-integration-candidate-r[0-9]+$`
   - unit integration: `^agent/[a-z0-9-]+-r[0-9]+-[0-9]{8}$`
   - intermediate: `^ceo-[a-z0-9]+-[a-z0-9-]+-r[0-9]+-[0-9]{8}$` (engine = first segment;
     task = middle; round + date suffix)
2. `scan [--repo <dir>] [--into <branch>=develop] [--pattern <regex>]...` →
   for each matching local branch: `{name, family, tip, ahead}` (`git rev-list --count
   <into>..<tip>`), `contained_in`: first of [`--into`, every live integration-candidate branch]
   for which `git merge-base --is-ancestor <tip> <target>` holds; `superseded_by`: the
   highest-round live sibling sharing engine+task+date (intermediates and units only).
   Output JSON `{branches:[...], candidates_ahead:[...], reapable:[...], superseded:[...],
   kept:[...]}`; exit 0 (scan never gates).
3. `check` = scan + gate: exit 1 iff ≥1 integration-candidate branch has `ahead>0` AND is not
   acked. Ack mechanism: `check --ack <branch>` appends `<branch> <tip-sha>` to
   `$(git rev-parse --git-common-dir)/autopilot-reap-ack`; an entry suppresses the gate ONLY
   while the tip sha matches (new commits re-arm the gate); entries for deleted branches are
   pruned on each run. Exit 2 on non-git dir / unreadable repo (never silently 0).

**Acceptance**: fixture repo with all three families + a hand-made lookalike branch (`ceo-mybranch`,
no date) → scan classifies exactly the dispatch-owned ones; check exits 1 with an unlanded
candidate, 0 after merge, 0 after ack, 1 again after a new commit on the acked branch.

### Phase B — `reap` (mutating, preserve-first) · size S
**Steps**:
1. `reap [--dry-run] [--yes] [--reap-superseded] [--bundle-dir <dir>]`
   default bundle dir: `$(git rev-parse --git-common-dir)/autopilot-reap-bundles/<UTC-date>/`.
   Without `--yes` behaves as `--dry-run` (prints the would-reap set; exit 0).
2. Eligible set: `reapable` (contained) always; `superseded` only under `--reap-superseded`.
   Per branch, strictly ordered: `git bundle create <dir>/<safe-name>.bundle <branch>` →
   `git bundle verify <bundle>` → only on verify exit 0 → `git branch -D <branch>`.
   Any step non-zero ⇒ keep branch, record `{branch, stage, error}` in JSON `failures[]`,
   final exit 1.
3. JSON output `{reaped:[{branch, bundle}], kept:[...], failures:[...], dry_run:bool}`.
   Never deletes worktree-checked-out branches (`git branch -D` refuses; record as failure —
   the operator reaps the worktree first via the existing worktree GC recipes).

**Acceptance**: fixture: contained branch → bundle exists + `git bundle verify` passes +
branch gone; un-contained branch survives every flag combination; corrupted-bundle simulation
(pre-create unwritable bundle path) → branch kept + exit 1; superseded branch survives default
reap, reaped only with `--reap-superseded`.

### Phase C — wiring + docs · size S
**Steps**:
1. `skills/finish-flow/SKILL.md` L-5.6: add checklist line — run
   `scripts/reap-dispatch-branches.sh check`; exit 1 ⇒ adjudicate each listed candidate
   (merge per L-front-door §4 / keep = `--ack` + handoff note / discard = `reap` after an
   explicit user decision) before the session-end gate may pass.
2. `level-front-door.md` §5: replace the bare `git branch -D <branch>` bullets' surrounding prose
   with the reaper (`reap` for contained, `--reap-superseded --dry-run` preview after each
   integrated round); §4 gains one line: after cherry-pick, the integrated branch is now
   contained ⇒ `reap` clears it.
3. `references/hetero-dispatch.md`: new § "Repo-branch lifecycle (reap-dispatch-branches.sh)"
   with grammar table + outcome table + the preserve-first contract.
4. CLAUDE.md inventory row; CHANGELOG v2.32.37 entry; `sync-version.js --version 2.32.37`;
   `sync-codex-plugin-skills.sh` payload refresh; BACKLOG entry marked shipped.

**Acceptance**: `preflight-portability.sh` + `preflight-release.sh` + pre-commit gates green.

### Phase D — orphan-log hygiene · size Fix
**Steps**: in `dispatch-hetero.sh` `--gc` path (before `gc_stale_worktrees`): rewrite
`$ORPHAN_LOG` keeping only lines whose path still exists; for surviving own-user entries attempt
one `git worktree remove --force` retry (already-armed `_rm` mechanics in
`scripts/lib/worktree-reap.sh`), dropping the line on success. Empty file ⇒ remove it.

**Acceptance**: unit test: log with {nonexistent path, existing own dir} → nonexistent line
pruned; no behavior change when `$ORPHAN_LOG` absent.

**Dependency order**: A → B → C; D independent (may land with C).

## 5. Test / validation

- Script-gated: `hooks/tests/reap-dispatch-branches.test.sh` (fixture repo, ~15 assertions per
  the acceptance lists above; uses `mktemp -d` under `$TMPDIR` per the multi-user-/tmp lesson).
- Script-gated: full `hooks/tests/run.sh` zero regression; `preflight-portability.sh` 17 checks.
- Human-gated: none beyond Board's standing qc — the reaper is never pointed at TWGameProject in
  this plan (user deferred that residue 2026-07-14).
- Dogfood: `scan`/`check` on the autopilot repo itself (expected: zero dispatch-owned branches ⇒
  clean exit 0) recorded in the ship notes.

## 6. Risks + inversion (what would guarantee failure)

| Failure mode | Guard |
|--------------|-------|
| Bundle silently fails → branch deleted → work lost | Strict order create→verify→delete; any non-zero keeps the branch; failure surfaces in JSON + exit 1 (Global Constraint, non-waivable) |
| Pattern over-match nukes a user branch | Anchored dated grammar; lookalike fixture test is a named acceptance case; deletion additionally requires containment/supersession proof |
| Gate nags forever on a deliberately-kept candidate | sha-pinned `--ack` (re-arms on new commits); ack file lives in `.git/`, never committed |
| Gate wired but skippable (prose again) | The gate line lands inside finish-flow L-5.6's checklist (an existing forcing function with per-line pass/fail output), not as a new free-floating paragraph |
| Reaper deletes the branch a worktree sits on | `git branch -D` refuses on checked-out branches; recorded as failure, operator uses existing worktree GC first |
| Fixture tests collide on shared /tmp (known machine gotcha) | `mktemp -d`, no fixed paths (BACKLOG lesson `check-test-integrity-l1` flaky) |
| `check` false-negative when repo has no develop | `--into` missing ref ⇒ exit 2 (environment), never a silent 0 |

## 7. Out of scope (focus as subtraction)

- Executing any cleanup on TWGameProject (user adjudicated: fully deferred 2026-07-14).
- codex-native `spawn_agent` containment (separate BACKLOG entry).
- E1 manifest-compliance merge gate (separate BACKLOG entry).
- `unit-<id>-<run-id>` batch branches — owned by `dispatch-batch.sh` verify/merge-back/abort
  lifecycle; adding a second owner here would create dueling reapers. Documented in the new
  reference § as an explicit non-target.
- Auto-merge of integration candidates (the gate demands adjudication; it never merges).
- A hook enforcing the gate (finish-flow checklist wiring only; hook promotion is a later
  ironlaw-to-gate step once calibrated).

## 8. Open questions (Board)

None blocking — Board delegated pipeline and scope 2026-07-14. (Deliberate default worth
flagging: gate wiring targets L-size finish-flow; S/Fix flows don't run the gate. Rationale:
dispatch-owned branches only arise from /l4-/l6 L-size campaigns.)

## Review log

- R0 (2026-07-14, CEO/Fable): authored per plan-template; self-review pass (scope coverage vs
  BACKLOG entry ✓, no placeholders ✓, dependency map ✓, inversion table ✓).
