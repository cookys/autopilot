# Plan — Dispatch-branch lifecycle: session-end integration-candidate gate + preserve-first branch reaper + intermediate-round detection/preservation/manual disposition

> Status: CONVERGED (5 external review generations; no open Critical/Major) · Owner: CEO (depth-0, Fable) · Branch: `feature/dispatch-branch-lifecycle` · Frame: Hold scope
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
by the integration target, or (c) surfaces superseded intermediate rounds for manual disposition.
Result: silent work loss risk (the
most valuable output is the thing that never lands) and unbounded branch accumulation.

## 2. OKR / KRs

**Objective**: TWGameProject-style residue becomes structurally impossible to happen *silently*.

- **KR1 (gate)**: A deterministic check exists — dispatch-owned integration-candidate branches
  ahead of the integration target ⇒ non-zero exit demanding explicit adjudication — and is wired
  into finish-flow L-5.6 and level-front-door §5.
- **KR2 (reaper)**: `scripts/reap-dispatch-branches.sh` exists, preserve-first: contained branches
  are bundled (verified) then deleted; un-contained branches are NEVER deleted, only listed.
- **KR3 (convergence)**: superseded intermediate rounds (`-r<n-1>` with a higher-round sibling of
  the same engine+task+date) have an explicit lifecycle: detectable by `scan`, preserved and
  reported by `--reap-superseded` for manual disposition, and wired as prose into the front-door
  integration step. Supersession alone never authorizes automatic deletion.
- **KR4 (quality)**: plan converges through hetero loop review (no open Critical/Major);
  fixture-repo red/green tests pass; diff-scoped gates add zero regression. Board/finish-flow
  adjudicates documented pre-existing portability/full-suite failures; no fake pass.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Bash + git built-ins only for the new script (dev/CI-time git-artifact glue, never on the agy
  sandbox path); Node not required; jq FORBIDDEN (repo convention: JSON emitted by hand like
  `check-disjointness.sh`).
- The reaper NEVER touches remotes: no `git push`, no `--delete` on origin, local branches only.
- Preserve-first is non-waivable: a branch may be deleted ONLY after `git bundle create` +
  `git bundle verify` both exit 0 for that branch; bundle-verify failure ⇒ branch kept + finding
  reported + exit 1.
- Every branch un-contained by the authoritative integration target is preserved regardless of
  supersession or flags; supersession is reporting metadata, never deletion proof.
- `check` (the gate) never mutates refs or worktrees; only explicit `--ack` metadata and
  deterministic stale-ack pruning may write under the git common dir. Adjudication is the caller's.
- Exit codes: 0 clean / 1 adjudication-needed-or-violation / 2 usage-or-environment. Exit 1's
  meaning is per-subcommand and unambiguous at the call site (`check` ⇒ adjudication needed;
  `reap` ⇒ ≥1 failure recorded; `scan` never exits 1); JSON on stdout, diagnostics on stderr.
  (R2: glm Minor)
- No new config file and no new hook in this plan; patterns ship as documented defaults +
  additive, non-empty `--pattern` flags (an empty ERE would match every local branch).
- Branch-name matching MUST be anchored to the dated dispatch grammar (see §4 Phase A); a
  user's hand-made branch that merely resembles it (no date suffix) must not match.
- JSON emission: every dynamic string (branch names, git error messages, paths) passes through
  ONE `json_escape` shell function (backslash, double-quote, and control chars escaped) before
  interpolation, and arrays are emitted through one delimiter-aware join helper — raw `printf`
  of git output or trailing-comma assembly into JSON is forbidden (a git error containing `"`
  must not produce invalid JSON). (R1: agy Major; fresh R2: agy Suggestion)
