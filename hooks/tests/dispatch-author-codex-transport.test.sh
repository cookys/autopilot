#!/usr/bin/env bash
# Frozen D0-T v4.1 Codex author-transport contract (sections 12.3-12.7).
#
# This is a deterministic RED suite for the pre-hardening dispatcher. It drives
# the canonical Codex branch through a fake binary only: no model, network,
# installed cache, ledger, or consuming-repository state is touched.

# shellcheck source=/dev/null
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT_FILE="$TEST_TMP/prompt.txt"
PROMPT_SECRET="PROMPT-BODY-MUST-NOT-ENTER-RESULT"
printf '%s' "$PROMPT_SECRET" > "$PROMPT_FILE"

# Keep session-mode and endpoint discovery wholly inside the per-test sandbox.
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

UUID_A="11111111-1111-4111-8111-111111111111"
UUID_B="22222222-2222-4222-9222-222222222222"
CANDIDATE_BYTES=$'TRANSPORT-CANDIDATE\r\nline-two'
STDERR_SECRET="STDERR-BODY-MUST-NOT-ENTER-RESULT"

FAKE_CODEX="$TEST_TMP/fake-codex"
FAKE_ARGV_LOG="$TEST_TMP/fake.argv"
FAKE_RUN_COUNT_FILE="$TEST_TMP/fake.run-count"
FAKE_SIDECAR_PATH_FILE="$TEST_TMP/fake.sidecar-path"
FAKE_STDOUT_TARGET_FILE="$TEST_TMP/fake.stdout-target"
FAKE_STDERR_TARGET_FILE="$TEST_TMP/fake.stderr-target"
FAKE_PARENT_PID_FILE="$TEST_TMP/fake.parent-pid"
FAKE_CHILD_PID_FILE="$TEST_TMP/fake.child-pid"
FAKE_GRANDCHILD_PID_FILE="$TEST_TMP/fake.grandchild-pid"
FAKE_SETSID_PID_FILE="$TEST_TMP/fake.setsid-pid"
FAKE_LATE_PID_FILE="$TEST_TMP/fake.late-pid"
FAKE_ORPHAN_PID_FILE="$TEST_TMP/fake.orphan-pid"
FAKE_DEADLINE_ORPHAN_PID_FILE="$TEST_TMP/fake.deadline-orphan-pid"
FAKE_DELETED_FD_PID_FILE="$TEST_TMP/fake.deleted-fd-pid"
FAKE_PGID_FILE="$TEST_TMP/fake.pgid"
FAKE_TERM_MARKER="$TEST_TMP/fake.term-observed"
FAKE_ATTACK_MARKER="$TEST_TMP/fake.attack-observed"
FAKE_HARDLINK_PATH="$TEST_TMP/attacker-sidecar-hardlink"
FAKE_SYMLINK_TARGET="$TEST_TMP/attacker-sidecar-target"
CODEX_0145_PREBANNER_FIXTURE="$REPO_ROOT/hooks/tests/fixtures/dispatch-author/codex-0.145.0-prebanner.stderr"

export UUID_A UUID_B CANDIDATE_BYTES STDERR_SECRET
export FAKE_ARGV_LOG FAKE_RUN_COUNT_FILE FAKE_SIDECAR_PATH_FILE
export FAKE_STDOUT_TARGET_FILE FAKE_STDERR_TARGET_FILE FAKE_PARENT_PID_FILE
export FAKE_CHILD_PID_FILE FAKE_GRANDCHILD_PID_FILE FAKE_SETSID_PID_FILE FAKE_LATE_PID_FILE FAKE_ORPHAN_PID_FILE FAKE_DEADLINE_ORPHAN_PID_FILE FAKE_DELETED_FD_PID_FILE
export FAKE_PGID_FILE FAKE_TERM_MARKER FAKE_ATTACK_MARKER
export FAKE_HARDLINK_PATH FAKE_SYMLINK_TARGET
export CODEX_0145_PREBANNER_FIXTURE

TEST_SHELL_PGID="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]')"

pid_file_alive() {
  local file="$1"
  local pid state
  [ -r "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*|0|1) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(awk '{ print $3 }' "/proc/$pid/stat" 2>/dev/null || true)"
  [ "$state" != "Z" ]
}

recorded_survivor_count() {
  local count=0
  local file
  for file in "$FAKE_PARENT_PID_FILE" "$FAKE_CHILD_PID_FILE" "$FAKE_GRANDCHILD_PID_FILE" "$FAKE_SETSID_PID_FILE" "$FAKE_LATE_PID_FILE" "$FAKE_ORPHAN_PID_FILE" "$FAKE_DEADLINE_ORPHAN_PID_FILE" "$FAKE_DELETED_FD_PID_FILE"; do
    if pid_file_alive "$file"; then
      count=$((count + 1))
    fi
  done
  printf '%s\n' "$count"
}

all_recorded_processes_dead() {
  [ "$(recorded_survivor_count)" -eq 0 ]
}

cleanup_transport_processes() {
  local pgid=""
  local file pid

  if [ -r "$FAKE_PGID_FILE" ]; then
    pgid="$(tr -d '[:space:]' < "$FAKE_PGID_FILE" 2>/dev/null || true)"
  fi
  case "$pgid" in
    ''|*[!0-9]*|0|1) ;;
    *)
      if [ "$pgid" != "$TEST_SHELL_PGID" ]; then
        kill -KILL -- "-$pgid" 2>/dev/null || true
      fi
      ;;
  esac

  for file in "$FAKE_PARENT_PID_FILE" "$FAKE_CHILD_PID_FILE" "$FAKE_GRANDCHILD_PID_FILE" "$FAKE_SETSID_PID_FILE" "$FAKE_LATE_PID_FILE" "$FAKE_ORPHAN_PID_FILE" "$FAKE_DEADLINE_ORPHAN_PID_FILE" "$FAKE_DELETED_FD_PID_FILE"; do
    [ -r "$file" ] || continue
    pid="$(cat "$file" 2>/dev/null || true)"
    case "$pid" in ''|*[!0-9]*|0|1) continue ;; esac
    kill -KILL "$pid" 2>/dev/null || true
  done
}

