# hooks/tests/lib/suite-residue-reap.sh — pre-run + on-exit reaper for the
# umbrella test suite's OWN ${TMPDIR} residue.
#
# Purpose: hooks/tests/run.sh --parallel deterministically leaks temp residue
# into ${TMPDIR:-/tmp} — hetero-*-log-* files, autopilot-test-* dirs (from
# hooks/tests/lib.sh's mktemp -d), *.manifest.json under
# ${TMPDIR}/autopilot-dispatch-runs/, and — on an interrupted run — the
# hooks-run-parallel.* scratch dir plus any hetero-* worktree dirs the
# children created. Nothing ever reaped it: measured on this host it
# accumulated to 82 worktrees + 627 manifests before this fix. This lib is
# test infrastructure with exactly one consumer (hooks/tests/run.sh) — it
# lives under hooks/tests/, NOT scripts/, deliberately (see CLAUDE.md: a
# script with no skill caller does not belong in the scripts/ inventory).
#
# Contract:
#   suite_run_lock_acquire        — register this suite run as live
#   suite_run_lock_release        — release it
#   suite_residue_reap [--dry-run] — reap stale residue; prints ONE JSON
#                                    envelope on stdout; ALWAYS returns 0
#
# SAFETY INVARIANT: reap only what is PROVEN dead. A dispatch worktree marker
# without its lifetime lock file is an UNKNOWN (dispatch-hetero.sh writes the
# marker before it opens the lock — see case A below) and an unknown NEVER
# authorizes deletion, mirroring dispatch-status.js reapRuns()'s "a
# DEFINITIVE 'free' verdict is required; 'n/a'/'unsupported' are unknowns".
# A lockless entry (case B) cannot be attributed to a specific run, so while
# ANY other suite run is live, lockless residue is left alone entirely — it
# might belong to that live run. Every enumerated entry is re-validated
# (direct child of $tmp, not a symlink, basename still pattern-matched)
# immediately before acting on it, and symlinks are never followed.
#
# Routing (fixed 2026-08-28, foreman-found defect): any `hetero-*` DIRECTORY
# routes to the lock-gated branch REGARDLESS of whether the marker exists yet
# — not only ones that already carry `.autopilot-worktree`. dispatch-hetero.sh
# creates the worktree directory, then `git worktree add`, then writes the
# `.autopilot-worktree` marker, and only THEN opens+acquires
# `.autopilot-worktree.lock` — so a live dispatch genuinely passes through
# states where the directory exists with a lock but no marker yet, or with
# neither. Gating the lock-checked branch on "marker present" let a live,
# lock-held `hetero-*` dir with no marker fall into the lockless branch, which
# `rm -rf`s without ever consulting a lock. Consequence documented below at
# the routing site: a genuinely dead, lock-less `hetero-*` directory is now
# never reaped by THIS path — that trade is intentional (safety over
# completeness) and costs nothing in practice, because dispatch-hetero.sh
# always leaves the lock FILE behind (only the flock is released), so real
# dead worktrees still present a free lock and are still reaped.
#
# A second lock name, `.autopilot-live.lock`, is also recognized generically
# (any directory carrying it routes to the lock-gated branch) — this is the
# sidecar hooks/tests/lib.sh holds for the lifetime of a running standalone
# *.test.sh, so a live test's TEST_TMP survives a concurrent suite's reaper
# even though it is not a dispatch worktree at all.

[ -n "${_AUTOPILOT_SUITE_RESIDUE_REAP_SH:-}" ] && return 0
_AUTOPILOT_SUITE_RESIDUE_REAP_SH=1

_SRR_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_SRR_REPO_ROOT="$(cd "$_SRR_SELF_DIR/../../.." && pwd)"

# json_escape() may already be sourced by the caller (worktree-reap.sh pulls
# it in); source defensively so this lib also works standalone in tests.
if ! command -v json_escape >/dev/null 2>&1; then
  # shellcheck source=../../../scripts/lib/json-emit.sh
  . "$_SRR_REPO_ROOT/scripts/lib/json-emit.sh"
fi

SUITE_RUN_LOCK_FD=""
SUITE_RUN_LOCK_PATH=""

