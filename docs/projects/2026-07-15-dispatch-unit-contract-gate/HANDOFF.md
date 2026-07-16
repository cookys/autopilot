## 目標

從已建立的 `feat/dispatch-unit-contract-gate` 繼續 v2.32.36，先取得可重現、非 infrastructure-red 的獨立 C1 oracle，再以新 immutable contract 派 Spark 實作 schema/checker。

## 現況

- Repo: `/home/cookys/projects/autopilot`; branch: `feat/dispatch-unit-contract-gate` tracking
  `origin/feat/dispatch-unit-contract-gate`; the latest bounded l6 recovery closed at reviewed,
  pushed Grok-r5 terminal commit `d2eea55bad2601470def6db5397e93281c018982`. Product tree remains clean;
  no accepted product/test code。
- While the r3 roster diff was under review, remote feature commit
  `a93be61f40b12402fb8643854dd3ef59bb02f2f4` merged current `origin/develop`
  `22ed5672809f27e57ff64d6aa84c740e62dc1615` into this branch. The reviewer blocked the stale local
  branch story; depth-0 fetched and fast-forwarded because the remote commit descends from local
  `9698ad5` and touches none of the four roster/lifecycle files. Terminal commit `d2eea55` is zero
  behind / 22 ahead of develop; this MiniMax-r3 roster authorization advances it to 23 ahead.
- l6 marker is active. The newest verification-author probe is MiniMax-M3 event 55; Spark implementer
  event 54 remains fresh. Both are `available/high`, and both direct scratch inferences returned `OK`.
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
  `STOP/no-artifact`; the log surfaces no quota/429 signal and no Spark dispatch ran.
- User then freshly authorized `MiniMax-M3`. The endpoint probe passed, strict roster resolved
  `cc-shim/minimax` versus Spark `openai`, and a new current-HEAD contract plus focused prompt were
  frozen. The single call preserved complete containment but returned only one newline byte and
  `status=empty_output`. This is `REJECT/empty-output`, not timeout/quota; no Spark dispatch ran.
- On the user's explicit `/l6` continuation, the marker was re-armed and orchestration resumed
  without another authorization question. Fresh GLM full author inference selected the permanent
  `cc-shim/glm-5.2/zhipu` tuple but timed out at exit 124 with a zero-byte raw log despite a 1,565 ms
  passing endpoint probe. The next automatic recovery selected AGY `Claude Sonnet 4.6 (Thinking)` as
  `agy/anthropic`; it also timed out waiting for the response and produced only the 218-byte AGY PTY
  error log. The GLM observation stayed clean with the same file count; Sonnet preserved the same
  status/file count/config-only diff. No complete content digest was preserved for either attempt,
  so containment evidence is bounded rather than byte-for-byte proof. Both are runtime
  `STOP/no-artifact`. The Sonnet roster override also violated C1's no-manual-substitution rule and
  cannot satisfy the author gate. Depth-0 stopped this resumed run after the two no-artifact calls to
  cap further author spend; that is an orchestration decision, not a contract budget. C1 remains
  fail-closed and no Spark dispatch ran.
- The user then reminded that Spark and Grok 4.5 were back. Fresh probes confirmed Spark event 45
  (`codex/gpt-5.3-codex-spark/implementer/available/high`) and Grok event 44
  (`grok/grok-4.5/verification_author/available/high`). `grok models` printed an unauthenticated banner,
  but the canonical live inference succeeded, so the banner is not authoritative readiness evidence.
  The reminder alone was initially recorded as availability, not authorization, and no dispatch
  followed. The user then explicitly rejected that orchestration stop. The combined exchange is the
  Board continuation for a tracked roster change: `.claude/review-loop-config.md` temporarily assigned
  `grok-4.5/grok/xai` as repository-wide C1 verification author. Its `high` field is roster
  provenance only; the Grok runner receives no effort flag. This is the strict authorization path;
  isolated tuple overrides remain prohibited. Authorization commit `3951f267` passed two gpt-5.5
  reviews and was pushed before spend. Fresh Grok capability event 46 was `available/high`; the exact
  strict-roster call from that clean HEAD returned an authored 52,515-byte raw artifact and preserved
  byte-for-byte containment across all 1,459 files. The artifact concatenates four shebangs, two
  harness sources, and two `finalize_test` calls, so it is `REJECT/output-shape` before RED. No Spark
  dispatch ran. The terminal triggered atomic restoration of the GLM tuple, dogfood resolver-test
  expectations, and lifecycle docs; the isolated Grok branch fixture remains tuple-independent.
