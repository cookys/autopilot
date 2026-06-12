#!/usr/bin/env bash
# tree.sh — append-only JSONL task-tree CLI.
#
# Single state-owning entrypoint for the task-tree engine (P1).
# All mutation goes through this script; consumers read via subcommands.
#
# Usage:
#   scripts/tree.sh <subcommand> [args]
#
# Subcommands:
#   init <proj>                        Create tree/ dir + empty events.jsonl
#   emit <proj> <node-id> <event-json> Validate + append one JSONL event under flock
#   rebuild-index <proj>               Fold events → index.json (deterministic, idempotent)
#   next-decision <proj>               Print highest-priority pending decision (compact JSON)
#   report <proj> <node>               Print node report JSON
#   escalations <proj>                 List open escalations as JSON array
#   fetch <proj> <node> --raw          Print artifact content + emit manager_raw_read event
#
# Event envelope (minimal, validated by emit):
#   schema_version  (integer)
#   ts              (ISO-8601 string)
#   node            (string)
#   type            (string)
#
# Stricter per-type validation is a P2 concern. emit is designed so that
# plugging in a validator ($TREE_EVENT_VALIDATOR env var pointing to a
# script) requires no CLI surface changes.
#
# File locations (per project):
#   docs/projects/<proj>/tree/events.jsonl   — append-only event log (git-tracked)
#   docs/projects/<proj>/tree/events.jsonl.lock — flock sidecar
#   docs/projects/<proj>/tree/index.json     — derived, gitignored, rebuildable
#
# flock notes:
#   Linux (util-linux flock): flock -x -w <timeout> <lockfile> <cmd>
#   macOS (BSD flock): flock -x -w <timeout> <fd> — slightly different API.
#   This script uses the Linux form. On macOS, install util-linux flock via
#   homebrew (brew install util-linux). The fd-based macOS shlock is NOT used
#   here. Document in your deployment notes if running on macOS.
#
# Exit codes:
#   0  success
#   1  logic error (event rejected, file not found, etc.)
#   2  usage / missing required argument
#
# Output: JSON to stdout for machine-readable subcommands.
#         Human-readable messages go to stderr.

set -uo pipefail

SCHEMA_VERSION=1
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECTS_DIR="$REPO_ROOT/docs/projects"

# Allow tests to override the projects directory
TREE_PROJECTS_DIR="${TREE_PROJECTS_DIR:-$PROJECTS_DIR}"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

usage_error() {
  echo "usage error: $*" >&2
  exit 2
}

log_err() {
  echo "tree.sh: $*" >&2
}

