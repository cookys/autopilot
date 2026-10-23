#!/bin/bash
# P1 rerun wrapper. usage: P1_RUN=<run dir> P1_CLONE=<clone> p1-wrapper.sh <first> <last>
# One harness call per id, never a second attempt. Before each id: fresh credential copy
# and a minimal auth probe; a failed probe means the id is NOT launched and the batch pauses (exit 7).
set -u
RUN=${P1_RUN:?}; CLONE=${P1_CLONE:?}
PREREG=docs/plans/evidence/2026-10-24-per-turn-gate-p1-rerun/preregistration.md
CAP=18; MEAN=0.5453; PROBE=0.0166; TOTAL=30; WINDOW_S=28800
LOG=$RUN/invocation.log; COSTS=$RUN/costs.tsv; PROBES=$RUN/probes.tsv
ts(){ date -u +%FT%T.%3NZ; }
cd "$CLONE" || exit 2
git ls-files --error-unmatch "$PREREG" >/dev/null 2>&1 || { echo "$(ts) ABORT prereg not tracked" >> $LOG; exit 3; }
[ -z "$(git status --porcelain -- "$PREREG")" ] || { echo "$(ts) ABORT prereg modified" >> $LOG; exit 3; }
PC=$(git log -1 --format=%H -- "$PREREG"); PT=$(git log -1 --format=%cI -- "$PREREG")
grep -q "^prereg_commit $PC" $LOG 2>/dev/null || echo "prereg_commit $PC $PT" >> $LOG
[ -f $RUN/window.start ] || date +%s > $RUN/window.start
echo "$(ts) WRAPPER_START first=$1 last=$2 prereg=$PC" >> $LOG
V=$(claude --version | head -1)
[ "$V" = "2.1.309 (Claude Code)" ] || { echo "$(ts) ABORT version=$V" >> $LOG; exit 3; }
( cd evals/orchestration/tasks/t14-constraint-horizon && find . -type f | LC_ALL=C sort | while read -r f; do printf "%s  %s\n" "$(git hash-object "$f")" "$f"; done ) > $RUN/taskhash.now.txt
diff -q $RUN/taskhash.pre.txt $RUN/taskhash.now.txt >/dev/null || { echo "$(ts) ABORT task hash differs" >> $LOG; exit 3; }
[ -f $COSTS ] || : > $COSTS; [ -f $PROBES ] || : > $PROBES
for n in $(seq "$1" "$2"); do
  id=$(printf "C-%02d" "$n"); out=$RUN/runs/$id; home=$RUN/homes/$id
  [ -e "$out" ] && { echo "$(ts) REFUSE $id output exists" >> $LOG; exit 4; }
  if [ "$n" -gt 1 ]; then prev=$(printf "C-%02d" $((n-1))); grep -q "^$prev	" $COSTS || { echo "$(ts) REFUSE $id previous id not finished" >> $LOG; exit 4; }; fi
  el=$(( $(date +%s) - $(cat $RUN/window.start) ))
  [ "$el" -le "$WINDOW_S" ] || { echo "$(ts) STOP_WINDOW before $id elapsed=${el}s" >> $LOG; exit 8; }
  spent=$(awk -F"\t" "BEGIN{s=0}{s+=\$3}END{printf \"%.4f\",s}" $COSTS); pspent=$(awk -F"\t" "BEGIN{s=0}{s+=\$3}END{printf \"%.4f\",s}" $PROBES)
  remaining=$((TOTAL-n+1))
  proj=$(awk -v s=$spent -v p=$pspent -v r=$remaining -v m=$MEAN -v q=$PROBE "BEGIN{printf \"%.4f\",s+p+r*(m+q)}")
  if awk -v p=$proj -v c=$CAP "BEGIN{exit !(p>c)}"; then echo "$(ts) STOP_COST before $id spent=$spent probes=$pspent projected=$proj cap=$CAP" >> $LOG; exit 5; fi
  # fresh credential copy for this id (probe attempts for the same id overwrite it)
  rm -rf "$home"; mkdir -p "$home/.claude"
  cp "$HOME/.claude/.credentials.json" "$home/.claude/.credentials.json" && chmod 600 "$home/.claude/.credentials.json" || { echo "$(ts) ABORT no credential file" >> $LOG; exit 3; }
  printf "{\"hasCompletedOnboarding\":true}\n" > "$home/.claude.json"
  pdir=$RUN/probe-work; mkdir -p $pdir
  ( cd $pdir && echo "Reply with exactly AUTH_OK" | env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$home" timeout 90 claude -p --model claude-haiku-4-5 --setting-sources project --strict-mcp-config --dangerously-skip-permissions --output-format json > $RUN/probe-$id.json 2> $RUN/probe-$id.err ); prc=$?
  pcost=$(node -e "try{const o=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));console.log((o.total_cost_usd||0).toFixed(6)+\"\t\"+(o.is_error?1:0)+\"\t\"+(String(o.result).includes(\"AUTH_OK\")?1:0))}catch(e){console.log(\"0.000000\t1\t0\")}" $RUN/probe-$id.json)
  IFS=$(printf "\t") read -r pc perr pok <<< "$pcost"
  printf "%s\t%s\t%s\n" "$id" "$prc" "$pc" >> $PROBES
  if [ "$prc" -ne 0 ] || [ "$perr" != 0 ] || [ "$pok" != 1 ]; then echo "$(ts) PROBE_FAIL $id rc=$prc cost=$pc; id NOT launched, batch paused" >> $LOG; exit 7; fi
  echo "$(ts) PROBE_OK $id cost=$pc" >> $LOG
  echo "$(ts) START $id spent=$spent probes=$pspent projected=$proj" >> $LOG
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$home" bash evals/orchestration/run-orchestration-eval.sh --task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out "$out" --gate observe > "$RUN/runs/$id.stdout" 2> "$RUN/runs/$id.stderr" < /dev/null
  rc=$?
  cost=$(node -e "
const fs=require(\"fs\");const t=(()=>{try{return fs.readFileSync(process.argv[1],\"utf8\")}catch(e){return \"\"}})();
let d=0,s=-1,last=0,n=0;for(let i=0;i<t.length;i++){const c=t[i];if(c===\"{\"){if(d===0)s=i;d++}else if(c===\"}\"){d--;if(d===0&&s>=0){try{const o=JSON.parse(t.slice(s,i+1));if(o.type===\"result\"){last=o.total_cost_usd||0;n++}}catch(e){}s=-1}}}
console.log(last.toFixed(6)+\"\t\"+n)" "$out/run.log")
  printf "%s\t%s\t%s\n" "$id" "$rc" "${cost%%	*}" >> $COSTS
  echo "$(ts) END $id rc=$rc cost_last_result=${cost}" >> $LOG
  rm -rf "$home"
  if grep -qi "failed to authenticate\|oauth session expired\|authentication_failed" "$out/run.log" "$RUN/runs/$id.stderr" 2>/dev/null; then echo "$(ts) STOP_AUTH after $id" >> $LOG; exit 6; fi
done
echo "$(ts) WRAPPER_DONE last=$2" >> $LOG
