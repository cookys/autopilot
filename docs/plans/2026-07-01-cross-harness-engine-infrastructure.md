# Plan R0 - Cross-Harness Engine Infrastructure

> Status: CONVERGED R3 - Codex + agy non-Claude review loop returned SHIP-AS-IS; ready for human approval.
> Owner: Codex acting as Tech Lead.
> Date: 2026-07-01.
> Size: XL.
> Frame: infrastructure foundation for future `/l5` and `/l6` autonomy.
> Review constraint: Claude Code subscription is exhausted; do not use `claude`
> or `cc-shim` for this review loop. Use Codex and agy only until Grok or
> MiniMax direct access is available.

## 0. Thesis

Autopilot should stop treating Claude Code as the architectural center.
Claude Code remains the mature host, but the durable product is a portable
autonomy engine with harness adapters:

```
portable skills + typed contracts + engine loop + harness adapters + probes/evals
```

The target is not "port the Claude plugin to Codex." The target is a
cross-harness engine that can run, inspect, qualify, and refresh its own
platform assumptions while preserving the existing Claude Code behavior.

The human should leave the execution and verification loop. The human remains
only in the policy/exception loop: credentials, irreversible external actions,
unqualified rosters, repeated fail-closed loops, or conflicting requirements.

## 1. Probe record for this plan

Live probe on 2026-07-01 from this checkout:

| Surface | Result | Notes |
| --- | --- | --- |
| `codex` | present, `codex-cli 0.142.5` | Usable as OpenAI-family reviewer/runner. |
| `agy` | present, `agy 1.0.14` | `agy models` works; live headless smoke returned `AUTOPILOT_AGY_SMOKE_OK`. |
| `grok` | installed and authenticated | Installed 2026-07-01 via official xAI installer: `grok 0.2.77 (44e77bec3a)`. After user login, `grok models` succeeds and a headless `grok-build` smoke returned `AUTOPILOT_GROK_OK`. |
| MiniMax direct | configured and live | Local provider defaults and a direct API probe were created under `~/.autopilot/`. After user login/configuration, MiniMax Anthropic-compatible API probe against `https://api.minimax.io/anthropic/v1/messages` with model `MiniMax-M3` returned `AUTOPILOT_MINIMAX_OK`. Secrets remain outside the repo. |
| `claude` / `cc-shim` | intentionally unused | User stated Claude Code subscription is exhausted; do not dispatch through Claude CLI. |

`agy plugin list` currently shows `autopilot` imported with `skills, agents`,
not hooks. This supports the current posture: agy is safe to treat as a
headless worker/reviewer, but not yet as a trusted hook host.

## 2. Problem

Autopilot already contains the right ingredients, but the current infrastructure
is script-shaped rather than engine-shaped:

- `skills/` is the portable source of truth, but skill trigger behavior is not
  evaluated as a first-class contract.
- `hooks/` is mostly Node.js, but hook code still receives host-specific
  payloads directly and `hooks/hooks.json` is Claude-specific.
- `dispatch-hetero.sh`, `dispatch-review.sh`, and `dispatch-explore.sh` encode
  the right rails, but each script owns its own runner parsing, sandbox posture,
  JSON output contract, and process cleanup.
- `engine-onboarding` and the hetero-engine lifecycle plan define a good model
  for qualification, but the scorecard and runner contracts are not yet the
  central API used by all dispatchers.
- `references/multi-agent-portability.md` has stale facts for Codex and should
  not be the long-term source of truth for fast-moving harness capabilities.

The long-term failure mode is predictable: every new harness feature will add a
new one-off branch to a shell script or markdown file, while old platform facts
silently rot.

## 3. Objective and key results

Objective: Build a sustainable cross-harness Autopilot Core Engine that can
dispatch, review, verify, score, and refresh platform assumptions without
breaking the existing Claude Code plugin.

Key results:

- KR1: One typed runner result contract is consumed by implementer, reviewer,
  explorer, qualifier, and `/l5`/`/l6` orchestration paths.
- KR2: Harness capabilities are recorded as data with source, version,
  `verified_at`, probe artifact, and expiry, rather than prose-only memory.
- KR3: The first Codex package ships as skills-only under
  `platforms/codex/plugin`, without loading Claude hooks.
