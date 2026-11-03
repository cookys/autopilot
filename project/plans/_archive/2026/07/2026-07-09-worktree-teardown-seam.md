# Plan — hetero-worktree teardown seam: reclaim root-owned build artifacts + project-named volumes on dispatch cleanup

> Status: **READY FOR IMPLEMENTATION** — converged through a 4-round heterogeneous loop-review (2026-07-09). **Do NOT collide with the in-flight `dispatch-model-guard` (dmg) work; sequence after dmg merges (append-only CHANGELOG/INDEX overlap only).**
> Owner: authored by depth-0 CEO session (PEACE) FOR the autopilot harness; **execution deferred to the autopilot dev agent.**
> Branch (proposed): `feat/worktree-teardown-seam`
> Sibling-of: `dispatch-model-guard` — shares the `project-config-template/` + `resolve-*.sh` DI idiom; DISJOINT file set (dmg = new PreToolUse hook; this = `scripts/dispatch-hetero.sh` cleanup path).
>
> **Loop-review ledger** (decorrelated disjoint-family panel; `union-on-verified-critical`; converge = all SHIP-AS-IS):
> | Round | codex gpt-5.5 (openai) | GLM-4.6 (zhipu) | MiniMax-M3 (minimax) |
> |---|---|---|---|
> | 1 | FIX (D4 contradiction, gc race) | FIX (path inj, TOCTOU) | FIX (branch-D data-loss, marker) |
> | 2 | 🔴 Critical (POSIX rm ≠ fail-on-busy) | **SHIP** | FIX (branch-D regression, escalation, undeclared var) |
> | 3 | Major (age=0 ⇒ reap-all) | **SHIP** | FIX (flock exit-code, matcher, fd lifetime) |
> | 4 | **SHIP** | **SHIP** | **SHIP** |
> Every finding traced to a numbered section fix (see inline `round-N …` citations). The 🔴 Critical (round-2 codex) — a pid-liveness gate cannot be safe because POSIX `git worktree remove --force` unlinks files under a running process without error — is closed by the per-worktree **flock ownership-handoff** (§2a/§2c).

## 0. Context / thesis

`scripts/dispatch-hetero.sh` isolates every hetero dispatch in a throwaway git worktree created under `TMPDIR` (`mktemp -u -d -t "hetero-<branch>-XXXXXX"`, line 430). On a clean success it removes the worktree; on failure/inspection outcomes it deliberately keeps it. Cleanup today is:

```
git worktree remove --force "$WT" >/dev/null 2>&1     # lines 489 (INT/TERM trap) and 724 (success path)
```

**Two independent leaks, two owners:**

1. **(autopilot-owned) `remove --force` failure is silently swallowed.** `>/dev/null 2>&1` + no exit check. When the worktree contains files the invoking user cannot unlink — the dominant real case: a project whose build runs as **root inside Docker** leaves a **root-owned `target/`** — `git worktree remove` fails, the worktree **orphans in `TMPDIR`**, and nothing is logged or emitted. Observed 2026-07-09 on the PEACE dev box: ~92 GB of orphaned `hetero-*`/`ssw-*` worktrees (each a full ~12 GB `backend/target`); host `/` hit 99%.

2. **(project-owned) per-worktree named Docker volumes are invisible to autopilot.** PEACE's `dev.sh` mounts a named volume `hetero-<branch>_backend_target` for cargo incremental state when building inside the worktree. dispatch-hetero.sh neither creates nor knows about these, so **even a clean worktree removal leaks the volume.** Observed: 12 dangling `hetero-*_backend_target` volumes = 126 GB reclaimable.

**Alternatives considered and rejected** (confirmed sound by round-1 review):
- *Run the whole dispatch as root* → worse: broadens blast radius, breaks file ownership for the operator, still leaks named volumes.
- *Just clean `TMPDIR` on a timer* → cannot unlink root-owned files; and blindly rm-ing `TMPDIR` destroys kept-for-inspection worktrees + unrelated temp state.
- *`git worktree remove` without `--force`* → fails on the (intended) dirty inspection tree; orthogonal to the ownership problem.

Neither leak is PEACE-specific in mechanism: any project that builds as a different uid inside the worktree, or provisions external named resources keyed to the worktree, hits the identical class. The fix belongs at the harness layer as a **DI seam** (autopilot: *when* teardown runs, failure *visibility*, and the *generic* root-owned reclaim; the project: *how* to reclaim its own external resources).

