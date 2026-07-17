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
  CODEX_RUN_DIR="$dir"
  CODEX_STDOUT="$dir/stdout"
  CODEX_STDERR="$dir/stderr"
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

codex_transport_kill_tree() {
  local pgid="$1"
  local signal="${2:-TERM}"
  case "$pgid" in
    ''|*[!0-9]*|0|1) return 0 ;;
  esac
  kill "-$signal" -- "-$pgid" 2>/dev/null || true
}

# Reap remaining members of pgid within a fixed cleanup budget (seconds).
# TERM first, then KILL after 1s; hard stop at budget. Returns 0 if clean.
codex_transport_reap_tree() {
  local pgid="$1"
  local budget_s="${2:-10}"
  local start now
  case "$pgid" in
    ''|*[!0-9]*|0|1) return 0 ;;
  esac
  if ! codex_transport_pgid_has_live "$pgid"; then
    return 0
  fi
  codex_transport_kill_tree "$pgid" TERM
  start="$(date +%s)"
  while codex_transport_pgid_has_live "$pgid"; do
    now="$(date +%s)"
    if [ $((now - start)) -ge 1 ]; then
      codex_transport_kill_tree "$pgid" KILL
    fi
    if [ $((now - start)) -ge "$budget_s" ]; then
      codex_transport_kill_tree "$pgid" KILL
      break
    fi
    sleep 0.1
  done
  codex_transport_kill_tree "$pgid" KILL
  if codex_transport_pgid_has_live "$pgid"; then
    return 1
  fi
  return 0
}

# Normalize timeout specs like "5m", "30s", or bare seconds → integer seconds.
codex_transport_timeout_seconds() {
  local t="$1"
  if [[ "$t" =~ ^([0-9]+)m$ ]]; then
    printf '%s' "$((BASH_REMATCH[1] * 60))"
    return 0
  fi
  if [[ "$t" =~ ^([0-9]+)s$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$t" =~ ^[0-9]+$ ]]; then
    printf '%s' "$t"
    return 0
  fi
  return 1
}

# Run the codex binary under process-group supervision.
# Sets: RUNNER_EXIT, CODEX_DEADLINE_HIT, CODEX_INCOMPLETE_TREE, CODEX_WORKER_PGID
#
# Args: bin model effort prompt_file stdout stderr sidecar timeout_spec
codex_transport_run() {
  local bin="$1"
  local model="$2"
  local effort="$3"
  local prompt="$4"
  local stdout_path="$5"
  local stderr_path="$6"
  local sidecar_path="$7"
  local timeout_spec="$8"

  CODEX_DEADLINE_HIT=0
  CODEX_INCOMPLETE_TREE=0
  CODEX_WORKER_PGID=""
  RUNNER_EXIT=0

  local deadline_secs
  deadline_secs="$(codex_transport_timeout_seconds "$timeout_spec")" || deadline_secs=300
  # Guard against zero/negative (would fire immediately).
  if [ "$deadline_secs" -lt 1 ]; then
    deadline_secs=1
  fi

  # New session ⇒ process-group identity is the session leader (setsid child).
  # Redirections attach before exec so the worker and same-group descendants
  # inherit the private capture fds. setsid-escaped grandchildren intentionally
  # leave the group (legacy settle path); same-group late writers are incomplete.
  setsid "$bin" exec --model "$model" \
    --sandbox read-only \
    -c "model_reasoning_effort=\"$effort\"" \
    --output-last-message "$sidecar_path" \
    < "$prompt" > "$stdout_path" 2> "$stderr_path" &
  local worker_pid=$!

  local pgid="" i
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
  CODEX_WORKER_PGID="$pgid"

  local start now state
  start="$(date +%s)"
  local timed_out=0

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
    sleep 0.05
  done

  if [ "$timed_out" -eq 1 ]; then
    # Terminal BEFORE signalling — deadline is not author time.
    CODEX_DEADLINE_HIT=1
    codex_transport_reap_tree "$pgid" 10 || CODEX_INCOMPLETE_TREE=1
    wait "$worker_pid" 2>/dev/null || true
    # Canonical deadline status for consumers (matches GNU timeout).
    RUNNER_EXIT=124
    # Final survivor check after wait.
    if codex_transport_pgid_has_live "$pgid"; then
      CODEX_INCOMPLETE_TREE=1
      codex_transport_kill_tree "$pgid" KILL
    fi
    return 0
  fi

  wait "$worker_pid" 2>/dev/null
  RUNNER_EXIT=$?

  # Frontend returned: same-group descendants mean incomplete tree (never recovery).
  if codex_transport_pgid_has_live "$pgid"; then
    CODEX_INCOMPLETE_TREE=1
    codex_transport_reap_tree "$pgid" 10 || true
  fi
  return 0
}

# True when stderr has a complete initial chrome frame (two -------- delimiters).
codex_transport_has_chrome_frame() {
  local stderr_path="$1"
  [ -r "$stderr_path" ] || return 1
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1]);
const lines = raw.toString("binary").split("\n");
let state = 0;
for (const line of lines) {
  const t = line.replace(/\r$/, "");
  if (t === "--------") {
    if (state === 0) { state = 1; continue; }
    if (state === 1) { process.exit(0); }
  }
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

# Extract exactly one canonical session id from the initial chrome frame.
# Prints the UUID on success; exits nonzero on any ambiguity/malformed/missing.
codex_transport_extract_session_id() {
  local stderr_path="$1"
  [ -r "$stderr_path" ] || return 1
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1]);
const lines = raw.toString("binary").split("\n");
const frame = [];
let state = 0;
for (const line of lines) {
  const t = line.replace(/\r$/, "");
  if (t === "--------") {
    if (state === 0) { state = 1; continue; }
    if (state === 1) { state = 2; break; }
  } else if (state === 1) {
    frame.push(t);
  }
}
if (state !== 2) process.exit(1);
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
