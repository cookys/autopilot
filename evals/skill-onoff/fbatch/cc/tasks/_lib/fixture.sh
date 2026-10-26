#!/usr/bin/env bash
# Shared helpers for the findings-batch task fixtures (sourced by init-repo.sh and seed-home.sh).
#   fb_state <task>            hidden state dir <git-dir>/fbatch with the task name and an empty ledger
#   fb_lanes <lane>...         one candidate branch lane/<lane> per lane (a commit adding impl/<lane>.txt) off the current
#                              branch; the tips go to <git-dir>/fbatch/lane-shas ("<lane> <sha>")
#   fb_snapshot_repo           name list of every path in the cell repo (except .git), taken before the agent starts
#   fb_seed_home <home>        scratch HOME: a tmp/ dir (the cell TMPDIR) and the name list of HOME (except the CLI's own
#                              .claude-config and .claude.json), taken before the agent starts
#   fb_after_s                 prints `,"after_s":N` for a plan entry when FBATCH_LAND_AFTER_S (seconds, prereg cc.land_after_s,
#                              handed over by the campaign) is a positive integer, else nothing
#   fb_start_timer             starts the landing timer (scripts/_land.js timer) in the background when the plan has an after_s
#                              entry; it lives in the runner's process group and exits with the runner / the cell (see _land.js)
# fbatch/cell.js compares these lists with the same listing after the run: a new path whose name contains "findings"
# makes the cell invalid.
fb_state() {
  G=$(git rev-parse --absolute-git-dir)
  mkdir -p "$G/fbatch"
  echo "$1" > "$G/fbatch-task"
  # The whole hidden state (generation token, plan, landed, waits, ledger, dispatch.json, watch.pid) is swapped by ONE node call under
  # the lock land() uses (_land.js reset), so a timer of an earlier fixture on this path is either finished before the swap or stale
  # after it. The token is made HERE, by the builder, and handed to the timers (fb_start_timer, register); no timer reads it for itself.
  # $PPID = whoever built the fixture (the timers watch it); FBATCH_DISPATCH_LAND_AFTER_S = prereg cc.dispatch_land_after_s.
  FB_GEN="$(date +%s%N)-$$-$RANDOM-$RANDOM"
  node scripts/_land.js reset --gen "$FB_GEN" --task "$1" --watch-pid "$PPID" --dispatch-after-s "$(case "${FBATCH_DISPATCH_LAND_AFTER_S:-}" in ''|0|*[!0-9]*) echo 0 ;; *) echo "$FBATCH_DISPATCH_LAND_AFTER_S" ;; esac)"
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
fb_after_s() {
  case "${FBATCH_LAND_AFTER_S:-}" in ''|0|*[!0-9]*) ;; *) printf ',"after_s":%s' "$FBATCH_LAND_AFTER_S" ;; esac
}
fb_start_timer() {
  case "${FBATCH_LAND_AFTER_S:-}" in ''|0|*[!0-9]*) return 0 ;; esac
  # no setsid: the timer stays in the process group of whoever built the fixture; $PPID = that builder (runner or test shell)
  node scripts/_land.js timer --watch-pid "$PPID" --gen "$FB_GEN" > /dev/null 2>&1 < /dev/null &
  disown 2> /dev/null || true
}
