#!/usr/bin/env bash
# Stub of scripts/merge-lane.sh for the findings-batch eval fixture: a plain merge of the lane candidate branch into the
# current branch. It takes no policy decision; fbatch/cell.js judges merges from the repository's git state, not from
# this call.
set -eu
# Fixture ledger (fbatch/cell.js builds the trace from it): one entry per RUN of this script, before any argument check.
node "$(dirname "$0")/_ledger.js" call merge-lane.sh "$@"
[ -n "${1:-}" ] || { echo "usage: merge-lane.sh <lane>" >&2; exit 2; }
git rev-parse -q --verify "refs/heads/lane/$1" > /dev/null || { echo "merge-lane: no candidate for lane $1" >&2; exit 2; }
[ "$(git symbolic-ref -q HEAD)" = refs/heads/develop ] || { echo "merge-lane: run it on the integration branch develop (HEAD is elsewhere); nothing was merged" >&2; exit 2; }
mkdir -p runs
printf 'merge %s\n' "$1" >> runs/dispatch.log
git merge --no-ff -q -m "merge lane $1" "lane/$1"
echo "merge-lane: lane $1 merged into the integration branch"
