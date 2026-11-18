#!/usr/bin/env bash
# mods/live/run-tests.sh — run the live mod's suites (gen-locales.js --check, live.test.ts, load-source.test.ts) with `claude plugin test`.
#
# live.test.ts is split in three files (live.test.ts, live2.test.ts, live3.test.ts; live.part1.ts / live.part2.ts only set which third a file registers): `claude plugin test` runs each file in a child
# that prints ONE report line to a pipe, and a line over about 128 KiB is cut, which reads as "the file did not load". One file of ~800 tests is about 200 KB; a third each is well under.
#
# `claude plugin test <folder>` runs a plugin's *.test.ts files against the real engine, and a plugin loads its hooks module from the
# `modules` key of hooks/hooks.json. The suite is written for a plugin named `autopilot` ($.state refs are owner-checked) whose
# modules entry is ../mods/live/register.ts. This script builds that throwaway wrapper in a temp dir:
#
#   <tmp>/.claude-plugin/plugin.json   {"name":"autopilot",...}
#   <tmp>/hooks/hooks.json             {"modules":["../mods/live/register.ts"]}      (an ARRAY; a string names none)
#   <tmp>/mods/live/                   a COPY of this directory (a symlink is refused: path-traversal)
#   <tmp>/mods/viewer/                 a COPY of ../viewer (the live mod's pressable file paths import mods/viewer/show.ts)
#
# and runs `claude plugin test <tmp>`. Nothing is written into the repo. Run solo (not in parallel with other long suites).
#
# usage: bash mods/live/run-tests.sh [extra args for `claude plugin test`]      exit code = the test run's
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# the string tables: locales.ts must match the JSON sources, both locales must carry the same ids and placeholders (gen-locales.js --check)
node "$here/gen-locales.js" --check
# the shared contract: band-contract-data.ts must match band-statusline-contract.json (a hooks module cannot import the JSON)
node "$here/gen-band-contract.js" --check
node --test "$here/gen-locales.test.js"
# the glyph tables, vocabulary and the all-mod design lints (L3, I5 (a), I20, L1b-L9 over every mods/* source): imports the real ui.ts, so the tables it lints are the ones the pane draws
node --test "$here/ui-lint.test.js"
node --test "$here/band-split.test.js"
# the O4 shell planner (tiers, geometry, the forge-stats panel reader, the right-hand columns): pure, imports the real shell.ts
node --test "$here/shell.test.js"
# the operator-console snapshot (the fleet.console/1 trust-boundary parser, the console.json mode reader, fictional fixtures): pure, imports the real console.ts
node --test "$here/console.test.js"
# the console tab strip (consoletabs.ts: five tabs, badges, the 120 / 80 / 20 column forms), the console.json mode finder, and the golden that pins the non-console strips byte for byte
node --test "$here/consolestrip.test.js"
# the console 指揮 page builder (commandtab.ts: summary, exceptions, queue, data age; the to_console negative control; the mirror card; the 120 / 80 / 20 widths)
node --test "$here/commandtab.test.js"
# the console pane's team / quota / hosts skeleton pages (consolepages.ts): 無來源 for a missing source, the red light with the fixture's lines deleted
node --test "$here/consolepages.test.js"
# the console data source (consolefeed.ts: fleet console --json, the 60 s interval, the console.json fallback, staleness, garbage input)
node --test "$here/consolefeed.test.js"
# the quota page's pick (pages/quota-pick.ts: worstPool / rankPools, g2 A1 / A7 order, the no-pace fallback): pure, imports the real source
node --test "$here/pages/quota-pick.test.js" < /dev/null
# console.test.ts (C1 U8: KR8 order and counts, the leak red light) is picked up by `claude plugin test` below with the other *.test.ts files
# frame.test.ts (S0: the fixed-height pane frame, the page registry, the pane key table, the strip without the › chip) is picked up the same way
# now.test.ts (S3: the 現況 page goldens at 160x40 / 120x30 / 80x24, the seat_blocked rows, the own-seat quota feed) is picked up the same way
# pages/fleet.test.ts (S2: the 艦隊 page golden rows, fixed height, no-source and stale rows, key presses) is picked up the same way
# decide.test.ts (S1: the 待決 page, golden against the codeforge mockups, and its key reducer) is picked up the same way
# pane-poll.test.ts (the real tick runs `fleet console --json` and `fleet seats --quota --json` on every page and with the pane closed, console.json or not) is picked up the same way
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/.claude-plugin" "$tmp/hooks" "$tmp/mods"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","description":"throwaway wrapper for the live mod tests","types":"./mods/live/types/index.d.ts"}' > "$tmp/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/live/register.ts"]}' > "$tmp/hooks/hooks.json"
cp -r "$here" "$tmp/mods/live"
cp -r "$here/../viewer" "$tmp/mods/viewer"
rm -f "$tmp/mods/live/run-tests.sh"
rm -f "$tmp/mods/viewer/"*.test.ts "$tmp/mods/viewer/"*.test.js "$tmp/mods/viewer/run-tests.sh" # the viewer suites run from their own wrapper

. "$here/../lib/real-claude-env.sh"
mods_run_plugin_test "$tmp" "$@"
