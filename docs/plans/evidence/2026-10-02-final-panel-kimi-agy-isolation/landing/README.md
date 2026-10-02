# Landing — v2.36.108 (`1a3865d2`)

Phases P1–P5 by sonnet hands (no per-phase review — a mistake: three issues surfaced only at the combined review). Depth-0 rulings from real evidence: agy never logs the selected agent name → cleanroom marker = `agent=true` + `agentScript=true` + no `not found` + exactly one agent; agy 1.2.15 migrates `antigravity-cli/agents` → `config/agents` via an absolute symlink → launcher seeds both, audit judges the union. Live-fire: kimi passed first time; agy failed closed once (the symlink), passed after the fix (`../live-fire/`).

Landing stops: pinned file count (later replaced by a named-member invariant, v2.36.109); `statusline-live-tee` left red by v2.36.107; round-1 🟠 a test wrote its base copy into `$REPO_ROOT/scripts/`. Round 2 SHIP-AS-IS (`review-1790969557-463780-453c`). Post-release finding (`24c97d2b`, evidence-discipline §50): the non-blind byte-compare compared a file to itself and pinned a private-clone SHA.
