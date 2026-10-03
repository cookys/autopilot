#!/bin/bash
cd /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5
export AUTOPILOT_LIVE_DIR=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/live S5_LOCK=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/project.lock
touch $S5_LOCK
echo "== (1) launch"; node launch.js; sleep 3
cat live/runs/spikeproj.json; echo
WP=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("live/runs/spikeproj.json")).writer_pid)')
echo "writer_pid=$WP"
echo "== (2) lock holder"; ./holder.sh $S5_LOCK
echo "cmd of writer_pid: $(tr '\0' ' ' < /proc/$WP/cmdline)  ppid=$(awk '/PPid/{print $2}' /proc/$WP/status) sid=$(ps -o sid= -p $WP)"
echo "== (3) second launch while held"; node launch.js; sleep 3
echo "writer_pid after 2nd launch: $(node -e 'console.log(JSON.parse(require("fs").readFileSync("live/runs/spikeproj.json")).writer_pid)')"
echo "direct foreground flock -n (what 'set' can use to detect holder):"; flock -n $S5_LOCK true; echo "flock rc=$? (1 = held)"
echo "node processes running stub: $(for p in /proc/[0-9]*; do tr '\0' ' ' < $p/cmdline 2>/dev/null | grep -q 'node .*stub-watcher' && echo -n \"$(basename $p) \"; done)"
echo "== (4) kill writer"; kill $WP; sleep 1
flock -n $S5_LOCK echo "lock acquired after kill rc=$?"; echo "flock rc=$?"
./holder.sh $S5_LOCK
echo "== (5) relaunch"; node launch.js; sleep 3
NP=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("live/runs/spikeproj.json")).writer_pid)')
echo "new writer_pid=$NP (old $WP)"; ./holder.sh $S5_LOCK
echo $NP > s5-writer.pid
kill $NP; sleep 1; flock -n $S5_LOCK true; echo "cleanup flock rc=$?"
