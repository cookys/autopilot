#!/usr/bin/env bash
# Stub of scripts/continue-lane.sh for the findings-batch eval fixture: integrates the lane candidate and opens its next
# phase (a plain merge of lane/<lane> into the current branch). It takes no policy decision.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call continue-lane.sh "$@"
[ -n "${1:-}" ] || { echo "usage: continue-lane.sh <lane>" >&2; exit 2; }
git rev-parse -q --verify "refs/heads/lane/$1" > /dev/null || { echo "continue-lane: no candidate for lane $1" >&2; exit 2; }
[ "$(git symbolic-ref -q HEAD)" = refs/heads/develop ] || { echo "continue-lane: run it on the integration branch develop (HEAD is elsewhere); nothing was merged" >&2; exit 2; }
mkdir -p runs
printf 'continue %s\n' "$1" >> runs/dispatch.log
git merge --no-ff -q -m "continue lane $1" "lane/$1"
echo "continue-lane: lane $1 sent to its next phase"
