#!/usr/bin/env bash
# Dual-purpose no-spend fixture:
#   * Codex CLI seam for canonical dispatch-hetero.sh (`--codex-bin this-file`)
#   * shared-review JSON seam for run-implementer-matrix.sh (`--reviewer-cmd this-file`)
set -uo pipefail

if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.146.0-stub"
  exit 0
fi
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "usage: codex exec --dangerously-bypass-hook-trust"
  exit 0
fi

for arg in "$@"; do
  if [ "$arg" = "--diff-file" ]; then
    if [ "${STUB_REQUIRE_EOF_STDIN:-0}" = "1" ] && IFS= read -r leaked; then
      printf '%s\n' '{"runner":"stub","model":"stub-reviewer","status":"no_verdict","verdict":null,"findings":"","raw_log":null,"error":"inherited stdin contamination"}'
      exit 1
    fi
    case "${STUB_REVIEW_SCENARIO:-ship}" in
      ship)
        printf '%s\n' '{"runner":"stub","model":"stub-reviewer","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","raw_log":null}'
        exit 0
        ;;
      finding)
        printf '%s\n' '{"runner":"stub","model":"stub-reviewer","status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🔴 stub-defect — deterministic fixture — MUST-FIX","raw_log":null}'
        exit 0
        ;;
      unavailable)
        printf '%s\n' '{"runner":"stub","model":"stub-reviewer","status":"no_verdict","verdict":null,"findings":"","raw_log":null}'
        exit 1
        ;;
      malformed)
        printf '{broken'
        exit 0
        ;;
      *) echo "unknown STUB_REVIEW_SCENARIO" >&2; exit 2 ;;
    esac
  fi
done

if [ "${1:-}" != "exec" ]; then
  echo "stub: unsupported invocation" >&2
  exit 2
fi

prompt="$(mktemp)"
trap 'rm -f "$prompt"' EXIT
cat > "$prompt"
capture="${STUB_CAPTURE_DIR:-}"
if [ -n "$capture" ]; then
  mkdir -p "$capture"
  arm="nopack"
  grep -q '^=== SKILL: implementer-pack ===$' "$prompt" && arm="pack"
  cp "$prompt" "$capture/$arm.prompt"
  printf '%s\n' "$arm" >> "$capture/model-calls.log"
fi

case "${STUB_IMPLEMENTER_SCENARIO:-success}" in
  success)
    printf 'fixed\n' > expected.txt
    echo "stub implementation complete"
    exit 0
    ;;
  noop)
    echo "stub judged no change necessary"
    exit 0
    ;;
  fail)
    echo "stub provider failure" >&2
    exit 13
    ;;
  *) echo "unknown STUB_IMPLEMENTER_SCENARIO" >&2; exit 2 ;;
esac
