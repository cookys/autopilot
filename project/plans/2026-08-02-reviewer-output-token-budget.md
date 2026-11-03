# Plan — runner-aware reviewer output-token budget

> Status: FROZEN FOR EXECUTION
> Owner: depth-0 CEO with one worktree-isolated L4 foreman
> Size: L (one cross-runner contract batch)
> Source: triggered `docs/BACKLOG.md` entry and the frozen Track 4 boundary in `2026-08-01-backlog-convergence-plan-set.md`

## Context

`scripts/dispatch-review.sh` limits input context but has no caller-facing response-token budget.
Blindly forwarding one spelling to every runner would be dishonest: the installed CLIs expose
different public surfaces, and most expose no enforceable per-response token cap at all.

Depth-0 probed the installed binaries before freezing this plan on 2026-08-02:

| Runner | Installed evidence | Frozen mapping |
|--------|--------------------|----------------|
| `anthropic-compatible` | `dispatch-anthropic-review.js` accepts `--max-tokens` and sends API `max_tokens` | supported: forward the canonical integer as `--max-tokens` |
| `qoderclicn` | QoderCN 1.1.8 help exposes `--max-output-tokens <size>` | supported: map to `--max-output-tokens` |
| `codex` | codex-cli 0.146.0 `codex exec --help` exposes output schema/file, not an output-token cap | unsupported: fail before runner spawn |
| `agy` | agy 1.1.9 help exposes output format, not an output-token cap | unsupported: fail before runner spawn |
| `grok` | grok 0.2.114 help exposes `--max-turns`, not an output-token cap | unsupported: fail before runner spawn |
| `cc-shim` | Claude Code 2.1.220 help exposes monetary budget, not an output-token cap | unsupported: fail before runner spawn |
| `claude-native` | same verified Claude Code CLI surface | unsupported: fail before runner spawn |

Absence from a help surface is not a claim that a provider has no hidden setting. It means this
wrapper has no probed, documented CLI contract it can safely enforce on that installed rail.

## Objective and measurable result

Add an optional `--max-tokens <n>` contract to `dispatch-review.sh` that is honest across all seven
runners, preserves byte-compatible behavior when omitted, and never converts truncation or an
unsupported rail into a passing review.

- Canonical unit: maximum model output tokens requested from the supported transport.
- Canonical range: positive base-10 integer from 1 through 200000 inclusive.
- Supported mappings are exactly the two frozen above.
- Every unsupported mapping exits `2` with `status=precondition_failed` before the runner binary is
  invoked.
- A supported response that truncates before a complete wrapped verdict remains `no_verdict`.
- Existing output framing, process-truth handling, read-only posture, and parser authority remain
  unchanged.

## Change-policy decisions

- **Compatibility impact**: additive CLI flag; omitted-flag behavior and JSON result shape remain
  unchanged. Existing callers need no migration.
- **Dependency decision**: platform/stdlib plus existing scripts only; no package or runtime
  dependency.
- **Version decision**: remain in the unreleased v2.34.1 train; add a changelog bullet, no manifest
  bump.

## File-structure map

| Path | Responsibility |
|------|----------------|
| `scripts/dispatch-review.sh` | parse/validate the canonical flag, reject unsupported runners, and map the two supported transports |
| `hooks/tests/dispatch-review.test.sh` | exact argv, no-spawn unsupported controls, validation, omission compatibility, and truncation polarity |
| `references/hetero-dispatch.md` | operator-facing runner capability matrix and failure semantics |
| `CHANGELOG.md` | unreleased v2.34.1 user-visible capability note |
| `docs/BACKLOG.md` | remove only the completed reviewer-budget entry |
| `docs/projects/2026-08-02-reviewer-output-token-budget/` | execution and evidence record |
| `docs/projects/INDEX.md` | lifecycle routing |

## Deliverable contract

### Canonical flag and validation

`--max-tokens` requires one non-empty argument matching a positive base-10 integer in the inclusive
range 1..200000. Missing, zero, negative, fractional, padded/non-numeric, or over-range values fail
as `precondition_failed`; no runner process may be spawned. The value controls model response tokens,
not prompt bytes, wall time, visible characters, tool turns, reasoning effort, or raw-log size.

When the flag is absent, do not add a runner argument, change a transport default, or add a result
field. In particular, the direct Anthropic adapter retains its existing default and Qoder retains
its native default.

### Runner-aware mapping

- `anthropic-compatible`: append `--max-tokens <n>` to the existing direct adapter invocation.
  Its existing `stop_reason=max_tokens` handling remains fail-closed.
- `qoderclicn`: append `--max-output-tokens <n>` to the Qoder CLI invocation. If the CLI returns a
  partial block with exit 0, the shared wrapped-block parser must still reject it.
- `codex`, `agy`, `grok`, `cc-shim`, and `claude-native`: reject the request before resolving or
  spawning the runner. The error names the runner and states that its current rail has no verified
  enforceable output-token mapping; it must not silently ignore, approximate, or reinterpret the
  budget.

### Verification and closure

Fixture tests must prove exact supported argv projection, unsupported no-spawn behavior for all five
rails, range validation, absent-flag compatibility, and fail-closed truncated output. Run the focused
reviewer test, detach regression, complete hook suite under the repository contention factor, syntax,
validation, and deterministic sync gates. The foreman performs one bundled first-pass review; only a
separate depth-0 full-diff panel may authorize local merge.

After terminal evidence, remove only this exact triggered backlog item and locally merge to
`develop`. Do not push, release, open a PR, publish, or pull forward B1/B2 delta review,
echo-hardening, transport-exit recovery, polarity, or leaf-output compaction.

## Risks and mitigations

- **False portability**: a same-named flag can mean something else. Mitigation: only two live-probed
  mappings are supported; the rest reject before spend.
- **Silent non-enforcement**: accepting a flag while dropping it gives a false budget. Mitigation:
  exact argv capture fixtures and five no-spawn negative controls.
- **Truncation read as success**: a partial favourable verdict can precede provider truncation.
  Mitigation: direct Anthropic stop-reason failure plus Qoder incomplete-wrapper negative control.
- **Default drift**: always forwarding a chosen default would alter current reviewers. Mitigation:
  omission produces no new runner argument and no JSON-shape change.

## Out of scope

- Adding new provider APIs or undocumented config keys to unsupported runners.
- Input-context limits, monetary limits, turn limits, raw-log byte caps, or response compaction.
- Delta re-review, prompt echo protocol changes, exit-recovery semantics, and polarity workflow.
- Version bump, release, push, PR, or external publication.

## Open questions

None. The user delegated bounded CEO execution through `/l4`; unsupported rails fail closed.

## Review log

- R0 2026-08-02: frozen after real installed-CLI help/version probes and direct-adapter code
  inspection, before feature branch/worktree/model effects. Plan review is disabled by project
  config; one bundled first-pass implementation review and one authoritative depth-0 final panel
  remain.
