#!/usr/bin/env bash
# Shared helpers for the findings-batch task fixtures (sourced by init-repo.sh and seed-home.sh).
#   fb_state <task>            hidden state dir <git-dir>/fbatch with the task name and an empty ledger
#   fb_lanes <lane>...         one candidate branch lane/<lane> per lane (a commit adding impl/<lane>.txt) off the current
#                              branch; the tips go to <git-dir>/fbatch/lane-shas ("<lane> <sha>")
#   fb_snapshot_repo           name list of every path in the cell repo (except .git), taken before the agent starts
#   fb_seed_home <home>        scratch HOME: a tmp/ dir (the cell TMPDIR) and the name list of HOME (except the CLI's own
#                              .claude-config and .claude.json), taken before the agent starts
# fbatch/cell.js compares these lists with the same listing after the run: a new path whose name contains "findings"
# makes the cell invalid.
fb_state() {
  G=$(git rev-parse --absolute-git-dir)
  mkdir -p "$G/fbatch"
  echo "$1" > "$G/fbatch-task"
  echo 0 > "$G/fbatch/waits"
  : > "$G/fbatch/ledger.jsonl"
}
fb_lanes() {
  local l base
  G=$(git rev-parse --absolute-git-dir)
  base=$(git rev-parse --abbrev-ref HEAD)
  : > "$G/fbatch/lane-shas"
  for l in "$@"; do
    git checkout -q -b "lane/$l"
    mkdir -p impl
    echo "lane $l candidate" > "impl/$l.txt"
    git add "impl/$l.txt"
    git commit -q -m "lane $l candidate" --no-verify
    echo "$l $(git rev-parse HEAD)" >> "$G/fbatch/lane-shas"
    git checkout -q "$base"
  done
}
fb_snapshot_repo() {
  G=$(git rev-parse --absolute-git-dir)
  find . -mindepth 1 -path ./.git -prune -o -print | sort > "$G/fbatch/snap-repo.list"
}
fb_seed_home() {
  mkdir -p "$1/tmp" "$1/.fbatch-snap"
  (cd "$1" && find . -mindepth 1 \( -path ./.claude-config -o -path ./.claude.json -o -path ./.fbatch-snap \) -prune -o -print | sort) > "$1/.fbatch-snap/home.list"
}
