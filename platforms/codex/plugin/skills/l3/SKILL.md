---
name: l3
description: >
  Terse CEO front-door — Level 3: full autonomy, CEO executes inline on this thread, escalate only
  at the DOA boundary. Use when: "/l3 <goal>", "L3 <goal>", you want the "全權處理 / get it done"
  behavior as one command without the CEO startup Q&A. Presets involvement=just-results, scope=Hold,
  project red lines plus -x additions (override --mode / --expand). Not for: offloading to a background foreman (→ /l4), hetero
  impl engine (→ /l5), participatory planning (→ dev-flow), research-only (→ survey).
---

<!-- AUTOPILOT_CODEX_LIFECYCLE_ADAPTER_V1 -->

## Codex lifecycle adapter (normative override)

This section overrides any later host-specific lifecycle or dispatch spelling in the canonical skill
body. Resolve `<plugin-root>` as the installed Autopilot plugin directory that contains this skill.

When using the packaged managed CLI, enter through the existing explicit marker command:

```text
node "<plugin-root>/scripts/session-mode.js" set --level <l3|l4|l5|l6> --entry-level <requested-level> --repo-root <git-root>
```

The production Codex package currently registers only its `PostCompact` recovery hook. It does not
ship a Codex-thread-bound `PreToolUse` direct-mutation gate, and this shell command must not be
described as receiving or exporting a `CODEX_THREAD_ID` binding. The marker is an explicit
CLI/Engine admission artifact; it is not a production hook admission proof. A marker from another
explicitly bound session is not reusable when the managed CLI validates it.

Continue only when the emitted marker contains `mission_routing.status: "READY"`, `admitted: true`, and
`would_block: false`. Managed implementation then follows the existing Mission admission, sealed
campaign, and `AUTOPILOT_LEVEL=<level> node
"<plugin-root>/bin/autopilot.js" engine implement-review ...`
route. Repairs attach to and resume that same engine/campaign lineage. A Codex implementer launched
inside that route receives a credentials-only isolated `CODEX_HOME`, never the controller plugin or
configuration.

Codex in this package does not provide `TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, or
`subagent_type`. Do not imitate them with Markdown tickets, inline managed implementation, a new
branch/session, or a replacement graph. If an exact mapping is unavailable, stop with the existing
precondition or abort receipt; do not invent another lifecycle authority.

# /l3 — CEO autonomy, inline

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer explicit commands over conversational autonomy).

Terse front-door into `autopilot:ceo-agent` at **Level 3**: the CEO executes the
goal **itself on this thread** and escalates only at the DOA boundary.

Hard rules:
- Startup pre-filled, never re-asked on a clean goal: OKR from `<goal>`;
  involvement=3 just-results; scope=Hold (`--expand` → Expand); governance mode from the project
  default (`--mode` changes only this run); project red lines plus `-x <csv>` additions.
- Before any TaskCreate, branch, worktree, runner, model, or inline implementation effect, run
  `node <plugin>/scripts/session-mode.js set --level l3 --repo-root <repo>`. The command performs
  canonical Mission policy/graph/source admission before writing its marker. Enforce requires
  `READY`; shadow is disclosed without authority; off remains `LEGACY`.
- Posture: **inline** — no foreman dispatch. `/l3` is also the `--solo` degradation
  target for `/l4`/`/l5`/`/l6`.
- The front-door changes startup ONLY — every `ceo-agent` gate (size → project setup
  → admitted deliverables → finish-flow) still applies. Plan headings, modules, tests,
  reviewers, and retries remain coverage/gates inside those deliverables.