Non-goal: changing the deliberate keep-on-failure policy. This plan makes the removal path robust + extensible, adds a **marker-scoped, liveness-guarded** age reaper, and — per round-1 MiniMax §1/§4 — **splits generic root-owned reclaim (autopilot built-in) from project-external-resource cleanup (DI hook)** so the two concerns aren't conflated.

## 1. File-structure map

| File | Repo | Responsibility |
|------|------|----------------|
| `scripts/dispatch-hetero.sh` | autopilot | (a) write a **marker file** into `$WT` at creation (line ~431); (b) replace the two inline removes (489, 724) with `reap_worktree` (success mode) / a minimal signal-safe path (trap); (c) `--gc` subcommand. |
| `scripts/lib/worktree-reap.sh` | autopilot | NEW sourced lib: `reap_worktree`, `reap_worktree_minimal` (signal-safe), `gc_stale_worktrees`, `_wt_is_live`, `_wt_validate_path`. Keeps dispatch-hetero.sh thin + unit-testable in isolation. |
| `scripts/resolve-worktree-teardown.sh` | autopilot | NEW resolver: `{teardown_hook, stale_reaper_age_days, reaper_scope}` JSON via the standard 4-level precedence chain (mirror `resolve-qc-gate.sh`). Pure, no side effects. |
| `project-config-template/worktree-teardown-config.md` | autopilot | NEW shipped-default DI config (all-off defaults → generic behavior only). |
| `scripts/dispatch-hetero.sh` JSON schema (`emit()`) | autopilot | ADD nullable `orphan_worktree` (path kept because removal failed). |
| `hooks/tests/dispatch-hetero.test.sh` + NEW `hooks/tests/worktree-reap.test.sh` | autopilot | cases enumerated in §3. |
| `CHANGELOG.md` / `docs/projects/INDEX.md` | autopilot | vNEXT entry (note: script seam, **no** hook-count change) + fix-ship row. |
| `.claude/hooks/worktree-teardown.sh` | **PEACE** (separate PR) | project impl of the seam (see §4). |
| `.claude/worktree-teardown-config.md` | **PEACE** | points `teardown_hook` at the above; `stale_reaper_age_days: 3`. |

## 2. Behavior spec (autopilot layer)

### 2a. Worktree creation marker + lifetime lock (enables safe reaping)

At worktree creation (after line 431 succeeds) write `"$WT/.autopilot-worktree"` containing: `created_at=<epoch>`, `branch=<BRANCH>`, `schema=1`. The marker is the **eligibility** token for `--gc` (§2c) — the reaper NEVER keys on the path glob alone (resolves round-1: `*/hetero-*` matches developer-created manual worktrees and misses the observed `ssw-*` class; eligibility = "autopilot wrote this marker", name-independent).

**Ownership lock (round-2 codex 🔴Critical fix).** Immediately after the marker, the dispatch process opens `"$WT/.autopilot-worktree.lock"` on a dedicated fd and holds an **exclusive `flock` for its entire lifetime** (`exec {lockfd}>"$WT/.autopilot-worktree.lock"; flock -x "$lockfd"`). The kernel releases the lock automatically when the process dies — **including crash / SIGKILL**. This lock, NOT a pid check, is the authoritative "is this worktree still owned" signal (see §2c). Rationale: round-2 proved a pid-based liveness gate cannot be safe — POSIX `rm`/`git worktree remove --force` unlink files out from under a running process without error (no Windows-style busy-file protection), so a check→remove window is unguarded unless ownership transfer is *atomic*. `flock -n` acquisition IS that atomic handoff.

> **fd lifetime constraint (round-3 MiniMax §2a).** `flock(2)` is bound to the **open file description**, not the process. The lock therefore tracks the **bash interpreter process** that opened `{lockfd}`, and the plan MUST hold: (a) `{lockfd}` stays open for the whole dispatch — no `exec {lockfd}>&-`, no code path that closes it; (b) the dispatch bash never `exec`-replaces itself (that closes the fd → silent release); (c) a backgrounded **subshell** inherits a dup of the fd but MUST NOT be the sole holder — the parent keeps it open, so a subshell closing its copy does not release. P1 asserts the lock survives a child `docker`/`cargo` invocation and is released only on interpreter exit. Filesystem note: `flock` requires advisory-lock support; `$TMPDIR` on the dev box is local ext4/tmpfs (supported). NFS-backed `TMPDIR` is handled by the exit-code differentiation in §2c.

