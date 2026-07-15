## 目標

從已推送並安裝的 v2.32.35 基線開始，依 frozen plan 實作 v2.32.36 dispatch unit contract gate，讓 strict L5/L6 派遣在花費模型 quota 前具備可機械驗證的 spec、boundary、GO/NO-GO，並在執行中/回傳後分別處理 STOP/REJECT。

## 現況

- Repo: `/home/cookys/projects/autopilot`
- Branch: `develop`; `HEAD == origin/develop == b064c916d7aa31e30f464dc5ed2850556975ee24`
  (`docs(project): record roster-gate push completion`); working tree clean; no stash.
- v2.32.35 verification-author roster gate is merged (`0a8ef08`), archived, pushed, plugin-installed,
  and its feature worktree/local branch are deleted.
- Codex reports `autopilot@autopilot-local` installed/enabled at `2.32.35`; session marker is inactive.
- v2.32.36 project/spec is bootstrapped at `a79277f`; implementation branch intentionally does not
  exist and C1 has not been dispatched. No product or verification code is in flight.
- Plan review: AGY Gemini 3.5 Flash High `SHIP-AS-IS`; MiniMax-M3 twice emitted legacy delimiters and
  was correctly recorded as `no_verdict`, not a panel pass.

## 已決事項(不重議)

- Depth-0 writes/freezes every spec and unit contract; implementers and verification authors do not
  redefine authorization. Depth-0 does not author product/test code.
- The checker alone owns GO/NO-GO after C1. NO-GO means zero runner/endpoint/worktree/quota spend;
  runtime failure is STOP; returned boundary/acceptance failure is REJECT. No prose override.
- Product implementer seat is `gpt-5.3-codex-spark` High. Verification author is GLM when its exact
  configured endpoint is live; recorded fallback is AGY Gemini 3.5 Flash High. Independent review
  uses MiniMax-M3 + AGY Gemini 3.5 Flash High. Never invent/use GPT-OSS. Do not retry Grok/Claude/
  Sonnet without fresh live availability evidence.
- Engine/model availability comes from live roster/readiness at dispatch time, never conversation
  memory. Unavailable/unknown/same-family is NO-GO, not silent fallback.
- One unit is one semantic decision plus mandatory generated mirrors. The entire plan is never one
  implementation or verification-author task.
- C1 is the sole bootstrap exception because it creates the checker: depth-0 records a frozen JSON
  contract hash and executes the plan's explicit mechanical checklist using v2.32.35 strict gates.
  Once C1 is accepted, C2-C7 must use the new checker; the exception cannot propagate.
- `scripts/preflight-release.sh` starts a Sonnet slash probe unless explicitly skipped. Until C6
  fixes routing, use `AUTOPILOT_SKIP_SLASH_PROBE=1` when Sonnet is unavailable and record that the
  live slash probe was skipped.

## 下一步

1. After `/reload`, verify reality before changing files:
   `cd /home/cookys/projects/autopilot && git fetch origin && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/develop)" && test -z "$(git status --porcelain)" && codex plugin list | rg 'autopilot@autopilot-local.*2\.32\.35' && node scripts/session-mode.js status`.
2. Enter `autopilot:dev-flow` for the approved L-size project, create
   `feat/dispatch-unit-contract-gate` from the current pushed `origin/develop`, set the l6 marker,
   and update this project's progress table; do not start from the stale handoff SHA if remote moved.
3. Depth-0 authors the C1 bootstrap contract and task prompt. Exact canonical write boundary:
   `schemas/dispatch-unit-contract.schema.json`, `scripts/dispatch-contract.js`, and
   `hooks/tests/dispatch-contract.test.sh`; mandatory generated mirrors are
   `platforms/codex/plugin/schemas/dispatch-unit-contract.schema.json` and
   `platforms/codex/plugin/scripts/dispatch-contract.js`, produced only by
   `scripts/sync-codex-plugin-skills.sh`. Freeze max files/diff lines/wall time, immutable base,
   RED command, acceptance argv, output paths, and live resolved engine tuple before dispatch.
4. Leaf-dispatch the C1 verification oracle separately from Spark implementation. Run depth-0 RED
   proof at base+tests, then GREEN at implementation tip; reject prose-only, timeout, dirty checkout,
   undeclared mirror, or out-of-bound artifacts.
5. Obtain MiniMax-M3 + AGY independent review over frozen C1 spec/diff, mechanically verify every
   finding, accept C1 only after focused tests, schema/parser negative cases, mirror parity, and
   full relevant dispatch regressions pass. Delete this HANDOFF after successful resume/consumption.

## 驗證方式

- C1 pre-dispatch: recorded contract SHA-256; clean immutable base; exact roster/readiness; exact
  canonical+mirror allowlist; budgets; RED/acceptance argv; zero manual model fields.
- Focused: `bash hooks/tests/dispatch-contract.test.sh` must prove invalid schema/spec/base/dependency/
  roster/readiness paths return NO-GO before a fake runner and one valid fixture emits stable hashes.
- Mirror: `scripts/sync-codex-plugin-skills.sh --check` and byte comparison for the new schema/script.
- Regression: focused dispatch-author/resolver/session suites named by the implementation diff, then
  `bash hooks/tests/run.sh` before finish-flow.
- Release close: `AUTOPILOT_SKIP_SLASH_PROBE=1 scripts/preflight-release.sh` while Sonnet is not live;
  expected 8/8 with the slash-probe skip explicitly reported.

## Read-order

1. `/home/cookys/projects/autopilot/docs/projects/2026-07-15-dispatch-unit-contract-gate/HANDOFF.md` — exact continuation state and first executable actions.
2. `/home/cookys/projects/autopilot/docs/plans/2026-07-15-dispatch-unit-contract-gate.md` — canonical frozen schema, authority, phases, acceptance, and bootstrap exception.
3. `/home/cookys/projects/autopilot/docs/projects/2026-07-15-dispatch-unit-contract-gate/README.md` — progress ledger and start gate.
4. `/home/cookys/projects/autopilot/docs/projects/_archive/2026-07-15-verification-author-roster-gate/README.md` — v2.32.35 incident evidence, model routing, unit-splitting, and QC history.
5. `/home/cookys/.claude/projects/-home-cookys-projects-autopilot/memory/project_dispatch-contract-authority.md` — allowlist/generator/preflight quota lessons.

## 陷阱

- Do not claim C1 was authorized by the checker it is creating. Use only the documented single-use
  bootstrap checklist, record its hash, and eliminate the exception after C1 acceptance.
- `sync-codex-plugin-skills.sh` mirrors the complete `schemas/` and `scripts/` trees; a generated
  mirror omitted from C1's frozen allowlist is a rejected contract/artifact, not scope to add later.
- MiniMax-M3 may answer semantically but omit the nonce wrapper. That is `no_verdict`; never count it
  as a panel pass. One bounded retry is enough before recording reviewer transport failure.
- AGY authoring previously mutated the consuming checkout despite read-only intent. Snapshot tree and
  status before/after every author run; mutation is containment breach even if the diff looks useful.
- A four-file Spark repair with broad acceptance timed out at 115s; three one-decision units finished
  in 25/46/33s. Split by semantic decision, not just file count.
- Do not run release preflight unskipped while Sonnet quota is unavailable. The previous accidental
  probe had to be killed; C6 exists to remove this manual hazard.
