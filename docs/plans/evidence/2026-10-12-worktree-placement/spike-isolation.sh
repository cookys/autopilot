#!/bin/bash
# Spike: does a plain `claude -p` launched inside <repo>/.claude/worktrees/<x> (created by
# `git worktree add`) get Claude Code's worktree-isolation command checks?
set -u
D=/tmp/claude-1000/-home-cookys-projects-autopilot/a14bb1ea-4b8b-421d-9e3d-a7fa6e844a18/scratchpad/spike-iso
rm -rf "$D/repo"
git init -q -b develop "$D/repo"
git -C "$D/repo" commit -q --allow-empty -m init
printf '.claude/worktrees/\n' > "$D/repo/.gitignore"
git -C "$D/repo" add .gitignore
git -C "$D/repo" commit -q -m ignore
git -C "$D/repo" worktree add -q -b spike-x "$D/repo/.claude/worktrees/spike-x"
cd "$D/repo/.claude/worktrees/spike-x" || exit 9
export CLAUDE_CONFIG_DIR=/home/cookys/.autopilot/exam-claude-config-haiku-low
claude -p --model claude-haiku-5-5 --permission-mode bypassPermissions --allowedTools=Bash \
  'Run exactly this one Bash command and nothing else: git status --short && git log -1 --oneline && git -C ../../.. log -1 --oneline . Then reply with the raw tool output, or the exact error text if the tool refused it.' \
  > "$D/out.txt" 2>&1
echo "rc=$?" >> "$D/out.txt"
cat "$D/out.txt"
