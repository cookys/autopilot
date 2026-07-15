## 目標

從已建立的 `feat/dispatch-unit-contract-gate` 繼續 v2.32.36，先取得可重現、非 infrastructure-red 的獨立 C1 oracle，再以新 immutable contract 派 Spark 實作 schema/checker。

## 現況

- Repo: `/home/cookys/projects/autopilot`; branch: `feat/dispatch-unit-contract-gate` tracking
  `origin/develop`; parent before this blocker snapshot is `3be381808b59273a1057dffa31a522333bc330ad`
  (`docs(project): enter dispatch contract C1`). Product tree is clean; no accepted product/test code。
- `origin/develop` remains `edad7025486ad196d1124785794c39ff86e092b2`; local feature branch has
  the L-1 project-ledger commit plus this blocker snapshot when committed.
- l6 marker is active. Spark live readiness passed and capability event 43 is `available/high`.
- C1 external run dir: `/tmp/autopilot-dispatch-contracts/dispatch-unit-contract-c1/`.
  Frozen attempt-1 contract hash: `1b6d6c46945b2df86554f04cb545e584d10ad8da81e6df2ee00bbabe401cb5e1`;
  do NOT reuse it after HEAD advances.
- GLM strict author failed twice with server-side 529 despite live endpoint probes. AGY fallback #1
  mutated checkout and was rejected; fallback #2 preserved containment but normalized oracle
  `4807ce54...` infrastructure-failed at `SIDE_SHA: unbound variable`. No implementation dispatch ran.

## 已決事項(不重議)

- Keep every authority/boundary/model/fallback decision from the frozen plan and prior HANDOFF.
- Depth-0 owns contract/spec; checker alone owns GO/NO-GO; worker prose is never artifact proof.
- GLM is the configured author; AGY Gemini 3.5 Flash High is the only recorded fallback. Do not invent
  GPT-OSS or silently substitute another family. New fallback authority requires Board/user approval.
- `containment_breach`, prose/PTY-polluted output, and infrastructure-red are REJECT, even if useful
  code can be quarantined. Quarantine may inform a new author contract but is not accepted code.
- The old contract is invalid once the blocker-doc commit advances HEAD. Re-freeze base/hash/budgets;
  never edit the old JSON and claim the old hash authorized a new run.

## 下一步

1. Verify reality: `git fetch origin && git status --short --branch && node scripts/session-mode.js status`
   and read this HANDOFF plus the project attempt ledger.
2. Do not dispatch while author availability is unchanged. Either obtain fresh evidence that strict
   GLM author inference (not merely `endpoints test`) is functioning, or ask the Board/user to approve
   a new verification-author fallback. Preserve the existing no-more-retry record otherwise.
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
