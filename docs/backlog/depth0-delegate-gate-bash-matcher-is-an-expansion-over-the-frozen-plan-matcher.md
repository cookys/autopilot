# depth0-delegate-gate `Bash` matcher is an expansion over the frozen plan matcher

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a measured depth-0 Bash latency complaint, or the next revision of `depth0-delegate-gate`.
- **Context**: plan §4 P3.1 lists `WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task`; the shipped hook also matches `Bash` and classifies read-shaped commands (`grep|rg|find|cat|sed -n|head|tail`) with a duplicated 35-line shell lexer, adding ~17 ms and two `/bin/sh` spawns per depth-0 Bash call (reviewer measurement). Accepted for v2.36.1 (depth-0's own grep bursts were the incident); recorded here so the delta is explicit. Options: keep and share the lexer with `foreman-guard.js`; or drop `Bash` and accept that grep-via-Bash is uncounted.
- **Effort**: S
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; `docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md` §4 P3.1