# suite_run_lock_acquire — best-effort; always returns 0.
suite_run_lock_acquire() {
  local tmp="${TMPDIR:-/tmp}"
  [ -d "$tmp" ] || return 0
  local lock="$tmp/.autopilot-suite-run.$$.lock"
  if _wt_open_lock_fd "$lock" 2>/dev/null; then
    local fd="$_WT_SAFE_LOCK_FD"
    if flock -n "$fd" 2>/dev/null; then
      SUITE_RUN_LOCK_FD="$fd"
      SUITE_RUN_LOCK_PATH="$lock"
    else
      # NOTE (see hooks/tests/lib.sh's matching note): a no-command `exec`
      # applies ALL its redirections PERMANENTLY to the calling shell — a
      # bare `exec {fd}>&- 2>/dev/null` here would silently blackhole this
      # shell's stderr for the rest of the process (run.sh calls this
      # directly). Wrap in a `{ ; }` group so `2>/dev/null` scopes to the
      # group only; the fd close still escapes the group and takes effect.
      { exec {fd}>&-; } 2>/dev/null || true
    fi
  fi
  return 0
}

# suite_run_lock_release — best-effort; always returns 0.
suite_run_lock_release() {
  if [ -n "$SUITE_RUN_LOCK_FD" ]; then
    # See the NOTE in suite_run_lock_acquire above — group-scope 2>/dev/null.
    { exec {SUITE_RUN_LOCK_FD}>&-; } 2>/dev/null || true
  fi
  if [ -n "$SUITE_RUN_LOCK_PATH" ]; then
    rm -f -- "$SUITE_RUN_LOCK_PATH" 2>/dev/null || true
  fi
  SUITE_RUN_LOCK_FD=""
  SUITE_RUN_LOCK_PATH=""
  return 0
}

# _srr_probe_generic_lock <lock-path> — flock -n probe on an arbitrary lock
# file (not necessarily named .autopilot-worktree.lock), mirroring
# _wt_is_live's contract via _wt_open_lock_fd's symlink/ownership hardening.
# Return codes match _wt_is_live: 0 acquired (eligible; _SRR_PROBE_FD set,
# caller must close after acting), 1 live, 2 unsupported/open failed.
_srr_probe_generic_lock() {
  local lock="$1" probe frc
  _SRR_PROBE_FD=""
  _wt_open_lock_fd "$lock" || return 2
  probe="$_WT_SAFE_LOCK_FD"
  flock -n "$probe"
  frc=$?
  if [ "$frc" -eq 0 ]; then
    _SRR_PROBE_FD="$probe"
    return 0
  fi
  # See the NOTE in suite_run_lock_acquire above — group-scope any redirect
  # on a bare `exec`, even though this one carries none today, so a future
  # edit that adds one here cannot silently regress this shell's stderr.
  { exec {probe}>&-; } || true
  if [ "$frc" -eq 1 ]; then
    return 1
  fi
  return 2
}

_SRR_PATTERNS=(
  'hetero-*'
  'autopilot-test-*'
  'hooks-run-parallel.*'
  'autopilot-l1-unit.*'
  'autopilot-managed-codex-home-*'
)

# _srr_pattern_match <basename> → 0 if basename matches one of the fixed patterns.
_srr_pattern_match() {
  local base="$1" pat
  for pat in "${_SRR_PATTERNS[@]}"; do
    # shellcheck disable=SC2254
    case "$base" in $pat) return 0 ;; esac
  done
  return 1
}

