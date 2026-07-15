## 目標

從已建立的 `feat/dispatch-unit-contract-gate` 繼續 v2.32.36，先取得可重現、非 infrastructure-red 的獨立 C1 oracle，再以新 immutable contract 派 Spark 實作 schema/checker。

## 現況

- Repo: `/home/cookys/projects/autopilot`; branch: `feat/dispatch-unit-contract-gate` tracking
  `origin/feat/dispatch-unit-contract-gate`; the fresh MiniMax recovery started from
  `d0012624c00263d3e0103f06158c05f340c6f3a1` (`docs(project): record AGY Opus author timeout`).
  Product tree is clean; no accepted product/test code。
- `origin/develop` remains `edad7025486ad196d1124785794c39ff86e092b2`; local feature branch has
  the L-1 project-ledger commit plus this blocker snapshot when committed.
- l6 marker is active. Spark live readiness passed and capability event 43 is `available/high`.
- C1 external run dir: `/tmp/autopilot-dispatch-contracts/dispatch-unit-contract-c1/`.
  Frozen attempt-1 contract hash: `1b6d6c46945b2df86554f04cb545e584d10ad8da81e6df2ee00bbabe401cb5e1`;
  do NOT reuse it after HEAD advances.
- GLM strict author failed twice with server-side 529 despite live endpoint probes. AGY fallback #1
  mutated checkout and was rejected; fallback #2 preserved containment but normalized oracle
  `4807ce54...` infrastructure-failed at `SIDE_SHA: unbound variable`. No implementation dispatch ran.
- User authorized MiniMax-M3 or gpt-5.5 review/recovery. MiniMax endpoint probe returned `ok` and a
  strict isolated roster resolved `MiniMax-M3/cc-shim/high/minimax` with family `minimax`, but the
  author call timed out (`runner exited 124`) with an empty raw log. Full status/diff/file hashes prove
  zero checkout mutation. gpt-5.5 then reviewed the quarantined AGY oracle and returned
  `FIX-THEN-SHIP` with five additional test-infrastructure findings. C1 is still NO-GO.
- User then authorized AGY `Gemini 3.1 Pro (High)`. Its exact model ID was present in AGY 1.1.2 and
  strict roster resolved `agy/google` versus Spark `openai`. Both author rounds preserved complete
  checkout containment. Round 1 produced a normal assertion RED but an invalid valid-fixture; gpt-5.5
  returned `FIX-THEN-SHIP`. The one repair round rewrote the frozen contract shape and infrastructure-
  failed on exit 127/invalid record fixtures. Both artifacts are REJECT; no Spark dispatch ran.
- User then authorized AGY `Claude Opus 4.6 (Thinking)`. An isolated strict roster correctly resolved
  `agy/anthropic` versus Spark `openai`; a fresh contract and prompt were frozen from `4f5dcb69`.
  The only author call preserved byte-for-byte checkout containment but AGY timed out waiting for the
  response after five minutes. Its 218-byte raw log contains no authored Bash. This is
  `REJECT/no-artifact`, not quota/429; no Spark dispatch ran.
- User then freshly authorized `MiniMax-M3`. The endpoint probe passed, strict roster resolved
  `cc-shim/minimax` versus Spark `openai`, and a new current-HEAD contract plus focused prompt were
  frozen. The single call preserved complete containment but returned only one newline byte and
  `status=empty_output`. This is `REJECT/empty-output`, not timeout/quota; no Spark dispatch ran.

## 已決事項(不重議)

- Keep every authority/boundary/model/fallback decision from the frozen plan and prior HANDOFF.
- Depth-0 owns contract/spec; checker alone owns GO/NO-GO; worker prose is never artifact proof.
- GLM remains the repository-configured author. The user additionally authorized MiniMax-M3 or
  gpt-5.5 on 2026-07-15: MiniMax is valid cross-family author/reviewer authority; gpt-5.5 is only a
  supplementary reviewer because it shares the OpenAI family with Spark. Do not count gpt-5.5 as the
  L6 independent verification author or silently substitute another family.
- The later AGY `Gemini 3.1 Pro (High)` authorization was exercised for one author round plus one
  reviewer-driven repair round. It is a valid Google-family seat, but neither emitted oracle passed
  the artifact-fidelity gate. Do not retry either prompt or promote their quarantined files.
- The later AGY `Claude Opus 4.6 (Thinking)` authorization was exercised once through strict roster.
  It produced only a timeout log and no artifact. Do not retry its recorded prompt or interpret the
  runner exit as a quota result.
- The fresh MiniMax authorization was exercised once with a new current-HEAD contract and shorter
  prompt. It returned empty output despite a passing endpoint probe. Do not replay either recorded
  MiniMax prompt or count endpoint-probe success as full-author readiness.
- `containment_breach`, prose/PTY-polluted output, and infrastructure-red are REJECT, even if useful
  code can be quarantined. Quarantine may inform a new author contract but is not accepted code.
- The old contract is invalid once the blocker-doc commit advances HEAD. Re-freeze base/hash/budgets;
  never edit the old JSON and claim the old hash authorized a new run.

## 下一步

1. Verify reality: `git fetch origin && git status --short --branch && node scripts/session-mode.js status`
   and read this HANDOFF plus the project attempt ledger.
2. Do not retry the recorded MiniMax, Gemini, or AGY Opus prompts. Either obtain fresh evidence that
   strict GLM full author inference (not merely `endpoints test`) is functioning, or ask the
   Board/user to authorize a different cross-family author. gpt-5.5 cannot fill that seat.