- Bundle recoverability proof (refines preserve-first): the bundle is created with FULL
  history (positive refs only, never a `<basis>..` range), and deletion additionally requires
  `git bundle list-heads <bundle>` to report `refs/heads/<branch>` at the tip sha recorded at
  scan time; the delete itself is the atomic compare-and-delete
  `git update-ref -d refs/heads/<branch> <recorded-sha>` (fails if the tip moved — no
  re-read/delete race window). Every recorded sha must first match `^[0-9a-f]{40}$`; an empty
  or malformed value is a bundle-stage failure and can never reach `update-ref`. Any
  mismatch/failure ⇒ keep + failure + exit 1. (R1: cc-shim/glm Critical; R2: agy Critical;
  fresh R2: agy Major)

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `scripts/reap-dispatch-branches.sh` (NEW) | The engine: `scan` (read-only classify+containment JSON) / `check` (session-end gate, exit 1 on unadjudicated candidates) / `reap` (bundle-verify-then-delete target-contained branches; `--reap-superseded` reports preserved manual-disposition candidates) |
| `hooks/tests/reap-dispatch-branches.test.sh` (NEW) | Fixture-repo red/green: containment, supersession, gate exits, bundle-verify failure path, ack behavior, non-git env |
| `scripts/dispatch-hetero.sh` + `scripts/lib/worktree-reap.sh` | Orphan-log hygiene: `--gc` prunes `$ORPHAN_LOG` entries whose path no longer exists; own-user retry once (append site: `worktree-reap.sh:267-269`) |
| `skills/finish-flow/SKILL.md` | L-5.6 row: add the gate call (`reap-dispatch-branches.sh check`) to the session-end checklist |
| `skills/ceo-agent/references/level-front-door.md` | §4/§5: replace bare `git branch -D` prose with reaper invocations; add the post-integration `--reap-superseded` report/manual-disposition step |
| `references/hetero-dispatch.md` | New § "Repo-branch lifecycle" — recipe + outcome table for the reaper (sibling of the existing worktree-GC §) |
| `CLAUDE.md` | Scripts inventory row |
| `CHANGELOG.md` + version mirrors | v2.32.37 (PATCH: new script + gate wiring) via `sync-version.js` |
| `platforms/codex/plugin/**` | Payload sync via `sync-codex-plugin-skills.sh` (pre-commit gate enforces) |
| `docs/BACKLOG.md` | Mark the entry shipped at finish |

## 4. Phases

### Phase A — `scan` + `check` (read-only core) · size S
**Steps**:
1. Branch grammar (Bash `[[ ... =~ $regex ]]` ERE held in variables and expanded unquoted,
   never quoted-literal RHS or BRE; anchored, all require the 8-digit date or `-r<N>` round
   suffix per family):
   - integration candidate: `^ceo-integration-candidate-r[0-9]+$`
   - unit integration: `^agent/[a-z0-9-]+-r[0-9]+-[0-9]{8}$`
   - intermediate: `^ceo-[a-z0-9][a-z0-9-]*-r[0-9]+-[0-9]{8}$`
   Classification precedence: candidate → unit → intermediate, first match wins. The
   engine/task split is NOT parsed (engine names may themselves contain hyphens — the split
   is ambiguous by construction); the supersession sibling key is the OPAQUE PREFIX = the
   branch name minus its `-r<N>-<date>` suffix, plus the date. (R2: agy Minor — hyphenated
   engines; agy Major — the unit family has no engine/task segments, its key is the same
   prefix+date rule.)