### 2b. `reap_worktree "$WT"` — removes a worktree; **NEVER deletes a branch**

```
resolve config once (cache in caller scope)
if teardown_hook resolved, validated (§2e), executable:
    timeout 120 "$hook" "$WT"    # ENFORCED via coreutils `timeout`; argv exec; stderr → agent log.
                                 # non-zero/timeout → log "teardown hook failed/timed out", CONTINUE (fail-open)
rm_status = git worktree remove --force "$WT"   # status + stderr CAPTURED (no >/dev/null swallow)
if rm_status != 0 AND [ -d "$WT" ]:
    printf 'WARN: worktree remove failed; orphan kept at %s (%s)\n' "$WT" "$rm_stderr" >&2   # ALWAYS loud
    OUTCOME_ORPHAN="$WT"          # → emit() JSON (§2d); visibility GUARANTEED
else:
    WT=""                         # cleared = fully reclaimed (existing success semantics preserved)
```

- **Branch-ref safety (round-2 MiniMax §2b — fixes a regression v2 introduced).** `reap_worktree` **never** runs `git branch -D`. This preserves the harness's *original* success semantics (dispatch-hetero.sh line 73–74: "worktree removed … **the branch survives for review/merge**"). The only place a branch is deleted is the **INT/TERM abort trap** (§2f), which discards a half-baked branch from an aborted run — unchanged original behavior. v2's `consume`-mode `git branch -D` on success was wrong: it would delete exactly the branch a reviewer needs to merge. Dropped. Net: success path keeps branch; abort trap deletes branch; `--gc` reaper keeps branch. "Branches survive" (§2c) is therefore literally true for every path except the deliberate abort.
- **Fail-open on hook error/timeout**: a broken/slow project hook must NOT brick cleanup — we still attempt the plain remove.
- Called on the success/return path (§2f line 724) and by `--gc` (§2c). NOT called from the signal handler.
- **Orphan propagation contract (round-3 MiniMax §2b).** `reap_worktree` sets the in-band global `OUTCOME_ORPHAN` (empty|path), which `dispatch-hetero.sh`'s existing `emit()` reads when serializing the result JSON — same in-band-global mechanism the script already uses for `OUTCOME_STATUS`/`OUTCOME_COMMIT` (line 129). This is a **different** surface from the signal path's `$ORPHAN_LOG` file (§2f) **by design**: the success path has a live `emit()` to populate a structured field; the abort path has no `emit()` (it `exit 2`s) so it appends to a file the operator/`--gc` can later read. P1 asserts both deterministically (success: `orphan_worktree` field set via forced `WT_RM` failure; abort: path present in `$ORPHAN_LOG`).

### 2c. `--gc` reaper — marker-scoped, liveness-guarded, lock-serialized

`dispatch-hetero.sh --gc` (no dispatch). Standalone: resolves config once at start from `$PWD/.claude/worktree-teardown-config.md` (the repo `--gc` is invoked in) → template default. **Disabled guard (round-3 codex Major):** `[ "$stale_reaper_age_days" -le 0 ] && { log "reaper disabled (stale_reaper_age_days=0)"; exit 0; }` runs FIRST — `0` means *disabled*, not "age threshold 0 ⇒ everything eligible". Without this guard the age arithmetic (`age < 0`) is always false → every marked lock-free tree would be reaped on a default `--gc`; the explicit guard is the only thing that makes `0` mean disabled. Then, **under a global `flock` on `$TMPDIR/.autopilot-gc.lock`** (serializes concurrent `--gc` — second run `flock -n`-skips, no racing enumeration):

