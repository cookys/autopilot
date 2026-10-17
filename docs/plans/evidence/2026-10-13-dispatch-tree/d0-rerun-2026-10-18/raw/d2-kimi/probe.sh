#!/usr/bin/env bash
S=$1; REPO=/home/cookys/projects/autopilot/.claude/worktrees/lane-kimiprobe
source $REPO/scripts/lib/qualify-stage-credentials.sh
bash $S/stage.sh $S >/dev/null 2>&1
qualify_kimi_arm_writeback $S/home/.kimi-code $HOME/.kimi-code
cd $S/sbx
env HOME=$S/home PATH=/home/cookys/.local/bin:$PATH CLAUDE_CODE_SESSION_ID=11111111-1111-4111-8111-111111111111 AUTOPILOT_SESSION_ID=outer-S AUTOPILOT_CHILD_SESSION_ID=22222222-2222-4222-8222-222222222222 \
  AUTOPILOT_PARENT_RUN_ID=run-outer AUTOPILOT_DISPATCH_DEPTH=1 AUTOPILOT_ROOT_RUN_ID=root-outer \
  bash $REPO/scripts/dispatch-author.sh --runner kimi --model kimi-code/k3 --prompt-file $S/author-prompt.txt --timeout 5m --run-id kimid3d > $S/out3.txt 2> $S/err3.txt
echo rc=$? > $S/rc3.txt
