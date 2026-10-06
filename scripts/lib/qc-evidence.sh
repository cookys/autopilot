# scripts/lib/qc-evidence.sh — the ONE implementation of the pre-push qc-gate decision
# ("does this range touch a protected path, and does it carry review evidence?").
# Sourced by .githooks/pre-push and by scripts/qc-evidence-status.js (the status fact),
# so the hook and the band chip can never disagree.
#
# Caller sets before calling:
#   REPO_ROOT   work-tree top level (for .qc/<sha>.verdict.json)
#   PROTECTED   bash array of protected path prefixes
#   EVIDENCE    trailer | artifact | either
#
# qc_protected_files <range>   prints each changed file under a protected prefix; rc 0 iff any
# qc_touches_protected <range> rc 0 iff the range touches a protected path
# qc_has_evidence <range>      rc 0 iff the range carries review evidence per EVIDENCE;
#                              sets QC_EVIDENCE_KIND=trailer|artifact (the kind that satisfied it)

qc_protected_files() { # range
  local range="$1" f p found=1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    for p in "${PROTECTED[@]}"; do
      p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"  # trim (defensive; resolver also normalizes)
      [ -z "$p" ] && continue
      case "$f" in "$p"*) printf '%s\n' "$f"; found=0; break ;; esac
    done
  done < <(git diff --name-only "$range" 2>/dev/null)
  return "$found"
}

qc_touches_protected() { # range
  [ -n "$(qc_protected_files "$1")" ]
}

qc_has_evidence() { # range
  local range="$1"
  QC_EVIDENCE_KIND=""
  if [ "$EVIDENCE" = "trailer" ] || [ "$EVIDENCE" = "either" ]; then
    # here-string, NOT `git log | grep -q`: under `set -o pipefail` grep -q closes
    # the pipe on its first match and git log gets SIGPIPE (141), which pipefail
    # surfaces as the pipeline's exit → the `&& return 0` silently misfires and a
    # legitimately-trailered push is racily blocked. Buffer first, then match.
    grep -qiE '^[[:space:]]*QC-Verdict:[[:space:]]*PASS' <<< "$(git log "$range" --format=%B 2>/dev/null)" && { QC_EVIDENCE_KIND=trailer; return 0; }
  fi
  if [ "$EVIDENCE" = "artifact" ] || [ "$EVIDENCE" = "either" ]; then
    local sha
    while IFS= read -r sha; do
      [ -f "$REPO_ROOT/.qc/${sha}.verdict.json" ] && { QC_EVIDENCE_KIND=artifact; return 0; }
    done < <(git rev-list "$range" 2>/dev/null)
  fi
  return 1
}