2. `scan [--repo <dir>] [--into <branch>=develop] [--pattern <regex>]...` →
   for each matching local branch: `{name, family, tip, ahead}` (`git rev-list --count
   <into>..<tip>`), `contained_in`: first the authoritative `--into`, otherwise the first
   canonical maximal live integration-candidate target for which `git merge-base
   --is-ancestor <tip> <target>` holds. Canonical means one survivor per same-tip group
   (highest numeric round, then last refname); maximal means its distinct tip is not an
   ancestor of another canonical candidate tip. Candidate enumeration is deterministic from
   `git for-each-ref --sort=refname`, and the scanned branch itself is excluded (self is never
   evidence of containment). Non-maximal candidates therefore cannot become the sole proof
   behind another branch's `contained_in`. (R1: glm Minor; fresh R3: agy Major)
   Candidate-as-target safety (R2: agy Critical — two candidates at the SAME commit are
   mutually `is-ancestor`, so candidate containment must never become delete authority):
   a same-tip candidate group designates one canonical containment target (numerically highest
   round; tie → last in refname sort), but every candidate remains preserved and gates while it
   is ahead of the authoritative integration target. Only target containment enters `reapable`;
   candidate-to-candidate containment is classification metadata, not deletion proof.
   `superseded_by` (intermediates and units only): a branch is superseded iff ANY live
   sibling with the same prefix+date key has a strictly greater round (the highest such
   sibling is reported — `r2` is superseded by `r4` even when `r3` was already deleted;
   R2: glm Major clarification); round numbers compared NUMERICALLY (strip `r`, parse with
   an explicit `10#` radix so `r08` is valid base-10 — `r10` supersedes `r2`; string and
   implicit-octal comparison are forbidden). (R1: agy Minor; fresh R3: agy Minor)
   Output partition (R2: glm Major): every scanned dispatch-owned branch appears in EXACTLY
   ONE of `reapable[]` / `superseded[]` / `kept[]`; containment takes precedence, so a branch
   that is both contained and superseded is `reapable`, then un-contained superseded →
   `superseded`, else → `kept`;
   `candidates_ahead[]` is an overlay subset (its members also appear in their partition
   bucket); `branches[]` is the full classified list.
   Output JSON `{branches:[...], candidates_ahead:[...], reapable:[...], superseded:[...],
   kept:[...]}`; exit 0 (scan never gates).
3. `check` = scan + gate: exit 1 iff ≥1 integration-candidate branch has `ahead>0` AND is not
   acked; candidate-to-candidate containment does not bypass the gate or enable reaping. Ack
   mechanism: `check --ack
   <branch>` appends `<branch> <tip-sha>` to
   `$(git rev-parse --git-common-dir)/autopilot-reap-ack`; an entry suppresses the gate ONLY
   while the tip sha matches (new commits re-arm the gate). Ack matching is EXACT-FIELD:
   parse each line with `read -r name sha` and compare both fields with full-string equality
   (`[[ "$a" == "$b" ]]`) — substring/prefix matching (grep without anchors) is forbidden, so
   `ceo-integration-candidate-r1` can never satisfy the gate for `...-r11`. (R1: agy Major)
   Prune algorithm (deterministic): on every `check` run the ack file is REWRITTEN keeping
   only entries whose branch still exists (`git rev-parse --verify --quiet
   refs/heads/<name>`) AND whose recorded sha still equals the live tip — a stale (re-armed)
   or deleted-branch entry is dropped; re-acking after new commits is an explicit new `--ack`.
   (R1: cc-shim/glm Critical) Malformed lines (field count ≠ 2, sha not 40-hex) are dropped
   on rewrite with a stderr diagnostic — dropping an ack re-arms the gate, the fail-safe
   direction. (R2: glm Major) The rewrite is atomic (write tmp file in the same dir + `mv`);
   concurrent `check`/`--ack` runs are last-writer-wins, documented as acceptable — the gate
   is a depth-0 single-operator surface, and a lost ack merely re-arms. (R2: agy Minor)
   Exit 2 on non-git dir / unreadable repo (never silently 0).

**Acceptance**: fixture repo with all three families + a hand-made lookalike branch (`ceo-mybranch`,
no date) → scan classifies exactly the dispatch-owned ones; check exits 1 with an unlanded
candidate, 0 after merge, 0 after ack, 1 again after a new commit on the acked branch;
ack for `...-r1` does NOT suppress the gate for a sibling `...-r11` (prefix-collision case);
supersession fixture includes `r2` vs `r10` (numeric-compare case).

### Phase B — `reap` (mutating, preserve-first) · size S
**Steps**:
1. `reap [--dry-run] [--yes] [--reap-superseded] [--bundle-dir <dir>]`
   default bundle dir: `$(git rev-parse --git-common-dir)/autopilot-reap-bundles/<UTC-date>/`,
   created with `mkdir -p` before bundling (missing dir must never fail a create). (R1: agy
   Minor) Without `--yes` behaves as `--dry-run` (prints the would-reap set; exit 0).