```
for WT in $(git worktree list --porcelain | parse paths):
    [ -f "$WT/.autopilot-worktree" ] || continue          # marker gate (§2a) — never touch unmarked/manual worktrees
    # ATOMIC ownership handoff (round-2 codex 🔴Critical): try to grab the dispatch's lifetime lock.
    exec {probe}>"$WT/.autopilot-worktree.lock" 2>/dev/null || { skip+log "nolock-fd"; continue; }
    flock -n "$probe"; frc=$?
    if   [ $frc -eq 1 ]; then exec {probe}>&-; skip+log "live (lock held)"; continue   # EWOULDBLOCK ⇒ dispatch alive
    elif [ $frc -ne 0 ]; then exec {probe}>&-; skip+log "lock-unsupported (frc=$frc)"; continue   # round-3 MiniMax §2c:
        # exit ≥2 = EOPNOTSUPP (NFS w/o lockd) / EROFS / EINVAL — flock is BROKEN here, NOT "held".
        # fail-CLOSED (skip, do NOT reap) + emit a distinct `lock_unsupported` count so the operator sees the FS
        # can't support safe reaping (rather than silently leaking as "live"). A pid-fallback is explicitly NOT
        # used: round-2 proved pid-liveness unsafe; better a visible no-op than an unsafe reap.
    fi
    # frc==0 ⇒ lock ACQUIRED ⇒ owning process is gone ⇒ this tree is exclusively ours; safe to remove.
    age = now - created_at(marker); [ age -lt 0 ] && age=$((stale_reaper_age_days*86400))   # clock-skew → treat eligible
    if [ age -lt stale_reaper_age_days*86400 ]: exec {probe}>&-; skip+log "fresh"; continue
    reap_worktree "$WT"                                    # runs teardown hook + remove; NEVER branch -D (§2b)
    exec {probe}>&-
git worktree prune
emit STRUCTURED JSON: {reaped:[…], skipped_live:n, skipped_fresh:n, kept_orphan:[paths]}   # §2d envelope, NOT a bare text line — downstream can react to kept_orphan
```

- **flock, not pid, is the liveness gate** (round-2 codex 🔴Critical + MiniMax §2c pid false-negative & pid-reuse leak): acquiring the dispatch's lifetime lock (§2a) is atomic proof the owner has exited (kernel released it on death, crash-safe). There is **no check→remove window**: we hold the lock across `reap_worktree`. A pid check would (a) false-negative when a live child's cwd/args don't name `$WT` → destroy a live tree, and (b) false-positive under pid reuse → never reap (permanent leak). flock has neither failure mode.
- **Age source** = marker `created_at`, not filesystem mtime (a long incremental build bumps mtime, masking a stale tree). Clock moved backward → negative age → treated as eligible-by-age (harmless: the lock already proved the tree is dead; reaping a dead tree early is fine).
- **Default `stale_reaper_age_days: 0` = disabled.** Seam ships; age policy is per-project opt-in (destructive-ish: drops an inspection checkout).
- **Marker-lost recovery** (round-2 MiniMax §2a): if the marker file is deleted (manual `rm`, `git clean -fdx`), `--gc` conservatively skips (no eligibility token) — but the worktree is **never truly invisible**: `git worktree list` still tracks it (git's own `.git/worktrees/` metadata is independent of our marker), so the operator can always `git worktree remove --force` by hand; only root-owned files need the teardown hook, runnable manually (`.claude/hooks/worktree-teardown.sh <path>`). Documented recovery: `dispatch-hetero.sh --gc --reap-unmarked` reaps git-tracked worktrees even without a marker, still gated by the same `flock -n` ownership handoff (safe). **Matcher (round-3 MiniMax §2c — blast-radius spec):** eligibility = `git worktree list` path whose **basename** matches the dispatch-creation template `hetero-*` (the `mktemp -t "hetero-<branch>-XXXXXX"` class) — NOT an arbitrary substring. `ssw-*`/other manually-named worktrees are **excluded** (they are operator-created, never autopilot's to reap) and are surfaced in the summary as `skipped_unmatched` so the operator can act on them by hand. `--reap-unmarked` additionally requires `--yes` (it is a recovery escape hatch, not routine). The flock gate still bounds safety even if the matcher over-broadens; the matcher bounds *false positives*.

### 2d. `orphan_worktree` JSON field