- KR4: Hook handlers are split into host-neutral handlers plus per-harness
  payload normalizers.
- KR5: Existing Claude Code plugin behavior remains unchanged unless a phase
  explicitly touches Claude packaging.
- KR6: `/l5` and `/l6` eventually call engine APIs instead of directly calling
  scattered shell scripts.
- KR7: Skill trigger coverage is evaluated with a prompt corpus before release.

## 4. Non-goals

- Do not replace Autopilot's methodology content.
- Do not migrate every script in one commit.
- Do not make Codex/Grok/agy/Copilot hooks blocking until event payloads,
  working directory, environment, and failure semantics are probed.
- Do not put `.codex-plugin` at the repository root.
- Do not route engines by domain or lifecycle phase. Keep the existing policy:
  capability, decorrelation, and cost only.
- Do not use `claude` or `cc-shim` for this plan's review loop while the
  subscription is exhausted.

## 5. Architecture

Target layout:

```
autopilot/
  skills/                         # portable methodology, source of truth
  agents/                         # canonical methodology agents
  schemas/                        # JSON schemas for contracts
  src/
    core/                         # fs/git/process/state primitives
    engine/                       # plan -> dispatch -> verify -> review loop
    runners/                      # headless runner implementations
    hooks/
      handlers/                   # host-neutral hook logic
      normalize/                  # claude/codex/copilot/opencode payload maps
    harness/
      capabilities/               # refresh/probe/report logic
      probes/                     # stable smoke probes
    platforms/                    # package generators
  platforms/
    claude/                       # generated or mirrored Claude package material
    codex/plugin/                 # Codex plugin package root
    opencode/                     # OpenCode plugin/package material
    antigravity/                  # agy import/install helpers
    grok/                         # Grok package/spike material
    copilot-cli/                  # Copilot CLI package material
  evals/
    skill-triggers/
    hook-payloads/
    runner-smoke/
    known-bad/
```

Use plain Node.js built-ins first. Add no NPM runtime dependency until a
specific module removes more risk than it adds.

Dependency injection should stay boring:

```js
const engine = new AutopilotEngine({
  runners,
  scorecard,
  stateStore,
  git,
  processRunner,
  clock,
  logger,
})
```

No framework DI container is needed. The important boundary is that engine code
does not read global environment, CLI binaries, or hook payloads directly; those
enter through adapter objects and typed contracts.

## 6. Core contracts

### 6.0 Six-element task contract

`/l5`, `/l6`, and headless implementer dispatch all normalize work into the
same six-element task contract:

1. Goal: the user-visible outcome.
2. Scope: files/modules/behavior that may change.
3. Input: source refs, branch/base, prompt, docs, and constraints.
4. Output: exact artifacts expected from the worker.
5. Acceptance: executable checks or reviewable criteria.
6. Boundaries: protected paths, no-go actions, and escalation triggers.

The contract travels in prompts for engines that do not load Autopilot skills in
headless mode. It also becomes the structured input for future JS runner APIs.

### 6.1 Runner identity

Every runner identity must include both the wrapper and the served model:

```json
{
  "runner": "agy",
  "runner_version": "1.0.14",
  "family": "google",
  "model": "Gemini 3.5 Flash (Low)",
  "model_version": "unknown",
  "version_source": "manual|response|cli|unknown"
}
```

If the provider does not expose model version, record `unknown` and rely on TTL
expiry plus explicit operator re-qualification.

### 6.2 Implementer result

```json
{
  "role": "implementer",
  "status": "committed|no_op|question_suspected|dirty|failure|precondition_failed",
  "runner": {},
  "branch": "feat/example",
  "base": "develop",
  "commit": "sha-or-null",
  "worktree": "path-or-null",
  "files_changed": 0,
  "insertions": 0,
  "deletions": 0,
  "agent_log": "path",
  "containment": {
    "mode": "cgroup|setsid|plain|sandbox|scratch",
    "contained": false,
    "security_boundary": "hard|best-effort|none"
  },
  "error": null
}
```

The only success state for mutation work is `committed` with a clean tree. A
model self-report never changes the status.

### 6.3 Reviewer result