cleanup_codex_transport_test() {
  cleanup_transport_processes
  cleanup_test_tmp
}
trap cleanup_codex_transport_test EXIT

cat > "$FAKE_CODEX" <<'FAKE'
#!/usr/bin/env bash
set -uo pipefail

if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "codex-cli 0.test.0"
  exit 0
fi

for arg in "$@"; do
  if [ "$arg" = "--help" ]; then
    printf '%s\n' "Usage: codex exec [--output-last-message PATH]"
    exit 0
  fi
done

{
  printf '%s\n' "__CALL__"
  printf '%s\n' "$@"
} >> "$FAKE_ARGV_LOG"
printf '%s\n' "1" >> "$FAKE_RUN_COUNT_FILE"
printf '%s\n' "$$" > "$FAKE_PARENT_PID_FILE"
ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]' > "$FAKE_PGID_FILE" || true
readlink "/proc/$$/fd/1" > "$FAKE_STDOUT_TARGET_FILE" 2>/dev/null || : > "$FAKE_STDOUT_TARGET_FILE"
readlink "/proc/$$/fd/2" > "$FAKE_STDERR_TARGET_FILE" 2>/dev/null || : > "$FAKE_STDERR_TARGET_FILE"

sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done
printf '%s' "$sidecar" > "$FAKE_SIDECAR_PATH_FILE"

# Consume the exact prompt stream; none of its bytes are reflected into result metadata.
cat > /dev/null

emit_chrome() {
  case "${FAKE_SCENARIO:-}" in
    codex_0145_prebanner_fixture)
      cat "$CODEX_0145_PREBANNER_FIXTURE" >&2
      return
      ;;
    prebanner)
      printf '%s\n' "Reading prompt from stdin..." >&2
      ;;
    prebanner_crlf)
      printf '%s\r\n' \
        "Reading prompt from stdin..." \
        "OpenAI Codex v0.145.0" \
        "--------" \
        "workdir: /fixture/repo" \
        "model: gpt-5.5" \
        "provider: openai" \
        "sandbox: read-only" \
        "reasoning effort: xhigh" \
        "session id: $UUID_A" \
        "--------" \
        "user" \
        "$STDERR_SECRET" >&2
      return
      ;;
    prebanner_ansi)
      printf '\033[32m%s\033[0m\n' "Reading prompt from stdin..." >&2
      ;;
    prebanner_duplicate)
      printf '%s\n%s\n' "Reading prompt from stdin..." "Reading prompt from stdin..." >&2
      ;;
    prebanner_near_match)
      printf '%s\n' "Reading prompt from stdin.." >&2
      ;;
    prebanner_extra_prefix)
      printf '%s\n%s\n' "notice: preparing prompt" "Reading prompt from stdin..." >&2
      ;;
    prebanner_model_injected)
      printf '%s\n%s\n' "Reading prompt from stdin..." "model: attacker-controlled" >&2
      ;;
    prebanner_session_injected)
      printf '%s\n' "Reading prompt from stdin..." >&2
      printf 'session id: %s\n' "$UUID_B" >&2
      ;;
    prebanner_duplicate_banner)
      printf '%s\n%s\n' "Reading prompt from stdin..." "OpenAI Codex v0.144.0" >&2
      ;;
  esac
  if [ "${FAKE_SCENARIO:-}" = "preframe_fake_frame" ]; then
    printf '%s\n' "--------" >&2
    printf 'session id: %s\n' "$UUID_B" >&2
    printf '%s\n' "--------" >&2
  fi
  if [ "${FAKE_SCENARIO:-}" = "prebanner" ]; then
    printf '%s\n' "OpenAI Codex v0.145.0" >&2
  else
    printf '%s\n' "OpenAI Codex v0.test.0" >&2
  fi
  printf '%s\n' "--------" >&2
  printf '%s\n' "workdir: /fixture/repo" >&2
  printf '%s\n' "model: gpt-5.5" >&2
  printf '%s\n' "provider: openai" >&2
  printf '%s\n' "sandbox: read-only" >&2
  printf '%s\n' "reasoning effort: xhigh" >&2
  case "${FAKE_SCENARIO:-exact}" in
    session_missing|session_injected|postframe_second_frame) ;;
    session_duplicate)
      printf 'session id: %s\n' "$UUID_A" >&2
      printf 'session id: %s\n' "$UUID_B" >&2
      ;;
    session_malformed)
      printf '%s\n' "session id: definitely-not-a-canonical-uuid" >&2
      ;;
    *)
      printf 'session id: %s\n' "$UUID_A" >&2
      ;;
  esac
  printf '%s\n' "--------" >&2
  printf '%s\n' "user" >&2
  printf '%s\n' "$STDERR_SECRET" >&2
  if [ "${FAKE_SCENARIO:-}" = "session_injected" ]; then
    printf 'session id: %s\n' "$UUID_B" >&2
  fi
  if [ "${FAKE_SCENARIO:-}" = "postframe_second_frame" ]; then
    printf '%s\n' "--------" >&2
    printf 'session id: %s\n' "$UUID_B" >&2
    printf '%s\n' "--------" >&2
  fi
}

write_stdout_exact() { printf '%s' "$CANDIDATE_BYTES"; }
write_sidecar_exact() {
  [ -n "$sidecar" ] || return 0
  printf '%s' "$CANDIDATE_BYTES" > "$sidecar"
}
write_complete_pair() {
  write_stdout_exact
  write_sidecar_exact
}

