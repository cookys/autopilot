#!/usr/bin/env bash
# worktree-reap.sh — sourced lib for dispatch-hetero worktree teardown seam.
#
# Provides: reap_worktree, reap_worktree_minimal, gc_stale_worktrees,
#           _wt_is_live, _wt_validate_path
#
# Contract (locked by docs/plans/2026-07-09-worktree-teardown-seam.md):
#   - reap_worktree / --gc NEVER run git branch -D (abort trap is sole site)
#   - liveness = flock -n on $WT/.autopilot-worktree.lock (no pid checks)
#   - fail-open on teardown_hook error/timeout
#   - age from marker created_at (never mtime); negative age → eligible
#   - stale_reaper_age_days <= 0 → --gc disabled (before any enumeration)
#
# Test seam: WT_RM — if set, invoked as `"$WT_RM" worktree remove --force "$wt"`
# instead of `git worktree remove --force "$wt"`.
#
# shellcheck shell=bash

# --- internals ----------------------------------------------------------------

# _wt_git_worktree_remove <path>
# Capture stderr+status of worktree remove. Uses WT_RM test seam when set.
_wt_git_worktree_remove() {
  local wt="$1"
  local out rc
  if [ -n "${WT_RM:-}" ]; then
    out=$("$WT_RM" worktree remove --force "$wt" 2>&1); rc=$?
  else
    out=$(git worktree remove --force "$wt" 2>&1); rc=$?
  fi
  printf '%s' "$out"
  return "$rc"
}

# _wt_read_marker_created_at <marker-file>
# Prints created_at epoch or empty on failure.
_wt_read_marker_created_at() {
  local marker="$1" val=""
  [ -f "$marker" ] || return 1
  val="$(grep -E '^created_at=' "$marker" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [[ "$val" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$val"
  return 0
}

# _wt_has_control_chars <string> → 0 if has control chars
_wt_has_control_chars() {
  case "$1" in
    *[[:cntrl:]]*) return 0 ;;
    *) return 1 ;;
  esac
}

# _wt_json_escape <string>
_wt_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '
}

# _wt_resolve_repo_root
# Prefer git top-level of $PWD; fall back to $PWD.
_wt_resolve_repo_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || root=""
  if [ -z "$root" ]; then
    root="$(pwd -P 2>/dev/null || pwd)"
  fi
  printf '%s' "$root"
}

