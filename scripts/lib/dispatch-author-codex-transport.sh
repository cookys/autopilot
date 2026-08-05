#!/usr/bin/env bash
# dispatch-author-codex-transport.sh — Codex author transport helpers (D0-T v4.1).
#
# Sourced by scripts/dispatch-author.sh. Process-tree supervision, private
# artifact lifecycle, exit-first classification support, stdout/sidecar witness
# verification, and chrome-frame session-id extraction.
#
# No side effects at source time. Double-source is a no-op for function defs.

# Create a dispatcher-owned per-run directory (0700) with three exclusive regular
# files (0600, nlink 1): stdout, stderr, last-message sidecar.
# Sets: CODEX_RUN_DIR, CODEX_STDOUT, CODEX_STDERR, CODEX_SIDECAR
codex_transport_create_artifacts() {
  local dir f
  dir="$(mktemp -d -t dispatch-author-codex-XXXXXX)" || return 1
  chmod 700 "$dir" || { rm -rf "$dir"; return 1; }
  # Owner must be the invoking uid (mktemp default); refuse anything else.
  if [ "$(stat -c '%u' "$dir" 2>/dev/null || true)" != "$(id -u)" ]; then
    rm -rf "$dir"
    return 1
  fi
  for f in stdout stderr last-message; do
    # Exclusive create: fail if the path already exists (incl. symlink).
    # umask 077 + noclobber avoids follow-on-create races for pre-existing links.
    (
      umask 077
      set -o noclobber
      : > "$dir/$f"
    ) || { rm -rf "$dir"; return 1; }
    chmod 600 "$dir/$f" || { rm -rf "$dir"; return 1; }
    if [ -L "$dir/$f" ] || [ ! -f "$dir/$f" ]; then
      rm -rf "$dir"
      return 1
    fi
    if [ "$(stat -c '%h' "$dir/$f" 2>/dev/null || true)" != "1" ]; then
      rm -rf "$dir"
      return 1
    fi
    if [ "$(stat -c '%u' "$dir/$f" 2>/dev/null || true)" != "$(id -u)" ]; then
      rm -rf "$dir"
      return 1
    fi
  done
  # Caller-scope globals (consumed by sourcing scripts/dispatch-author.sh).
  # shellcheck disable=SC2034
  CODEX_RUN_DIR="$dir"
  # shellcheck disable=SC2034
  CODEX_STDOUT="$dir/stdout"
  # shellcheck disable=SC2034
  CODEX_STDERR="$dir/stderr"
  # shellcheck disable=SC2034
  CODEX_SIDECAR="$dir/last-message"
  return 0
}

# Post-run inode integrity: regular file, not symlink, mode 0600, owner, nlink 1.
codex_transport_check_artifact() {
  local path="$1"
  [ -n "$path" ] || return 1
  [ -e "$path" ] || return 1
  [ -f "$path" ] || return 1
  [ ! -L "$path" ] || return 1
  [ "$(stat -c '%a' "$path" 2>/dev/null || true)" = "600" ] || return 1
  [ "$(stat -c '%u' "$path" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  [ "$(stat -c '%h' "$path" 2>/dev/null || true)" = "1" ] || return 1
  return 0
}

codex_transport_check_all_artifacts() {
  local dir="${1:-}"
  [ -n "$dir" ] || return 1
  [ -d "$dir" ] || return 1
  [ ! -L "$dir" ] || return 1
  [ "$(stat -c '%a' "$dir" 2>/dev/null || true)" = "700" ] || return 1
  [ "$(stat -c '%u' "$dir" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  codex_transport_check_artifact "$dir/stdout" || return 1
  codex_transport_check_artifact "$dir/stderr" || return 1
  codex_transport_check_artifact "$dir/last-message" || return 1
  return 0
}

# True if pid is a live non-zombie process (excludes self and pid 0/1).
codex_transport_pid_is_live() {
  local pid="$1"
  local state
  case "$pid" in
    ''|*[!0-9]*|0|1) return 1 ;;
  esac
  [ "$pid" = "$$" ] && return 1
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(awk '{ print $3 }' "/proc/$pid/stat" 2>/dev/null || true)"
  [ "$state" != "Z" ]
}

# True if any non-zombie process remains in the process group.
codex_transport_pgid_has_live() {
  local pgid="$1"
  local pid state
  case "$pgid" in
    ''|*[!0-9]*|0|1) return 1 ;;
  esac
  # shellcheck disable=SC2009
  while read -r pid state; do
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$state" = "Z" ] && continue
    # Skip our own shell if it somehow shares the group (should not).
    [ "$pid" = "$$" ] && continue
    return 0
  done < <(ps -o pid=,state= -g "$pgid" 2>/dev/null || true)
  return 1
}