`emit()` gains `"orphan_worktree": <path|null>`. Non-null ⇔ removal failed and a dir remains (actionable for the depth-0 orchestrator/foreman). The `--gc` path emits its own **structured envelope** `{reaped:[…], skipped_live:n, skipped_fresh:n, kept_orphan:[paths]}` (round-2 MiniMax §2c — a bare stderr text line can't be consumed programmatically to react to `kept_orphan>0`). **Compat (round-1 glm/MiniMax §2b):** additive key; lenient parsers ignore it, but a strict-schema consumer that rejects unknown keys WOULD break — the autopilot JSON consumers (`resolve-*`, foreman parsers) are all lenient `jq`/field-access, verified in P0; documented in CHANGELOG as an additive schema bump so any third-party strict parser is warned.

### 2e. teardown_hook path + argument hardening (round-1 codex §2d + glm §2a/§4)

- Resolver returns the hook path; before exec, `_wt_validate_path`: resolve to an **absolute** path and require it to be **inside the consuming repo root** (`realpath` prefix check; reject `..` traversal and any outside-repo target — **no override bypass**, round-2 MiniMax §2e: an outside-repo escape hatch that project config could set would be a privilege-escalation vector, so it simply does not exist); require regular + executable; else skip with a warning (fail-open).
- Execute via **argv, never a shell string**: `timeout 120 "$hook" "$WT"`. Reject a `$WT` containing newline/control characters (defensive; branch-name sanitization already restricts, but validate at the boundary).
- The PEACE reference hook (§4) mounts via `--mount=type=bind,source="$WT/backend",target=/b` (not `-v "$WT/backend:/b"`) so a pathological `$WT` cannot break mount parsing.
- **Symlink-only note (round-3 MiniMax §2e):** the `realpath` prefix check resolves symlinks; it intentionally does NOT reason about hardlinks — a within-repo hardlink still resolves to a repo path, and hardlinks cannot cross filesystem boundaries, so there is no escape vector. The check's job is symlink resolution; documenting the scope preempts a "what about hardlinks" review question.

### 2f. Signal-safety (round-1 MiniMax §2a/§3)

The INT/TERM trap (line 489) must stay minimal and re-entrant-safe. `ORPHAN_LOG` is initialized **early, before the trap is armed** (alongside the other top-of-script temp-file vars ~line 104, round-2 MiniMax §2f — otherwise a trap firing before assignment appends to an undefined path and the orphan goes unreported, silently voiding the D4 visibility guarantee). The trap calls **`reap_worktree_minimal`** = `git worktree remove --force "$WT" 2>>log || printf '%s\n' "$WT" >> "$ORPHAN_LOG"`, then `git branch -D "$BRANCH"` (the original abort semantics — discard the half-baked branch of an aborted run; this is the **sole** branch-delete site, §2b), then `exit 2`. It does **NOT** run the project teardown hook (no `docker run` / no 120 s wait inside a signal handler; a second SIGINT during a hook is unsafe). The full `reap_worktree` (with hook) runs only on the normal success/return path (line 724). Trade-off: a SIGINT-interrupted dispatch may leave a root-owned tree → surfaced via `$ORPHAN_LOG`, reclaimable later by `--gc` (its lifetime lock was released when this process exited). Acceptable: correctness > completeness on the abort path.

## 3. Phases

- **P0 — resolver + config template + schema field + marker (size S).** `resolve-worktree-teardown.sh` + template + `emit()` `orphan_worktree` key + marker write at creation. Verify all in-repo JSON consumers are lenient. Unit-test the resolver (override/project/default + garbage-row rejection).
- **P1 — `scripts/lib/worktree-reap.sh` + wire success/trap paths (size S).** `reap_worktree` (consume/keep modes, branch-ref safety), `reap_worktree_minimal` (trap), `_wt_validate_path`, timeout-enforced hook. Re-point 489 (→ minimal) and 724 (→ `reap_worktree … consume`). Tests in NEW `worktree-reap.test.sh` via a `WT_RM` git-seam (**committed**, not "if needed"): stubs `git worktree remove` to force the failure branch → assert loud stderr + `orphan_worktree` set + exit code UNCHANGED; consume deletes branch, keep never does; hook-timeout → fail-open remove.
- **P2 — `--gc` reaper (size Fix).** global-flock serialize + marker gate + **per-worktree `flock -n` ownership handoff** + age-from-marker + structured JSON emit + prune. Tests: marked+aged+lock-free → reaped (branch survives — assert `git rev-parse <branch>` still resolves); marked+lock-held (background holder process) → skipped `live`; unmarked/manual → untouched; fresh → skipped; two concurrent `--gc` → second no-ops under global lock; clock-backward marker → still reaps a lock-free tree; `kept_orphan` count exact in JSON envelope.
- **P3 — release hygiene (size Fix).** CHANGELOG vNEXT (explicit: script seam, **no** hook-count/skill-count change — preempts the inventory gate), INDEX fix-ship row, `preflight-release.sh` green.
- **P4 — PEACE-side impl (separate repo/PR; size Fix). ✅ DONE 2026-07-09, PEACE merge `0a59fa02`** — hook byte-identical to §5 (VERBATIM_OK by diff); e2e on the dev box: incident reproduced (plain remove Permission denied on root-owned target), fresh victim fully reclaimed (dir + named volume, orphan null, branch survives), `--gc` with age-3 config reaped an aged marked tree. `.claude/hooks/worktree-teardown.sh` + config (`stale_reaper_age_days: 3`). E2E: worktree with root-owned `target/` + named volume → dispatch cleanup → both reclaimed, `orphan_worktree: null`; then a kept+aged one → `--gc` reaps it and `feat/*` branch still exists.

Dependency: P0 → P1 → P2 → P3 (autopilot PR). P4 independent, after merge.

## 4. PEACE-side seam implementation (reference; ships in PEACE repo)

`.claude/hooks/worktree-teardown.sh`:
```sh
#!/usr/bin/env bash
# Invoked by autopilot dispatch-hetero as: worktree-teardown.sh <worktree_path>
# PEACE builds as root inside Docker → target/ is root-owned; also uses a named
# cargo-target volume keyed to the worktree basename. Reclaim both (best-effort).
set -euo pipefail
WT="${1:?worktree path required}"
# reject control chars and COMPONENT-level `..` only (round-3 MiniMax §4: a bare `*..*` would refuse a
# legitimate basename like `feat..refactor`). autopilot's §2e _wt_validate_path already validated this path;
# this is defense-in-depth at the project boundary.
case "$WT" in *[!$'\t'-~]*) echo "refusing WT with control chars: $WT" >&2; exit 0;; esac
case "/$WT/" in */../*) echo "refusing WT with .. component: $WT" >&2; exit 0;; esac
base="$(basename "$WT")"
if [ -d "$WT/backend/target" ]; then
  docker run --rm --mount type=bind,source="$WT/backend",target=/b alpine rm -rf /b/target || true
fi
docker volume rm "${base}_backend_target" >/dev/null 2>&1 || true
```
> Note on the split (round-1 MiniMax §1/§4): the root-owned `target/` reclaim is arguably *generic* — a future autopilot built-in could offer an opt-in "root-container rm" fallback so projects needn't hand-roll it. v1 keeps it in the project hook because autopilot cannot assume the project uses Docker (or which image / uid model); the DI hook is the honest place for "I know how MY artifacts are owned". Decision D5 tracks promoting the generic half into the harness later.

## 5. Decision points (for round-2 review)

- **D1 — reaper default** `stale_reaper_age_days: 0` (disabled), per-project opt-in. (proposed: yes.)
- **D2 — teardown hook trust** = same class as existing `verify-cmd` / `resolve-qc-gate` project scripts; no new boundary. (confirm.)
- **D3 — reaper trigger** = explicit `--gc` only for v1; per-dispatch auto-reap deferred to BACKLOG (would need an amortized cheap check to avoid per-dispatch latency — this is what "cheap age check" referred to; NOT a contradiction with §2c, which is the explicit-`--gc` age check). Reworded to remove the round-1 ambiguity.
- **D4 — orphan escalation** = **informational, exit code UNCHANGED**, BUT visibility is *mandatory* (loud stderr WARN + non-null JSON, asserted by tests). Removal failure ≠ dispatch failure (the agent's commit already landed); silence is the bug, not the exit code. (Reconciles round-1 codex Major.)
- **D5 — promote generic root-reclaim into the harness?** Deferred (see §4 note); v1 keeps it project-side. (confirm defer.)

## 6. Coordination / non-collision with dmg

- dmg edit set: `hooks/dispatch-model-guard.js`, `hooks/hooks.json`, `hooks/opt-in-manifest.json`, `project-config-template/dispatch-guard-config.md`, `hooks/tests/dispatch-model-guard.test.sh`. **Zero** overlap with this plan except append-only `CHANGELOG.md`/`INDEX.md` (trivial merge).
- This plan adds **no hook** → does not touch `opt-in-manifest.json` or hook-count inventory (round-1 glm §6 confirmed the assessment).
- Recommend sequencing this PR **after** dmg merges to keep CHANGELOG/INDEX linear.
