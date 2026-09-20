# `peer-coordination` skill — ruled in, blocked on a spike sweep

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
  skill before that — its whole subject is harness capability, and shipping unverified capability
  claims is the defect `references/knowledge-routing.md` §6 exists to stop.
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has
  no entry for a **peer** — an agent this session did not dispatch, does not control, and that may
  not be Claude. Two heterogeneous seats over two rounds ruled: a thin skill (routing entry only) plus
  **two** references — `peer-channels.md` (capability matrix, audience = local session) and
  `peer-contract.md` (the fill-in division-of-labour template, audience = the peer or its operator,
  and the only artifact handed across the boundary). `references/` cannot be selected by skill
  routing, which is why a skill is needed at all. Route key must be the authority relationship, never
  brand or tool names — `grok`/`tmux`/`ListAgents` as triggers collide with `team`, `l3`–`l6` and
  `engine-onboarding`. Ruling detail is in machine-local memory (`peer-coordination-skill-ruling`).
- **Spike list (none of these may be asserted without a dated result)**: which harness versions expose
  the native peer enumeration; whether every enumerated target is actually reachable by the paired
  send tool; whether reported pane addresses survive a peer restart; what the MCP relay lane provides
  that the native lane does not; `pgrep` identification accuracy per non-Claude CLI; whether file-drop
  is really reachable by "any agent" (pickup convention, atomic write, cross-worktree visibility).
- **Design constraint discovered while drafting**: reach is a property of the **environment**, not of
  the channel — the same enumeration lists 38 targets on one machine and local-only on another. Every
  matrix row therefore needs a **verified-on-machine** column beside its verified-date, or the next
  reader will take one host's topology for a channel capability.
- **Effort**: M (skill is thin; the two references and the spike sweep are the work)
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel

## 2026-08-28 foreman cost is the polling loop, not the model (revival.3d session 5ca9b104)

Evidence (grok cost split, `revival.3d/NOTE-FOR-FABLE-FOREMAN-COST.md`): 30 opus foremen, 28 of them
burned more usage than all their sonnet leaves combined (foremen 227M vs leaves 130M). Foreman tool
mix 3971 Bash / 337 Edit — almost no code; the Bash is `sleep 240` polling + `cat <leaf>.output` fed
back into the foreman context. Every wake is a full-price inference on a 200–500k prompt. Switching
the foreman role to sonnet (`model-routing-config.md`, 2026-08-28) only lowers unit price; the loop
remains.

Two items:

1. **Foreman must not be a polling model.** Waiting has to be inference-free: the canonical foreman
   for /l4–/l6 should be a `Workflow` script (deterministic fan-out, zero turns while leaves run) or a
   `run_in_background` + notification wake. Add a gate: a sub-orchestrator transcript with
   `sleep` in a loop, or `cat`/`tail` of a child output file into its own context, is a red-line
   violation. Leaves return a schema-typed criteria table; their raw output never enters the
   foreman prompt. → plan 2026-08-28 (`docs/plans/_archive/2026/08/2026-08-28-foreman-no-polling.md`).
2. **Implementer ladder by unit class, not one seat.** → plan 2026-08-28
   (`docs/plans/_archive/2026/08/2026-08-28-implementer-ladder.md`). `review-loop-config.md` has a single
   `implementer_engine`. Add `implementer_ladder: gemini-3.7-flash-low → grok-4.6/low → sonnet`
   with two triggers: contract field `unit_class: mechanical|judgment` picks the starting rung; a
   red repair round climbs one rung; top rung then enters `awaiting_convergence_adjudication`
   (existing). `on_engine_unavailable` stays availability-only. Sample: revival.3d AF
   (wizhall-mega 058 migration) — brief fully pre-resolved, flash-low one-shot, 5 files correct.
   Adjudication (BLOCKED) stays on opus/fable via `tree:judge`.

- **check-foreman-polling bash_cap=40 ground truth (2026-08-28, peer aimax395)**: a real /l4 foreman
  that runs the hetero review loop scored sleep_loop=0 / leaf_output_reads=0 / bash=126 — the two
  toxic patterns absent, red only on bash_cap, because endpoint load / roster / test execution all
  go through Bash. Tune: make the cap configurable per level, or exclude Bash calls that invoke
  autopilot's own scripts (`dispatch-review.sh`, `resolve-review-loop.sh`, `node --test`) from the
  count. Keep sleep_loop and leaf_output_read as the hard reds.

## 2026-08-29 dispatch residue governance: mechanism in autopilot, declaration via project DI

Evidence: revival.3d 2026-08-28 — 40 dispatches left 35 `.vite-<tag>` caches, 625 root-owned Chrome
udd dirs (238 MB+), 118 `/tmp/rw3d-*`, and 5 live Chromes holding 5.7 GB on GPU1 that killed the next
line's WebGPU context. Owner: "治理你自己每一輪生產的垃圾要系統化". The project shipped
revival.3d's `lab/reap-run.mjs` (under its own `scripts/`; `--tag/--check/--all-stale/--self-test` + hourly user timer) as a stopgap
adapter; ruling: the **mechanism belongs in autopilot**, the project only declares what counts as residue.

Split:
- **autopilot (mechanism)**: tag-is-ownership naming contract (worktree dir, branch `l6/<tag>`, any
  file/dir/process the leaf creates carries `<tag>`); `reap --tag` at the end of every merge; `--check`
  gate before dispatching a resource-bound line; `--all-stale` timer; receipts merged into
  `LifecycleResidueReceipt.zero_residue` (today it only counts worktrees/branches —
  `reap-dispatch-worktrees.sh`/`reap-dispatch-branches.sh`); self-test harness that injects fake residue
  incl. root-owned dirs; whitelist semantics (never touch non-`l6/` branches, foreign worktrees,
  `/tmp/claude-*`, flock-held tags).
- **project DI** `.claude/residue-config.md` (draft fields): `kinds[]` each with `glob` (with `<tag>`),
  `owner: self|root` (needs `sudo -n`), `process_match` (cmdline substring with `<tag>`, exact per-pid —
  **never `pkill -f`**, leaves' briefs live on argv), `port_from` (file glob + regex), `stale_after`,
  `whitelist[]`; plus `resource_check[]` (e.g. `nvidia-smi` GPU index + mem threshold).
- Leaves are not trusted to clean up ("已收" was false 3× on 2026-08-28); they only owe correct naming.

Reference impl to absorb: revival.3d's `lab/reap-run.mjs` (under its own `scripts/`) + `docs/governance/dispatch.md`
"派遣殘留物治理".

## 2026-08-29 qualification run.sh templates baked an invalid effort enum

Evidence: `docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/`
seat6 (agy) and seat3 (cc-shim) `run.sh` scripts set `EFFORT` to a free-text placeholder
(`"baked-in-model-name"`, `"default"`) instead of a value in `engine-scorecard.js record`'s closed
enum (`none|low|medium|high|xhigh|max`), which blocked scorecard recording until corrected to
`"high"` (receipt-only — matches kimi/grok's convention for the same transport class; the CLI
never receives this value). Future qualification `run.sh` templates for effort-less transports
(agy, cc-shim/QRP, and any other transport whose CLI takes no `--effort`) should default straight
to a valid enum value (`"high"` or `"none"` per `engine-scorecard.js`'s own documented convention),
never an ad hoc descriptive string.