```json
{
  "role": "reviewer",
  "status": "reviewed|no_verdict|precondition_failed",
  "runner": {},
  "verdict": "SHIP-AS-IS|FIX-THEN-SHIP|null",
  "findings": [
    {
      "severity": "Critical|Major|Minor|Suggestion",
      "evidence": "file:line",
      "summary": "...",
      "fix_direction": "..."
    }
  ],
  "raw_log": "path",
  "error": null
}
```

`no_verdict` is fail-closed. Partial output from a timed-out or non-zero runner
must not be parsed as a passing verdict.

### 6.4 Explorer result

```json
{
  "role": "explorer",
  "status": "explored|explored_dirty|read_failed|precondition_failed",
  "runner": {},
  "read_probe": "passed|failed",
  "repo_modified": false,
  "raw_log": "path",
  "answer": "withheld when read_failed"
}
```

Reading the repository is trusted input, but the runner must still prove it read
the repo using an unguessable sentinel.

### 6.5 Hook event

All platform hook payloads normalize into:

```json
{
  "platform": "claude|codex|copilot-cli|opencode|agy|grok",
  "event": "session_start|pre_tool_use|post_tool_use|pre_compact|stop|...",
  "cwd": "path",
  "tool": "Edit",
  "tool_input": {},
  "tool_output": {},
  "session": {
    "id": "optional",
    "source": "startup|resume|compact|unknown"
  },
  "raw": {}
}
```

Handlers consume only the normalized shape. Platform-specific raw payloads stay
in normalizers and fixture tests.

## 7. Harness capability state

Create data files like:

```
platforms/codex/capabilities.json
platforms/claude/capabilities.json
platforms/agy/capabilities.json
platforms/grok/capabilities.json
platforms/copilot-cli/capabilities.json
platforms/copilot-cloud/capabilities.json
```

Example row:

```json
{
  "platform": "codex",
  "feature": "plugin_hooks",
  "status": "supported",
  "source_url": "https://developers.openai.com/codex/hooks",
  "source_checked_at": "2026-07-01",
  "verified_at": "2026-07-01",
  "verified_by": "docs+probe",
  "cli_version": "codex-cli 0.142.5",
  "probe_artifact": "evals/hook-payloads/codex/pre-tool-use-2026-07-01.json",
  "expires_at": "2026-07-15",
  "notes": "Project-local hooks require trusted .codex layer."
}
```

Commands:

```bash
node bin/autopilot.js harness probe --platform codex
node bin/autopilot.js harness refresh --platform codex
node bin/autopilot.js harness report --stale-after 14d
```

SessionStart should only emit a bounded warning when facts are stale. It should
not browse or refresh automatically in the critical path.

## 8. Skills strategy

Skills should remain the portable interface. The mistake to avoid is turning
`SKILL.md` into a stale encyclopedia of platform details.

Rules:

- Keep frontmatter minimal: `name` and `description`.
- Put trigger language in the description, including Chinese user phrases where
  useful.
- Keep hot-path forcing functions inline.
- Move volatile harness facts into references generated from capability state.
- Use scripts for deterministic work.
- Add skill trigger evals for front-door skills.

New or revised skills:

| Skill | Change |
| --- | --- |
| `engine-onboarding` | Keep as model/runner qualification workflow; update it to call engine APIs once available. |
| `l5` / `l6` | Keep as CEO front doors; eventually call `AutopilotEngine` instead of shell scripts. |
| `harness-maintenance` | New skill for "Codex/Grok/agy/Copilot integration changed", stale docs, plugin porting, hook payload spikes. |
| `quality-pipeline` | Consume typed review results and panel outputs. |
| `distill` | Stay Claude-specific unless another harness exposes equivalent transcript/session APIs. |

Skill eval corpus:

```
evals/skill-triggers/
  harness-maintenance.should-trigger.txt
  engine-onboarding.should-trigger.txt
  l5.should-trigger.txt
  l6.should-trigger.txt
  quality-pipeline.should-trigger.txt
  should-not-trigger.txt
```

Acceptance: a fresh Codex/Claude run with only skill metadata can select the
right skill for each prompt class.

## 9. Agents strategy

Keep `agents/reviewer.md`, `agents/debugger.md`, and `agents/planner.md` as the
canonical methodology agents.

Generate harness-specific copies:

```bash
node bin/autopilot.js platform generate-agents --target claude
node bin/autopilot.js platform generate-agents --target opencode
node bin/autopilot.js platform generate-agents --target copilot-cli
```