- From the clean pushed restoration commit `b84cbd6`, an endpoint-backed GLM live inference succeeded
  (event 47), proving the endpoint was neither 429 nor out of quota at probe time. A new r4 contract
  and non-replayed prompt were frozen from that exact HEAD. The one strict tracked
  `cc-shim/glm-5.2/high/endpoint glm/zhipu` author call preserved all 1,459 file hashes but timed out
  at exit 124 with a zero-byte raw log. This is `STOP/timeout-no-artifact`, not quota, REJECT, or RED;
  no Spark dispatch ran and r4 must not be replayed.
- The continuing CEO run then used the user's prior AGY Gemini authorization without replaying either
  old prompt. AGY 1.1.2 lists exact `Gemini 3.1 Pro (High)` and fresh live event 48 is
  `available/high`. The staged tracked roster assigns `Gemini 3.1 Pro (High)/agy/high/endpoint ""/google`
  against Spark/OpenAI. Authorization commit `b046ee1` passed gpt-5.5 review and was pushed before
  spend. The one exact strict call preserved all 1,459 checkout hashes and returned an authored
  10,155-byte/308-line artifact, but it is wrapped in PTY chrome and Markdown fences with 305 CRLF
  lines. This is `REJECT/output-shape` before RED; no normalization or Spark dispatch ran. The terminal
  restored GLM config, dogfood resolver expectations, and lifecycle docs atomically. Isolated/manual
  substitution remains prohibited; permanent isolated AGY coverage is tuple-independent.
- The user then explicitly reported Grok 4.5 and Spark quota had returned. Fresh live probes recorded
  events 49/50 as `available/high`; Spark returned `OK`. Authorization commit `5fe8949` passed gpt-5.5
  review and was pushed clean. Depth-0 froze r2 contract hash
  `d230bc885dd56e4ce158f9537bf82589562c4b4b3c0f8576d84395cef6f0ecee` and materially new prompt hash
  `146e4b4724a4f5bd49d6c7c0edb8414447ea4492d819006940cc08d292a37679`. The exact strict Grok call
  preserved all 1,459 checkout hashes but returned only one 135-byte planning sentence (raw hash
  `518f07e52850f9c4577569ea2936786ee2a034e7fbc0aa59558532c6ee953b14`) with no shebang, source, or
  finalizer. This is terminal `REJECT/output-shape`; no syntax/RED/normalization/Spark step ran. GLM
  config, matching dogfood expectations, and lifecycle docs are restored atomically. All Grok prompts
  and artifacts are non-replayable; isolated/manual tuple override remains prohibited.
- The user then explicitly directed `/l6` to continue rather than stop at the consumed r2 authority
  boundary. Fresh events 51/52 are `available/high`; Spark returned `OK`. This is new Board authority
  for continued autonomous recovery through one-attempt contracts. The r3 tracked roster assigned
  `grok-4.5/grok/high/endpoint ""/xai`; r3 used a no-inspection, immediate-shebang prompt and may
  not replay/normalize/splice/promote r1/r2. The first r3 authorization review blocked because remote
  feature HEAD had concurrently advanced; after a clean no-overlap fast-forward, r3 is based on the
  actual synced feature HEAD. Authorization commit `ca9d0ff` passed renewed gpt-5.5 review. Depth-0
  froze contract hash `f97ff4ddb8967c0e4a558dae6bd11bcabc05542c6b4371067ec7910147d8e25e` and prompt
  hash `29254b484836870fc8d0e0bfe1da6afc0c31906b95325202538f221935ee69e6`. The exact strict call
  preserved all 1,466 file hashes and returned 30,192 bytes/764 lines (raw hash
  `64f45397e527bf1e1c7149761bc9241899985f4b8bead6f0f6af23db5934f669`). It contains six total
  shebangs (five fixture heredocs) and literal `<|eos|>` after the sole `finalize_test`, so it is
  terminal `REJECT/output-shape` before syntax/RED. No normalization or Spark dispatch ran. GLM
  config, dogfood expectations, and docs restore atomically before any next tracked attempt.
- Persistent Board continuation now authorizes one new tracked current-HEAD Grok r4 attempt without
  another human gate. Events 51/52 remain fresh/high. The staged roster assigns
  `grok-4.5/grok/high/endpoint ""/xai`; r4 is materially new and specifically forbids any fixture
  heredoc shebang plus literal `<|eos|>`. R1-r3 remain terminal/non-replayable. At any terminal,
  pre-dispatch NO-GO, abandonment, or inability to begin, restore GLM config, matching dogfood
  expectations, and README/HANDOFF atomically through review before further strict authoring.
