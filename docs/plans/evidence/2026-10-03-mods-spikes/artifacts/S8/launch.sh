#!/bin/bash
cd $P/c3/repo
exec env -u AUTOPILOT_SESSION_ID CLAUDE_CONFIG_DIR=$P/c1/claude-config HOME=$P/c3/home TMPDIR=$P/c3/tmp claude --plugin-dir $P/c2/wrap --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --session-id 22222222-3333-4444-8555-6666666666a1
