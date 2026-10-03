#!/bin/bash
cd $C1/proj/sub
$C1/cc.sh --plugin-dir $C1/plug --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --session-id 11111111-2222-4333-8444-5555555555c2
echo "EXITED rc=$?"
sleep 600