# _srr_other_live_run <tmp> <own_lock_path> → 0 (true) if some OTHER suite-run
# registry lock is currently held (live). Best-effort cleans up dead registry
# files it finds along the way. Fail-closed: flock exit >=2 counts as live.
_srr_other_live_run() {
  local tmp="$1" own="$2" f frc
  local found_live=1
  local f_mtime f_age f_now
  shopt -s nullglob
  for f in "$tmp"/.autopilot-suite-run.*.lock; do
    [ -e "$f" ] || continue
    [ "$f" = "$own" ] && continue
    [ -L "$f" ] && continue
    flock -n "$f" true 2>/dev/null
    frc=$?
    if [ "$frc" -eq 1 ]; then
      found_live=0
    elif [ "$frc" -ge 2 ]; then
      found_live=0
    else
      # frc == 0: the flock probe acquired the lock, but this can also mean
      # we landed in another suite_run_lock_acquire's OPEN-then-FLOCK gap —
      # its lock FILE exists (created first) but the flock hasn't been taken
      # yet. rm -f'ing it there would delete a live run's own registration,
      # after which a third run would see "no other live run" and could reap
      # that live run's lockless scratch. Only tidy a registry file old
      # enough that it cannot still be in that gap (5s is generous headroom
      # over the file-create → flock window); a fresher file is left alone
      # and, per the caller's contract, NOT counted as live either — it is
      # simply unknown, not a sighted live run.
      f_mtime="$(stat -c %Y -- "$f" 2>/dev/null || stat -f %m -- "$f" 2>/dev/null)"
      if [[ "$f_mtime" =~ ^[0-9]+$ ]]; then
        f_now="$(date +%s)"
        f_age=$((f_now - f_mtime))
        if [ "$f_age" -ge 5 ]; then
          rm -f -- "$f" 2>/dev/null || true
        fi
      fi
      # mtime unresolvable: leave the file alone (same as "too fresh").
    fi
  done
  shopt -u nullglob
  return "$found_live"
}

