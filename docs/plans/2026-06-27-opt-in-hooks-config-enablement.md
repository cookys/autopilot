# Plan — migrate all opt-in hooks off the broken `settings.example.json` copy-paste route (v2.26.2)

## Problem
`${CLAUDE_PLUGIN_ROOT}` expands ONLY inside the plugin's own `hooks.json`, never in a
user's `settings.json` (confirmed vs CC hooks docs + reproduced; see
`project_plugin-root-only-in-hooks-json` memory). The 12 Tier-B opt-in hooks ship as
`hooks-opt-in-examples` entries that users are told to COPY into their `settings.json`
— where the token stays literal and the hook never launches. v2.26.1 fixed 2 of them;
this ships the systemic fix for the remaining 12.

## The 12 opt-in hooks (13 wiring entries)
| stem | event | matcher | timeout | arg |
|------|-------|---------|---------|-----|
| branch-protection | PreToolUse | Bash | — | — |
| commit-secret-scan | PreToolUse | Bash | — | — |
| large-file-warner | PreToolUse | Read | — | — |
| config-protection | PreToolUse | Write\|Edit | — | — |
| mcp-health | PreToolUse | mcp__.* | — | `pre` |
| mcp-health | PostToolUseFailure | mcp__.* | — | `failure` |
| accumulator | PostToolUse | Write\|Edit | — | — |
| test-runner | PostToolUse | Write\|Edit | 60000 | — |
| design-quality | PostToolUse | Write\|Edit | 10000 | — |
| cost-tracker | Stop | "" | — | — |
| session-summary | Stop | "" | — | — |
| check-console | Stop | "" | — | — |
| batch-format | Stop | "" | 300000 | — |

## Design
1. **`hooks/_shared/opt-in.js`** — `isEnabled(name)`: returns true iff
   `~/.autopilot/config.json` `hooks[name] === true` OR env `AUTOPILOT_HOOK_<NAME>`
   (UPPER, `-`→`_`) is `1`/`true`. **Default false. Fail-safe: ANY error → false.**
   This is the single opt-in switch; default-off preserves today's behaviour exactly
   (nothing fires unless the user opts in).
2. **Per-hook gate**: each of the 12 scripts gains, at the EARLIEST execution point
   (before any blocking/output logic), `if (!require('./_shared/opt-in').isEnabled('<stem>')) process.exit(0);`
   For PreToolUse hooks the gate exits 0 (NEVER emits a block decision) so a disabled
   hook can never interfere with a tool call.
3. **`hooks/hooks.json`**: add all 13 entries under the correct events, preserving
   matchers / timeouts / the `mcp-health` mode arg. Merge into existing matcher blocks
   where one already exists (PostToolUse `Write|Edit`); add new PreToolUse / Stop /
   PostToolUseFailure blocks otherwise.
4. **`hooks/opt-in-manifest.json`** — `{"opt_in": [<12 stems>]}` — the declarative
   SSOT for "which wired hooks are opt-in".
5. **`scripts/check-hook-inventory.js`** rework derivation ONLY:
   - `optIn = manifest.opt_in`
   - `defaultOn = (hooks.json stems) − optIn`
   - `disabled = (on-disk hook scripts) − (hooks.json stems)`
   - Stop reading `settings.example.json` for the opt-in set.
   - **Invariant: counts + membership stay 10 default-on / 12 opt-in / 0 disabled**
     (identical to v2.26.1) → NO doc count edits, NO version-mirror count churn.
     Add a self-check: every manifest entry MUST be wired in hooks.json (else error).
6. **`settings.example.json`**: remove `hooks-opt-in-examples` entirely; keep the
   `autopilot.*` settings; add a pointer comment: opt-in hooks are wired in
   `hooks.json` and enabled via `~/.autopilot/config.json` `{"hooks":{"<name>":true}}`.
7. **Docs**: `hooks/README.md` Tier-B intro (config-enable, not copy-paste);
   `docs/installation.md` + `docs/configuration.md` document the enable mechanism;
   `CLAUDE.md` + `preflight-portability.sh` comment: inventory opt-in source = manifest.
8. **Version**: PATCH 2.26.1 → 2.26.2 (mechanism change, no new surface). CHANGELOG +
   INDEX row + mirrors via `sync-version.js` (counts unchanged, version only).

## Known tradeoff (decision: accept + BACKLOG optimisation)
Wiring the 5 PreToolUse / 4 Stop / etc. opt-in hooks in `hooks.json` means they now
spawn `node` (then gate-exit ~immediately) on every matching tool call for ALL users,
even when disabled — a small per-tool-call latency in line with the existing default-on
hooks. The only update-stable alternative (the token must resolve) is hooks.json wiring,
so the spawn is unavoidable without a single multiplexer hook per event. **Decision**:
accept the gated-spawn cost; BACKLOG a per-event multiplexer that runs only the enabled
opt-in hooks if telemetry shows it matters.

## Acceptance
- Each of 12 hooks: disabled (no config) → no-op / no block / no output; enabled (config
  flag OR env) → fires. Verified by an independent harness (depth-0), not self-report.
- `check-hook-inventory.js --check` green (10/12/0 unchanged) + manifest⊆hooks.json.
- All existing gates green: sync-version --check, readme parity, validate, preflight-release.
- PreToolUse gate proven fail-OPEN: corrupt `~/.autopilot/config.json` → hooks disabled,
  never a spurious block.
- Decorrelated gpt-5.5 review → SHIP-AS-IS.

## Out of scope / non-goals
- Changing WHICH hooks are on by default (semantics preserved: all stay default-off).
- The multiplexer optimisation (BACKLOG).
