# Session Handoff - 2026-07-02 (cross-harness engine infrastructure)

> Resuming after `/clear`: read this file first, run the Verification block, then continue with Phase 6 or MiniMax/cc-shim smoke.
> User preference: Traditional Chinese.

## Repo State

- Repo: `/home/codepower/projects/autopilot`
- Branch: `develop`
- Expected HEAD: `d0cc6c0 fix(harness): separate driver and provider quota state`
- Expected status before editing: clean.
- Do not use or print secrets. MiniMax credentials are outside the repo.

Recent commits:

| Commit | Summary |
| --- | --- |
| `d0cc6c0` | Separates driver availability from provider quota in harness capability state. Fixes the earlier mistaken interpretation that Anthropic subscription exhaustion disables provider-bound `cc-shim`. |
| `1a03c02` | Adds governed role evidence states: scorecard can record/query planner/implementer/verifier/reviewer/orchestrator evidence; verifier/orchestrator remain evidence-only, not ladder/gate-routable. |
| `8c7f612` | Adds Codex skills-only plugin package under `platforms/codex/plugin` plus local marketplace and package drift tests. |
| `5ac0b0d` | Adds read-only harness capability state/report infrastructure. |
| `34700d1` | Adds role and harness governance method. |
| `533afc6` | Adds first read-only `AutopilotEngine` API. |
| `0fd6d58` | Adds review-loop resolver bridge. |
| `97be7cf` | Parses review dispatcher results. |
| `fcae00f` | Adds autopilot dispatch review bridge. |
| `f9ffc31` | Adds direct Anthropic-compatible reviewer path. |

## MiniMax / cc-shim Status

Important correction from 2026-07-02:

- "Claude Code quota exhausted" means **native Anthropic subscription quota** is unavailable.
- It does **not** mean the Claude Code CLI driver is unusable for third-party provider-bound `cc-shim`.
- `cc-shim` is: Claude Code CLI driver + explicit `ANTHROPIC_BASE_URL` + explicit `ANTHROPIC_AUTH_TOKEN` for MiniMax/GLM/etc.
- The model/provider quota is MiniMax/GLM quota, not Anthropic subscription quota.
- Native Anthropic-backed `claude` dispatch should still be avoided while Anthropic subscription quota is exhausted.

Token/config presence checked safely on 2026-07-02:

- Current shell env did **not** have `MINIMAX_API_KEY`, `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL` exported.
- `~/.autopilot/providers/minimax.env` exists and contains present values for:
  - `MINIMAX_API_KEY`
  - `AUTOPILOT_MINIMAX_BASE_URL`
  - `AUTOPILOT_MINIMAX_MODEL`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_MODEL`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`

Do not print that file. To use it in a future shell, source it only in the local process:

```bash
set -a
. "$HOME/.autopilot/providers/minimax.env"
set +a
```

Then verify presence without revealing values:

```bash
for k in MINIMAX_API_KEY AUTOPILOT_MINIMAX_BASE_URL AUTOPILOT_MINIMAX_MODEL ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL; do
  if [ -n "${!k:-}" ]; then echo "$k=present"; else echo "$k=absent"; fi
done
```

If `ANTHROPIC_AUTH_TOKEN` is absent after sourcing but `MINIMAX_API_KEY` is present, bind it only for the cc-shim process:

```bash
ANTHROPIC_AUTH_TOKEN="$MINIMAX_API_KEY" \
  scripts/dispatch-review.sh --runner cc-shim --model "${ANTHROPIC_MODEL:-MiniMax-M3}" --diff-file /tmp/example.diff
```

Prefer the direct MiniMax reviewer path when possible:

```bash
scripts/dispatch-review.sh --runner anthropic-compatible --model "${AUTOPILOT_MINIMAX_MODEL:-MiniMax-M3}" --diff-file /tmp/example.diff
```

## What Is Done

Completed and committed:

- Direct Anthropic-compatible reviewer adapter for MiniMax-style APIs.
- Review dispatcher JS bridge and parser.
- Review-loop resolver JS bridge.
- Read-only `AutopilotEngine` API.
- Harness capability report infrastructure.
- Codex skills-only plugin package with generated real skill/support payload.
- Role/harness governance methodology.
- Scorecard evidence support for all governed roles.
- Driver/provider quota separation in capability state.

Review/gates already run:

- Codex / agy / Grok hetero reviews for the Codex package and role-evidence slices.
- Clean subagent review for the role-evidence slice.
- For the quota-domain fix, Codex/agy findings were checked and rejected with local proof; Grok returned `SHIP-AS-IS`.
- Focused tests passed:
  - `bash hooks/tests/harness-capabilities.test.sh` -> 90 assertions
  - `bash hooks/tests/engine-onboarding-methodology.test.sh` -> 38 assertions
  - `bash hooks/tests/codex-plugin-package.test.sh` -> 53 assertions
  - `bash hooks/tests/engine-scorecard.test.sh` -> 14 passed
- Broader gates passed:
  - `scripts/validate.sh`
  - `node scripts/sync-version.js --check`
  - `node scripts/doc-drift-gate.js .` (known warning: non-UTF-8 `docs/plans/2026-05-14-test-suite.md`)
  - `node scripts/check-hook-inventory.js --check`
  - `git diff --check`

## Next Work

Recommended order:

1. **Phase 6 - Hook Adapter Framework**
   - Add normalized hook event schema.
   - Add Claude payload normalizer fixtures.
   - Extract host-neutral handlers for `intent-capture` and `session-start`.
   - Add Codex warning-only probe hook package under `platforms/codex/`.
   - Do not ship blocking Codex hooks until payload/cwd/env/failure semantics are probed.

2. **MiniMax / cc-shim smoke**
   - Source `~/.autopilot/providers/minimax.env` locally.
   - Run direct MiniMax reviewer smoke (`anthropic-compatible`).
   - Run provider-bound `cc-shim` reviewer smoke.
   - Optionally run `cc-shim` implementer smoke in a throwaway worktree.
   - Update capability state and scorecard evidence if the smoke passes.

3. **Implementer JS Runner API**
   - Add `src/runners/implement.js`.
   - Parse `dispatch-hetero.sh` result JSON.
   - Normalize `committed`, `dirty`, `no_op`, `question_suspected`, `failure`, `precondition_failed`.
   - Keep old shell entrypoint compatible.

4. **Full `/l5` / `/l6` Engine Loop**
   - Wire `resolve roster -> implementer -> depth-0 verify -> reviewer panel -> repair loop -> final gate`.
   - Human remains outside normal loop; only credentials, irreversible actions, unqualified rosters, and repeated fail-closed loops escalate.

Later:

- Planner eval harness.
- Implementer eval corpus.
- Verifier authoring eval.
- Orchestrator promotion gate.
- Skill trigger eval corpus.
- Codex status-line/hook UX once hook payload probes are trustworthy.

## Verification On Resume

```bash
cd /home/codepower/projects/autopilot
git status --short -uall
git log --oneline -5

node --check src/harness/capabilities.js
bash hooks/tests/harness-capabilities.test.sh
bash hooks/tests/engine-onboarding-methodology.test.sh
bash hooks/tests/codex-plugin-package.test.sh

node bin/autopilot.js harness report --now 2026-07-02T00:00:00.000Z --stale-after 14d \
  | node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(0,"utf8")); const c=r.records.find(x=>x.id==="claude-code"); const m=r.records.find(x=>x.id==="minimax-direct"); console.log(JSON.stringify({claude:c.auth_domains,minimax:m.auth_domains}, null, 2));'
```

Expected auth-domain shape:

```json
{
  "claude": {
    "driver_cli": "verified",
    "anthropic_subscription_quota": "unavailable",
    "third_party_provider_quota": "not-applicable"
  },
  "minimax": {
    "provider_api_key": "verified",
    "anthropic_subscription_quota": "not-applicable",
    "cc_shim_provider_quota": "verified"
  }
}
```

## Gotchas

- Do not conflate `claude` native Anthropic-backed dispatch with provider-bound `cc-shim`.
- `cc-shim` must be explicit and must have `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN`; never let default Anthropic credentials decide routing.
- Direct MiniMax reviewer intentionally ignores `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`; it uses `MINIMAX_API_KEY` for MiniMax hosts or `ANTHROPIC_COMPATIBLE_AUTH_TOKEN` for generic third-party endpoints.
- Codex plugin package copies generated payload under `platforms/codex/plugin`; after changing canonical `skills/`, `references/`, `scripts/`, or `project-config-template/`, run `scripts/sync-codex-plugin-skills.sh`.
- `docs/HANDOFF.md` itself is a working handoff artifact; decide whether to commit it or leave it local before starting a new implementation slice.