Rules:

- If a platform supports tool restrictions, encode read-only mechanically.
- If it does not, use scratch cwd, disabled tools where possible, and artifact
  verification.
- Agent body drift checks remain deterministic.
- Agent outputs must keep the existing handoff grammar.

Do not create platform-specific agent content by hand unless the generator has a
documented unsupported field.

## 10. Hooks strategy

Hooks are not portable. Handler logic can be portable; hook manifests and event
payloads are not.

Target split:

```
src/hooks/
  handlers/
    intent-capture.js
    session-start.js
    state-checkpoint.js
    audit-log.js
    failure-escalation.js
  normalize/
    claude.js
    codex.js
    copilot-cli.js
    opencode.js
  manifests/
    claude.js
    codex.js
    copilot-cli.js
```

Porting order:

1. Keep existing `hooks/hooks.json` as Claude canonical.
2. Add fixture tests for existing Claude hook payloads.
3. Create Codex warning-only hook package under `platforms/codex/`, not repo root.
4. Probe Codex `PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop` payloads.
5. Only after probes, map selected hooks to Codex.
6. Copilot CLI hooks follow the same pattern.
7. agy/Grok hooks remain spike-only until local runtime firing is proven.

Blocking hooks require:

- payload fixture,
- fail-open/fail-closed policy documented,
- timeout behavior verified,
- cwd and plugin-root semantics verified,
- one negative test that proves a malformed payload cannot block unrelated work.

## 11. Platform packaging

### 11.1 Claude Code

Preserve current package:

```
.claude-plugin/plugin.json
hooks/hooks.json
skills/
agents/
```

Do not change the Claude package during Codex or generic engine work unless the
phase explicitly says so.

### 11.2 Codex

Ship skills-only first:

```
platforms/codex/plugin/
  .codex-plugin/plugin.json
  skills -> ../../../skills
```

Minimal manifest:

```json
{
  "name": "autopilot",
  "version": "2.28.0",
  "description": "Autopilot methodology skills for Codex.",
  "skills": "./skills/"
}
```

Hooks come later under:

```
platforms/codex/plugin/hooks/hooks.json
```

but only after the hook payload probes pass.

### 11.3 OpenCode

Keep `.opencode/plugins/autopilot.ts` for now, then migrate shared logic to
`src/hooks/handlers` and leave the OpenCode plugin as a thin adapter.

### 11.4 Antigravity / agy

Keep root `plugin.json` and guarded install script. Do not rely on hooks for
correctness yet. Treat agy as:

- interactive host: skills/agents import appears available, but needs more tests;
- headless worker/reviewer: proven and usable via prompt contract.

Never raw-install from a symlinked destination. Keep export-then-install guard.

### 11.5 Grok

This host now has authenticated `grok`; keep it out of default rosters until
the scorecard explicitly selects it, but it is available for heterogeneous
review and implementation dispatch:

- `grok --version`: `grok 0.2.77 (44e77bec3a)`.
- `grok models`: `grok-build`, `grok-composer-2.5-fast`.
- Headless scratch-cwd review smoke with `--disable-web-search` works.
- `--no-auto-update` should only be added after confirming the local CLI
  supports it.
- Keep Grok as headless implementer/reviewer first, not plugin host.

### 11.6 Copilot CLI and cloud

Split adapters:

- `CopilotCliRuntimeAdapter`: local/headless runner with skills/plugins/hooks/MCP.
- `CopilotCloudTaskAdapter`: async GitHub issue/branch/PR worker.

The cloud adapter must not pretend to be a local plugin runtime. Its artifacts are
branches, PRs, checks, and session logs.

### 11.7 MiniMax

The old working path was `cc-shim`, which uses the Claude CLI as driver. Because
this review run must not use Claude Code, the first safe MiniMax slice is a
direct Anthropic-compatible HTTP reviewer adapter:

```bash
# Requires MINIMAX_API_KEY to already exist in the parent process environment.
# AUTOPILOT_MINIMAX_BASE_URL or ANTHROPIC_COMPATIBLE_BASE_URL may override the
# default https://api.minimax.io/anthropic. Generic ANTHROPIC_BASE_URL is ignored
# so Claude/cc-shim settings cannot silently redirect this direct runner.
# The adapter accepts a base root, a `/v1` base, or a full `/v1/messages` URL.
scripts/dispatch-review.sh \
  --runner anthropic-compatible \
  --model MiniMax-M3 \
  --diff-file "$DIFF_FILE"
```