if [ "${FAKE_SCENARIO:-}" != "no_chrome" ]; then
  emit_chrome
else
  printf '%s\n' "warning: bare warning line" >&2
fi

case "${FAKE_SCENARIO:-exact}" in
  exact|codex_0145_prebanner_fixture|prebanner|prebanner_crlf|prebanner_ansi|prebanner_duplicate|prebanner_near_match|prebanner_extra_prefix|prebanner_model_injected|prebanner_session_injected|prebanner_duplicate_banner|session_missing|session_duplicate|session_malformed|session_injected|no_chrome|preframe_fake_frame|postframe_second_frame)
    write_complete_pair
    exit 0
    ;;
  stdout_lf)
    printf '%s\n' "$CANDIDATE_BYTES"
    write_sidecar_exact
    exit 0
    ;;
  sidecar_missing)
    write_stdout_exact
    [ -n "$sidecar" ] && rm -f "$sidecar"
    exit 0
    ;;
  sidecar_empty)
    write_stdout_exact
    [ -n "$sidecar" ] && : > "$sidecar"
    exit 0
    ;;
  sidecar_mismatch)
    write_stdout_exact
    [ -n "$sidecar" ] && printf '%s' "DIFFERENT-COMPLETE-LOOKING-CONTENT" > "$sidecar"
    exit 0
    ;;
  sidecar_inverse_lf)
    write_stdout_exact
    [ -n "$sidecar" ] && printf '%s\n' "$CANDIDATE_BYTES" > "$sidecar"
    exit 0
    ;;
  sidecar_only)
    write_sidecar_exact
    exit 0
    ;;
  nonzero)
    write_complete_pair
    exit 42
    ;;
  exit124)
    write_complete_pair
    exit 124
    ;;
  signal)
    write_complete_pair
    kill -TERM "$$"
    sleep 1
    exit 99
    ;;
  deadline)
    write_complete_pair
    trap 'printf "%s" "LATE-BYTES-MUST-NOT-RECOVER"; : > "$FAKE_TERM_MARKER"; exit 0' TERM
    sleep 30
    exit 0
    ;;
  sidecar_hardlink)
    write_complete_pair
    if [ -n "$sidecar" ] && ln "$sidecar" "$FAKE_HARDLINK_PATH" 2>/dev/null; then
      : > "$FAKE_ATTACK_MARKER"
    fi
    exit 0
    ;;
  sidecar_symlink)
    write_stdout_exact
    if [ -n "$sidecar" ]; then
      rm -f "$sidecar"
      printf '%s' "$CANDIDATE_BYTES" > "$FAKE_SYMLINK_TARGET"
      if ln -s "$FAKE_SYMLINK_TARGET" "$sidecar" 2>/dev/null; then
        : > "$FAKE_ATTACK_MARKER"
      fi
    fi
    exit 0
    ;;
  late_flush)
    write_sidecar_exact
    (
      trap '' TERM
      printf '%s\n' "$BASHPID" > "$FAKE_LATE_PID_FILE"
      sleep 0.5
      printf '%s' "$CANDIDATE_BYTES"
    ) &
    exit 0
    ;;
  term_tree)
    write_complete_pair
    trap '' TERM
    (
      trap '' TERM
      printf '%s\n' "$BASHPID" > "$FAKE_CHILD_PID_FILE"
      (
        trap '' TERM
        printf '%s\n' "$BASHPID" > "$FAKE_GRANDCHILD_PID_FILE"
        setsid bash -c '
          trap "" TERM
          printf "%s\n" "$BASHPID" > "$FAKE_SETSID_PID_FILE"
          while :; do sleep 1; done
        ' &
        while :; do sleep 1; done
      ) &
      wait
    ) &
    wait
    exit 0
    ;;
  orphan_writer_exit0)
    setsid bash -c '
      trap "" TERM
      printf "%s\n" "$BASHPID" > "$FAKE_ORPHAN_PID_FILE"
      for i in {1..30}; do
        sleep 1
      done
    ' &
    sleep 0.1
    write_complete_pair
    exit 0
    ;;
  deadline_setsid_orphan)
    setsid bash -c '
      trap "" TERM
      printf "%s\n" "$BASHPID" > "$FAKE_DEADLINE_ORPHAN_PID_FILE"
      sleep 30
    ' &
    sleep 0.1
    write_complete_pair
    trap 'printf "%s" "LATE-BYTES-MUST-NOT-RECOVER"; : > "$FAKE_TERM_MARKER"; exit 0' TERM
    sleep 30
    exit 0
    ;;
  orphan_deleted_fd_holder)
    setsid bash -c '
      trap "" TERM
      printf "%s\n" "$BASHPID" > "$FAKE_DELETED_FD_PID_FILE"
      target_path="$(cat "$FAKE_STDOUT_TARGET_FILE" 2>/dev/null)"
      if [ -n "$target_path" ]; then
        rm -f "$target_path"
      fi
      sleep 30
    ' &
    sleep 0.1
    write_complete_pair
    exit 0
    ;;
  *)
    printf 'unknown fake scenario: %s\n' "${FAKE_SCENARIO:-}" >&2
    exit 97
    ;;
esac
FAKE
chmod +x "$FAKE_CODEX"

EXPECTED_EXACT="$TEST_TMP/expected.exact"
EXPECTED_STDOUT_LF="$TEST_TMP/expected.stdout-lf"
printf '%s' "$CANDIDATE_BYTES" > "$EXPECTED_EXACT"
printf '%s\n' "$CANDIDATE_BYTES" > "$EXPECTED_STDOUT_LF"

json_field() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY' 2>/dev/null
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        value = json.load(handle).get(sys.argv[2])
except Exception:
    sys.exit(1)
if value is None:
    print("")
elif isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
}

json_find_first() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY' 2>/dev/null
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        root = json.load(handle)
except Exception:
    sys.exit(1)