- R4 authorization commit `8d06781` passed gpt-5.5 review and was pushed clean. Contract SHA-256 is
  `326d0cdbec3d2df034f0178321f93d3732ba452428e0d3c6e5c53ada5be13e08`; prompt SHA-256 is
  `210694c67890da352124132c29e0718cd6534b52f61e282dd57c6d3e7ddf053c`. The exact strict call
  selected `grok-4.5/grok/high/endpoint ""/xai`, preserved all 1,466 checkout file hashes and clean
  HEAD/status/diff, then returned raw SHA-256
  `d7cfe3d564032ea63f7aaa12dfdd2e35176ecd24d44d019f29777bff9a2136e8` (68,112 bytes / 1,762
  lines). It concatenates two candidates (shebang/source/finalizer at 1/2/848 and 849/850/1761) and
  appends literal `<|eos|>` at line 1762. This is terminal `REJECT/output-shape` before syntax/RED;
  no normalization or Spark dispatch ran. GLM config, matching dogfood expectations, and lifecycle
  docs restored atomically in reviewed, pushed commit `847c34b` before further strict authoring.
- Persistent Board continuation now authorizes one new tracked current-HEAD r5 attempt without a
  human gate. Grok event 53 and Spark event 54 are fresh `available/high`; a MiniMax endpoint tiny-test
  passed but does not outweigh its earlier empty full-author timeout. The staged roster assigns
  `grok-4.5/grok/high/endpoint ""/xai`; r5's materially new prompt must emit only one candidate and
  hard-stop after its sole finalizer, with no restart or literal EOS. R1-r4 remain terminal and no code
  is reused. Every terminal, pre-dispatch NO-GO, abandonment, or inability to begin restores GLM,
  matching dogfood expectations, and README/HANDOFF atomically through independent review.
- R5 authorization commit `590a4a3` passed gpt-5.5 review and was pushed clean. Contract SHA-256 is
  `c72c272fa4b0cc42c293c0fe8ef4fd761010ed57ce509febde2be3513a637463`; prompt SHA-256 is
  `72556636306ec8ab5ef569f5adb7ecd9fceb380f0e5b2367481f467a1f457e07`. The exact strict call
  selected `grok-4.5/grok/high/endpoint ""/xai`, preserved all 1,466 checkout hashes and clean
  HEAD/status/diff, then returned only a 138-byte planning sentence promising inspection (raw hash
  `51b2c4605b8c43a78a154dd6fffc83992fac8aff08874c2508ffda04ea947d6d`) with zero shebangs,
  sources, and finalizers. This is terminal `REJECT/output-shape` before syntax/RED; no normalization
  or Spark dispatch ran. Restore GLM atomically, then persistent continuation selects the user's
  explicitly authorized MiniMax-M3 seat rather than another immediate Grok call.
- Grok-r5 terminal restoration commit `d2eea55` passed gpt-5.5 review and was pushed clean. A new
  endpoint-backed direct Claude CLI probe for `MiniMax-M3` returned `OK` and recorded event 55 as
  `available/high`; Spark event 54 remains fresh/high. Persistent continuation plus `換 minimax 3?`
  now authorizes exactly one materially new current-HEAD MiniMax r3 attempt through the tracked tuple
  `MiniMax-M3/cc-shim/high/endpoint minimax/minimax`. Old MiniMax and Grok prompts/artifacts are
  terminal and non-replayable. Every terminal, pre-dispatch NO-GO, abandonment, or inability to begin
  atomically restores GLM, matching dogfood expectations, and README/HANDOFF through review.

## 已決事項(不重議)

- Keep every authority/boundary/model/fallback decision from the frozen plan and prior HANDOFF.
- Depth-0 owns contract/spec; checker alone owns GO/NO-GO; worker prose is never artifact proof.
- GLM was the repository-configured author for the recorded attempts and is the tuple to restore
  immediately after the temporary Grok C1 run terminates. The user additionally authorized MiniMax-M3 or
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
- The resumed fresh GLM and AGY Sonnet prompts were each exercised once from `f3fdc92`. Both are
  `STOP/no-artifact` timeouts and must not be replayed. Their endpoint/model-list availability is
  not full-author readiness evidence. Sonnet's isolated roster substitution was a protocol deviation,
  not new standing author authority.
- The tracked Grok 4.5 authorization was consumed by one exact C1 author attempt and terminated at
  `REJECT/output-shape`. GLM is again the repository-configured author; Grok's isolated regression
  fixture is not standing authority and no later substitution follows from readiness alone.
- GLM r4 was a fresh current-HEAD attempt after live capability event 47, but the full author call
  timed out with no bytes. The small probe is quota evidence only, not full-author readiness; do not
  replay r4 or reinterpret its exit 124 as 429/out-of-quota.
- The prior Board-authorized AGY Gemini seat was live at event 48 and received one new tracked
  current-HEAD recovery. Its r3 artifact is terminal `REJECT/output-shape`; all three Gemini prompts
  and artifacts are non-replayable/non-normalizable. GLM is again the tracked repository author.