# --- _wt_validate_path --------------------------------------------------------
# Validate teardown_hook path: realpath-resolve inside repo root, regular file,
# executable. Prints absolute path on success (stdout); returns 0.
# On failure: warning on stderr, return 1 (fail-open caller skips hook).
# $1 = hook path (may be relative); $2 = optional repo root (default: git toplevel).
_wt_validate_path() {
  local hook="$1"
  local repo_root="${2:-}"
  local abs hook_real root_real

  if [ -z "$hook" ]; then
    return 1
  fi
  if _wt_has_control_chars "$hook"; then
    printf 'WARN: teardown_hook path contains control characters; skipping hook\n' >&2
    return 1
  fi

  if [ -z "$repo_root" ]; then
    repo_root="$(_wt_resolve_repo_root)"
  fi

  # Resolve relative hooks against the consuming repo root.
  case "$hook" in
    /*) abs="$hook" ;;
    *) abs="$repo_root/$hook" ;;
  esac

  if ! hook_real="$(realpath -e "$abs" 2>/dev/null)"; then
    printf 'WARN: teardown_hook not resolvable (missing?): %s; skipping hook\n' "$hook" >&2
    return 1
  fi
  if ! root_real="$(realpath -e "$repo_root" 2>/dev/null)"; then
    printf 'WARN: cannot realpath repo root %s; skipping hook\n' "$repo_root" >&2
    return 1
  fi

  # Must be inside repo root (prefix check on resolved paths). No outside-repo override.
  case "$hook_real" in
    "$root_real"|"$root_real"/*) ;;
    *)
      printf 'WARN: teardown_hook %s resolves outside repo root %s; skipping hook\n' \
        "$hook_real" "$root_real" >&2
      return 1
      ;;
  esac

  # -f follows symlinks; require ultimate target is a regular file + executable.
  if [ ! -f "$hook_real" ]; then
    printf 'WARN: teardown_hook is not a regular file: %s; skipping hook\n' "$hook_real" >&2
    return 1
  fi
  if [ ! -x "$hook_real" ]; then
    printf 'WARN: teardown_hook is not executable: %s; skipping hook\n' "$hook_real" >&2
    return 1
  fi

  printf '%s' "$hook_real"
  return 0
}

# --- _wt_is_live --------------------------------------------------------------
# Atomic ownership probe via flock -n on $WT/.autopilot-worktree.lock.
# Side effect on "owned" (dead owner): sets _WT_PROBE_FD to the held probe fd
# (caller must close via `exec {_WT_PROBE_FD}>&-` after reap).
#
# Return codes:
#   0  lock acquired (not live — safe to reap); _WT_PROBE_FD set
#   1  live (lock held by another process)
#   2  lock unsupported / open failed (fail-closed: do NOT reap)
_wt_is_live() {
  local wt="$1"
  local lock="$wt/.autopilot-worktree.lock"
  local frc probe

  _WT_PROBE_FD=""
  if [ ! -e "$lock" ]; then
    # No lock file — treat as lock-openable: create and try exclusive.
    # If we can't open, fail-closed.
    :
  fi

  # Open (create if missing) on a dedicated fd.
  exec {probe}>"$lock" 2>/dev/null || return 2
  flock -n "$probe"
  frc=$?
  if [ "$frc" -eq 0 ]; then
    _WT_PROBE_FD="$probe"
    return 0
  fi
  # Did not acquire — close probe fd.
  exec {probe}>&- 2>/dev/null || true
  if [ "$frc" -eq 1 ]; then
    return 1   # EWOULDBLOCK — live
  fi
  return 2     # ≥2 — lock unsupported
}

# --- config cache helpers -----------------------------------------------------
# Cache resolved teardown config in caller scope (TEARDOWN_HOOK, STALE_REAPER_AGE_DAYS,
# REAPER_SCOPE, TEARDOWN_CONFIG_LOADED). Resolve once via resolve-worktree-teardown.sh.
_wt_ensure_config() {
  if [ "${TEARDOWN_CONFIG_LOADED:-0}" = "1" ]; then
    return 0
  fi
  local resolver self_dir json
  # Prefer SELF_DIR from dispatch-hetero when sourced there; else derive from this lib path.
  if [ -n "${SELF_DIR:-}" ]; then
    resolver="$SELF_DIR/resolve-worktree-teardown.sh"
  else
    self_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
    resolver="$self_dir/resolve-worktree-teardown.sh"
  fi
  TEARDOWN_HOOK=""
  STALE_REAPER_AGE_DAYS=0
  REAPER_SCOPE="marker-only"
  if [ -r "$resolver" ]; then
    json="$(bash "$resolver" 2>/dev/null)" || json=""
    if [ -n "$json" ]; then
      TEARDOWN_HOOK="$(printf '%s' "$json" | sed -n 's/.*"teardown_hook"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
      STALE_REAPER_AGE_DAYS="$(printf '%s' "$json" | sed -n 's/.*"stale_reaper_age_days"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
      REAPER_SCOPE="$(printf '%s' "$json" | sed -n 's/.*"reaper_scope"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    fi
  fi
  [[ "$STALE_REAPER_AGE_DAYS" =~ ^[0-9]+$ ]] || STALE_REAPER_AGE_DAYS=0
  [ -n "$REAPER_SCOPE" ] || REAPER_SCOPE="marker-only"
  TEARDOWN_CONFIG_LOADED=1
}

# --- reap_worktree ------------------------------------------------------------
# Full teardown: optional project hook + git worktree remove --force.
# NEVER deletes a branch. Sets OUTCOME_ORPHAN (empty|path). Clears global WT=""
# on full reclaim. Fail-open on hook error/timeout.
reap_worktree() {
  local wt="${1:-}"
  local hook_abs="" repo_root hook_rc rm_status rm_stderr

  OUTCOME_ORPHAN="${OUTCOME_ORPHAN:-}"
  if [ -z "$wt" ]; then
    return 0
  fi
  if _wt_has_control_chars "$wt"; then
    printf 'WARN: worktree path contains control characters; refusing reap: %s\n' "$wt" >&2
    OUTCOME_ORPHAN="$wt"
    return 0
  fi

  _wt_ensure_config
  repo_root="$(_wt_resolve_repo_root)"

  if [ -n "${TEARDOWN_HOOK:-}" ]; then
    if hook_abs="$(_wt_validate_path "$TEARDOWN_HOOK" "$repo_root")"; then
      # argv exec under timeout; fail-open
      if command -v timeout >/dev/null 2>&1; then
        timeout 120 "$hook_abs" "$wt" >&2
        hook_rc=$?
      else
        "$hook_abs" "$wt" >&2
        hook_rc=$?
      fi
      if [ "$hook_rc" -ne 0 ]; then
        if [ "$hook_rc" -eq 124 ]; then
          printf 'WARN: teardown hook timed out (120s); continuing with worktree remove\n' >&2
        else
          printf 'WARN: teardown hook failed (exit %s); continuing with worktree remove\n' "$hook_rc" >&2
        fi
      fi
    fi
  fi

  rm_stderr="$(_wt_git_worktree_remove "$wt")"
  rm_status=$?

  if [ "$rm_status" -ne 0 ] && [ -d "$wt" ]; then
    printf 'WARN: worktree remove failed; orphan kept at %s (%s)\n' "$wt" "$rm_stderr" >&2
    OUTCOME_ORPHAN="$wt"
  else
    # fully reclaimed (or already gone)
    if [ -n "${WT:-}" ] && [ "$WT" = "$wt" ]; then
      WT=""
    fi
    OUTCOME_ORPHAN=""
  fi
  return 0
}

# --- reap_worktree_minimal ----------------------------------------------------
# Signal-safe path: remove worktree only; on failure append path to ORPHAN_LOG.
# Does NOT run the project hook. Does NOT delete a branch (caller does).
reap_worktree_minimal() {
  local wt="${1:-}"
  if [ -z "$wt" ]; then
    return 0
  fi
  if ! git worktree remove --force "$wt" 2>>"${ORPHAN_LOG:-/dev/null}"; then
    if [ -n "${ORPHAN_LOG:-}" ]; then
      printf '%s\n' "$wt" >> "$ORPHAN_LOG"
    fi
  fi
  return 0
}

# --- gc_stale_worktrees -------------------------------------------------------
# Marker-scoped, flock-gated stale reaper. Emits ONE structured JSON envelope
# on stdout. NEVER branch -D. --reap-unmarked (via REAP_UNMARKED=1) + --yes
# (GC_YES=1) recovery path: basename hetero-* only.
gc_stale_worktrees() {
  local age_days reaped_json="" kept_json=""
  local skipped_live=0 skipped_fresh=0 skipped_unmatched=0 lock_unsupported=0
  local reaped_count=0 kept_count=0
  local gc_lock gcfd frc now threshold age created_at
  local wt marker base live_rc probe_fd
  local reap_unmarked="${REAP_UNMARKED:-0}"
  local first_reaped=1 first_kept=1

  _wt_ensure_config
  age_days="${STALE_REAPER_AGE_DAYS:-0}"
  [[ "$age_days" =~ ^[0-9]+$ ]] || age_days=0

  # Disabled guard FIRST — before any enumeration (round-3 codex Major).
  if [ "$age_days" -le 0 ]; then
    printf 'reaper disabled (stale_reaper_age_days=0)\n' >&2
    exit 0
  fi

  # Global serialization.
  gc_lock="${TMPDIR:-/tmp}/.autopilot-gc.lock"
  exec {gcfd}>"$gc_lock" 2>/dev/null || {
    printf 'WARN: cannot open global gc lock %s; aborting --gc\n' "$gc_lock" >&2
    printf '{ "reaped": [], "skipped_live": 0, "skipped_fresh": 0, "skipped_unmatched": 0, "lock_unsupported": 0, "kept_orphan": [] }\n'
    return 0
  }
  flock -n "$gcfd"
  frc=$?
  if [ "$frc" -ne 0 ]; then
    printf 'reaper: another --gc is running; no-op\n' >&2
    exec {gcfd}>&- 2>/dev/null || true
    printf '{ "reaped": [], "skipped_live": 0, "skipped_fresh": 0, "skipped_unmatched": 0, "lock_unsupported": 0, "kept_orphan": [] }\n'
    return 0
  fi

  now="$(date +%s)"
  threshold=$((age_days * 86400))
  reaped_json=""
  kept_json=""

  # Enumerate git worktrees (porcelain).
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        wt="${line#worktree }"
        [ -n "$wt" ] || continue
        [ -d "$wt" ] || continue

        marker="$wt/.autopilot-worktree"
        if [ ! -f "$marker" ]; then
          if [ "$reap_unmarked" = "1" ]; then
            base="$(basename "$wt")"
            case "$base" in
              hetero-*)
                # recovery path — still flock-gated below
                ;;
              *)
                skipped_unmatched=$((skipped_unmatched + 1))
                continue
                ;;
            esac
          else
            # marker gate: never touch unmarked without --reap-unmarked
            continue
          fi
        fi

        # ATOMIC ownership handoff
        live_rc=0
        _wt_is_live "$wt"
        live_rc=$?
        if [ "$live_rc" -eq 1 ]; then
          skipped_live=$((skipped_live + 1))
          continue
        fi
        if [ "$live_rc" -eq 2 ]; then
          lock_unsupported=$((lock_unsupported + 1))
          continue
        fi
        # live_rc==0: we hold _WT_PROBE_FD
        probe_fd="${_WT_PROBE_FD:-}"

        # Age from marker created_at (unmarked recovery: treat as eligible).
        if [ -f "$marker" ]; then
          if created_at="$(_wt_read_marker_created_at "$marker")"; then
            age=$((now - created_at))
            # clock skew → treat eligible
            if [ "$age" -lt 0 ]; then
              age=$threshold
            fi
            if [ "$age" -lt "$threshold" ]; then
              skipped_fresh=$((skipped_fresh + 1))
              [ -n "$probe_fd" ] && exec {probe_fd}>&- 2>/dev/null || true
              _WT_PROBE_FD=""
              continue
            fi
          fi
          # unreadable created_at → eligible (lock already proved dead)
        fi

        # Safe to reap while holding probe lock.
        OUTCOME_ORPHAN=""
        reap_worktree "$wt"
        if [ -n "${OUTCOME_ORPHAN:-}" ]; then
          if [ "$first_kept" -eq 1 ]; then
            kept_json="\"$(_wt_json_escape "$OUTCOME_ORPHAN")\""
            first_kept=0
          else
            kept_json="$kept_json, \"$(_wt_json_escape "$OUTCOME_ORPHAN")\""
          fi
          kept_count=$((kept_count + 1))
        else
          if [ "$first_reaped" -eq 1 ]; then
            reaped_json="\"$(_wt_json_escape "$wt")\""
            first_reaped=0
          else
            reaped_json="$reaped_json, \"$(_wt_json_escape "$wt")\""
          fi
          reaped_count=$((reaped_count + 1))
        fi

        [ -n "$probe_fd" ] && exec {probe_fd}>&- 2>/dev/null || true
        _WT_PROBE_FD=""
        ;;
    esac
  done < <(git worktree list --porcelain 2>/dev/null || true)

  git worktree prune >/dev/null 2>&1 || true

  exec {gcfd}>&- 2>/dev/null || true

  printf '{ "reaped": [%s], "skipped_live": %s, "skipped_fresh": %s, "skipped_unmatched": %s, "lock_unsupported": %s, "kept_orphan": [%s] }\n' \
    "$reaped_json" "$skipped_live" "$skipped_fresh" "$skipped_unmatched" "$lock_unsupported" "$kept_json"
  return 0
}