needle = sys.argv[2]
def walk(value):
    if isinstance(value, dict):
        if needle in value:
            return value[needle]
        for child in value.values():
            found = walk(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = walk(child)
            if found is not None:
                return found
    return None

found = walk(root)
if found is None:
    print("")
elif isinstance(found, bool):
    print("true" if found else "false")
else:
    print(found)
PY
}

read_file_or_empty() {
  if [ -r "$1" ]; then
    cat "$1"
  fi
}

fake_flag_count() {
  if [ ! -r "$FAKE_ARGV_LOG" ]; then
    printf '%s\n' "0"
    return
  fi
  awk '$0 == "--output-last-message" { count += 1 } END { print count + 0 }' "$FAKE_ARGV_LOG"
}

fake_run_count() {
  if [ -r "$FAKE_RUN_COUNT_FILE" ]; then
    wc -l < "$FAKE_RUN_COUNT_FILE" | tr -d '[:space:]'
  else
    printf '%s\n' "0"
  fi
}

reset_observation() {
  cleanup_transport_processes
  rm -f \
    "$FAKE_ARGV_LOG" "$FAKE_RUN_COUNT_FILE" "$FAKE_SIDECAR_PATH_FILE" \
    "$FAKE_STDOUT_TARGET_FILE" "$FAKE_STDERR_TARGET_FILE" \
    "$FAKE_PARENT_PID_FILE" "$FAKE_CHILD_PID_FILE" "$FAKE_GRANDCHILD_PID_FILE" \
    "$FAKE_SETSID_PID_FILE" "$FAKE_LATE_PID_FILE" "$FAKE_ORPHAN_PID_FILE" \
    "$FAKE_DEADLINE_ORPHAN_PID_FILE" "$FAKE_DELETED_FD_PID_FILE" \
    "$FAKE_PGID_FILE" "$FAKE_TERM_MARKER" \
    "$FAKE_ATTACK_MARKER" "$FAKE_HARDLINK_PATH" "$FAKE_SYMLINK_TARGET"
}

RUN_SETTLE_MS=0
RUN_EMPTY_GRACE_MS=0
RUN_STABLE_POLLS=1

run_dispatch() {
  local scenario="$1"
  shift
  local out_file="$TEST_TMP/dispatch-result.json"
  local err_file="$TEST_TMP/dispatch-wrapper.stderr"

  reset_observation
  : > "$out_file"
  : > "$err_file"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" \
    DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 \
    AUTOPILOT_SETTLE_MS="$RUN_SETTLE_MS" \
    AUTOPILOT_EMPTY_GRACE_MS="$RUN_EMPTY_GRACE_MS" \
    AUTOPILOT_STABLE_POLLS="$RUN_STABLE_POLLS" \
    FAKE_SCENARIO="$scenario" \
    "$SCRIPT" "$@" --prompt-file "$PROMPT_FILE" --bin "$FAKE_CODEX" \
    > "$out_file" 2> "$err_file"
  DISPATCH_RC=$?
  DISPATCH_JSON="$(cat "$out_file")"
  DISPATCH_STATUS="$(json_field "$out_file" status || true)"
  DISPATCH_RAW_LOG="$(json_field "$out_file" raw_log || true)"
  DISPATCH_SELECTION_SOURCE="$(json_field "$out_file" selection_source || true)"
  DISPATCH_SESSION_ID="$(json_find_first "$out_file" session_id || true)"
}

assert_nonempty() {
  local value="$1"
  local message="$2"
  if [ -n "$value" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$message: expected a non-empty value"
  fi
}

assert_authored() {
  local label="$1"
  assert_eq "$DISPATCH_RC" "0" "$label: dispatcher exit"
  assert_eq "$DISPATCH_STATUS" "authored" "$label: status"
}

assert_rejected() {
  local label="$1"
  assert_neq "$DISPATCH_RC" "0" "$label: dispatcher must fail closed"
  assert_neq "$DISPATCH_STATUS" "authored" "$label: status must not be authored"
}

assert_private_regular_file() {
  local path="$1"
  local label="$2"
  if [ -z "$path" ]; then
    fail "$label: artifact path is absent"
    return
  fi
  if [ ! -f "$path" ] || [ -L "$path" ]; then
    fail "$label: expected retained non-symlink regular file at $path"
    return
  fi
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  assert_eq "$(stat -c '%a' "$path")" "600" "$label: mode 0600"
  assert_eq "$(stat -c '%u' "$path")" "$(id -u)" "$label: owner"
  assert_eq "$(stat -c '%h' "$path")" "1" "$label: link count one"
}

assert_file_bytes() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ ! -f "$actual" ]; then
    fail "$label: missing file $actual"
    return
  fi
  cmp -s "$actual" "$expected"
  assert_eq "$?" "0" "$label: exact bytes"
}

assert_stdout_plus_one_lf() {
  local stdout_path="$1"
  local sidecar_path="$2"
  local label="$3"
  python3 - "$stdout_path" "$sidecar_path" <<'PY' >/dev/null 2>&1
import pathlib
import sys
stdout = pathlib.Path(sys.argv[1]).read_bytes()
sidecar = pathlib.Path(sys.argv[2]).read_bytes()
sys.exit(0 if stdout == sidecar + b"\n" else 1)
PY
  assert_eq "$?" "0" "$label"
}

# ---------------------------------------------------------------------------
# Positive witness and private-channel contract (explicit CLI compatibility).
# ---------------------------------------------------------------------------
run_dispatch exact --runner codex --model gpt-5.5 --effort xhigh
assert_authored "exact witness"
assert_eq "$(fake_run_count)" "1" "exact witness: one runner attempt"
assert_eq "$(fake_flag_count)" "1" "exact witness: one internal --output-last-message"

