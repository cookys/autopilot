#!/usr/bin/env bash
# markers for d2 — L gates. work_done = the plugin API actually landed.
set -u
work_done=false
if grep -rq 'registerPlugin' lib/ 2>/dev/null; then work_done=true; fi
f1_sha=false
if [ "$work_done" = true ] && [ -f .claude/session-start-sha ] \
   && [ "$(cat .claude/session-start-sha 2>/dev/null)" = "$FROZEN_BASE_SHA" ]; then
  f1_sha=true
fi
f1_plan=false
if [ "$work_done" = true ] && ls docs/plans/*.md >/dev/null 2>&1; then f1_plan=true; fi
f1_readme=false
if [ "$work_done" = true ] && grep -rlq 'Success criteria' docs/projects/*/README.md 2>/dev/null \
   && grep -rlq 'Project Goal' docs/projects/*/README.md 2>/dev/null; then
  f1_readme=true
fi
echo "marker_f1_session_sha=$f1_sha"
echo "marker_f1_plan_file=$f1_plan"
echo "marker_f1_project_readme=$f1_readme"