# ISO-8601 UTC timestamp (seconds precision, no subseconds for portability)
now_ts() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Guard against path traversal / accidental misuse: project names are
# plain dirnames (alnum start; alnum/dot/dash/underscore body; no "..").
# MUST be called from a non-subshell context (the main dispatcher) — an
# exit inside $(...) is swallowed by the command substitution, so putting
# this guard inside proj_tree_dir would be dead code.
validate_proj_name() {
  case "$1" in
    *..*|/*|-*|.*|"") usage_error "invalid project name: '$1' (alphanumeric start; a-zA-Z0-9._- only)" ;;
  esac
  if ! printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    usage_error "invalid project name: '$1' (alphanumeric start; a-zA-Z0-9._- only)"
  fi
}

proj_tree_dir() {
  echo "$TREE_PROJECTS_DIR/$1/tree"
}

proj_events_file() {
  echo "$(proj_tree_dir "$1")/events.jsonl"
}

proj_index_file() {
  echo "$(proj_tree_dir "$1")/index.json"
}

# Validate minimal event envelope.
# Returns 0 if valid, 1 with message to stderr if invalid.
validate_envelope() {
  local event_json="$1"

  # Must be valid single-line JSON (no embedded newlines).
  # Use case pattern matching — grep -q $'\n' is a known false-positive trap:
  # bash expands $'\n' to a literal newline as the grep pattern, which grep
  # then interprets as an empty pattern (matches everything).
  case "$event_json" in
    *$'\n'*)
      log_err "event must be a single JSON line (no embedded newlines)"
      return 1
      ;;
  esac

  # Must parse as JSON
  if ! printf '%s' "$event_json" | jq -e . >/dev/null 2>&1; then
    log_err "event is not valid JSON"
    return 1
  fi

  # Required fields
  local missing=""
  for field in schema_version ts node type; do
    if ! printf '%s' "$event_json" | jq -e --arg f "$field" 'has($f)' >/dev/null 2>&1; then
      missing="$missing $field"
    fi
  done
  if [ -n "$missing" ]; then
    log_err "event missing required fields:$missing"
    return 1
  fi

  return 0
}

# Append one line to the event log under a file lock.
# $1 = events file path, $2 = line content
locked_append() {
  local events_file="$1"
  local line="$2"
  local lock_file="${events_file}.lock"

  # Ensure lock file exists before flocking
  touch "$lock_file"

  # flock -x (exclusive) -w 10 (wait up to 10s) on the lock sidecar.
  # We use a file descriptor so flock holds the lock only during the append.
  # SC2094: opening the events file with >> inside the locked block is safe
  # because the lock sidecar is a separate file from events_file.
  (
    flock -x -w 10 9 || exit 99
    printf '%s\n' "$line" >> "$events_file"
  ) 9>"$lock_file"
  local rc=$?
  if [ "$rc" -eq 99 ]; then
    log_err "could not acquire lock on $lock_file within 10s — append aborted (no unlocked write)"
    exit 1
  elif [ "$rc" -ne 0 ]; then
    # printf failure: disk full / permissions / fd error. Fail closed —
    # callers must never report success for an event that was not written.
    log_err "append failed (write error rc=$rc) for $events_file — event NOT recorded"
    exit 1
  fi
  return 0
}

# Check whether index needs rebuilding:
# - index file absent, OR
# - mtime(events.jsonl) > mtime(index.json)
index_is_stale() {
  local proj="$1"
  local events_file; events_file="$(proj_events_file "$proj")"
  local index_file; index_file="$(proj_index_file "$proj")"

  [ ! -f "$index_file" ] && return 0   # absent → stale

  # Compare mtimes using find -newer
  if find "$events_file" -newer "$index_file" | grep -q .; then
    return 0  # events newer → stale
  fi
  return 1
}

# ---------------------------------------------------------------------------
# subcommand: init
# ---------------------------------------------------------------------------

cmd_init() {
  [ $# -ge 1 ] || usage_error "init requires <proj>"
  local proj="$1"
  local tree_dir; tree_dir="$(proj_tree_dir "$proj")"
  local events_file; events_file="$(proj_events_file "$proj")"

  mkdir -p "$tree_dir"

  if [ -f "$events_file" ] && [ -s "$events_file" ]; then
    log_err "tree already initialized at $events_file (not overwriting)"
    exit 1
  fi

  # Create empty events file
  : > "$events_file"

  # Emit the schema_version bootstrap event
  local init_event
  init_event="$(jq -cn \
    --argjson sv "$SCHEMA_VERSION" \
    --arg ts "$(now_ts)" \
    --arg proj "$proj" \
    '{schema_version: $sv, ts: $ts, node: "root", type: "tree_initialized", proj: $proj}')"

  locked_append "$events_file" "$init_event"
  echo "initialized tree at $events_file" >&2
}

# ---------------------------------------------------------------------------
# subcommand: emit
# ---------------------------------------------------------------------------

cmd_emit() {
  [ $# -ge 3 ] || usage_error "emit requires <proj> <node-id> <event-json>"
  local proj="$1"
  local node_id="$2"
  local event_json="$3"
  local events_file; events_file="$(proj_events_file "$proj")"

  [ -f "$events_file" ] || { log_err "tree not initialized for project '$proj'; run init first"; exit 1; }

  # Validate envelope
  validate_envelope "$event_json" || exit 1

  # Verify the node field matches node_id (or inject if absent in caller's JSON)
  local json_node; json_node="$(printf '%s' "$event_json" | jq -r '.node')"
  if [ "$json_node" != "$node_id" ]; then
    log_err "event.node ('$json_node') does not match <node-id> argument ('$node_id')"
    exit 1
  fi

  # If an external validator is configured, run it (P2 extension point).
  # TRUST NOTE: the path in $TREE_EVENT_VALIDATOR is executed directly —
  # callers must treat it as fully trusted (same trust level as this script).
  if [ -n "${TREE_EVENT_VALIDATOR:-}" ] && [ -x "$TREE_EVENT_VALIDATOR" ]; then
    printf '%s' "$event_json" | "$TREE_EVENT_VALIDATOR" || {
      log_err "external event validator rejected event"
      exit 1
    }
  fi

  locked_append "$events_file" "$event_json"
}

# ---------------------------------------------------------------------------
# subcommand: rebuild-index
# ---------------------------------------------------------------------------

# Rebuilds index.json from events.jsonl.
# Handles truncated tail: the last line of a JSONL file with no trailing
# newline indicates a partial write (kill mid-append). We detect this,
# process only valid complete lines, and record a truncated_tail tombstone
# in the index.
#
# A truncated line can only be the FINAL line by append semantics — each
# successful locked_append writes "content\n". We assert this invariant:
# if the truncated line is NOT at the end of the file, something unexpected
# happened; we still handle it safely but record it as anomalous.

cmd_rebuild_index() {
  [ $# -ge 1 ] || usage_error "rebuild-index requires <proj>"
  local proj="$1"
  local events_file; events_file="$(proj_events_file "$proj")"
  local index_file; index_file="$(proj_index_file "$proj")"

  [ -f "$events_file" ] || { log_err "events file not found: $events_file"; exit 1; }

  # Build index from events using jq/awk
  # We read the file in bash to handle truncated-tail detection before
  # passing valid lines to jq.

  # Detect if file ends without newline (truncated tail)
  local file_size; file_size="$(wc -c < "$events_file")"
  local has_truncated_tail=false
  local truncated_content=""
  local truncated_byte_offset=0

  # Detect truncated tail: if file is non-empty and does NOT end with newline
  if [ "$file_size" -gt 0 ]; then
    local last_char; last_char="$(tail -c 1 "$events_file" | xxd -p | tr -d '\n')"
    # 0a = newline in hex
    if [ "$last_char" != "0a" ]; then
      has_truncated_tail=true
      # The partial line is everything after the last newline; awk END
      # yields the last line without relying on shell IFS tricks.
      truncated_content="$(awk 'END{print}' "$events_file")"
      # Byte offset of the start of the truncated tail. wc -c counts bytes
      # (${#var} counts characters, which under-counts multibyte UTF-8).
      local trunc_len; trunc_len="$(printf '%s' "$truncated_content" | wc -c)"
      truncated_byte_offset=$(( file_size - trunc_len ))
    fi
  fi

  # Collect valid complete lines (all lines except the truncated tail if present)
  local valid_lines=()
  local line_num=0

  while IFS= read -r line; do
    line_num=$(( line_num + 1 ))
    # Skip empty lines
    [ -z "$line" ] && continue
    # Validate as JSON
    if printf '%s' "$line" | jq -e . >/dev/null 2>&1; then
      valid_lines+=("$line")
    else
      log_err "rebuild-index: skipping invalid JSON on line $line_num: ${line:0:80}"
    fi
  done < "$events_file"

  # Assert truncated-tail invariant: a partial last line must be the FINAL line.
  # The loop above reads complete lines (terminated by \n), so the truncated
  # tail (no trailing \n) is never yielded by `while IFS= read -r`. This is
  # the correct behaviour — no assertion needed beyond recording the tombstone.

  # Build the index using jq to fold events
  # Pass valid events as a JSON array into jq
  local events_json="[]"
  if [ "${#valid_lines[@]}" -gt 0 ]; then
    # Build JSON array from valid lines
    events_json="$(printf '%s\n' "${valid_lines[@]}" | jq -s '.')"
  fi

  # Compute a content hash of valid events for determinism verification.
  # Empty-array guard: "${arr[@]}" on an empty array is an unbound-variable
  # error under set -u on bash 3.2 (macOS system bash).
  local events_hash
  if [ "${#valid_lines[@]}" -gt 0 ]; then
    events_hash="$(printf '%s\n' "${valid_lines[@]}" | sha256sum | awk '{print $1}')"
  else
    events_hash="$(printf '' | sha256sum | awk '{print $1}')"
  fi

  # Fold events into node states
  local index_json
  index_json="$(jq -n \
    --argjson events "$events_json" \
    --arg rebuilt_at "$(now_ts)" \
    --arg events_hash "$events_hash" \
    --argjson schema_version "$SCHEMA_VERSION" \
    '
    # Fold events into node map
    reduce $events[] as $ev (
      {nodes: {}, escalations: [], decisions: []};

      # Track node state
      .nodes[$ev.node] //= {
        id: $ev.node,
        status: "active",
        events: [],
        report: null,
        doa_log: [],
        escalations: [],
        verdict: null,
        confidence: null,
        evidence_pointers: [],
        artifact_paths: []
      } |

      # Append event reference to node
      .nodes[$ev.node].events += [$ev.ts + ":" + $ev.type] |

      # Handle specific event types
      if $ev.type == "node_created" then
        .nodes[$ev.node].status = "active" |
        .nodes[$ev.node].parent = $ev.parent |
        .nodes[$ev.node].question = ($ev.question // null) |
        .nodes[$ev.node].options = ($ev.options // []) |
        .nodes[$ev.node].evidence_pointers = ($ev.evidence_pointers // [])
      elif $ev.type == "delegated" then
        .nodes[$ev.node].status = "delegated"
      elif $ev.type == "doa_decision" then
        .nodes[$ev.node].doa_log += [$ev]
      elif $ev.type == "escalation_opened" then
        .nodes[$ev.node].status = "escalated" |
        .nodes[$ev.node].escalations += [{
          id: ($ev.escalation_id // ($ev.node + ":" + $ev.ts)),
          question: ($ev.question // null),
          options: ($ev.options // []),
          evidence_pointers: ($ev.evidence_pointers // []),
          opened_at: $ev.ts,
          resolved: false
        }] |
        .escalations += [{
          node: $ev.node,
          id: ($ev.escalation_id // ($ev.node + ":" + $ev.ts)),
          question: ($ev.question // null),
          options: ($ev.options // []),
          evidence_pointers: ($ev.evidence_pointers // []),
          opened_at: $ev.ts,
          resolved: false
        }]
      elif $ev.type == "escalation_resolved" then
        .nodes[$ev.node].escalations |= map(
          if .id == $ev.escalation_id then . + {resolved: true, resolved_at: $ev.ts} else . end
        ) |
        .escalations |= map(
          if .id == $ev.escalation_id then . + {resolved: true, resolved_at: $ev.ts} else . end
        )
      elif $ev.type == "verdict" then
        .nodes[$ev.node].status = "complete" |
        .nodes[$ev.node].verdict = ($ev.verdict // null) |
        .nodes[$ev.node].confidence = ($ev.confidence // null)
      elif $ev.type == "node_report" then
        .nodes[$ev.node].report = $ev |
        .nodes[$ev.node].artifact_paths = ($ev.artifact_paths // []) |
        .nodes[$ev.node].evidence_pointers = ($ev.evidence_pointers // []) |
        .nodes[$ev.node].artifact_sha256 = ($ev.artifact_sha256 // null)
      elif $ev.type == "decision_fork" then
        .decisions += [{
          node: $ev.node,
          question: ($ev.question // null),
          options: ($ev.options // []),
          evidence_pointers: ($ev.evidence_pointers // []),
          created_at: $ev.ts,
          resolved: false
        }]
      elif $ev.type == "decision_resolved" then
        .decisions |= map(
          if .node == $ev.node and .resolved == false then
            . + {resolved: true, resolved_at: $ev.ts, chosen: ($ev.chosen // null)}
          else .
          end
        )
      elif $ev.type == "manager_raw_read" then
        .nodes[$ev.node].raw_reads = ((.nodes[$ev.node].raw_reads // []) + [$ev.ts])
      else .
      end
    ) |

    # Add metadata
    . + {
      schema_version: $schema_version,
      rebuilt_at: $rebuilt_at,
      events_hash: $events_hash,
      event_count: ($events | length),
      truncated_tail: null
    }
    ')"

  # Inject truncated_tail tombstone if detected
  if [ "$has_truncated_tail" = "true" ]; then
    local trunc_hash; trunc_hash="$(printf '%s' "$truncated_content" | sha256sum | awk '{print $1}')"
    index_json="$(printf '%s' "$index_json" | jq \
      --arg content "$truncated_content" \
      --arg hash "$trunc_hash" \
      --argjson offset "$truncated_byte_offset" \
      '.truncated_tail = {
        byte_offset: $offset,
        content_hash: $hash,
        partial_content: $content,
        detected_at: .rebuilt_at
      }')"
    log_err "WARNING: truncated tail detected at byte offset $truncated_byte_offset (partial write, likely kill mid-append)"
  fi

  # Write index atomically via temp file. The temp file MUST live in the
  # same directory as index.json: mv across filesystems (/tmp is often
  # tmpfs) degrades to copy+delete and loses rename(2) atomicity.
  local tmp_index; tmp_index="$(mktemp "$(dirname "$index_file")/index.XXXXXX")"
  printf '%s\n' "$index_json" > "$tmp_index"
  mv "$tmp_index" "$index_file"
}

# ---------------------------------------------------------------------------
# auto-rebuild helper (used by read subcommands)
# ---------------------------------------------------------------------------

maybe_rebuild() {
  local proj="$1"
  if index_is_stale "$proj"; then
    # Do NOT suppress stderr here: a failed rebuild (corrupt log, jq
    # missing, disk full) must surface, not degrade to "index not found".
    cmd_rebuild_index "$proj" >/dev/null
  fi
}

# ---------------------------------------------------------------------------
# subcommand: next-decision
# ---------------------------------------------------------------------------

cmd_next_decision() {
  [ $# -ge 1 ] || usage_error "next-decision requires <proj>"
  local proj="$1"
  local events_file; events_file="$(proj_events_file "$proj")"
  [ -f "$events_file" ] || { log_err "tree not initialized for project '$proj'"; exit 1; }

  maybe_rebuild "$proj"

  local index_file; index_file="$(proj_index_file "$proj")"
  [ -f "$index_file" ] || { log_err "index not found after rebuild attempt"; exit 1; }

  # Print highest-priority pending decision:
  #   1. Open escalations first (by oldest open time)
  #   2. Then unblocked decision forks
  # NEVER prints work content / artifact content.
  # Use a single jq expression that checks both in priority order.
  jq -r '
    # Check escalations first
    ((.escalations // []) | map(select(.resolved == false)) | sort_by(.opened_at)) as $open_esc |
    ((.decisions // []) | map(select(.resolved == false)) | sort_by(.created_at)) as $open_dec |

    if ($open_esc | length) > 0 then
      $open_esc[0] | {
        node: .node,
        question: .question,
        options: (.options // []),
        evidence_pointers: (.evidence_pointers // []),
        decision_type: "escalation"
      }
    elif ($open_dec | length) > 0 then
      $open_dec[0] | {
        node: .node,
        question: .question,
        options: (.options // []),
        evidence_pointers: (.evidence_pointers // []),
        decision_type: "fork"
      }
    else
      null
    end
  ' "$index_file"
}

# ---------------------------------------------------------------------------
# subcommand: report
# ---------------------------------------------------------------------------

cmd_report() {
  [ $# -ge 2 ] || usage_error "report requires <proj> <node>"
  local proj="$1"
  local node_id="$2"
  local events_file; events_file="$(proj_events_file "$proj")"
  [ -f "$events_file" ] || { log_err "tree not initialized for project '$proj'"; exit 1; }

  maybe_rebuild "$proj"

  local index_file; index_file="$(proj_index_file "$proj")"
  [ -f "$index_file" ] || { log_err "index not found after rebuild attempt"; exit 1; }

  jq -e --arg node "$node_id" '.nodes[$node] // empty' "$index_file" || {
    log_err "node '$node_id' not found in index"
    exit 1
  }
}

# ---------------------------------------------------------------------------
# subcommand: escalations
# ---------------------------------------------------------------------------

cmd_escalations() {
  [ $# -ge 1 ] || usage_error "escalations requires <proj>"
  local proj="$1"
  local events_file; events_file="$(proj_events_file "$proj")"
  [ -f "$events_file" ] || { log_err "tree not initialized for project '$proj'"; exit 1; }

  maybe_rebuild "$proj"

  local index_file; index_file="$(proj_index_file "$proj")"
  [ -f "$index_file" ] || { log_err "index not found after rebuild attempt"; exit 1; }

  jq -r '(.escalations // []) | map(select(.resolved == false))' "$index_file"
}

# ---------------------------------------------------------------------------
# subcommand: fetch
# ---------------------------------------------------------------------------

cmd_fetch() {
  [ $# -ge 3 ] || usage_error "fetch requires <proj> <node> --raw"
  local proj="$1"
  local node_id="$2"
  local flag="$3"

  [ "$flag" = "--raw" ] || { log_err "fetch: unknown flag '$flag'; only --raw is supported"; exit 2; }

  local events_file; events_file="$(proj_events_file "$proj")"
  [ -f "$events_file" ] || { log_err "tree not initialized for project '$proj'"; exit 1; }

  # Rebuild index if stale so we can find artifact paths
  maybe_rebuild "$proj"
  local index_file; index_file="$(proj_index_file "$proj")"

  # Get artifact paths from the node's report
  local artifact_paths
  artifact_paths="$(jq -r --arg node "$node_id" \
    '(.nodes[$node].artifact_paths // [])[]' "$index_file" 2>/dev/null || true)"

  if [ -z "$artifact_paths" ]; then
    log_err "fetch: no artifact_paths found for node '$node_id'"
    # Emit the manager_raw_read event regardless (log the attempt)
  fi

  # Emit manager_raw_read event
  local raw_read_event
  raw_read_event="$(jq -cn \
    --argjson sv "$SCHEMA_VERSION" \
    --arg ts "$(now_ts)" \
    --arg node "$node_id" \
    --arg proj "$proj" \
    '{schema_version: $sv, ts: $ts, node: $node, type: "manager_raw_read", proj: $proj}')"

  locked_append "$events_file" "$raw_read_event"

  # Print artifact content
  if [ -n "$artifact_paths" ]; then
    while IFS= read -r path; do
      [ -z "$path" ] && continue
      if [ -f "$path" ]; then
        cat "$path"
      else
        log_err "fetch: artifact not found at path: $path"
      fi
    done <<< "$artifact_paths"
  fi
}

# ---------------------------------------------------------------------------
# --help dispatcher
# ---------------------------------------------------------------------------

show_help() {
  sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

CMD="${1:-}"
[ -n "$CMD" ] || { show_help; exit 2; }
shift || true

# Any subcommand accepts --help as its first argument.
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  show_help; exit 0
fi

# Every subcommand's first positional is <proj>. Validate it HERE, in the
# main script context — exit propagates. (Inside $() it would not.)
case "$CMD" in
  init|emit|rebuild-index|next-decision|report|escalations|fetch)
    [ $# -ge 1 ] || usage_error "$CMD requires <proj>"
    validate_proj_name "$1"
    ;;
esac

case "$CMD" in
  init)              cmd_init "$@" ;;
  emit)              cmd_emit "$@" ;;
  rebuild-index)     cmd_rebuild_index "$@" ;;
  next-decision)     cmd_next_decision "$@" ;;
  report)            cmd_report "$@" ;;
  escalations)       cmd_escalations "$@" ;;
  fetch)             cmd_fetch "$@" ;;
  -h|--help|help)    show_help; exit 0 ;;
  *)
    log_err "unknown subcommand: $CMD"
    show_help
    exit 2
    ;;
esac