EXACT_SIDECAR="$(read_file_or_empty "$FAKE_SIDECAR_PATH_FILE")"
EXACT_STDOUT_TARGET="$(read_file_or_empty "$FAKE_STDOUT_TARGET_FILE")"
EXACT_STDERR_TARGET="$(read_file_or_empty "$FAKE_STDERR_TARGET_FILE")"
assert_nonempty "$EXACT_SIDECAR" "exact witness: internal sidecar path"
assert_nonempty "$EXACT_STDOUT_TARGET" "exact witness: stdout target"
assert_nonempty "$EXACT_STDERR_TARGET" "exact witness: stderr target"
assert_eq "$DISPATCH_RAW_LOG" "$EXACT_STDOUT_TARGET" "exact witness: raw_log remains stdout authority"
assert_eq "$DISPATCH_SESSION_ID" "$UUID_A" "exact witness: anchored session id projection"
assert_neq "$EXACT_STDOUT_TARGET" "$EXACT_STDERR_TARGET" "channel separation: stdout != stderr"
assert_neq "$EXACT_STDOUT_TARGET" "$EXACT_SIDECAR" "channel separation: stdout != sidecar"
assert_neq "$EXACT_STDERR_TARGET" "$EXACT_SIDECAR" "channel separation: stderr != sidecar"

assert_private_regular_file "$EXACT_STDOUT_TARGET" "private stdout"
assert_private_regular_file "$EXACT_STDERR_TARGET" "private stderr"
assert_private_regular_file "$EXACT_SIDECAR" "private sidecar"

if [ -n "$EXACT_STDOUT_TARGET" ] && [ -n "$EXACT_STDERR_TARGET" ] && [ -n "$EXACT_SIDECAR" ]; then
  EXACT_RUN_DIR="$(dirname "$EXACT_STDOUT_TARGET")"
  assert_eq "$(dirname "$EXACT_STDERR_TARGET")" "$EXACT_RUN_DIR" "private artifacts: common stderr run dir"
  assert_eq "$(dirname "$EXACT_SIDECAR")" "$EXACT_RUN_DIR" "private artifacts: common sidecar run dir"
  assert_eq "$(stat -c '%a' "$EXACT_RUN_DIR" 2>/dev/null || true)" "700" "private run dir: mode 0700"
  assert_eq "$(stat -c '%u' "$EXACT_RUN_DIR" 2>/dev/null || true)" "$(id -u)" "private run dir: owner"
else
  fail "private artifacts: cannot prove a common dispatcher-owned run directory"
fi

assert_file_bytes "$EXACT_STDOUT_TARGET" "$EXPECTED_EXACT" "stdout authority"
assert_file_bytes "$EXACT_SIDECAR" "$EXPECTED_EXACT" "exact sidecar witness"
if [ -r "$EXACT_STDERR_TARGET" ]; then
  EXACT_STDERR_BYTES="$(cat "$EXACT_STDERR_TARGET")"
  assert_contains "$EXACT_STDERR_BYTES" "$STDERR_SECRET" "stderr channel retains sensitive fixture"
  assert_not_contains "$EXACT_STDERR_BYTES" "$CANDIDATE_BYTES" "stderr channel does not receive candidate"
else
  fail "stderr channel: retained artifact is unreadable"
fi
if [ -r "$EXACT_STDOUT_TARGET" ]; then
  assert_not_contains "$(cat "$EXACT_STDOUT_TARGET")" "$STDERR_SECRET" "stdout excludes stderr bytes"
fi
if [ -r "$EXACT_SIDECAR" ]; then
  assert_not_contains "$(cat "$EXACT_SIDECAR")" "$STDERR_SECRET" "sidecar excludes stderr bytes"
fi
assert_not_contains "$DISPATCH_JSON" "$CANDIDATE_BYTES" "result JSON excludes candidate body"
assert_not_contains "$DISPATCH_JSON" "$STDERR_SECRET" "result JSON excludes stderr body"
assert_not_contains "$DISPATCH_JSON" "$PROMPT_SECRET" "result JSON excludes prompt body"

# ---------------------------------------------------------------------------
# Codex 0.145.0 may emit one exact benign prompt-source line before chrome.
# The retained G0 stderr fixture hash is:
# fc2e8df167caa1165ce44778c466811eb6a02e4abaf394ffefbe36a4ce2dec5b
# ---------------------------------------------------------------------------
run_dispatch codex_0145_prebanner_fixture --runner codex --model gpt-5.6-sol --effort xhigh
assert_authored "Codex 0.145.0 retained pre-banner fixture"
assert_eq "$DISPATCH_SESSION_ID" "019f94b1-7105-7f60-81a8-82b23cb81f46" "Codex 0.145.0 retained fixture: anchored session id"

run_dispatch prebanner --runner codex --model gpt-5.5 --effort xhigh
assert_authored "exact benign pre-banner"
assert_eq "$DISPATCH_SESSION_ID" "$UUID_A" "exact benign pre-banner: anchored session id"

run_dispatch prebanner_crlf --runner codex --model gpt-5.5 --effort xhigh
assert_authored "CRLF benign pre-banner and chrome"
assert_eq "$DISPATCH_SESSION_ID" "$UUID_A" "CRLF benign pre-banner: anchored session id"

for scenario in prebanner_ansi prebanner_duplicate prebanner_near_match prebanner_extra_prefix prebanner_model_injected prebanner_session_injected prebanner_duplicate_banner; do
  run_dispatch "$scenario" --runner codex --model gpt-5.5 --effort xhigh
  assert_rejected "adversarial $scenario"
  assert_eq "$(fake_run_count)" "1" "adversarial $scenario: one attempt"
  assert_not_contains "$DISPATCH_JSON" "$UUID_A" "adversarial $scenario: UUID_A not adopted"
  assert_not_contains "$DISPATCH_JSON" "$UUID_B" "adversarial $scenario: UUID_B not adopted"