# suite_residue_reap [--dry-run]
# Prints ONE JSON envelope on stdout. ALWAYS returns 0.
suite_residue_reap() {
  local dry_run=0
  [ "${1:-}" = "--dry-run" ] && dry_run=1

  local reaped=0 reaped_paths=() errors=()
  local skipped_live=0 skipped_unknown=0 skipped_lock_unsupported=0
  local skipped_foreign_run=0 skipped_symlink=0 skipped_log_deferred=0
  local manifests_json="null"
  local tmp=""

  if [ "${AUTOPILOT_SUITE_REAP:-1}" = "0" ]; then
    _srr_emit_envelope "$dry_run" "" 0 "" 0 0 0 0 0 0 "" "null"
    return 0
  fi

  tmp="$(realpath -e "${TMPDIR:-/tmp}" 2>/dev/null)" || tmp=""
  if [ -z "$tmp" ] || [ "$tmp" = "/" ] || [ ! -d "$tmp" ]; then
    _srr_emit_envelope "$dry_run" "${tmp:-}" 0 "" 0 0 0 0 0 0 "" "null"
    return 0
  fi

  local other_live=1
  _srr_other_live_run "$tmp" "${SUITE_RUN_LOCK_PATH:-}"
  other_live=$?
  # 0 == true (bash convention) here since _srr_other_live_run returns 0 for live.

  local pat entry base dirname_of marker lock live_lock live_rc probe_fd rc
  local is_hetero lock_gated

  for pat in "${_SRR_PATTERNS[@]}"; do
    while IFS= read -r -d '' entry; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue

      dirname_of="$(dirname -- "$entry")"
      if [ "$dirname_of" != "$tmp" ]; then
        continue
      fi
      base="$(basename -- "$entry")"
      if [ -L "$entry" ]; then
        skipped_symlink=$((skipped_symlink + 1))
        continue
      fi
      if ! _srr_pattern_match "$base"; then
        continue
      fi

      marker="$entry/.autopilot-worktree"
      lock="$entry/.autopilot-worktree.lock"
      live_lock="$entry/.autopilot-live.lock"
      is_hetero=1
      case "$base" in hetero-*) is_hetero=0 ;; *) is_hetero=1 ;; esac

      lock_gated=1
      if [ -d "$entry" ]; then
        if [ -f "$marker" ] || [ -e "$lock" ] || [ -e "$live_lock" ] \
           || [ "$is_hetero" -eq 0 ]; then
          lock_gated=0
        fi
      fi

      if [ "$lock_gated" -eq 0 ]; then
        if [ -e "$lock" ]; then
          _wt_is_live "$entry"
          live_rc=$?
          probe_fd="${_WT_PROBE_FD:-}"
        elif [ -e "$live_lock" ]; then
          _srr_probe_generic_lock "$live_lock"
          live_rc=$?
          probe_fd="${_SRR_PROBE_FD:-}"
        else
          # No lock file at all: dispatch-hetero.sh creates the worktree dir
          # (and, for hetero-* basenames, may still be between mktemp and
          # `git worktree add`) BEFORE it ever writes a marker or opens a
          # lock — an unknown never authorizes deletion. This means a
          # genuinely dead, lock-less hetero-* directory is never reaped by
          # this path; that is the correct trade (safety over completeness)
          # and costs nothing in practice, since dispatch-hetero.sh always
          # leaves the lock FILE behind (only the flock is released) — real
          # dead worktrees still present a free lock and are still reaped.
          skipped_unknown=$((skipped_unknown + 1))
          continue
        fi

        if [ "$live_rc" -eq 1 ]; then
          skipped_live=$((skipped_live + 1))
          continue
        elif [ "$live_rc" -eq 2 ]; then
          skipped_lock_unsupported=$((skipped_lock_unsupported + 1))
          continue
        fi
        # live_rc == 0: lock acquired, safe to reap; close probe fd after.
        if [ "$dry_run" -eq 0 ]; then
          if rm -rf -- "$entry" 2>/dev/null; then
            reaped=$((reaped + 1))
            [ "${#reaped_paths[@]}" -lt 50 ] && reaped_paths+=("$entry")
          else
            errors+=("remove failed: $entry")
          fi
        else
          reaped=$((reaped + 1))
          [ "${#reaped_paths[@]}" -lt 50 ] && reaped_paths+=("$entry")
        fi
        if [ -n "$probe_fd" ]; then
          # See the NOTE in suite_run_lock_acquire above — group-scope 2>/dev/null.
          { exec {probe_fd}>&-; } 2>/dev/null || true
        fi
        _WT_PROBE_FD=""
        _SRR_PROBE_FD=""
      else
        # Lockless file/dir: cannot attribute to a specific run. Refuse while
        # any OTHER suite run is live.
        case "$base" in
          hetero-*-log-*)
            # scripts/dispatch-hetero.sh writes a live external dispatch's log
            # to ${TMPDIR}/hetero-<branch>-log-XXXXXX — a PLAIN FILE, so unlike
            # a hetero-* worktree DIR it never routes to the lock-gated branch
            # above (there is no lock by which its liveness could be judged).
            # Reaping it here on the immediate lockless path would unlink a
            # concurrently-running dispatch's log mid-run, violating "a live
            # dispatch must survive". Defer entirely to the aged
            # prune_tmp_residue call below (hetero-*-log-* is already in its
            # pattern list): the file is then bounded by
            # AUTOPILOT_TMP_LOG_RETENTION_DAYS (default 3) instead of removed
            # same-run — the correct trade given no lock exists to gate on.
            skipped_log_deferred=$((skipped_log_deferred + 1))
            continue
            ;;
        esac
        if [ "$other_live" -eq 0 ]; then
          skipped_foreign_run=$((skipped_foreign_run + 1))
          continue
        fi
        if [ "$dry_run" -eq 0 ]; then
          if rm -rf -- "$entry" 2>/dev/null; then
            reaped=$((reaped + 1))
            [ "${#reaped_paths[@]}" -lt 50 ] && reaped_paths+=("$entry")
          else
            errors+=("remove failed: $entry")
          fi
        else
          reaped=$((reaped + 1))
          [ "${#reaped_paths[@]}" -lt 50 ] && reaped_paths+=("$entry")
        fi
      fi
    done < <(find "$tmp" -maxdepth 1 -mindepth 1 -user "$(id -un 2>/dev/null)" -name "$pat" -print0 2>/dev/null)
  done

  # Manifests: dispatch-status.js --reap removes only *.manifest.json (not-live
  # AND older than --days). Ledgers (*.ledger.jsonl) and .locks/ are untouched
  # by that call — there can be a live foreman ledger in that directory on
  # this host. NOTE: dispatch-status.js's own CLI validation rejects
  # `--days 0` ("--days must be a positive integer", scripts/dispatch-status.js
  # reapRuns guard) — 0 is not a "reap regardless of age" sentinel there, it is
  # simply invalid. We are forbidden from touching that file, so the minimum
  # valid value (1) is used; this only reaps not-live manifests strictly older
  # than 1 day. A same-run dead-but-fresh manifest therefore is NOT reaped by
  # this call — it is still reachable next run once it ages past 1 day, and
  # is never a residue-accumulation risk (unlike the unbounded worktree/temp
  # patterns above) because reapRuns' own liveness probe already gates it.
  local manifests_dir="$tmp/autopilot-dispatch-runs"
  if command -v node >/dev/null 2>&1 && [ -d "$manifests_dir" ]; then
    local ds_args=(--reap --days 1 --dir "$manifests_dir")
    [ "$dry_run" -eq 1 ] && ds_args+=(--dry-run)
    local ds_out=""
    if ds_out="$(node "$_SRR_REPO_ROOT/scripts/dispatch-status.js" "${ds_args[@]}" 2>/dev/null)"; then
      # dispatch-status.js pretty-prints (2-space indent); collapse to one
      # line so this function's own JSON envelope stays a single line.
      manifests_json="$(printf '%s' "$ds_out" | node -e '
        let s = "";
        process.stdin.on("data", (c) => { s += c; });
        process.stdin.on("end", () => {
          try { process.stdout.write(JSON.stringify(JSON.parse(s))); }
          catch (_e) { process.stdout.write("null"); }
        });
      ' 2>/dev/null)"
      [ -n "$manifests_json" ] || manifests_json="null"
    else
      manifests_json="null"
    fi
  fi

  # Aged log prune — reuse, don't reimplement. Gated on dry_run: --dry-run
  # must not really delete anything, and prune_tmp_residue performs a real
  # unlink with no dry-run mode of its own.
  if [ "$dry_run" -eq 0 ] && command -v prune_tmp_residue >/dev/null 2>&1; then
    prune_tmp_residue "${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}" \
      'hetero-*-log-*' 'dispatch-review-log-*' 'dispatch-author-log-*' 2>/dev/null || true
  fi

  local errors_json="[]"
  if [ "${#errors[@]}" -gt 0 ]; then
    local ejoin="" e first=1
    for e in "${errors[@]}"; do
      if [ "$first" -eq 1 ]; then first=0; else ejoin="$ejoin, "; fi
      ejoin="$ejoin\"$(json_escape "$e")\""
    done
    errors_json="[$ejoin]"
  fi

  local paths_json="[]"
  if [ "${#reaped_paths[@]}" -gt 0 ]; then
    local pjoin="" p first=1
    for p in "${reaped_paths[@]}"; do
      if [ "$first" -eq 1 ]; then first=0; else pjoin="$pjoin, "; fi
      pjoin="$pjoin\"$(json_escape "$p")\""
    done
    paths_json="[$pjoin]"
  fi

  printf '{"schema":1,"dry_run":%s,"tmpdir":"%s","reaped":%s,"reaped_paths":%s,"skipped_live":%s,"skipped_unknown":%s,"skipped_lock_unsupported":%s,"skipped_foreign_run":%s,"skipped_symlink":%s,"skipped_log_deferred":%s,"errors":%s,"manifests":%s}\n' \
    "$([ "$dry_run" -eq 1 ] && echo true || echo false)" \
    "$(json_escape "$tmp")" \
    "$reaped" "$paths_json" \
    "$skipped_live" "$skipped_unknown" "$skipped_lock_unsupported" \
    "$skipped_foreign_run" "$skipped_symlink" "$skipped_log_deferred" \
    "$errors_json" "$manifests_json"
  return 0
}