3. From the then-current clean `HEAD`, issue a new C1 contract/hash with the same exact five-file
   boundary and a new independent author prompt. The new raw oracle must pass output-shape,
   checkout-containment, `bash -n`, portable-tool, and isolated base+oracle RED gates.
4. Only after assertion-red succeeds without fixture/import/tool failure, author the implementation
   prompt with the accepted oracle hash, dispatch Spark once, then run GREEN, mirror parity, boundary,
   budgets, and MiniMax-M3 + AGY review.

## 驗證方式

- Author artifact: exact raw Bash file, clean consuming tree before/after, `bash -n` exit 0, no
  unavailable host tools, and isolated base+oracle run exits nonzero on behavioral assertions without
  any `unbound variable`, missing helper/import, collect-zero, or syntax failure.
- C1 implementation: `bash hooks/tests/dispatch-contract.test.sh`, `node --check
  scripts/dispatch-contract.js`, `scripts/sync-codex-plugin-skills.sh --check`, both canonical/mirror
  `cmp` commands, five-file/1600-line boundary, and full acceptance argv all green.

## Read-order

1. `/home/cookys/projects/autopilot/docs/projects/2026-07-15-dispatch-unit-contract-gate/HANDOFF.md` — current blocker and exact safe resume condition.
2. `/home/cookys/projects/autopilot/docs/projects/2026-07-15-dispatch-unit-contract-gate/README.md` — scope audit, attempt ledger, and progress state.
3. `/home/cookys/projects/autopilot/docs/plans/2026-07-15-dispatch-unit-contract-gate.md` — frozen authority/schema/units.
4. `/tmp/autopilot-dispatch-contracts/dispatch-unit-contract-c1/C1-bootstrap-checklist.md` — full hashes, live probes, author outcomes, and quarantines.
5. `/home/cookys/.claude/projects/-home-cookys-projects-autopilot/memory/project_dispatch-contract-authority.md` — cross-session probe/author landmines.

## 陷阱

- `scripts/probe-engine-capability.sh --live-spend --runner codex` currently omits
  `--skip-git-repo-check` in its scratch cwd on Codex 0.144.4; its `unknown` event can be probe
  infrastructure failure before model invocation.
- `autopilot endpoints test glm` passed immediately before both 529 author failures; endpoint tiny-test
  success does not prove a full author inference will run.
- `dispatch-author.sh status=authored` only means legacy non-empty output. Inspect raw shape, PTY chrome,
  syntax, fixture execution, and checkout containment independently.
- The quarantined AGY files are evidence, not an allowlist shortcut. Do not copy them into the repo or
  repair their assertions at depth-0 under l6.
- MiniMax evidence: `/tmp/dispatch-author-log-QzBekL` is an empty timeout log; its isolated roster
  override lived only in `/tmp/autopilot-minimax-c1-author-775e1d1` and did not alter this branch.
  gpt-5.5 review evidence is `/tmp/dispatch-review-log-48mObD`; it found marker-env, GO-side-effect,
  repeat-hash, mixed-family-fixture, and negative-JSON-shape coverage defects.
- Gemini round 1 raw log is `/tmp/dispatch-author-log-AJyBJr`, SHA-256
  `7750dcfb986663c6c546baa40a2b34a889a93f1829d57bcacf18402b6adb0b0e`; deterministic CR/PTY normalization is
  `C1-author-Gemini31-r2-normalized.test.sh`, SHA-256
  `baff7a34a9e1fd0aa4ffb0b7fb843f7427b286705d91a2e9301aeaa72c93c61a`. Its isolated run reached
  `Summary: 8 passed, 52 failed`, but the valid spec/base fixture was invalid and it bypassed the repo
  test API. gpt-5.5 review: `/tmp/dispatch-review-log-qpTLHX` (`FIX-THEN-SHIP`).
- Gemini repair raw log is `/tmp/dispatch-author-log-pnHzfs`, SHA-256
  `6cb8ef190c5329fac95ed701648675f4504a1f60d82fea125e4ed07fd32196d4`; normalized candidate SHA-256
  `71504d2b6c795e7b48d4b759f8a45bc93adefa514e52551f28c5055a177d2255`. It invented a different
  contract schema and its isolated run was infrastructure-red (`engine-scorecard.js` permission
  denied, invalid capability record, checker exit 127). Evidence log: `C1-gemini31-repair-red.log`.
- AGY Opus raw log is `/tmp/dispatch-author-log-DhdUUZ`, 218 bytes, SHA-256
  `ec5fdb3c0f1c8c8c1d9cc3f080f7e4e698b3316cf805b0c4d25d12be60e92b39`. The rail selected
  `Claude Opus 4.6 (Thinking)/agy/high/anthropic`, then returned `runner_failed` with
  `Error: timeout waiting for response`. Before/after containment digest is identical:
  1,459 files, tree-content SHA-256 `f0a37af2dd75828cf1446f14e2b0232483688597619d502b5bae60c9917a03b8`,
  config-only diff SHA-256 `3799aade09cf60495a6c2307e94d8af2021025239a8b231bb40dfa1428a095b0`.
- Fresh MiniMax raw log is `/tmp/dispatch-author-log-nWuKex`, exactly one newline byte, SHA-256
  `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`. The rail selected
  `MiniMax-M3/cc-shim/high/endpoint minimax/family minimax` and returned `empty_output`; endpoint
  preflight had returned `ok` in 1,401 ms. Before/after containment is identical: 1,459 files,
  tree-content SHA-256 `5ad3c041acf0e71c1b9d267d183b9efcb86d38b52a3dd14060fd1b476ed5d5fc`, config-only diff
  SHA-256 `7781453cfabcd958911bd46ec4836e11622e8e498486a7205fd4a4ddf105bcda`.
