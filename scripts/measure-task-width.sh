#!/usr/bin/env bash
# measure-task-width.sh — portable "can this repo's work even fan out?" probe.
#
# Answers ONE question, repo-agnostically: of the last N "tasks" (merges or
# mainline commits), what fraction decompose into >=K file-disjoint units each
# big enough to be worth a separate parallel agent?  This is the S0.a
# task-supply existence cut for autopilot's /l4 /l5 width fan-out — but it runs
# in ANY git repo, so the metric is sampled from a representative population
# (real app projects) instead of a single-threaded plugin/docs repo.
#
# IMPORTANT — what this measures and does NOT:
#   * It counts FILE-DISJOINT potential (units touching different path subtrees).
#     That is an UPPER BOUND on true parallelizability: two file-disjoint units
#     can still be semantically coupled (shared types, behavioural contract),
#     which this script cannot see. A "wide" result is necessary-not-sufficient;
#     a "narrow" result is a hard no.
#   * "non-trivial wall-clock" is proxied by churn (added+deleted lines) >= a
#     threshold, because a parallel agent's fixed cost (worktree + dispatch +
#     merge-back) dwarfs a tiny edit.
#   * "unit" granularity is proxied by path prefix at depth D. The result is
#     SENSITIVE to D (a flat dir like scripts/ fragments at D=2 but is one
#     component at D=1), so the report sweeps D as well as the threshold. Read
#     the whole surface, not one cell.
#
# Usage:
#   measure-task-width.sh [--mainline REF] [--sample N] [--width K]
#                         [--threshold C] [--unit merge|commit|auto]
#                         [--exclude GLOB]... [--json] [--show-wide]
# Defaults: --width 4 --threshold 25 --sample 50 --unit auto
#           mainline auto-detected (origin/HEAD -> main -> master -> develop).
#           depth + threshold are swept; --threshold/--width pick the "primary"
#           cell highlighted and used for --show-wide.
# Exit: 0 ok, 2 usage/env error.
set -euo pipefail

MAINLINE=""; SAMPLE=50; WIDTH=4; THRESH=25; UNIT="auto"; JSON=0; SHOW_WIDE=0
EXCLUDES=()
DEPTHS=(1 2 3)
THRESHOLDS=(0 10 25 50 100)

die(){ echo "ERROR: $*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --mainline) MAINLINE="$2"; shift 2;;
    --sample) SAMPLE="$2"; shift 2;;
    --width) WIDTH="$2"; shift 2;;
    --threshold) THRESH="$2"; shift 2;;
    --unit) UNIT="$2"; shift 2;;
    --exclude) EXCLUDES+=("$2"); shift 2;;
    --json) JSON=1; shift;;
    --show-wide) SHOW_WIDE=1; shift;;
    -h|--help) sed -n '2,46p' "$0"; exit 0;;
    *) die "unknown arg: $1";;
  esac
done

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo (cd into one first)"