- The new Grok/Spark quota-return statement authorized exactly one materially new tracked Grok
  recovery backed by events 49/50. R2 consumed that authority and terminated at
  `REJECT/output-shape`; it does not authorize a retry or reopen any Grok prompt/artifact. GLM is
  again the tracked repository author and the isolated Grok fixture is not standing authority.
- The later explicit `你就繼續啊?` is persistent Board continuation after r2 terminal, backed by
  events 51/52: do not stop for a fresh human question after every one-attempt contract. R3 ended at
  `REJECT/output-shape` and does not reopen any old artifact. Every terminal still restores GLM first;
  a next attempt still requires a materially new current-HEAD contract/prompt, fresh readiness,
  tracked roster, and review before spend.
- R4 is the first such next attempt. Its scope is one new tracked contract/prompt correcting r3's raw
  shape only. It ended at terminal `REJECT/output-shape` and does not authorize normalization or
  reuse of either r3 or r4's substantial Bash output. Persistent continuation permits a new tracked
  current-HEAD attempt only after atomic GLM restoration.
- R5 is the next tracked attempt after that reviewed restoration, backed by fresh events 53/54. It
  corrected only r4's concatenated-candidate failure with a new hard-stop prompt and reused no old
  code. Its planning-only response is terminal `REJECT/output-shape`. The next tracked attempt uses
  MiniMax-M3 after atomic restoration and a fresh endpoint/readiness check; old MiniMax prompts remain
  non-replayable.
- MiniMax r3 is the resulting next attempt, backed by fresh events 55/54. Its current-HEAD prompt and
  contract are new; neither old MiniMax prompt nor empty output may be replayed or normalized.
- `containment_breach`, prose/PTY-polluted output, and infrastructure-red are REJECT, even if useful
  code can be quarantined. Quarantine may inform a new author contract but is not accepted code.
- The old contract is invalid once the blocker-doc commit advances HEAD. Re-freeze base/hash/budgets;
  never edit the old JSON and claim the old hash authorized a new run.

## 下一步

1. Verify reality: `git fetch origin && git status --short --branch && node scripts/session-mode.js status`
   and read this HANDOFF plus the project attempt ledger. This is phase 2 of 8: P0 is complete, C1 is
   active on tracked MiniMax-M3 recovery r3, and seven phases remain including active C1; C2-C7 are pending.
2. Review/commit/push the MiniMax tracked roster and matching dogfood expectations; verify
   MiniMax/OpenAI family separation, events 55/54, and permanent isolated fixture independence.
3. Freeze a materially new current-HEAD MiniMax prompt/contract from that clean pushed HEAD. The raw
   oracle must pass output-shape, checkout-containment, `bash -n`, portable-tool, and isolated RED.
4. Only after assertion-red succeeds without fixture/import/tool failure, author the implementation
   prompt with the accepted oracle hash, dispatch Spark once, then run GREEN, mirror parity, boundary,
   budgets, and MiniMax-M3 + AGY review.
5. If a future temporary repository-wide assignment is reviewed and committed, retain the same
   atomic restoration rule at every terminal or aborted/non-started attempt before C2 or unrelated
   strict `/l6` authoring.

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
- Resumed GLM contract/prompt hashes are
  `4816d0ba5f6306fd4e4f1aa833cbb3bf3fff4e1626c1c02f8e793c13e9e5b63e` and
  `aebed687253eada734bcfe4282d4f489bedab88750bddb5f18b48dcc5e48f2f0`. Raw log
  `/tmp/dispatch-author-log-mTXCy2` is zero bytes, SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; strict runner exit was 124.
- AGY Sonnet contract/prompt hashes are
  `0659e4e3d38a28a9224210f3aa34d28043c0f32ca33dea6c621caeec0bef26fd` and
  `9847ab7f4ac6bc0a06443c76f7bbf69434955268b5ab0637cd886005e723f0b7`. Raw log
  `/tmp/dispatch-author-log-FdmtLz` is 218 bytes, SHA-256
  `9ee505e23120741d0ee0bc16b14d43d19d45576e959847b8735f93debacfe8ca`, containing only
  `Error: timeout waiting for response` plus PTY chrome. Bounded containment observations remained at
  1,459 files and the same config-only diff SHA-256
  `7b5778e176acc9a08fe06c532d041f7cd9121c1a430e3a1af73c0727944669b5`; no complete content digest
  was preserved.
- For future strict-author terminals, persist and hash the dispatcher result JSON or terminal
  transcript before deleting the isolated worktree; a raw model log alone does not prove runner exit,
  probe latency, or strict-roster provenance.
