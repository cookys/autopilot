#!/usr/bin/env bash
# task-width-fleet.sh — fleet layer over measure-task-width.sh.
#
# Collect the /l4 /l5 task-width metric across MANY repos on MANY machines/
# accounts, then aggregate into one cross-repo verdict (deduping the same repo
# cloned on several machines). Two subcommands:
#
#   scan [--root DIR]... [--find-depth N] [--sample N] [--out FILE]
#        Find every git repo under the roots, run the probe on each, tag with
#        machine + git account + normalized remote, append one JSON line per
#        repo to OUT (default ~/.autopilot/task-width/<host>.jsonl).
#        Run this ONCE PER MACHINE (per account if you switch git identities).
#
#   aggregate [JSONL...]   (default: ~/.autopilot/task-width/*.jsonl)
#        Combine all JSONL, dedup by remote, print per-repo table + the gate
#        verdict (how many DISTINCT repos clear the ~15-20% wide bar). Needs
#        python3; if absent, just bring the JSONL to a Claude session — the
#        format is one self-describing object per line.
#
# Typical flow:
#   # on each machine / account:
#   bash task-width-fleet.sh scan --root ~/projects
#   # gather every machine's ~/.autopilot/task-width/*.jsonl into one dir, then:
#   bash task-width-fleet.sh aggregate ./collected/*.jsonl
#   # ...or paste the JSONL lines into Claude and ask it to aggregate.
#
# Exit: 0 ok, 2 usage/env.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$SELF_DIR/measure-task-width.sh"
die(){ echo "ERROR: $*" >&2; exit 2; }

jstr(){ # minimal JSON string escape
  local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"
}
norm_remote(){ # normalize a git remote URL for cross-machine dedup
  local u="$1"
  u="${u%.git}"; u="${u%/}"
  u="${u#git@}"; u="${u#ssh://}"; u="${u#https://}"; u="${u#http://}"
  u="${u#*@}"            # strip any user@ left
  u="${u/://}"           # git@host:org/repo -> host/org/repo (first colon)
  echo "$u" | tr '[:upper:]' '[:lower:]'
}