# Recursively emit children of pid via /proc/<pid>/task/*/children (setsid-safe walk).
codex_transport_walk_children() {
  local pid="$1"
  local f child
  case "$pid" in
    ''|*[!0-9]*|0|1) return 0 ;;
  esac
  for f in /proc/"$pid"/task/*/children; do
    [ -r "$f" ] || continue
    # shellcheck disable=SC2013
    for child in $(cat "$f" 2>/dev/null || true); do
      case "$child" in ''|*[!0-9]*) continue ;; esac
      printf '%s\n' "$child"
      codex_transport_walk_children "$child"
    done
  done
}

# Snapshot worker descendants ∪ process-group members (unique pids, one per line).
# Additive over pgid: keeps group members and also setsid-escaped PPID descendants.
codex_transport_snapshot_tree_pids() {
  local worker_pid="$1"
  local pgid="$2"
  {
    case "$worker_pid" in
      ''|*[!0-9]*) ;;
      *)
        printf '%s\n' "$worker_pid"
        codex_transport_walk_children "$worker_pid"
        ;;
    esac
    case "$pgid" in
      ''|*[!0-9]*|0|1) ;;
      *)
        # shellcheck disable=SC2009
        ps -o pid= -g "$pgid" 2>/dev/null || true
        ;;
    esac
  } | tr -s '[:space:]' '\n' | while read -r pid; do
    case "$pid" in ''|*[!0-9]*|0|1) continue ;; esac
    [ "$pid" = "$$" ] && continue
    printf '%s\n' "$pid"
  done | sort -u
}

# True if any pid in the newline-separated set is still live (non-zombie).
codex_transport_pidset_has_live() {
  local pidset="$1"
  local pid
  while IFS= read -r pid; do
    codex_transport_pid_is_live "$pid" && return 0
  done <<< "$pidset"
  return 1
}

codex_transport_kill_tree() {
  local pgid="$1"
  local signal="${2:-TERM}"
  case "$pgid" in
    ''|*[!0-9]*|0|1) return 0 ;;
  esac
  kill "-$signal" -- "-$pgid" 2>/dev/null || true
}

# Signal every pid in a newline-separated set (individual kills; covers setsid escapees).
codex_transport_kill_pidset() {
  local signal="$1"
  local pidset="$2"
  local pid
  while IFS= read -r pid; do
    case "$pid" in ''|*[!0-9]*|0|1) continue ;; esac
    [ "$pid" = "$$" ] && continue
    kill "-$signal" "$pid" 2>/dev/null || true
  done <<< "$pidset"
}

# Union two newline-separated pid sets (unique, stable).
codex_transport_merge_pidsets() {
  printf '%s\n%s\n' "${1-}" "${2-}" | tr -s '[:space:]' '\n' | while read -r pid; do
    case "$pid" in ''|*[!0-9]*|0|1) continue ;; esac
    [ "$pid" = "$$" ] && continue
    printf '%s\n' "$pid"
  done | sort -u
}

# Scan own-uid processes for open fds whose readlink target equals one of this
# run's private capture paths (stdout, stderr, sidecar). Emits matching pids
# (one per line), excluding the dispatcher itself. Permission errors on
# /proc/<pid>/fd/* are ignored. CODEX-branch only.
codex_transport_scan_fd_holders() {
  local stdout_path="$1"
  local stderr_path="$2"
  local sidecar_path="$3"
  local my_uid pid owner fd_path target
  my_uid="$(id -u)"

  for proc in /proc/[0-9]*; do
    pid="${proc#/proc/}"
    case "$pid" in ''|*[!0-9]*|0|1) continue ;; esac
    [ "$pid" = "$$" ] && continue
    # Own-uid only; unreadable /proc entries (other users) are skipped.
    owner="$(stat -c '%u' "$proc" 2>/dev/null || true)"
    [ "$owner" = "$my_uid" ] || continue
    # Skip zombies — they hold no fds and are not "live" for incomplete-tree.
    codex_transport_pid_is_live "$pid" || continue
    for fd_path in "$proc"/fd/*; do
      # readlink fails with EACCES/ENOENT for some entries; ignore those.
      target="$(readlink "$fd_path" 2>/dev/null || true)"
      [ -n "$target" ] || continue
      if [ "$target" = "$stdout_path" ] \
        || [ "$target" = "$stderr_path" ] \
        || [ "$target" = "$sidecar_path" ]; then
        printf '%s\n' "$pid"
        break
      fi
    done
  done | sort -u
}

# Reap remaining members of the worker tree within a fixed cleanup budget (seconds).
# Snapshots descendants∪pgid before signalling; TERM first, then KILL after 1s;
# hard stop at budget. Returns 0 if clean (no live survivors in the same set).
# The initial snapshot is retained for the whole budget so setsid escapees remain
# addressable after their PPID chain is torn down (orphans reparent to init).
# Optional seed_pidset (arg 4) is unioned into the kill set — used by the normal-
# exit path for supervision-time seen-set + post-exit fd-holder detections.
# Args: pgid [budget_s] [worker_pid] [seed_pidset]
codex_transport_reap_tree() {
  local pgid="$1"
  local budget_s="${2:-10}"
  local worker_pid="${3:-}"
  local seed_pidset="${4:-}"
  local start now pidset fresh
  case "$pgid" in
    ''|*[!0-9]*|0|1)
      # Still try worker-rooted descendants / seed when pgid is unusable.
      case "$worker_pid" in
        ''|*[!0-9]*)
          if [ -z "$seed_pidset" ]; then
            return 0
          fi
          ;;
      esac
      ;;
  esac

  # Snapshot BEFORE any signal so setsid escapees are recorded while the
  # PPID chain is still intact. Seed retains pids from earlier supervision /
  # fd-holder scans that reparented to init and are no longer walkable.
  pidset="$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")"
  pidset="$(codex_transport_merge_pidsets "$pidset" "$seed_pidset")"
  if ! codex_transport_pidset_has_live "$pidset" && ! codex_transport_pgid_has_live "$pgid"; then
    return 0
  fi

  codex_transport_kill_tree "$pgid" TERM
  codex_transport_kill_pidset TERM "$pidset"

  start="$(date +%s)"
  while codex_transport_pidset_has_live "$pidset" || codex_transport_pgid_has_live "$pgid"; do
    now="$(date +%s)"
    # Additive re-snapshot: never drop pids already seen (PPID walk goes blind
    # once parents die and children reparent to init).
    fresh="$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")"
    pidset="$(codex_transport_merge_pidsets "$pidset" "$fresh")"
    if [ $((now - start)) -ge 1 ]; then
      codex_transport_kill_tree "$pgid" KILL
      codex_transport_kill_pidset KILL "$pidset"
    fi
    if [ $((now - start)) -ge "$budget_s" ]; then
      codex_transport_kill_tree "$pgid" KILL
      codex_transport_kill_pidset KILL "$pidset"
      break
    fi
    sleep 0.1
  done
  fresh="$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")"
  pidset="$(codex_transport_merge_pidsets "$pidset" "$fresh")"
  codex_transport_kill_tree "$pgid" KILL
  codex_transport_kill_pidset KILL "$pidset"
  if codex_transport_pidset_has_live "$pidset" || codex_transport_pgid_has_live "$pgid"; then
    return 1
  fi
  return 0
}

# GNU timeout duration grammar → ceiling integer seconds.
# NUMBER[SUFFIX] with optional fractional NUMBER; SUFFIX ∈ s|m|h|d (bare = seconds).
# Zero/negative clamp to 1. Unparseable → return 1 (caller fail-closes as precondition).
codex_transport_timeout_seconds() {
  local t="$1"
  local num suffix mult secs
  case "$t" in
    ''|*[!0-9smhd.]* ) return 1 ;;
  esac
  if [[ "$t" =~ ^([0-9]+(\.[0-9]*)?|\.[0-9]+)([smhd])?$ ]]; then
    num="${BASH_REMATCH[1]}"
    suffix="${BASH_REMATCH[3]:-s}"
    case "$suffix" in
      s) mult=1 ;;
      m) mult=60 ;;
      h) mult=3600 ;;
      d) mult=86400 ;;
      *) return 1 ;;
    esac
    # Ceiling of num*mult via awk (no bc dependency); clamp ≤0 → 1.
    secs="$(awk -v n="$num" -v m="$mult" 'BEGIN {
      v = n * m;
      if (v <= 0) { print 1; exit }
      c = int(v);
      if (v > c) c = c + 1;
      if (c < 1) c = 1;
      printf "%d", c;
    }')" || return 1
    case "$secs" in
      ''|*[!0-9]*) return 1 ;;
    esac
    printf '%s' "$secs"
    return 0
  fi
  return 1
}

# Probe whether systemd-run --user --scope is available (teardown hygiene only —
# NOT a same-UID security boundary; see dispatch-hetero.sh cgroup notes).
codex_transport_cgroup_available() {
  command -v systemd-run >/dev/null 2>&1 \
    && systemd-run --user --scope --quiet -- true >/dev/null 2>&1
}

# Verify a cgroup scope has empty cgroup.procs (or is already gone).
# Returns 0 when empty/gone, 1 when live descendants remain.
codex_transport_cgroup_empty() {
  local unit="$1"
  local cg=""
  # Resolve the cgroup path from the unit name via systemd property when available.
  cg="$(systemctl --user show -p ControlGroup --value "$unit" 2>/dev/null || true)"
  if [ -z "$cg" ]; then
    # Scope already gone → treated as empty (contained).
    return 0
  fi
  if [ -s "/sys/fs/cgroup${cg}/cgroup.procs" ]; then
    return 1
  fi
  return 0
}

# Run the codex binary under process-group supervision, with an optional
# systemd-run --user --scope cgroup tier (D3 A07).
# Sets: RUNNER_EXIT, CODEX_DEADLINE_HIT, CODEX_INCOMPLETE_TREE, CODEX_WORKER_PGID,
#       CODEX_CONTAINMENT (cgroup|setsid|plain), CODEX_CONTAINED (0|1),
#       CODEX_CGROUP_UNIT (when cgroup tier used)
#
# Args: bin model effort prompt_file stdout stderr sidecar timeout_spec
# Optional 9th: trusted_cwd — when set, child runs with that working directory
# (plan-review repository-trust binding). Empty keeps ambient cwd.
codex_transport_run() {
  local bin="$1"
  local model="$2"
  local effort="$3"
  local prompt="$4"
  local stdout_path="$5"
  local stderr_path="$6"
  local sidecar_path="$7"
  local timeout_spec="$8"
  local trusted_cwd="${9:-}"

  CODEX_DEADLINE_HIT=0
  CODEX_INCOMPLETE_TREE=0
  CODEX_WORKER_PGID=""
  CODEX_CONTAINMENT="setsid"
  CODEX_CONTAINED=0
  CODEX_CGROUP_UNIT=""
  RUNNER_EXIT=0

  local deadline_secs
  # Fail closed: unparseable timeout must never silently default (pre-validated
  # by dispatch-author.sh; double-check here so a direct caller cannot mis-run).
  if ! deadline_secs="$(codex_transport_timeout_seconds "$timeout_spec")"; then
    RUNNER_EXIT=2
    return 1
  fi
  # Guard against zero/negative (would fire immediately).
  if [ "$deadline_secs" -lt 1 ]; then
    deadline_secs=1
  fi

  # Launch under setsid (process-group identity) — proven transport path.
  # D3 A07: optional cgroup when AUTOPILOT_CODEX_CGROUP=1 (teardown hygiene via
  # empty cgroup.procs). Default is setsid with honest CODEX_CONTAINMENT so
  # incomplete-tree matrices and hosts without user systemd stay green.
  if [ -n "$trusted_cwd" ] && [ ! -d "$trusted_cwd" ]; then
    RUNNER_EXIT=2
    return 1
  fi

  if [[ "${AUTOPILOT_CODEX_CGROUP:-0}" == "1" ]] && codex_transport_cgroup_available; then
    CODEX_CONTAINMENT="cgroup"
    CODEX_CGROUP_UNIT="dispatch-author-codex-$$-$RANDOM.scope"
  else
    CODEX_CONTAINMENT="setsid"
  fi

  # Redirections attach before exec so the worker and same-group descendants
  # inherit the private capture fds. setsid-escaped grandchildren leave the
  # group; reap_tree walks PPID descendants so they are still reaped.
  if [ "$CODEX_CONTAINMENT" = "cgroup" ]; then
    if [ -n "$trusted_cwd" ]; then
      systemd-run --user --scope --quiet --unit="$CODEX_CGROUP_UNIT" -- \
        env -C "$trusted_cwd" setsid "$bin" exec --model "$model" \
        --sandbox read-only \
        -c "model_reasoning_effort=\"$effort\"" \
        --output-last-message "$sidecar_path" \
        < "$prompt" > "$stdout_path" 2> "$stderr_path" &
    else
      systemd-run --user --scope --quiet --unit="$CODEX_CGROUP_UNIT" -- \
        setsid "$bin" exec --model "$model" \
        --sandbox read-only \
        -c "model_reasoning_effort=\"$effort\"" \
        --output-last-message "$sidecar_path" \
        < "$prompt" > "$stdout_path" 2> "$stderr_path" &
    fi
  else
    if [ -n "$trusted_cwd" ]; then
      env -C "$trusted_cwd" setsid "$bin" exec --model "$model" \
        --sandbox read-only \
        -c "model_reasoning_effort=\"$effort\"" \
        --output-last-message "$sidecar_path" \
        < "$prompt" > "$stdout_path" 2> "$stderr_path" &
    else
      setsid "$bin" exec --model "$model" \
        --sandbox read-only \
        -c "model_reasoning_effort=\"$effort\"" \
        --output-last-message "$sidecar_path" \
        < "$prompt" > "$stdout_path" 2> "$stderr_path" &
    fi
  fi
  local worker_pid=$!

  local pgid="" i
  # shellcheck disable=SC2034  # retry counter only; body uses sleep/break
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    pgid="$(ps -o pgid= -p "$worker_pid" 2>/dev/null | tr -d '[:space:]' || true)"
    case "$pgid" in
      ''|*[!0-9]*) ;;
      *) break ;;
    esac
    # If the worker already exited, fall through to wait.
    kill -0 "$worker_pid" 2>/dev/null || break
    sleep 0.05
  done
  case "$pgid" in
    ''|*[!0-9]*) pgid="$worker_pid" ;;
  esac
  # Caller-scope global (consumed by sourcing scripts/dispatch-author.sh).
  # shellcheck disable=SC2034
  CODEX_WORKER_PGID="$pgid"

  local start now state pidset seen_set holders seed poll_i
  start="$(date +%s)"
  local timed_out=0
  seen_set=""
  poll_i=0

  while kill -0 "$worker_pid" 2>/dev/null; do
    state="$(awk '{ print $3 }' "/proc/$worker_pid/stat" 2>/dev/null || echo Z)"
    if [ "$state" = "Z" ]; then
      break
    fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$deadline_secs" ]; then
      timed_out=1
      break
    fi
    # Accumulate descendant∪pgid snapshots during supervision so a setsid
    # escapee reparented to init after the worker exits is still remembered.
    # Every ~5 polls (~250ms at 50ms sleep) keeps /proc walk cost bounded.
    if [ $((poll_i % 5)) -eq 0 ]; then
      seen_set="$(codex_transport_merge_pidsets "$seen_set" \
        "$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")")"
    fi
    poll_i=$((poll_i + 1))
    sleep 0.05
  done

  if [ "$timed_out" -eq 1 ]; then
    # Terminal BEFORE signalling — deadline is not author time.
    # Caller-scope global (consumed by sourcing scripts/dispatch-author.sh).
    # shellcheck disable=SC2034
    CODEX_DEADLINE_HIT=1
    # Deadline path unchanged: post-wait liveness uses a fresh snapshot only
    # (no seen-set / fd-holder extension — those are normal-exit path only).
    codex_transport_reap_tree "$pgid" 10 "$worker_pid" || CODEX_INCOMPLETE_TREE=1
    wait "$worker_pid" 2>/dev/null || true
    # Canonical deadline status for consumers (matches GNU timeout).
    RUNNER_EXIT=124
    # Final survivor check after wait (descendants ∪ pgid, including setsid escapees).
    pidset="$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")"
    if codex_transport_pidset_has_live "$pidset" || codex_transport_pgid_has_live "$pgid"; then
      CODEX_INCOMPLETE_TREE=1
      codex_transport_kill_tree "$pgid" KILL
      codex_transport_kill_pidset KILL "$pidset"
    fi
    return 0
  fi

  wait "$worker_pid" 2>/dev/null
  # Caller-scope global (consumed by sourcing scripts/dispatch-author.sh).
  # shellcheck disable=SC2034
  RUNNER_EXIT=$?

  # Normal-exit incomplete-tree detection (two complementary sources):
  #   1) supervision-time seen-set ∪ post-wait snapshot ∪ pgid (FAST path —
  #      must run before any expensive walk so a short-lived late writer in the
  #      original group cannot finish and vanish before we classify)
  #   2) post-exit fd-holder scan (SLOW; only when the fast path looks clean —
  #      catches setsid orphans reparented to init that still hold private fds)
  # Residual honesty: a descendant that never appeared in any live snapshot AND
  # holds none of the private capture fds remains out of detection reach.
  pidset="$(codex_transport_merge_pidsets \
    "$(codex_transport_snapshot_tree_pids "$worker_pid" "$pgid")" \
    "$seen_set")"
  holders=""
  if ! codex_transport_pidset_has_live "$pidset" \
    && ! codex_transport_pgid_has_live "$pgid"; then
    holders="$(codex_transport_scan_fd_holders \
      "$stdout_path" "$stderr_path" "$sidecar_path")"
    pidset="$(codex_transport_merge_pidsets "$pidset" "$holders")"
  fi
  seed="$(codex_transport_merge_pidsets "$seen_set" "$holders")"
  if codex_transport_pidset_has_live "$pidset" || codex_transport_pgid_has_live "$pgid"; then
    # Caller-scope global (consumed by sourcing scripts/dispatch-author.sh).
    # shellcheck disable=SC2034
    CODEX_INCOMPLETE_TREE=1
    # TERM→KILL within the existing 10s budget; seed keeps reparented holders
    # addressable after the PPID walk goes blind.
    codex_transport_reap_tree "$pgid" 10 "$worker_pid" "$seed" || true
  fi

  # Cgroup empty-procs verification (D3). Only claim contained=1 when the scope
  # is empty/gone; fallback hosts leave CODEX_CONTAINED=0 and never claim cgroup.
  if [ "$CODEX_CONTAINMENT" = "cgroup" ] && [ -n "$CODEX_CGROUP_UNIT" ]; then
    if [ "$CODEX_INCOMPLETE_TREE" -eq 0 ] && codex_transport_cgroup_empty "$CODEX_CGROUP_UNIT"; then
      CODEX_CONTAINED=1
    else
      CODEX_CONTAINED=0
      # Attempt to stop the scope unit so leftovers are reaped.
      systemctl --user stop "$CODEX_CGROUP_UNIT" >/dev/null 2>&1 || true
      if ! codex_transport_cgroup_empty "$CODEX_CGROUP_UNIT"; then
        CODEX_INCOMPLETE_TREE=1
      fi
    fi
  else
    # Honest provenance: non-cgroup paths never claim cgroup containment.
    CODEX_CONTAINED=0
  fi
  return 0
}

# True when stderr has a complete INITIAL chrome frame anchored at start.
# Codex 0.145.0 may emit exactly one benign "Reading prompt from stdin..."
# line before its version banner. No other pre-banner content is accepted, and
# that compatibility path requires a canonical OpenAI Codex semver banner.
# The next line must be opening "--------", then body to the next "--------".
# Delimiter blocks after the initial frame are ignored.
codex_transport_has_chrome_frame() {
  local stderr_path="$1"
  [ -r "$stderr_path" ] || return 1
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1]);
const lines = raw.toString("binary").split("\n");
const strip = (s) => s.replace(/\r$/, "");
let i = 0;
while (i < lines.length && strip(lines[i]) === "") i++;
if (i >= lines.length) process.exit(1);
let hasPromptSourceLine = false;
if (strip(lines[i]) === "Reading prompt from stdin...") {
  hasPromptSourceLine = true;
  i += 1;
  if (i >= lines.length) process.exit(1);
}
const banner = strip(lines[i]);
if (hasPromptSourceLine &&
    !/^OpenAI Codex v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(banner)) {
  process.exit(1);
}
if (banner === "--------") process.exit(1);
i += 1;
if (i >= lines.length || strip(lines[i]) !== "--------") process.exit(1);
i += 1;
for (; i < lines.length; i++) {
  if (strip(lines[i]) === "--------") process.exit(0);
}
process.exit(1);
' "$stderr_path" 2>/dev/null
}

# Exact witness: stdout == sidecar OR stdout == sidecar + single trailing LF.
# No other normalization. Sidecar must be non-empty. Empty stdout fails.
codex_transport_verify_witness() {
  local stdout_path="$1"
  local sidecar_path="$2"
  [ -f "$stdout_path" ] && [ -f "$sidecar_path" ] || return 1
  node -e '
const fs = require("fs");
const stdout = fs.readFileSync(process.argv[1]);
const sidecar = fs.readFileSync(process.argv[2]);
if (sidecar.length === 0) process.exit(1);
if (Buffer.compare(stdout, sidecar) === 0) process.exit(0);
const withLf = Buffer.concat([sidecar, Buffer.from([0x0a])]);
if (Buffer.compare(stdout, withLf) === 0) process.exit(0);
process.exit(1);
' "$stdout_path" "$sidecar_path" 2>/dev/null
}

# Extract exactly one canonical session id from the INITIAL chrome frame only.
# Frame anchoring matches codex_transport_has_chrome_frame, including its
# single exact Codex 0.145.0 prompt-source compatibility line.
# Delimiter blocks after the anchored frame never supply or override a session id.
# Prints the UUID on success; exits nonzero on any ambiguity/malformed/missing.
codex_transport_extract_session_id() {
  local stderr_path="$1"
  [ -r "$stderr_path" ] || return 1
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1]);
const lines = raw.toString("binary").split("\n");
const strip = (s) => s.replace(/\r$/, "");
let i = 0;
while (i < lines.length && strip(lines[i]) === "") i++;
if (i >= lines.length) process.exit(1);
let hasPromptSourceLine = false;
if (strip(lines[i]) === "Reading prompt from stdin...") {
  hasPromptSourceLine = true;
  i += 1;
  if (i >= lines.length) process.exit(1);
}
const banner = strip(lines[i]);
if (hasPromptSourceLine &&
    !/^OpenAI Codex v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(banner)) {
  process.exit(1);
}
if (banner === "--------") process.exit(1);
i += 1;
if (i >= lines.length || strip(lines[i]) !== "--------") process.exit(1);
i += 1;
const frame = [];
let closed = false;
for (; i < lines.length; i++) {
  const t = strip(lines[i]);
  if (t === "--------") { closed = true; break; }
  frame.push(t);
}
if (!closed) process.exit(1);
const re = /^session id: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const matches = [];
for (const line of frame) {
  const m = re.exec(line);
  if (m) matches.push(m[1]);
}
if (matches.length !== 1) process.exit(1);
process.stdout.write(matches[0]);
' "$stderr_path" 2>/dev/null
}