2. Eligible set: `reapable` only — branches proven contained by the authoritative integration
   target. `--reap-superseded` adds uncontained superseded branches to the preserved `kept`
   report for manual disposition; it never adds them to the delete/bundle set.
   ONE bundle per run — `<dir>/reap-<UTC-timestamp>-<pid>.bundle` naming both amortizes the
   full-history cost (one pack-sized artifact per run instead of per branch; R2: agy Major)
   and avoids path collisions (R2: glm Minor). Strictly ordered:
   record every eligible branch's tip sha → validate every recorded value against
   `^[0-9a-f]{40}$` (any invalid value aborts the entire bundle stage) → `git bundle create
   <bundle> <ref>...` (ALL
   eligible refs, full history, positive refs only; stderr captured and `json_escape`d into
   `failures[]` on error — R2: glm Minor) → `git bundle verify <bundle>` →
   `git bundle list-heads <bundle>` must report EVERY eligible ref at its recorded sha →
   then per branch capture a complete successful worktree list, re-read exact tip + target
   containment + occupancy immediately around exact-tip compare-delete, and repeat proof /
   occupancy after deletion. On invalidation, exact-ref restoration is only attempted through
   a prepared `git update-ref --stdin` transaction with `option no-deref`; the ref lock is held
   while the raw ref is checked, and a raced direct ref or symref aborts/fails closed rather
   than being overwritten. A restore failure remains a recorded failure; the already-verified
   bundle is the authoritative recovery artifact. Git cannot transact ref and worktree
   metadata together, so no stronger concurrency claim is made.
   On successful ref deletion, remove the local `branch.<name>` config section if present;
   config cleanup failure is reported but never rolls back the already preserved+deleted ref.
   Bundle-stage failure (create/verify/list-heads) ⇒ NOTHING is deleted this run, exit 1.
   Per-branch failure (checked-out / tip moved) ⇒ that branch kept, `{branch, stage, error}`
   in `failures[]`, others proceed, final exit 1. Empty eligible set ⇒ no bundle, exit 0.
3. JSON output `{reaped:[{branch, bundle}], kept:[...], failures:[...], dry_run:bool}` —
   `dry_run` ALWAYS present, `true`/`false`. (R2: glm Minor) A checked-out branch's
   worktree (including a corrupt one still occupying disk) is the worktree-GC/Phase-D
   domain, not this reaper's — the branch is kept and the failure names the worktree path.
   (R2: glm Major, partial — branch-side safety is the pre-check above.)

**Acceptance**: fixture: contained branch → run bundle exists + `git bundle verify` passes +
`list-heads` covers its ref + branch gone; a slash-family branch (`agent/...`) reaps cleanly;
un-contained branch survives every flag combination; same-tip integration candidates both
survive until the authoritative target contains them; bundle-stage failure
simulation (unwritable bundle path) → NOTHING deleted + exit 1; a checked-out branch is kept
with a failure naming the worktree; superseded uncontained branches survive every flag,
`--reap-superseded` reports them in `kept` for manual disposition, and a git error message
containing `"` lands in `failures[]` as valid JSON
(escape case).

### Phase C — wiring + docs · size S
**Steps**:
1. `skills/finish-flow/SKILL.md` L-5.6: add checklist line — run
   `scripts/reap-dispatch-branches.sh check`; exit 1 ⇒ adjudicate each listed candidate
   (identity-preserving merge / keep = `--ack` + handoff / manual discard only after verified
   preservation under human/depth-0 authority) before the gate may pass.
2. `level-front-door.md` §5: replace the bare `git branch -D <branch>` bullets' surrounding prose
   with the reaper (`reap` for contained, `--reap-superseded --dry-run` preview after each
   integrated round); §4 states cherry-pick does not establish ancestry: source stays
   preserved+acked until explicit disposition, while a real merge enables reap.