The adapter must never accept secret values as CLI arguments or inline shell
assignments in documented examples. In the first slice, auth material enters
only through already-present environment variables and is bound to the provider:
MiniMax hosts use `MINIMAX_API_KEY`; other third-party compatible endpoints must
use explicit `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`. This direct runner intentionally
does not accept `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`; official
Anthropic/Claude auth belongs on a separate adapter surface with its own header
contract. Later engine CLI work may add `--auth-env`, inherited file descriptor,
stdin, or mode-0600 config loading, but must still keep secret values out of
process arguments and raw logs.

The current adapter supports reviewer only. Implementer comes after file-edit
protocol and artifact verification are defined.

## 12. Engine loop

Target `/l5` flow:

```
1. Resolve policy and roster from scorecard.
2. Plan or normalize task into six-element contract.
3. Optional spec-review loop.
4. Dispatch implementer in isolated worktree.
5. Verify by git artifacts only.
6. Author independent harness or checks.
7. Run checks at depth 0.
8. Dispatch decorrelated review panel.
9. Repair loop until SHIP-AS-IS or max rounds.
10. Emit ledger and QC verdict.
11. Merge or produce PR only after authoritative gates pass.
```

Target `/l6` adds verification-authoring dispatch:

```
implementation engine family != verification-authoring family
verification-authoring family != terminal reviewer family when possible
depth-0 still executes all artifacts and holds merge authority
```

Human interaction policy:

- Do not ask the human during normal implementation/review/repair.
- Ask only for credentials, irreversible external writes, policy conflicts,
  unqualified rosters, or repeated fail-closed exhaustion.
- If the task is blocked because no qualified runner exists, emit the exact
  onboarding command or probe needed.

## 13. JS migration plan

This is not a mechanical `.sh` to `.js` rewrite. The migration target is a
single engine CLI plus reusable libraries.

Target command surface:

```bash
node bin/autopilot.js dispatch implement --runner agy --task task.json
node bin/autopilot.js dispatch review --runner codex --diff diff.patch
node bin/autopilot.js dispatch explore --runner agy --prompt prompt.md
node bin/autopilot.js engine qualify reviewer --runner codex
node bin/autopilot.js harness probe --platform codex
node bin/autopilot.js platform generate --target codex
```

Port order:

1. `dispatch-review.sh` -> `src/runners/review.js`
2. `dispatch-hetero.sh` -> `src/runners/implement.js`
3. `dispatch-explore.sh` -> `src/runners/explore.js`
4. `resolve-review-loop.sh` -> `src/engine/resolve-review-loop.js`
5. `engine-qualify.sh` -> `src/engine/qualify.js`
6. platform packaging and capability commands
7. remove shell wrappers only after compatibility shims and tests pass

Keep old entrypoints as wrappers during migration.

## 14. Evals and tests

Required test layers:

- Unit tests for contract parsing and runner status mapping.
- Fixture tests for hook normalizers.
- Smoke tests for each runner family.
- Known-bad reviewer qualification.
- Implementer eval tasks with hidden acceptance tests.
- Skill trigger corpus.
- Packaging validation per platform.
- Stale capability detector tests.

A release cannot claim a harness capability unless it has either:

- official docs cited in capability state, or
- a local probe artifact committed under `evals/` or `platforms/<name>/probes/`.

## 15. Phases

### Phase 0 - Documentation correction and review

Deliverables:

- This plan.
- Heterogeneous review record from available non-Claude engines.
- Update `references/multi-agent-portability.md` to mark stale Codex facts and
  point to the future capability-state source.

Acceptance:

- Codex and agy review this plan or produce explicit blocked states.
- Grok and MiniMax availability are recorded honestly.

### Phase 1 - Contracts and runner library skeleton

Deliverables:

- `schemas/runner-result.schema.json`
- `schemas/review-result.schema.json`
- `schemas/hook-event.schema.json`
- `src/core/process.js`
- `src/core/git.js`
- `src/runners/index.js`
- tests for status mapping

Acceptance:

- Existing shell scripts still pass.
- New JS library can parse current shell JSON outputs.

