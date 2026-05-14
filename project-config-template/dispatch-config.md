# Dispatch — Project Config
# Place this file at: .claude/dispatch-config.md
#
# Declares which dispatcher / reviewer / methodology skill autopilot's
# orchestrator skills should prefer. autopilot picks the FIRST AVAILABLE entry
# in each chain — entries naming a plugin / skill that is not loaded in the
# current session are skipped.
#
# This file is OPTIONAL. If absent, autopilot defaults to:
#   - Parallel dispatch:   native (multiple Task tool calls in one response)
#   - Code review:         autopilot:reviewer only
#   - Methodology chains:  autopilot's own fallback skills (debug, test-strategy,
#                          team, profiling) as primary; superpowers equivalents
#                          NOT auto-preferred (this file is where you express
#                          that preference)
# Create this file only when you have third-party plugins (typically `superpowers`)
# and want autopilot orchestrators to prefer them over autopilot's fallbacks.

## Parallel Dispatch
# Ordered preference for skills that fan out work (think-tank, think-tank-dialectic,
# ceo-agent, dev-flow PARALLEL_DISPATCH handoffs).
#
# Recognized entries:
#   - superpowers:dispatching-parallel-agents   # richer report contract; requires `superpowers` plugin
#   - native                                    # built-in: issue multiple Task tool calls in one response
#
# Example (superpowers installed):
#   - superpowers:dispatching-parallel-agents
#   - native
#
# Example (superpowers NOT installed — or just omit this file entirely):
#   - native

## Code Review
# Ordered preference for quality-pipeline's reviewer step.
#
# Recognized entries:
#   - autopilot:reviewer                # autopilot's built-in methodology-disciplined reviewer
#   - superpowers:code-reviewer         # only if `superpowers` plugin installed
#   - <your-project-reviewer>           # project-specific reviewer agent, if any
#
# Example (default — autopilot only):
#   - autopilot:reviewer
#
# Example (superpowers installed, used as fallback when autopilot:reviewer not
# yet loaded mid-session):
#   - autopilot:reviewer
#   - superpowers:code-reviewer

## Methodology Preferences
# Ordered preference for methodology skills that orchestrator skills (ceo-agent,
# dev-flow Session Rules, finish-flow) dispatch when domain-specific methodology
# is needed.
#
# Each chain is independent — you can prefer superpowers for debugging but
# autopilot for testing, etc. List the skill names in order; first one
# available wins.

### Debugging
# Recognized entries:
#   - superpowers:systematic-debugging  # broader hypothesis-driven framing; requires `superpowers`
#   - autopilot:debug                   # autopilot's evidence-first methodology (tool → log → code) with Three Red Lines
#
# Example (superpowers installed, prefer it):
#   - superpowers:systematic-debugging
#   - autopilot:debug
#
# Example (no superpowers, or prefer autopilot's stricter evidence-first):
#   - autopilot:debug

### Testing methodology
# NOTE: superpowers:test-driven-development and autopilot:test-strategy are
# NOT equivalent — TDD is a coding loop; test-strategy covers test pyramid /
# baseline / failure investigation. Often you want BOTH; listing both here is
# legitimate — orchestrator picks first available, but you can also invoke each
# directly for its specific use case.
#
# Recognized entries:
#   - superpowers:test-driven-development   # red-green-refactor coding cycle; requires `superpowers`
#   - autopilot:test-strategy               # test pyramid + baseline + failure funnel
#
# Example:
#   - autopilot:test-strategy
#   - superpowers:test-driven-development

### Performance profiling
# Recognized entries:
#   - autopilot:profiling   # only methodology entry point (superpowers has no profiling skill)
#
# This chain has only one entry by design (per CHANGELOG v2.0); listed for
# completeness so orchestrators have a uniform lookup pattern.

### Team allocation
# NOTE: team allocation (when to組隊 / role 選擇 / 依賴分析) is autopilot's domain.
# The dispatch MECHANISM is handled by the `## Parallel Dispatch` chain above.
#
# Recognized entries:
#   - autopilot:team   # allocation decision tree + team size rules + shutdown flow

## Fallback semantics
# - First available entry wins. If the primary is unavailable in the current
#   session (e.g., the plugin is not installed, or skill not yet loaded after
#   mid-session install requiring restart), autopilot moves to the next entry.
# - `native` always succeeds — it does not depend on any plugin. Keep it as
#   the last Parallel Dispatch entry so skills never hit a dead end.
# - autopilot's own fallback skills (debug, test-strategy, team, profiling) are
#   always available once autopilot is installed — they always succeed as the
#   tail entry of their respective chain.
# - If a chain is empty or absent, the defaults at the top of this file apply.
# - There is no `mode` field. Per-chain ordering expresses all preferences.
#   For hard exclusion of a specific skill, use `.claude/settings.json`'s
#   `disabledSkills` (see README "Superpowers Coexistence" section for examples).