done

# ---------------------------------------------------------------------------
# The only other accepted witness: stdout == sidecar + exactly one LF.
# Run through strict-roster to prove transport hardening remains below selection.
# ---------------------------------------------------------------------------
ROSTER_REPO="$TEST_TMP/strict-roster-repo"
mkdir -p "$ROSTER_REPO/.claude"
cat > "$ROSTER_REPO/.claude/review-loop-config.md" <<'EOF'
- verification_author_present: true
- verification_author_engine: gpt-5.5
- verification_author_runner: codex
- verification_author_effort: xhigh
- verification_author_endpoint:
- implementer_engine: Gemini 3.1 Pro (High)
EOF

run_dispatch stdout_lf --strict-roster --repo-root "$ROSTER_REPO"
assert_authored "stdout plus one LF witness"
assert_eq "$DISPATCH_SELECTION_SOURCE" "strict_roster" "stdout plus one LF: strict-roster provenance preserved"
assert_eq "$(fake_run_count)" "1" "stdout plus one LF: one runner attempt"
assert_eq "$(fake_flag_count)" "1" "stdout plus one LF: internal sidecar flag"
LF_SIDECAR="$(read_file_or_empty "$FAKE_SIDECAR_PATH_FILE")"
LF_STDOUT_TARGET="$(read_file_or_empty "$FAKE_STDOUT_TARGET_FILE")"
assert_stdout_plus_one_lf "$LF_STDOUT_TARGET" "$LF_SIDECAR" "stdout plus one LF: exact allowed relation"
assert_eq "$DISPATCH_SESSION_ID" "$UUID_A" "stdout plus one LF: anchored session id"

# ---------------------------------------------------------------------------
# Witness failures. No repair, inverse-LF allowance, or channel substitution.
# ---------------------------------------------------------------------------
for scenario in no_chrome sidecar_missing sidecar_empty sidecar_mismatch sidecar_inverse_lf sidecar_only; do
  run_dispatch "$scenario" --runner codex --model gpt-5.5 --effort xhigh
  assert_rejected "witness $scenario"
  assert_eq "$(fake_run_count)" "1" "witness $scenario: one attempt"
  assert_not_contains "$DISPATCH_JSON" "$CANDIDATE_BYTES" "witness $scenario: no body in result"
done

# ---------------------------------------------------------------------------
# Exit truth precedes complete-looking stdout/sidecar/chrome content.
# Preserve the existing runner_failed status/exit consumer contract.
# ---------------------------------------------------------------------------
for scenario in nonzero exit124 signal; do
  run_dispatch "$scenario" --runner codex --model gpt-5.5 --effort xhigh
  assert_eq "$DISPATCH_RC" "3" "exit-first $scenario: dispatcher exit"
  assert_eq "$DISPATCH_STATUS" "runner_failed" "exit-first $scenario: status"
  assert_not_contains "$DISPATCH_JSON" "$UUID_A" "exit-first $scenario: session channel not parsed"
  assert_not_contains "$DISPATCH_JSON" "$CANDIDATE_BYTES" "exit-first $scenario: candidate body not promoted"
done

run_dispatch deadline --runner codex --model gpt-5.5 --effort xhigh --timeout 1s
assert_eq "$DISPATCH_RC" "3" "deadline: dispatcher exit"
assert_eq "$DISPATCH_STATUS" "runner_failed" "deadline: status"
assert_file_exists "$FAKE_TERM_MARKER" "deadline: TERM precedes cleanup"
assert_not_contains "$DISPATCH_JSON" "$UUID_A" "deadline: session channel not parsed"
assert_not_contains "$DISPATCH_JSON" "LATE-BYTES-MUST-NOT-RECOVER" "deadline: late bytes never enter result"

# ---------------------------------------------------------------------------
# Session IDs are accepted only from one canonical line in initial chrome.
# ---------------------------------------------------------------------------
for scenario in session_missing session_duplicate session_malformed session_injected preframe_fake_frame postframe_second_frame; do
  run_dispatch "$scenario" --runner codex --model gpt-5.5 --effort xhigh
  assert_rejected "session $scenario"
  assert_eq "$(fake_run_count)" "1" "session $scenario: one attempt"
  assert_not_contains "$DISPATCH_JSON" "$UUID_A" "session $scenario: UUID_A not adopted"
  assert_not_contains "$DISPATCH_JSON" "$UUID_B" "session $scenario: UUID_B not adopted"
done

# ---------------------------------------------------------------------------
# Post-run inode integrity: same-user runner cannot swap/link the witness path.
# ---------------------------------------------------------------------------
for scenario in sidecar_hardlink sidecar_symlink; do
  run_dispatch "$scenario" --runner codex --model gpt-5.5 --effort xhigh
  assert_file_exists "$FAKE_ATTACK_MARKER" "artifact $scenario: attack fixture executed"
  assert_rejected "artifact $scenario"
done

# Caller output paths remain forbidden even though the dispatcher passes one internally.
CALLER_PATH="$TEST_TMP/caller-controlled-sidecar"
run_dispatch exact --runner codex --model gpt-5.5 --effort xhigh --output-last-message "$CALLER_PATH"
assert_eq "$DISPATCH_RC" "2" "caller sidecar path: usage rejection"
assert_eq "$(fake_run_count)" "0" "caller sidecar path: runner never starts"
assert_file_absent "$CALLER_PATH" "caller sidecar path: target never created"

# ---------------------------------------------------------------------------
# Frontend exit with a late writer is a failed/incomplete tree, never recovery.
# ---------------------------------------------------------------------------
RUN_SETTLE_MS=2000
RUN_EMPTY_GRACE_MS=2000
RUN_STABLE_POLLS=2
run_dispatch late_flush --runner codex --model gpt-5.5 --effort xhigh
RUN_SETTLE_MS=0
RUN_EMPTY_GRACE_MS=0
RUN_STABLE_POLLS=1
assert_rejected "late flush"
assert_eq "$(fake_run_count)" "1" "late flush: no retry"
if ! poll_until 3 all_recorded_processes_dead; then
  fail "late flush: descendant survived dispatcher return"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ---------------------------------------------------------------------------
