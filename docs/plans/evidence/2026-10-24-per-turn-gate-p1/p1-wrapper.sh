#!/bin/bash
# P1 wrapper: runs C-NN..C-MM sequentially, one harness call per id, never a second attempt.
# usage: p1-wrapper.sh <first> <last>      (ids are C-01..C-30)
set -u
ROOT=/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo
RUN=$ROOT/p1base/run; CLONE=$ROOT/p0probe/clone
PREREG=docs/plans/evidence/2026-10-24-per-turn-gate-p1/preregistration.md
CAP=18; MEAN=0.5453; TOTAL=30
LOG=$RUN/invocation.log; COSTS=$RUN/costs.tsv
ts(){ date -u +%FT%T.%3NZ; }
cd "$CLONE" || exit 2
# 1. the preregistration commit must exist, be tracked and unmodified
git ls-files --error-unmatch "$PREREG" >/dev/null 2>&1 || { echo "$(ts) ABORT prereg not tracked" >> $LOG; exit 3; }
[ -z "$(git status --porcelain -- "$PREREG")" ] || { echo "$(ts) ABORT prereg modified" >> $LOG; exit 3; }
PC=$(git log -1 --format=%H -- "$PREREG"); PT=$(git log -1 --format=%cI -- "$PREREG")
grep -q "^prereg_commit $PC" $LOG 2>/dev/null || echo "prereg_commit $PC $PT" >> $LOG
echo "$(ts) WRAPPER_START first=$1 last=$2 prereg=$PC" >> $LOG
# 2. version and task hash preflight
V=$(claude --version | head -1)
[ "$V" = "2.1.309 (Claude Code)" ] || { echo "$(ts) ABORT version=$V" >> $LOG; exit 3; }
( cd evals/orchestration/tasks/t14-constraint-horizon && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(git hash-object "$f")" "$f"; done ) > $RUN/taskhash.now.txt
diff -q $RUN/taskhash.pre.txt $RUN/taskhash.now.txt >/dev/null || { echo "$(ts) ABORT task hash differs" >> $LOG; exit 3; }
[ -f $COSTS ] || : > $COSTS
for n in $(seq "$1" "$2"); do
  id=$(printf 'C-%02d' "$n"); out=$RUN/runs/$id
  [ -e "$out" ] && { echo "$(ts) REFUSE $id output exists" >> $LOG; exit 4; }
  if [ "$n" -gt 1 ]; then prev=$(printf 'C-%02d' $((n-1))); grep -q "^$prev	" $COSTS || { echo "$(ts) REFUSE $id previous id not finished" >> $LOG; exit 4; }; fi
  spent=$(awk -F'\t' 'BEGIN{s=0.016617}{s+=$3}END{printf "%.4f",s}' $COSTS)   # 0.016617 = preflight auth probe
  remaining=$((TOTAL-n+1))
  proj=$(awk -v s=$spent -v r=$remaining -v m=$MEAN 'BEGIN{printf "%.4f",s+r*m}')
  if awk -v p=$proj -v c=$CAP 'BEGIN{exit !(p>c)}'; then echo "$(ts) STOP_COST before $id spent=$spent projected=$proj cap=$CAP" >> $LOG; exit 5; fi
  CMD="HOME=$RUN/cfg-home bash evals/orchestration/run-orchestration-eval.sh --task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out $out --gate observe"
  echo "$(ts) START $id spent=$spent projected=$proj cmd=$CMD" >> $LOG
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME=$RUN/cfg-home bash evals/orchestration/run-orchestration-eval.sh --task t14-constraint-horizon --arm off --runner cc --model claude-haiku-4-5 --out "$out" --gate observe > "$RUN/runs/$id.stdout" 2> "$RUN/runs/$id.stderr" < /dev/null
  rc=$?
  cost=$(node -e '
const fs=require("fs");const t=(()=>{try{return fs.readFileSync(process.argv[1],"utf8")}catch(e){return ""}})();
let d=0,s=-1,last=0,n=0;for(let i=0;i<t.length;i++){const c=t[i];if(c==="{"){if(d===0)s=i;d++}else if(c==="}"){d--;if(d===0&&s>=0){try{const o=JSON.parse(t.slice(s,i+1));if(o.type==="result"){last=o.total_cost_usd||0;n++}}catch(e){}s=-1}}}
console.log(last.toFixed(6)+"\t"+n)' "$out/run.log")
  printf '%s\t%s\t%s\n' "$id" "$rc" "${cost%%	*}" >> $COSTS
  echo "$(ts) END $id rc=$rc cost_last_result=${cost}" >> $LOG
  if grep -qi 'failed to authenticate\|oauth.*expired\|invalid api key\|authentication_error' "$out/run.log" "$RUN/runs/$id.stderr" 2>/dev/null; then echo "$(ts) STOP_AUTH after $id" >> $LOG; exit 6; fi
done
echo "$(ts) WRAPPER_DONE last=$2" >> $LOG
