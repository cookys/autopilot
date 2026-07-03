#!/usr/bin/env bash
# check-test-integrity.sh — L0 static layer test-integrity gate.
# Prevents implementers from gaming tests by deleting assertions,
# skipping tests, or escaping test directories.
#
# Usage:
#   scripts/check-test-integrity.sh validate --range <base>..<head> [--repo <dir>]
#
# Options:
#   validate                     Run L0 static checks on the git diff.
#   --range <base>..<head>       The commit range to validate (required).
#   --repo <dir>                 Repository directory to check (default: git root).
#   --base <base>                Sets the <base> side for this run.
#   --allow-env-config           Allow TEST_INTEGRITY_CONFIG_OVERRIDE for config.
#   -h, --help                   Show this help message.
#
# Exit codes:
#   0  ok (or warn/off mode with violations)
#   1  block-violation (gate fails in block mode)
#   2  usage / internal error
#
# Output: JSON to stdout.
#
# Candidate-Denied Paths:
#   The following paths are protected and must not be modified by delegated tasks:
#   - .qc/**
#   - scripts/check-test-integrity.sh (this script)
#   - scripts/lib/test-integrity-l1.py (the extracted Python engine)
#   - .claude/test-integrity-config.md (project configuration)
#   - .gitattributes

set -euo pipefail

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ $# -eq 0 ]]; then
  usage
  exit 2
fi

CMD="$1"
shift

if [[ "$CMD" == "-h" || "$CMD" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$CMD" != "validate" ]]; then
  echo "Unknown command: $CMD" >&2
  echo "Usage: $0 validate --range <base>..<head> [--repo <dir>]" >&2
  exit 2
fi

RANGE=""
REPO_DIR=""
ALLOW_ENV_CONFIG="0"
BASE_OVERRIDE=""
NO_L1="0"
L1_TIMEOUT="180"
L1_RUNNER=""
L1_WORKTREE_DIR=""
L1_VERDICT_FILE=""
ASSERT_WORKER_DEAD=""
CONTAINMENT_FLAG="none"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      if [[ $# -lt 2 ]]; then
        echo "Error: --range expects <base>..<head>." >&2
        exit 2
      fi
      RANGE="$2"
      shift 2
      ;;
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "Error: --repo expects a directory." >&2
        exit 2
      fi
      REPO_DIR="$2"
      shift 2
      ;;
    --base)
      if [[ $# -lt 2 ]]; then
        echo "Error: --base expects a ref." >&2
        exit 2
      fi
      BASE_OVERRIDE="$2"
      shift 2
      ;;
    --allow-env-config)
      ALLOW_ENV_CONFIG="1"
      shift
      ;;
    --no-l1)
      NO_L1="1"
      shift
      ;;
    --l1-timeout)
      if [[ $# -lt 2 ]]; then
        echo "Error: --l1-timeout expects seconds." >&2
        exit 2
      fi
      L1_TIMEOUT="$2"
      shift 2
      ;;
    --l1-runner)
      if [[ $# -lt 2 ]]; then
        echo "Error: --l1-runner expects one of pytest|jest|vitest|go." >&2
        exit 2
      fi
      L1_RUNNER="$2"
      shift 2
      ;;
    --l1-worktree-dir)
      if [[ $# -lt 2 ]]; then
        echo "Error: --l1-worktree-dir expects a directory." >&2
        exit 2
      fi
      L1_WORKTREE_DIR="$2"
      shift 2
      ;;
    --assert-worker-dead)
      if [[ $# -lt 2 ]]; then
        echo "Error: --assert-worker-dead expects a pgid." >&2
        exit 2
      fi
      ASSERT_WORKER_DEAD="$2"
      shift 2
      ;;
    --containment)
      # Accepted for telemetry / forward-compat ONLY — it does NOT currently unlock
      # block-mode override honoring. An unlock on `cgroup-verified` was reverted as
      # UNSAFE (gpt-5.5 review 2026-06-26): a same-user worker can sibling-escape the
      # dispatcher's cgroup via `systemd-run --user --scope`, so no local-only
      # containment is malicious-proof. Block-mode always defers; see BACKLOG.
      if [[ $# -lt 2 ]]; then
        echo "Error: --containment expects a value (currently advisory only)." >&2
        exit 2
      fi
      CONTAINMENT_FLAG="$2"
      shift 2
      ;;
    --l1-verdict-file)
      if [[ $# -lt 2 ]]; then
        echo "Error: --l1-verdict-file expects a file path." >&2
        exit 2
      fi
      L1_VERDICT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$L1_RUNNER" && "$L1_RUNNER" != "pytest" && "$L1_RUNNER" != "jest" && "$L1_RUNNER" != "vitest" && "$L1_RUNNER" != "go" ]]; then
  echo "Error: --l1-runner must be one of pytest, jest, vitest, go." >&2
  exit 2
fi

if ! [[ "$L1_TIMEOUT" =~ ^[0-9]+$ ]]; then
  echo "Error: --l1-timeout must be a non-negative integer." >&2
  exit 2
fi
if [[ "$L1_TIMEOUT" == "0" ]]; then
  NO_L1="1"
fi

if [[ -z "$RANGE" ]]; then
  if [[ -n "$BASE_OVERRIDE" ]]; then
    RANGE="${BASE_OVERRIDE}..HEAD"
  else
    echo "Error: --range <base>..<head> is required." >&2
    exit 2
  fi
fi

if [[ "$RANGE" != *".."* ]]; then
  echo "Error: Range must be in <base>..<head> format." >&2
  exit 2
fi

BASE_REF="${RANGE%%..*}"
HEAD_REF="${RANGE#*..}"
if [[ -z "$HEAD_REF" ]]; then
  HEAD_REF="HEAD"
fi

if [[ -z "$REPO_DIR" ]]; then
  REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if ! git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: $REPO_DIR is not a git repository." >&2
  exit 2
fi

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SELF_DIR=""
LIB_PATH="$SELF_DIR/lib/test-integrity-l1.py"
if [[ ! -f "$LIB_PATH" ]]; then
  echo "Error: test-integrity-l1.py missing at: $LIB_PATH" >&2
  exit 2
fi

python3 "$LIB_PATH" "$REPO_DIR" "$RANGE" "$BASE_REF" "$HEAD_REF" "$ALLOW_ENV_CONFIG" "$NO_L1" "$L1_TIMEOUT" "$L1_RUNNER" "$L1_WORKTREE_DIR" "$L1_VERDICT_FILE" "$ASSERT_WORKER_DEAD" "$CONTAINMENT_FLAG"