# _srr_emit_envelope — used only for the two early-out (kill-switch /
# unresolvable tmpdir) no-op paths, to keep suite_residue_reap's body
# readable. All args positional; kept private (underscore-prefixed).
_srr_emit_envelope() {
  local dry_run="$1" tmpdir="$2" reaped="$3" _paths="$4" \
    skipped_live="$5" skipped_unknown="$6" skipped_lock_unsupported="$7" \
    skipped_foreign_run="$8" skipped_symlink="$9" skipped_log_deferred="${10}" \
    _errors="${11}" manifests="${12}"
  printf '{"schema":1,"dry_run":%s,"tmpdir":"%s","reaped":%s,"reaped_paths":[],"skipped_live":%s,"skipped_unknown":%s,"skipped_lock_unsupported":%s,"skipped_foreign_run":%s,"skipped_symlink":%s,"skipped_log_deferred":%s,"errors":[],"manifests":%s}\n' \
    "$([ "$dry_run" -eq 1 ] && echo true || echo false)" \
    "$(json_escape "$tmpdir")" \
    "$reaped" "$skipped_live" "$skipped_unknown" "$skipped_lock_unsupported" \
    "$skipped_foreign_run" "$skipped_symlink" "$skipped_log_deferred" "$manifests"
  return 0
}
