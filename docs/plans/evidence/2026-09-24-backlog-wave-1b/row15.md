# Row 15 — Managed rail: a non-git `--repo` still consumes a Mission claim before intake rejects it — AUTHORIZED (depth-0/owner, 2026-09-21 HANDOFF item 3)

## Product
In `src/engine/campaign-intake.js` `runCampaignIntake`, the Mission claim (`missionClaimAdapter(...)`, ~:2246) runs before
any repo-identity-dependent check (`inspectSealedCampaignContract`, ~:2491). A `--repo` that is not a git repo therefore
consumes a Mission claim/attempt before intake rejects it. Fix: before the claim, resolve repo identity with the existing
`canonicalRepoIdentity` (exported from `scripts/implementation-campaign-check.js`, already imported by campaign-intake.js);
if it throws, reject with the same rejection shape/code intake already uses for that failure, WITHOUT calling the claim adapter.
Do not change the claim adapter, the sealed-contract inspection, or any other rejection path.

## Tests (RED-first: run against unmodified base first, record exact output as a `# RED at <base sha>:` comment)
Append one case to `hooks/tests/managed-rail-core-engine.test.sh`: a non-git temp dir as `--repo`, a stub
`adapters.missionClaim` that records calls → assert intake rejects AND the stub was called 0 times. Plus a control:
a git repo fixture still reaches the claim (stub called ≥1). Clean up temp dirs.

## Verify
`test -x hooks/tests/managed-rail-core-engine.test.sh && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash hooks/tests/managed-rail-core-engine.test.sh < /dev/null`
plus every existing suite that exercises `runCampaignIntake` (find with `grep -l runCampaignIntake hooks/tests/*.sh tests/ -r`; run each, one at a time),
plus `bash scripts/sync-codex-plugin-skills.sh --check`.

## Allowed files
`src/engine/campaign-intake.js`, `scripts/implementation-campaign-check.js` (only if an export is genuinely needed),
their codex mirrors under `platforms/codex/plugin/` (via `bash scripts/sync-codex-plugin-skills.sh`),
`hooks/tests/managed-rail-core-engine.test.sh`.
