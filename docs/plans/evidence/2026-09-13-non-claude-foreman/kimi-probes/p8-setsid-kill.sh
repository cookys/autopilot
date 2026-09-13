cd /tmp/claude-1000/-home-cookys-projects-autopilot/d1423f91-4e83-43b9-ae77-3de0367aa10a/scratchpad/kimi-probe/ws4
setsid kimi -m kimi-code/k3 -p 'Using your shell tool, run these one at a time as separate tool calls: echo one; sleep 4; echo two; sleep 4; echo three; sleep 4; echo four. Then reply DONE.' --output-format stream-json > /tmp/claude-1000/-home-cookys-projects-autopilot/d1423f91-4e83-43b9-ae77-3de0367aa10a/scratchpad/kimi-probe/p8-kill.jsonl 2>&1 &
pid=$!
for i in $(seq 1 90); do sleep 1; n=$(grep -c '"name":"Bash"' /tmp/claude-1000/-home-cookys-projects-autopilot/d1423f91-4e83-43b9-ae77-3de0367aa10a/scratchpad/kimi-probe/p8-kill.jsonl); [ "$n" -ge 2 ] && break; done
echo "bash-calls-seen=$n at ${i}s pid=$pid pgid=$(ps -o pgid= $pid | tr -d ' ')"
kill -- -$pid; wait $pid; echo killed-rc=$?
sleep 1; ps -eo pid,pgid,cmd | grep '[k]imi' | head
