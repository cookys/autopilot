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

Read the emitted marker's `mission_routing` exactly as the canonical skills do (dev-flow /
ceo-agent Mission routing sections): `READY` (with `admitted: true`, `would_block: false`) is the
only enforce-mode admission — only then does managed implementation follow the existing Mission
admission, sealed campaign, and `AUTOPILOT_LEVEL=<level> node
"<plugin-root>/bin/autopilot.js" engine implement-review ...`
route. `SHADOW` (the repo's `mission-routing-config.json` has `enforcement_mode: shadow`) is
observation only: record `admitted` / `would_block` honestly in the run summary and continue
through the ordinary non-managed workflow without claiming an enforced receipt or grant, and
without calling the managed engine route (the managed CLI rejects a non-READY marker). `LEGACY`
means the project's Mission policy is off. Switching a repo from shadow to enforce is that repo
owner's policy decision, not a gate to be bypassed. Repairs attach to and resume that same engine/campaign lineage. A Codex implementer launched
inside that route receives a credentials-only isolated `CODEX_HOME`, never the controller plugin or
configuration.

Codex in this package does not provide `TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, or
`subagent_type`. Do not imitate them with Markdown tickets, inline managed implementation, a new
branch/session, or a replacement graph. If an exact mapping is unavailable, stop with the existing
precondition or abort receipt; do not invent another lifecycle authority.