### Phase 2 - Port review dispatcher

Deliverables:

- `src/runners/review.js`
- `bin/autopilot.js dispatch review`
- wrappers keep `scripts/dispatch-review.sh` compatible
- fixtures for codex, agy, grok, cc-shim blocked/nonzero/timeout logs

Acceptance:

- `hooks/tests/dispatch-review.test.sh` still passes.
- A local agy review smoke produces `reviewed` or `no_verdict` fail-closed.

First implementation slice after R3:

- `bin/autopilot.js dispatch review` now delegates to the hardened
  `scripts/dispatch-review.sh` surface and preserves stdout/stderr/exit status.
- `src/runners/review.js` provides the first JS runner module boundary for the
  future engine loop.
- `src/runners/review.js` also exposes `dispatchReviewJson()` and
  `parseReviewOutput()` so the future engine loop can capture and inspect
  `reviewed` / `no_verdict` / `precondition_failed` results without scraping
  shell output ad hoc.
- `hooks/tests/autopilot-cli.test.sh` covers the public CLI bridge without live
  network or model calls.
- `hooks/tests/review-runner.test.sh` covers JS capture/parse behavior.

### Phase 3 - Port implementer dispatcher

Deliverables:

- `src/runners/implement.js`
- worktree creation/cleanup library
- containment provenance object
- wrapper compatibility

Acceptance:

- `hooks/tests/dispatch-hetero.test.sh` passes.
- No mutation path runs in the main checkout.

### Phase 4 - Capability state and harness maintenance

Deliverables:

- `src/harness/cli.js`
- platform capability JSON files
- stale detector
- `harness-maintenance` skill

Acceptance:

- `node bin/autopilot.js harness report --stale-after 14d` returns machine-readable output.
- SessionStart can inject a bounded stale-facts warning without network access.

### Phase 5 - Codex skills-only package

Deliverables:

- `platforms/codex/plugin/.codex-plugin/plugin.json`
- `platforms/codex/plugin/skills` symlink or generated copy
- local marketplace entry for development
- documentation for install/update

Acceptance:

- `codex plugin` can discover/install the local package.
- No Claude hooks load through Codex.
- Running Codex in the Autopilot repo shows expected skills.

### Phase 6 - Hook adapter framework

Deliverables:

- normalized hook event schema
- Claude normalizer fixtures
- Codex warning-only probe hook package
- handler extraction for at least `intent-capture` and `session-start`

Acceptance:

- Existing Claude hooks pass current tests.
- Codex hook payload probes are captured before any blocking behavior ships.

### Phase 7 - `/l5` and `/l6` engine integration

Deliverables:

- `AutopilotEngine` API
- `/l5` and `/l6` skill docs updated to call engine CLI
- scorecard-aware roster resolution through JS
- ledger output for all dispatched units

Acceptance:

- A small task can run implementer -> review -> repair through engine APIs.
- Human is not asked unless policy exceptions fire.

First implementation slice:

- `src/engine/resolve-review-loop.js` and
  `node bin/autopilot.js engine review-loop` provide the first JS boundary for
  scorecard-aware `/l5` roster resolution while preserving the legacy shell
  resolver contract.
- `hooks/tests/review-loop-runner.test.sh` covers JSON capture, enforce-exit
  parsing, and fail-loud schema validation.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Platform facts rot again | Capability state with expiry and probe artifacts. |
| Codex package accidentally loads Claude hooks | Put Codex plugin under `platforms/codex/plugin`, not repo root. Skills-only first. |
| JS port changes shell contracts | Parse old outputs first, keep wrappers, run existing shell tests. |
| Hook portability causes false confidence | Normalize payloads with fixtures; block only after probes. |
| agy/grok implementers mutate wrong path | Worktree isolation plus git artifact verification; absolute cwd anchors where needed. |
| MiniMax path burns Claude quota | Do not use `cc-shim` when Claude subscription is exhausted; build direct HTTP adapter first. |
| Skill list gets too large and descriptions truncate | Trigger evals and concise descriptions; move detail to references. |
| Model self-report contaminates gates | Status always derives from git, process exit, parser result, and external checks. |

## 17. Review loop for this plan

Run this plan through a non-Claude review loop:

1. Create the plan file.
2. Review the plan diff with Codex:
   ```bash
   scripts/dispatch-review.sh --runner codex --model gpt-5.5 --diff-file /tmp/plan.diff
   ```
3. Review the plan diff with agy:
   ```bash
   scripts/dispatch-review.sh --runner agy --model "Gemini 3.5 Flash (Low)" --diff-file /tmp/plan.diff --timeout 3m
   ```
4. If both return `SHIP-AS-IS`, record the review result.
5. If either returns `FIX-THEN-SHIP`, fold verified findings into R1 and rerun.
6. Do not use `grok` until installed.
7. Do not use MiniMax through `cc-shim` until Claude Code is available again or
a direct HTTP adapter exists.

## 18. R0 acceptance checklist

- [ ] Plan file committed or staged for review.
- [ ] agy smoke recorded.
- [ ] Grok missing recorded.
- [ ] MiniMax direct access blocked recorded.
- [ ] Codex review attempted.
- [ ] agy review attempted.
- [ ] Verified findings folded into R1 or explicitly rejected with rationale.

## 19. Review log

### R0 heterogeneous review

Review inputs:

- Diff: `git diff --no-index /dev/null docs/plans/2026-07-01-cross-harness-engine-infrastructure.md`
- Claude Code / `cc-shim`: intentionally skipped.
- Grok: skipped because `grok` was not installed at review time. It was installed later, but auth is still pending.
- MiniMax direct: skipped because no direct token existed in this environment.

Results:

| Reviewer | Runner | Verdict | Finding disposition |
| --- | --- | --- | --- |
| Codex | `codex`, `gpt-5.5`, `xhigh` | `FIX-THEN-SHIP` | Accepted: direct MiniMax adapter example passed `ANTHROPIC_AUTH_TOKEN` as a CLI arg, which can expose secrets via process listings/logs. R1 changes the contract to read the token from environment, config fd, or stdin only. |
| Gemini | `agy`, `Gemini 3.5 Flash (High)` | `SHIP-AS-IS` | No findings. |

R1 change:

- Section 11.7 no longer passes auth tokens as CLI arguments.

### R1 heterogeneous re-review

Results:

| Reviewer | Runner | Verdict | Finding disposition |
| --- | --- | --- | --- |
| Codex | `codex`, `gpt-5.5`, `xhigh` | `SHIP-AS-IS` | No findings. |
| Gemini | `agy`, `Gemini 3.5 Flash (High)` | `FIX-THEN-SHIP` | Accepted: Section 12 used "six-element contract" without defining it, and command examples mixed internal `src/*/cli.js` entrypoints with `bin/autopilot.js` public subcommands. R2 adds Section 6.0 and standardizes user-facing commands on `bin/autopilot.js`. |

R2 changes:

- Added Section 6.0 defining the six-element task contract.
- Standardized public commands on `node bin/autopilot.js ...`.

### R2 heterogeneous re-review

Results:

| Reviewer | Runner | Verdict | Finding disposition |
| --- | --- | --- | --- |
| Codex | `codex`, `gpt-5.5`, `xhigh` | `FIX-THEN-SHIP` | Accepted: Section 11.7 still used an inline environment assignment for the auth token and showed an internal `src/runners/*` entrypoint. R3 removed the internal entrypoint and inline secret value from the plan. The implementation slice below supersedes the earlier future-CLI placeholder with the concrete `scripts/dispatch-review.sh --runner anthropic-compatible` surface until `bin/autopilot.js dispatch review` exists. |
| Gemini | `agy`, `Gemini 3.5 Flash (High)` | `SHIP-AS-IS` | No findings. |

R3 changes:

- Section 11.7 no longer shows an internal `src/runners/*` entrypoint or inline secret value.
- The first implementation slice uses `scripts/dispatch-review.sh --runner anthropic-compatible` with already-present auth environment variables; `--auth-env` remains a future engine CLI option, not part of the current script surface.

### R3 heterogeneous re-review

Results:

| Reviewer | Runner | Verdict | Finding disposition |
| --- | --- | --- | --- |
| Codex | `codex`, `gpt-5.5`, `xhigh` | `SHIP-AS-IS` | No findings. |
| Gemini | `agy`, `Gemini 3.5 Flash (High)` | `SHIP-AS-IS` | No findings. |

Conclusion: R3 is converged under the available non-Claude heterogeneous review loop.