3. `references/hetero-dispatch.md`: new § "Repo-branch lifecycle (reap-dispatch-branches.sh)"
   with grammar table + outcome table + the preserve-first contract.
4. CLAUDE.md inventory row; CHANGELOG v2.32.37 entry; `sync-version.js --version 2.32.37`;
   `sync-codex-plugin-skills.sh` payload refresh; BACKLOG entry marked shipped.

**Acceptance**: deterministic release/pre-commit gates green; portability is diff-scoped
zero-regression with reproduced base failures recorded PRE_EXISTING DEFERRED.

### Phase D — orphan-log hygiene · size Fix
**Steps**: startup initializes the private state root
`${AUTOPILOT_ORPHAN_STATE_DIR:-${TMPDIR:-/tmp}/autopilot-${UID}}` as an owner-owned mode-0700
real directory. An existing symlink, non-directory, foreign-owned directory, or unsafe mode
fails startup closed with exit 2. In `dispatch-hetero.sh` `--gc` (before
`gc_stale_worktrees`), rewrite `$ORPHAN_LOG`. Writer and rewrite share a lock; the writer records paths only (legacy
interleaved stderr lines remain tolerated and are pruned):
1. A line is a RETRY CANDIDATE iff it is an absolute path (`/...`) to an existing directory;
   every other line (error text, nonexistent path) is pruned on rewrite.
2. For each candidate owned by the current user (`[ -O "$path" ]`), require `$path/.git` to
   be a regular gitfile whose first line starts with `gitdir: ` (linked-worktree identity;
   never let `git -C` traverse upward from an arbitrary or corrupt directory), then derive
   the owning repo from the worktree itself
   (`git -C "$path" rev-parse --git-common-dir`) and canonicalize it without GNU-only
   `realpath`/`readlink -f` by resolving relative output under `$path` in a subshell and using
   Bash `pwd -P`; if underivable (corrupt worktree), keep the line. Require an exact
   `worktree <absolute-path>` record for `$path` in `git -C <owner-repo> worktree list
   --porcelain`; an unregistered path is kept. Only then attempt ONE `git -C <owner-repo>
   worktree remove --force "$path"` (retry stderr goes to /dev/null, never back into the
   log), while continuously holding the same worktree lifetime-flock proof used by normal GC;
   a held or unsafe/unsupported lifetime lock preserves the worktree and log entry. Drop the
   line on success, keep on failure.
3. Non-own-user existing paths are kept verbatim (report-only). Empty file after rewrite ⇒
   remove it.

**Acceptance**: unit test: log with {nonexistent path, error-text line, existing own dir} →
first two pruned, own dir retried (removed ⇒ line dropped); no behavior change when
`$ORPHAN_LOG` absent; retry failure keeps the line and the log gains no new error text;
lifetime-locked orphan retry is preserved; private state is mode 0700 and unsafe state roots
fail closed with exit 2.

**Dependency order**: A → B → C; D independent (may land with C).

## 5. Test / validation

- Script-gated: `hooks/tests/reap-dispatch-branches.test.sh` (fixture repo, ~15 assertions per
  the acceptance lists above; uses `mktemp -d` under `$TMPDIR` per the multi-user-/tmp lesson).
- Script-gated: full suite and portability diff-scoped zero regression; any nonzero group is
  reproduced on immutable base and recorded PRE_EXISTING DEFERRED.
- Human-gated: none beyond Board's standing qc — the reaper is never pointed at TWGameProject in
  this plan (user deferred that residue 2026-07-14).
- Dogfood: `scan`/`check` on the autopilot repo itself (expected: zero dispatch-owned branches ⇒
  clean exit 0) recorded in the ship notes.

## 6. Risks + inversion (what would guarantee failure)