if [ ${#EXCLUDES[@]} -eq 0 ]; then
  EXCLUDES=( '*.lock' '*-lock.json' '*-lock.yaml' 'CHANGELOG*' 'go.sum'
             'node_modules/*' 'vendor/*' 'dist/*' 'build/*' '.yarn/*' 'Pods/*' )
fi
is_excluded(){ local f="$1" g; for g in "${EXCLUDES[@]}"; do case "$f" in $g) return 0;; esac; done; return 1; }

if [ -z "$MAINLINE" ]; then
  for cand in "$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)" \
              origin/main origin/master origin/develop main master develop HEAD; do
    [ -n "$cand" ] && git rev-parse --verify --quiet "$cand^{commit}" >/dev/null 2>&1 && { MAINLINE="$cand"; break; }
  done
fi
[ -n "$MAINLINE" ] || die "could not resolve a mainline ref; pass --mainline"

# A "task" is a FEATURE merge. Exclude pull-sync / mainline-into-itself merges
# ("Merge branch 'x' of <url>", "Merge remote-tracking ...", "Merge branch
# 'main'") — those are integration noise, not units of work, and counting them
# craters the width to ~0. NOTE: use git's own -n cap + awk to limit, never
# `| head` — under `set -o pipefail` head closes the pipe early and the upstream
# git gets SIGPIPE (141), aborting the script. awk reads all input (no early close).
# pull-sync / mainline-into-self subjects (NOT feature merges). Narrow on purpose:
# do NOT match "Merge feat/x: ..." / "Merge origin/feature-branch:" — those ARE
# feature merges. Only mainline-into-mainline syncs.
SYNC_RE="^Merge (remote-tracking )?branch '[^']*' of |^Merge remote-tracking branch|^Merge branch '(main|master|develop|trunk)'( into (main|master|develop|trunk))?\$|^Merge origin/(main|master|develop|trunk)\b|of (github|gitlab|bitbucket)"
SHALLOW="no"; [ -f "$(git rev-parse --git-dir)/shallow" ] && SHALLOW="yes"
CONF="ok"; FMERGES=0
feat_shas=$(git log --merges --first-parent -n $((SAMPLE*4)) "$MAINLINE" --format='%H%x09%s' 2>/dev/null \
            | grep -vE "$SYNC_RE" | awk -v n="$SAMPLE" 'NR<=n{print $1}' || true)
FMERGES=$(printf '%s\n' "$feat_shas" | grep -c . || true)
mode="$UNIT"
[ "$mode" = "auto" ] && { [ "$FMERGES" -ge 15 ] && mode="merge" || mode="commit"; }
if [ "$mode" = "merge" ]; then
  shas="$feat_shas"
  [ "$FMERGES" -lt 20 ] && CONF="low"      # thin feature-merge sample
  parentspec(){ echo "$1^1"; }
else
  CONF="low"                               # commit-mode width is unreliable (a task spans many commits)
  shas=$(git log --no-merges --first-parent -n "$SAMPLE" "$MAINLINE" --format=%H 2>/dev/null)
  parentspec(){ echo "$1^"; }
fi
[ "$SHALLOW" = "yes" ] && CONF="low"   # shallow clone = truncated history, untrustworthy
[ -n "$shas" ] || die "no $mode units found on $MAINLINE"

clusterkey(){ # $1=path $2=depth
  echo "$1" | awk -F/ -v d="$2" '{n=(NF<d?NF:d); s=$1; for(i=2;i<=n;i++) s=s"/"$i; if(NF<=1) s="(root)"; print s}'
}

declare -A WIDECNT   # "depth,thresh" -> count of >=WIDTH-wide tasks
for d in "${DEPTHS[@]}"; do for t in "${THRESHOLDS[@]}"; do WIDECNT["$d,$t"]=0; done; done
TOTAL=0
WIDE_LINES=""

while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  TOTAL=$((TOTAL+1))
  par=$(parentspec "$sha")
  # --no-renames: a rename-with-edit otherwise emits "old => new" as one numstat
  # field, which clusterkey/is_excluded mis-bucket → phantom units inflate width.
  numstat=$(git diff --no-renames --numstat "$par" "$sha" 2>/dev/null || true)
  # per depth: cluster -> churn
  for d in "${DEPTHS[@]}"; do
    declare -A CH=()
    while IFS=$'\t' read -r add del f; do
      [ -z "${f:-}" ] && continue
      is_excluded "$f" && continue
      [ "$add" = "-" ] && add=0; [ "$del" = "-" ] && del=0
      k=$(clusterkey "$f" "$d"); CH[$k]=$(( ${CH[$k]:-0} + add + del ))
    done <<< "$numstat"
    for t in "${THRESHOLDS[@]}"; do
      u=0; for k in "${!CH[@]}"; do [ "${CH[$k]}" -ge "$t" ] && u=$((u+1)); done
      [ "$u" -ge "$WIDTH" ] && WIDECNT["$d,$t"]=$(( ${WIDECNT["$d,$t"]} + 1 ))
    done
    # capture wide detail only for the primary cell (depth 2, primary threshold)
    if [ "$d" -eq 2 ] && [ "$SHOW_WIDE" -eq 1 ]; then
      u=0; det=""
      for k in "${!CH[@]}"; do [ "${CH[$k]}" -ge "$THRESH" ] && { u=$((u+1)); det="$det $k=${CH[$k]}"; }; done
      if [ "$u" -ge "$WIDTH" ]; then
        subj=$(git log -1 --format=%s "$sha" | cut -c1-58)
        WIDE_LINES="${WIDE_LINES}  units=$u | $subj |$det"$'\n'
      fi
    fi
    unset CH
  done
done <<< "$shas"

pct(){ awk "BEGIN{printf \"%.1f\", ($1==0?0:100*$2/$1)}"; }

if [ "$JSON" -eq 1 ]; then
  printf '{"repo":"%s","mainline":"%s","unit_mode":"%s","sample":%d,"feature_merges":%d,"shallow":"%s","confidence":"%s","width":%d,"primary_threshold":%d,"matrix":{' \
    "$(basename "$(git rev-parse --show-toplevel)")" "$MAINLINE" "$mode" "$TOTAL" "$FMERGES" "$SHALLOW" "$CONF" "$WIDTH" "$THRESH"
  fd=1
  for d in "${DEPTHS[@]}"; do
    [ $fd -eq 0 ] && printf ','; fd=0; printf '"depth%d":{' "$d"
    ft=1; for t in "${THRESHOLDS[@]}"; do [ $ft -eq 0 ] && printf ','; ft=0; printf '"%d":{"wide":%d,"pct":%s}' "$t" "${WIDECNT["$d,$t"]}" "$(pct "$TOTAL" "${WIDECNT["$d,$t"]}")"; done
    printf '}'
  done
  printf '}}'; echo
else
  echo "== task-width probe =="
  echo "repo      : $(basename "$(git rev-parse --show-toplevel)")"
  echo "mainline  : $MAINLINE    unit mode: $mode  (sampled $TOTAL of last $SAMPLE)"
  echo "confidence: $CONF  (feature-merges=$FMERGES, shallow=$SHALLOW)  <-- 'low' => do NOT trust the numbers"
  echo "question  : what % of tasks split into >=$WIDTH file-disjoint, non-trivial units?"
  echo
  echo "  rows = unit granularity (path depth); cols = 'non-trivial' churn threshold"
  printf "  %-9s" "depth\\churn"
  for t in "${THRESHOLDS[@]}"; do printf "  >=%-5s" "$t"; done; echo
  for d in "${DEPTHS[@]}"; do
    printf "  depth=%-3s" "$d"
    for t in "${THRESHOLDS[@]}"; do printf "  %5s%%" "$(pct "$TOTAL" "${WIDECNT["$d,$t"]}")"; done
    echo
  done
  echo
  echo "READ:"
  echo "  * churn>=0 column = file-count fallacy (1-line touches counted as units). Ignore."
  echo "  * defensible 'worth a parallel agent' = churn>=25..50."
  echo "  * depth=1 lumps a flat dir (scripts/) into one unit (under-counts);"
  echo "    depth=2/3 split nested trees (src/auth, src/billing) correctly but"
  echo "    fragment flat dirs (over-counts). Pick the row matching THIS repo's layout."
  echo "  * whole surface is an UPPER BOUND: file-disjoint != semantically independent."
  echo "  * autopilot's own /l4/l5 gate was ~15-20%: below it => width fan-out is dead weight."
  if [ "$SHOW_WIDE" -eq 1 ] && [ -n "$WIDE_LINES" ]; then
    echo; echo "wide tasks at depth=2, churn>=$THRESH:"; printf '%s' "$WIDE_LINES"
  fi
fi