# TERM-ignoring parent/child/grandchild: deadline must return after bounded reap
# and no recorded descendant may remain. An outer watchdog is test cleanup only;
# triggering it is itself RED and it forcibly prevents a leaking base process.
# ---------------------------------------------------------------------------
run_term_tree_case() {
  local out_file="$TEST_TMP/tree-result.json"
  local err_file="$TEST_TMP/tree-wrapper.stderr"
  local outer_pid start now max_wait

  reset_observation
  : > "$out_file"
  : > "$err_file"
  setsid env \
    HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" \
    DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 \
    AUTOPILOT_SETTLE_MS=0 AUTOPILOT_EMPTY_GRACE_MS=0 AUTOPILOT_STABLE_POLLS=1 \
    FAKE_SCENARIO=term_tree \
    "$SCRIPT" --runner codex --model gpt-5.5 --effort xhigh --timeout 1s \
    --prompt-file "$PROMPT_FILE" --bin "$FAKE_CODEX" \
    > "$out_file" 2> "$err_file" &
  outer_pid=$!
  TREE_OUTER_TIMEOUT=0
  max_wait="$(test_timing_scale 16)"
  start="$(date +%s)"

  while pid_file_alive <(printf '%s\n' "$outer_pid"); do
    now="$(date +%s)"
    if [ $((now - start)) -ge "$max_wait" ]; then
      TREE_OUTER_TIMEOUT=1
      break
    fi
    sleep 0.1
  done

  TREE_SURVIVORS_BEFORE_CLEANUP="$(recorded_survivor_count)"
  if [ "$TREE_OUTER_TIMEOUT" -eq 1 ]; then
    cleanup_transport_processes
    kill -TERM "$outer_pid" 2>/dev/null || true
    sleep 0.2
    kill -KILL "$outer_pid" 2>/dev/null || true
  fi
  wait "$outer_pid" 2>/dev/null
  TREE_DISPATCH_RC=$?
  TREE_STATUS="$(json_field "$out_file" status || true)"

  cleanup_transport_processes
  if ! poll_until 3 all_recorded_processes_dead; then
    fail "term tree: test cleanup could not reap all recorded fixture processes"
  fi
}

if ! command -v setsid >/dev/null 2>&1; then
  fail "term tree: infrastructure requires setsid"
else
  run_term_tree_case
  assert_file_exists "$FAKE_CHILD_PID_FILE" "term tree: TERM-ignoring child started"
  assert_file_exists "$FAKE_GRANDCHILD_PID_FILE" "term tree: TERM-ignoring grandchild started"
  assert_file_exists "$FAKE_SETSID_PID_FILE" "term tree: setsid descendant started"
  assert_eq "$(fake_run_count)" "1" "term tree: one runner attempt"
  assert_eq "$TREE_OUTER_TIMEOUT" "0" "term tree: dispatcher returns within deadline + 10s cleanup"
  assert_eq "$TREE_SURVIVORS_BEFORE_CLEANUP" "0" "term tree: no parent/child/grandchild/setsid survives dispatcher return"
  assert_neq "$TREE_DISPATCH_RC" "0" "term tree: deadline is terminal"
  assert_neq "$TREE_STATUS" "authored" "term tree: complete-looking pre-deadline bytes stay rejected"
fi

# ---------------------------------------------------------------------------
# Negative control: orphan_writer_exit0
# A runner exiting 0 with a surviving descendant that still holds the private
# capture channels is an incomplete process tree, and must be rejected.
# ---------------------------------------------------------------------------
if ! command -v setsid >/dev/null 2>&1; then
  fail "orphan writer exit0: infrastructure requires setsid"
else
  run_dispatch orphan_writer_exit0 --runner codex --model gpt-5.5 --effort xhigh
  assert_rejected "orphan writer exit0"
  assert_eq "$(fake_run_count)" "1" "orphan writer exit0: one runner attempt"

  # The dispatcher owns cleanup of detected holders; the orphan should be killed.
  # Poll with a 3s budget to check if the orphan PID is dead.
  orphan_dead() {
    ! pid_file_alive "$FAKE_ORPHAN_PID_FILE"
  }
  if ! poll_until 3 orphan_dead; then
    fail "orphan writer exit0: descendant survived dispatcher return"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi

  # Follow run_term_tree_case's cleanup discipline to avoid leak
  cleanup_transport_processes
  if ! poll_until 3 all_recorded_processes_dead; then
    fail "orphan writer exit0: test cleanup could not reap all recorded fixture processes"
  fi
fi