cmd_scan(){
  [ -x "$PROBE" ] || die "probe not found/executable: $PROBE"
  local roots=() FIND_DEPTH=6 SAMPLE=50 OUT="" SUBMIT="" TOKEN="${TASK_WIDTH_TOKEN:-}"
  while [ $# -gt 0 ]; do case "$1" in
    --root) roots+=("$2"); shift 2;;
    --find-depth) FIND_DEPTH="$2"; shift 2;;
    --sample) SAMPLE="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --submit) SUBMIT="$2"; shift 2;;       # POST results to a task-width-ingest URL
    --token) TOKEN="$2"; shift 2;;
    *) die "scan: unknown arg $1";;
  esac; done
  [ ${#roots[@]} -eq 0 ] && { [ -d "$HOME/projects" ] && roots=("$HOME/projects") || roots=("$HOME"); }
  local host; host="$(hostname -s 2>/dev/null || hostname)"
  [ -z "$OUT" ] && { mkdir -p "$HOME/.autopilot/task-width"; OUT="$HOME/.autopilot/task-width/$host.jsonl"; }
  : > "$OUT"
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  echo "scanning roots: ${roots[*]}  (find-depth $FIND_DEPTH)" >&2
  # find .git dirs, prune heavy trees
  local gitdirs
  gitdirs="$(find "${roots[@]}" -maxdepth "$FIND_DEPTH" \
      \( -name node_modules -o -name vendor -o -name .cache -o -name Library \) -prune -o \
      -type d -name .git -print 2>/dev/null || true)"
  local n=0 ok=0 skip=0
  while IFS= read -r gd; do
    [ -z "$gd" ] && continue
    n=$((n+1))
    local repo; repo="$(dirname "$gd")"
    local pj; pj="$( (cd "$repo" && "$PROBE" --sample "$SAMPLE" --json) 2>/dev/null || true)"
    if [ -z "$pj" ] || [ "${pj:0:1}" != "{" ]; then
      skip=$((skip+1)); echo "  skip (no sample): $repo" >&2; continue
    fi
    local acct rem reponame
    acct="$(git -C "$repo" config user.email 2>/dev/null || true)"
    rem="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
    reponame="$(basename "$repo")"
    local remkey; if [ -n "$rem" ]; then remkey="$(norm_remote "$rem")"; else remkey="local:$host:$repo"; fi
    printf '{"machine":%s,"account":%s,"remote":%s,"remote_key":%s,"repo":%s,"abspath":%s,"ts":%s,"probe":%s}\n' \
      "$(jstr "$host")" "$(jstr "$acct")" "$(jstr "$rem")" "$(jstr "$remkey")" \
      "$(jstr "$reponame")" "$(jstr "$repo")" "$(jstr "$ts")" "$pj" >> "$OUT"
    ok=$((ok+1)); echo "  probed: $reponame  ($remkey)" >&2
  done <<< "$gitdirs"
  echo "" >&2
  echo "done: $ok probed, $skip skipped, $n found" >&2
  echo "wrote: $OUT" >&2
  if [ -n "$SUBMIT" ]; then
    command -v curl >/dev/null 2>&1 || die "--submit needs curl"
    local url="${SUBMIT%/}/submit" hdr=()
    [ -n "$TOKEN" ] && hdr=(-H "X-Token: $TOKEN")
    echo "submitting $ok repos -> $url" >&2
    local resp; resp="$(curl -fsS -XPOST --data-binary @"$OUT" "${hdr[@]}" "$url" 2>&1)" || resp="SUBMIT_FAILED: $resp"
    echo "  ingest reply: $resp" >&2
  fi
  echo "$OUT"
}

cmd_aggregate(){
  command -v python3 >/dev/null 2>&1 || die "aggregate needs python3 (or paste the JSONL to Claude)"
  local files=("$@")
  if [ ${#files[@]} -eq 0 ]; then
    shopt -s nullglob; files=("$HOME"/.autopilot/task-width/*.jsonl); shopt -u nullglob
  fi
  [ ${#files[@]} -gt 0 ] || die "no JSONL files (run scan first, or pass paths)"
  python3 - "${files[@]}" <<'PY'
import json, sys
GATE = 20.0          # the ~15-20% wide bar; <gate => width fan-out is dead weight
DEPTHS = ["depth1","depth2","depth3"]
THRS   = ["25","50"]
records = {}
dups = {}
for path in sys.argv[1:]:
    try:
        for line in open(path):
            line=line.strip()
            if not line: continue
            r=json.loads(line)
            k=r.get("remote_key") or r.get("abspath")
            # dedup: keep the record that sampled the most history
            prev=records.get(k)
            cur_n=r.get("probe",{}).get("sample",0)
            if prev is None or cur_n > prev.get("probe",{}).get("sample",0):
                if prev is not None: dups[k]=dups.get(k,1)+1
                records[k]=r
            else:
                dups[k]=dups.get(k,1)+1
    except Exception as e:
        print(f"warn: bad file {path}: {e}", file=sys.stderr)

allrows=list(records.values())
if not allrows:
    print("no records"); sys.exit(0)

def cell(r,d,t):
    try: return r["probe"]["matrix"][d][t]["pct"]
    except Exception: return None
def conf(r): return r.get("probe",{}).get("confidence","?")

# the gate is computed ONLY over measurable repos (confidence==ok). low-confidence
# repos (commit-mode / thin feature-merges / shallow) are listed but excluded —
# their ~0% is a sampling artifact, not evidence of narrowness.
rows=[r for r in allrows if conf(r)=="ok"]
low =[r for r in allrows if conf(r)!="ok"]

print(f"== cross-repo task-width aggregate ==")
print(f"   {len(allrows)} distinct repos: {len(rows)} MEASURABLE, {len(low)} low-confidence (excluded from gate)")
width = rows[0].get("probe",{}).get("width",4) if rows else 4
print(f"   gate = {GATE}% of tasks >= {width}-wide\n")
hdr=f"{'repo':<22} {'machine':<10} {'mode':<6} {'fm':>3} {'cf':>4}  " + "  ".join(f"d{d[-1]}c{t}" for d in DEPTHS for t in THRS)
print(hdr); print("-"*len(hdr))
counts={ (d,t):0 for d in DEPTHS for t in THRS }
def fm(r): return r.get("probe",{}).get("feature_merges",0)
for r in sorted(allrows, key=lambda x: (conf(x)!="ok", -(cell(x,'depth2','25') or 0))):
    cells=[]
    measurable = conf(r)=="ok"
    for d in DEPTHS:
        for t in THRS:
            v=cell(r,d,t)
            cells.append("  -  " if v is None else f"{v:5.1f}")
            if measurable and v is not None and v>=GATE: counts[(d,t)]+=1
    print(f"{r.get('repo','?'):<22.22} {r.get('machine','?'):<10.10} {r.get('probe',{}).get('unit_mode','?'):<6} {fm(r):>3} {conf(r):>4}  " + "  ".join(cells))

N=len(rows)
print(f"\n-- of the {N} MEASURABLE repos, how many CLEAR the gate (>= {GATE:.0f}% wide) --")
if N==0:
    print("  (none measurable yet — need repos with real feature-merge history)")
for d in DEPTHS:
    for t in THRS:
        c=counts[(d,t)]
        print(f"  {d} churn>={t:<3}: {c}/{N} = {(100*c/N if N else 0):4.1f}% of measurable repos clear the bar")
print("""
READ:
  * The decision uses the row matching each repo's real layout (flat dirs->d1,
    src/<module>->d2, deep nesting->d3) at churn>=25..50. d2c25 is the headline.
  * This is an UPPER BOUND (file-disjoint != semantically independent). Before
    flipping the descope, manually open the --show-wide task lists of the repos
    that clear the bar and confirm the wide tasks are genuinely INDEPENDENT
    features, not one theme spread across dirs.
  * Verdict rule: only a CONSISTENT wide regime (most representative repos over
    the gate) reopens Tier-2. A single outlier does not.""")
if dups:
    print(f"\n(deduped {sum(v-1 for v in dups.values())} duplicate clones of {len(dups)} repos across machines)")
PY
}

sub="${1:-}"; shift || true
case "$sub" in
  scan) cmd_scan "$@";;
  aggregate|agg) cmd_aggregate "$@";;
  -h|--help|"") sed -n '2,40p' "$0";;
  *) die "unknown subcommand: $sub (use scan|aggregate)";;
esac