| Failure mode | Guard |
|--------------|-------|
| Bundle silently fails → branch deleted → work lost | Strict order create→verify→delete; any non-zero keeps the branch; failure surfaces in JSON + exit 1 (Global Constraint, non-waivable) |
| Pattern over-match nukes a user branch | Anchored dated grammar; lookalike fixture test is a named acceptance case; deletion additionally requires authoritative-target containment proof |
| Gate nags forever on a deliberately-kept candidate | sha-pinned `--ack` (re-arms on new commits); ack file lives in `.git/`, never committed |
| Gate wired but skippable (prose again) | The gate line lands inside finish-flow L-5.6's checklist (an existing forcing function with per-line pass/fail output), not as a new free-floating paragraph |
| Reaper deletes a checked-out branch | Complete worktree enumeration before/after CAS; occupancy/proof invalidation restores exact ref and names the path |
| Fixture tests collide on shared /tmp (known machine gotcha) | `mktemp -d`, no fixed paths (BACKLOG lesson `check-test-integrity-l1` flaky) |
| `check` false-negative when repo has no develop | `--into` missing ref ⇒ exit 2 (environment), never a silent 0 |
| Ack prefix collision unlocks the wrong branch (`r1` vs `r11`) | Exact-field ack parse (§4 Phase A step 3); named acceptance case |
| Git error text corrupts emitted JSON | Single `json_escape` helper is a Global Constraint; escape case in Phase B acceptance |
| Bundle exists but doesn't actually contain the branch tip (verify-scope gap / TOCTOU) | Full-history-only create + `list-heads` sha match + pre-delete tip re-read (§2.5 recoverability proof) |

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
- R1 (2026-07-14, hetero panel — agy/Gemini 3.5 Flash (High) + cc-shim/glm-4.7, both
  FIX-THEN-SHIP): 2 Critical / 3 Major / 4 Minor, all accepted and folded in:
  - glm Critical (bundle-verify scope): §2.5 recoverability proof — full-history create +
    `list-heads` sha match + pre-delete tip re-read (empirically confirmed `git bundle verify`
    output on a no-basis bundle before adopting).
  - glm Critical (ack prune undefined): Phase A step 3 — deterministic rewrite-on-run
    algorithm.
  - agy Major (JSON escaping): §2.5 `json_escape` constraint + Phase B acceptance case.
  - agy Major (ack prefix collision): Phase A exact-field parse + acceptance case.
  - glm Major (Phase D under-specified): Phase D rewritten with line semantics (empirically
    confirmed the log interleaves stderr — `worktree-reap.sh` `2>>"$ORPHAN_LOG"`), owner-repo
    derivation, own-user rule.
  - agy Minor ×3 (numeric round compare / slash-safe bundle names / `mkdir -p`) + glm Minor
    (contained_in order): folded into Phase A/B steps.
- Fresh R2–R4 (2026-07-15, artifact-only hetero loop; 5 external generations total —
  agy/Gemini 3.5 Flash (High) + cc-shim/glm-4.7): converged with no open Critical/Major.
  - R2: Gemini `FIX-THEN-SHIP` (1 Major / 2 Minor / 2 Suggestions), GLM `SHIP-AS-IS`.
    Accepted malformed recorded-SHA rejection, gitfile validation, ERE/base-10 portability,
    delimiter-aware JSON emission, and the non-reapable-candidate gate scope.
  - R3: Gemini `FIX-THEN-SHIP` (2 Major / 1 Minor / 1 Suggestion); GLM emitted an invalid
    wrapper and was fail-closed as `no_verdict`. Accepted candidate self-target exclusion,
    `gitdir:` validation, explicit radix, and exact owner-worktree registration.
  - R4 (generation cap 5): Gemini `FIX-THEN-SHIP` with only 2 Minor / 4 Suggestions and no
    Critical/Major. Folded contained-before-superseded precedence, portable common-dir
    canonicalization, unquoted ERE variables, exact worktree matching, and branch-config
    cleanup into the plan. CRLF/whitespace stripping was rejected because log paths are
    verbatim records and trimming can change a valid path. Conditional convergence accepted:
    all gate-level findings are resolved; remaining observations are implementation checks.