# ---------------------------------------------------------------------------
# Negative control: deadline_setsid_orphan
# ---------------------------------------------------------------------------
run_deadline_setsid_orphan_case() {
  local out_file="$TEST_TMP/deadline-orphan-result.json"
  local err_file="$TEST_TMP/deadline-orphan-wrapper.stderr"
  local outer_pid start now max_wait

  reset_observation
  : > "$out_file"
  : > "$err_file"
  setsid env \
    HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" \
    DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 \
    AUTOPILOT_SETTLE_MS=0 AUTOPILOT_EMPTY_GRACE_MS=0 AUTOPILOT_STABLE_POLLS=1 \
    FAKE_SCENARIO=deadline_setsid_orphan \
    "$SCRIPT" --runner codex --model gpt-5.5 --effort xhigh --timeout 1s \
    --prompt-file "$PROMPT_FILE" --bin "$FAKE_CODEX" \
    > "$out_file" 2> "$err_file" &
  outer_pid=$!
  ORPHAN_OUTER_TIMEOUT=0
  max_wait="$(test_timing_scale 16)"
  start="$(date +%s)"

  while pid_file_alive <(printf '%s\n' "$outer_pid"); do
    now="$(date +%s)"
    if [ $((now - start)) -ge "$max_wait" ]; then
      ORPHAN_OUTER_TIMEOUT=1
      break
    fi
    sleep 0.1
  done

  ORPHAN_SURVIVORS_BEFORE_CLEANUP="$(recorded_survivor_count)"
  if [ "$ORPHAN_OUTER_TIMEOUT" -eq 1 ]; then
    cleanup_transport_processes
    kill -TERM "$outer_pid" 2>/dev/null || true
    sleep 0.2
    kill -KILL "$outer_pid" 2>/dev/null || true
  fi
  wait "$outer_pid" 2>/dev/null
  ORPHAN_DISPATCH_RC=$?
  ORPHAN_STATUS="$(json_field "$out_file" status || true)"

  cleanup_transport_processes
  if ! poll_until 3 all_recorded_processes_dead; then
    fail "deadline setsid orphan: test cleanup could not reap all recorded fixture processes"
  fi
}

if ! command -v setsid >/dev/null 2>&1; then
  fail "deadline setsid orphan: infrastructure requires setsid"
else
  run_deadline_setsid_orphan_case
  assert_file_exists "$FAKE_DEADLINE_ORPHAN_PID_FILE" "deadline setsid orphan: setsid descendant started"
  assert_eq "$(fake_run_count)" "1" "deadline setsid orphan: one runner attempt"
  assert_eq "$ORPHAN_OUTER_TIMEOUT" "0" "deadline setsid orphan: dispatcher returns within deadline + 10s cleanup"
  assert_neq "$ORPHAN_DISPATCH_RC" "0" "deadline setsid orphan: dispatcher exit must be nonzero"
  assert_neq "$ORPHAN_STATUS" "authored" "deadline setsid orphan: status must not be authored"
  
  deadline_orphan_dead() {
    ! pid_file_alive "$FAKE_DEADLINE_ORPHAN_PID_FILE"
  }
  if ! poll_until 3 deadline_orphan_dead; then
    fail "deadline setsid orphan: setsid orphan descendant survived dispatcher return"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi

  if [ "$ORPHAN_SURVIVORS_BEFORE_CLEANUP" -ne 0 ]; then
    fail "deadline setsid orphan: recorded processes survived dispatcher return"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Negative control: orphan_deleted_fd_holder
# ---------------------------------------------------------------------------
if ! command -v setsid >/dev/null 2>&1; then
  fail "orphan deleted fd holder: infrastructure requires setsid"
else
  run_dispatch orphan_deleted_fd_holder --runner codex --model gpt-5.5 --effort xhigh
  assert_rejected "orphan deleted fd holder"
  assert_eq "$(fake_run_count)" "1" "orphan deleted fd holder: one runner attempt"

  deleted_fd_holder_dead() {
    ! pid_file_alive "$FAKE_DELETED_FD_PID_FILE"
  }
  if ! poll_until 3 deleted_fd_holder_dead; then
    fail "orphan deleted fd holder: descendant survived dispatcher return"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi

  cleanup_transport_processes
  if ! poll_until 3 all_recorded_processes_dead; then
    fail "orphan deleted fd holder: test cleanup could not reap all recorded fixture processes"
  fi
fi

# ---------------------------------------------------------------------------
# Timeout grammar, two cases:
# a. Run the exact-witness scenario with --timeout 1h. Expected: assert_authored.
# b. Run with --timeout notaduration. Expected: precondition failure (exit 2).
# ---------------------------------------------------------------------------
run_dispatch exact --runner codex --model gpt-5.5 --effort xhigh --timeout 1h
assert_authored "timeout 1h grammar"
assert_eq "$(fake_run_count)" "1" "timeout 1h grammar: one runner attempt"

run_dispatch exact --runner codex --model gpt-5.5 --effort xhigh --timeout notaduration
assert_eq "$DISPATCH_RC" "2" "timeout notaduration: dispatcher exit 2"
assert_eq "$DISPATCH_STATUS" "precondition_failed" "timeout notaduration: status"
assert_eq "$(fake_run_count)" "0" "timeout notaduration: runner never starts"

# ---------------------------------------------------------------------------
# codex 必須帶 --skip-git-repo-check
#
# dispatch-author 在 mkdtemp 出來的臨時目錄執行（dispatch-plan-review.js 也是
# `cwd: tempDir`），那不是 git repo。codex 不帶該旗標時直接拒跑：
#     Not inside a trusted directory and --skip-git-repo-check was not specified.
# 而它的輸出是 **stdout 0 bytes**，harness 仍會產出帶 verdict 的完整 artifact
# ⇒ 只讀 verdict 的呼叫端會以為審查跑過了。
#
# ⚠️ `~/.codex/config.toml` 的 `[projects."/tmp"] trust_level="trusted"`
#    **不繼承到子目錄**，所以「把 /tmp 設成 trusted」不是替代解。
#
# 2026-08-10 實測（PEACE A-2 計畫複審）：
#   非 git 目錄 + 無旗標 → rc=1、stdout 0 bytes、Not inside a trusted directory
#   同命令 + --skip-git-repo-check → rc=0、輸出正常
# ---------------------------------------------------------------------------
run_dispatch exact --runner codex --model gpt-5.5 --effort xhigh
assert_authored "skip-git-repo-check: baseline authored"
if [ -r "$FAKE_ARGV_LOG" ] && grep -qx -- '--skip-git-repo-check' "$FAKE_ARGV_LOG"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "codex argv must include --skip-git-repo-check (dispatch runs from a non-git mkdtemp cwd; without it codex refuses and emits zero bytes while the harness still reports a verdict)"
fi

finalize_test
