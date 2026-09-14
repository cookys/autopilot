# live-state-dir 🔵 leftovers — multi-row findmnt, `\040`-only unescape, per-process SSD warning, sub-200k window scaling untested

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a candidate that `findmnt -T` reports as more than one row; a mountpoint with an escaped character other than space; a host with neither findmnt nor /proc/mounts (macOS, unverified) where the SSD warning is observed once per hook fire; or the next edit to `tiersForKnownWindow`.
- **Context**: the 🟡 items of the v2.36.1 pre-merge review shipped in v2.36.2; these 🔵 items did not. `fstypeViaFindmnt` reads only the first output row; `fstypeViaProcMounts` unescapes only `\040` (not `\011`/`\012`/`\134`); the "falling back to ~/.autopilot" warning is once per PROCESS, i.e. once per hook fire on a host with no probe; a live window below 200k scales tiers DOWN with no test pinning it.
- **Effort**: S each
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; carried out of the v2.36.2 row

