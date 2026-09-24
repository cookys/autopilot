# autopilot — BACKLOG

One entry = one index row per [`references/backlog-entry.md`](../references/backlog-entry.md); evidence lives at
the row's `Pointer` (a plan, a project, or a sidecar under `docs/backlog/`). Gate:
`node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (config `.claude/backlog-config.md`, `mode: block`;
residual debt in `.claude/backlog-debt.json` ratchets down only). Migrated 2026-09-14 by
`scripts/migrate-backlog-entries.js` (manifest `docs/backlog/MIGRATION-2026-09-14.json`).

**FIRED queue (order, as of 2026-09-14)** — rows whose trigger has fired are worked in this order:

1. ~~`chatgpt-tunnel-host` (E)~~ SHIPPED v2.36.32 · 2. ~~`openclaw` main claim~~ v2.36.28 · 3. ~~`cookys-7840hs` four defects~~ v2.36.33 ·
4. ~~foreman rail Shape B~~ v2.36.34 · 5. ~~`308-db` (a) residue sweep~~ v2.36.35 · 6. ~~2026-09-12 dogfood four defects~~ v2.36.36 ·
7. ~~backlog entry schema Phases 1–4~~ v2.36.38–39 · 8. ~~disposition resume~~ v2.36.41 · 9. ~~ledger flag burns a grant~~ v2.36.42 · 10. ~~reviewer no_verdict releases the claim~~ v2.36.43. Next: operator-named work, or the 308-8f dispatch-hetero reports.

### `dispatch-hetero.sh --timeout` is accepted and recorded but never applied to the grok rail
- **Status**: open
- **Trigger**: the next grok dispatch anyone needs to bound, or any audit of runner-branch parity
- **Effort**: S
- **Source**: 2026-09-22 foreman phase-1 build (a `--timeout 20m` grok dispatch alive at 22m39s; the foreman was planning around a deadline that never fires)
- **Pointer**: docs/backlog/dispatch-hetero-grok-timeout-not-applied.md
- **Context**: agy forwards `$TIMEOUT` to `run_worker`, the two grok branches do not, and `run_worker` adds none; the manifest still emits `timeout_seconds`, so the record states an unenforced bound.

### OpenCode Go needs a Responses-protocol transport and an `x-opencode-session` header
- **Status**: open
- **Trigger**: the next attempt to administer ANY non-implementer seat on an `opencode-go` model
- **Effort**: M
- **Source**: 2026-09-21 muse-spark seat probe (503 on both protocols looked like an outage; a per-model probe of all 31 ids showed per-model routing)
- **Pointer**: docs/backlog/opencode-go-responses-transport.md
- **Context**: 9 ids need only the session header; 5 (incl. both muse-spark contributors) are Responses-only; its truncation signal is `status:"incomplete"`, which the v2.36.83 budget diagnosis does not match.

### Foreman ↔ depth-0 coordination: typed `worker_condition` was planned (r6) and never built
- **Status**: open
- **Trigger**: a foreman wait loop that must tell "hand parked on a question" from "hand still working" without reading the transcript
- **Effort**: M
- **Source**: 2026-09-20 orphan-plan triage (plan frozen into a mission graph, zero identifiers in history)
- **Pointer**: docs/backlog/foreman-depth0-typed-worker-condition.md
- **Context**: plan archived as dropped-never-built; the mission graph that sealed it is terminal.

### Skill frontmatter `tier:` migration never landed — the portability probe checks a key no SKILL.md carries
- **Status**: open
- **Trigger**: any edit to `scripts/probe-skill-frontmatter-portability.sh`, OR the next cross-harness skill-portability report
- **Effort**: S
- **Source**: 2026-09-20 orphan-plan triage (`grep -rln '^tier:' skills/*/SKILL.md` empty)
- **Pointer**: docs/backlog/skill-frontmatter-tier-migration.md
- **Context**: decide keep-or-drop `tier:`; the probe and the plan's §0 note must agree either way.

### Host Conformance tool — authorized by the 2026-08-23 consolidation decision, never built
- **Status**: open
- **Trigger**: before any coding-harness architecture migration is proposed again, OR when a host capability claim is disputed by a peer
- **Effort**: L
- **Source**: 2026-09-20 remote-branch triage (decision branch merged at 47b52eac; deliverable absent)
- **Pointer**: docs/backlog/host-conformance-tool.md
- **Context**: needs its own registered plan; the decision doc lists the six report sections.

### Foreman rail residuals (v2.36.34) — accepted and named, not hidden
- **Status**: open
- **Trigger**: **NOT FIRED — recorded at ship time, 2026-09-13.** Fires when a real foreman run trips one of them.
- **Effort**: M
- **Source**: `docs/plans/2026-09-13-foreman-rail-b-build.md`, ship-time adjudication.
- **Pointer**: docs/backlog/foreman-rail-residuals-v2-36-34-accepted-and-named-not-hidden.md

### Dev mode layer ③ (marketplace clone) as a symlink — spike before changing dev-setup
- **Status**: open
- **Trigger**: **NOT FIRED — operator question 2026-09-13** after `/reload-plugins` loaded v2.34.5 skills because `~/.claude/plugins/marketplaces/autopilot` had not been pulled since 2026-08-07 (the same shape as the 2026-07-17 incident in…
- **Effort**: S
- **Source**: unknown
- **Pointer**: docs/backlog/dev-mode-layer-marketplace-clone-as-a-symlink-spike-before-changing-dev-setup.md

### Blind review redesign: blind the packet and the process boundary, not the runner
- **Status**: open
- **Trigger**: owner asked 2026-09-16 how to keep review independence while tool-capable reviewers sit on the panel and the loop gets faster; gpt-6-astra and claude-fable-5-1 converged
- **Effort**: L
- **Source**: owner request 2026-09-16 after v2.36.58
- **Pointer**: docs/plans/evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md
- **Context**: packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats; quorum + snapshot; panel station; shared packet. Shipped: 1a-A..2-C v2.36.59-69. Open: 2-D overlap/pre-pass.

### PEER-REPORTED (openclaw): briefs pairing `session-mode set --level l5` with non-strict dispatch burn foreman budgets
- **Status**: open
- **Trigger**: in-session operator confirmation of the relayed ruling (a)=B, (b) approved
- **Effort**: S
- **Source**: `openclaw` msg `msg_01M2PHM6PWH6VY7WP059Y0Q1TT` (2026-09-17, /l5 ×3 on fleet-comms + chatgpt-tunnel-host); replied `msg_01M2PHNG5TTNXQYJQ2G3EKANFW`
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: ruling relayed by openclaw 2026-09-17 (`msg_01M2PWEZ8WAVJ8S4F032MFTVGQ`): (a)=B no seat exemption — ship mask-line print + brief linter; (b) same refusal twice → ladder stop. Peer relay only; operator confirms in-session first.

### Managed rail: codex containment (bwrap) qualification spike so a codex seat can serve the blind final panel
- **Status**: open
- **Trigger**: operator wants a pinned codex qc seat to survive managed blind discovery without replacing the seat
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 (cuda P1 consult, A2)
- **Pointer**: docs/plans/evidence/2026-09-16-blind-review-redesign/bwrap-probe.md
- **Context**: absorbed by redesign cut 1b (plan 2026-09-16-blind-review-packet §7). Probe 2026-09-16: codex with tools ran inside bwrap on a planted packet; left: timeout/exit/raw_log parity via dispatch-review.sh, other CLIs.

### PEER-REPORTED (openclaw): PreToolUse(Bash) guard — detach without wake-up, `pkill -f` self-match, zsh `=`/glob abort
- **Status**: open
- **Trigger**: operator decision on adoption; three regex rules on `tool_input.command`, must fire for depth-0 too
- **Effort**: S
- **Source**: `openclaw` msgs `msg_01M2KS2TXH2V1T90DQ7X8F2TB1`, `msg_01M2KS5WZKY5WTFXPGEKJ9QH8W`; replied `msg_01M2KS6RBYNB9X43MT9PMTKGVG`
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: (1) `nohup`/`setsid`/`&` + rail entrypoint → deny (use `run_in_background`); (2) `pkill -f` without `[x]` → warn; (3) bare `=` token or unquoted glob → deny (zsh aborts the line).

### CI `tests` workflow red before v2.36.54: `dispatch-detached-campaign-authority.test.sh` fails on the runner
- **Status**: open
- **Trigger**: every run since at least 2026-09-14 (the workflow runs only the changed test files, so the red is masked locally)
- **Effort**: S
- **Source**: `gh run list` 2026-09-16 while fixing the v2.36.54 executable-bit red
- **Pointer**: none
- **Context**: `detached campaign strict dispatch changes only the narrow subset: expected 'src/out.txt', got ''` on the GitHub runner; passes locally — environment coupling to reproduce in a clean clone.

### PEER-REPORTED (openclaw): agy flash/low implementer is no-go on real briefs — qualify on brief length + self-run tests
- **Status**: open
- **Trigger**: next agy implementer qualification, or a consumer config that still defaults the implementer to agy
- **Effort**: S
- **Source**: `openclaw` via hangar-bridge 2026-09-16, msg `msg_01M2KNFAB7P7TGGMF4K5QYQFYH`
- **Pointer**: none
- **Context**: agy `-p` self-aborts at 5 min, a >~40-line brief at low ends in silent no_op, `run_command` 10 s cap backgrounds test loops; add scorecard dimensions or auto-degrade the seat with a warning.

### agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT
- **Status**: open
- **Trigger**: the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Effort**: S
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at…
- **Pointer**: docs/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and…

### Reconnaissance and implementation share one leaf bash budget, so a leaf can exhaust it before touching code
- **Status**: open
- **Trigger**: **NOT FIRED — peer observation, 2026-09-13.** Fires when a leaf under this rail is measured hitting its command cap with zero diff.
- **Effort**: S
- **Source**: `308-db` via the local session mesh, 2026-09-13.
- **Pointer**: docs/backlog/reconnaissance-and-implementation-share-one-leaf-bash-budget-so-a-leaf-can-exhau.md
- **Context**: `308-db` ran six Agent-worktree leaves on 2026-09-13; three hit the 40-command bash ceiling **after reconnaissance was complete and before a single line changed**.

### Main-checkout boundary: accepted residuals of an accident guard that is not a sandbox
- **Status**: open
- **Trigger**: fires only if the boundary is ever asked to be a sandbox — i.e. an adversarial worker becomes a threat model this repo adopts. Today it is not (`references/blind-dispatch.md`; v2.36.32's own contract says "accident guard, not a sandbox").
- **Effort**: L
- **Source**: v2.36.32 review round 6, 2026-09-13, adjudicated at depth 0 by re-derivation.
- **Pointer**: docs/backlog/main-checkout-boundary-accepted-residuals-of-an-accident-guard-that-is-not-a-san.md
- **Context**: v2.36.32's detection layer fingerprints every ref, HEAD, symbolic-ref target, staged/unstaged diff content, and a size+mtime+type+link-target walk of every entry outside `.git`.

### The implementer ladder's cost ordering is nearly degenerate — 11 of 17 rungs share one effort tier
- **Status**: open
- **Trigger**: the next time a climb picks a seat whose price is wildly out of line with the rung below it, or any work that wants the ladder to mean "cheaper first" in dollars rather than in label order.
- **Effort**: S
- **Source**: v2.36.20 follow-up, 2026-09-08; the adjacency rule shipped, this is the ordering key underneath it
- **Pointer**: docs/backlog/the-implementer-ladder-s-cost-ordering-is-nearly-degenerate-11-of-17-rungs-share.md
- **Context**: measured on this host 2026-09-08 (`~/.autopilot/topology.json`, 17 rungs): indices 5–16 are ALL `high`, so within that region the ordering falls through to `latency.sample_wall_time_s` then engine name.

### kimi reviewer rail: file-indirection for prompts above the argv wall (needs a live kimi credential to probe)
- **Status**: open
- **Trigger**: a host with a working `kimi login` (this host's managed:kimi-code OAuth has no credential as of 2026-09-07, so the probe could not run), or Kimi Code CLI shipping `--prompt-file` / stdin prompt input (0.39.1 has neither: `-p ''` is…
- **Effort**: S
- **Source**: 308 report 2026-09-07, run review-1788751167-2077044-2d7b.
- **Pointer**: docs/backlog/kimi-reviewer-rail-file-indirection-for-prompts-above-the-argv-wall-needs-a-live.md
- **Context**: v2.36.14 fails closed pre-spend when the kimi prompt exceeds ~120 KB (Linux MAX_ARG_STRLEN, 308 hit rc=126 on a 145 KB prompt).

### Per-hook × per-harness support matrix with verification dates (hook inventory that is periodically re-checked)
- **Status**: open
- **Trigger**: the next hook that is registered on a second harness (Codex `Stop`/`SessionEnd` for `dirty-protected-paths` is the first, v2.36.11, and its Codex live-fire is unverified), or a `harness-maintenance` run that finds a hook-event claim…
- **Effort**: S
- **Source**: owner 2026-09-07 during the dirty-tree hook ship; `references/evidence-discipline.md` (script existing ≠ running).
- **Pointer**: docs/backlog/per-hook-per-harness-support-matrix-with-verification-dates-hook-inventory-that.md
- **Context**: owner question 2026-09-07 「那些 hook 是不是要統一做個盤點表定期 check 所有 harness 是否支援」.

### Codex dev-mode hook entry that survives plugin cache replacement (`~/.codex/hooks.json` → repo path)
- **Status**: open
- **Trigger**: a second report of `PostCompact MODULE_NOT_FOUND` on a host that ran `dev-setup.sh --harness codex --install` with `--force`, or a Codex release that documents whether hook `command` strings run through a shell (then a self-contained…
- **Effort**: S
- **Source**: local Codex session hand-off via agent-call 2026-09-07; `hooks/tests/codex-plugin-package.test.sh` upgrade case.
- **Pointer**: docs/backlog/codex-dev-mode-hook-entry-that-survives-plugin-cache-replacement-codex-hooks-jso.md
- **Context**: v2.36.10 guards the update (refuse under live sessions) but cannot make a live session survive it: Codex pins `PLUGIN_ROOT` to `~/.codex/plugins/cache/…/<version>/`, and both `plugin add` (in-place upgrade) and `plugin remove` delete…

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Status**: open
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8
- **Pointer**: docs/backlog/apply-two-tier-pooled-verdict-to-reviewer-implementer-owner-verification-author.md
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map

### Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
- **Status**: open
- **Trigger**: Codex 提供受支援的 native plugin lifecycle：在 plugin install **與** Git marketplace upgrade/refetch 兩條適用路徑上，都能於 payload discovery 前自動執行 deterministic generator，且 generator…
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）；[`codex-payload-residual-spike`](projects/_archive/2026-08-02-codex-payload-residual-spike/README.md)…
- **Pointer**: docs/backlog/codex-payload-install-time-generation-2026-08-02-residual-spike-no-go.md
- **Context**: codex-cli 0.146.0 的 logged-in `codex exec` 已實證 installed Autopilot cache payload 與 linked support reference 可被讀取，且 audit 結果正確。殘餘 probe 同時反證把 local source 當 Git refresh：generation A…

### Release-time payload branch（B）重啟條件
- **Status**: open
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）
- **Pointer**: docs/backlog/release-time-payload-branch-b.md
- **Context**: Generic push/PR test CI 已存在，但 B 仍需新建 tag→payload publication→push-credential 的 release path；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user…

### 🔵 suite oracle lock: a killed full-suite run leaves the next one refused (observed 2026-09-02)
- **Status**: open
- **Trigger**: see pointer
- **Effort**: M
- **Source**: unknown
- **Pointer**: docs/backlog/suite-oracle-lock-a-killed-full-suite-run-leaves-the-next-one-refused-observed-2.md

### Promote the depth-0 hetero-run watcher to a shipped dispatch-watch script
- **Status**: open
- **Trigger**: the next `/l4`–`/l6` session that has to wake parked foremen — depth-0 re-armed a scratch script ~40 times in v2.36.0 (report the first run whose `dispatch-status.js` phase flips from running to terminal)
- **Effort**: S
- **Source**: v2.36.0 session
- **Pointer**: docs/backlog/promote-the-depth-0-hetero-run-watcher-to-a-shipped-dispatch-watch-script.md
- **Context**: parked foremen are never woken by their own background children; a shipped watcher plus a documented `SendMessage` wake step would replace the hand-rolled loop.

### Lint hands diffs for fixture literals leaking into production code
- **Status**: open
- **Trigger**: next hands cut on a script with a test that names phases/ids (`p7`, `fixture`, `test`)
- **Effort**: S
- **Source**: core review g2, v2.36.0
- **Pointer**: docs/backlog/lint-hands-diffs-for-fixture-literals-leaking-into-production-code.md
- **Context**: `references/evidence-discipline.md` §23 — three reviewers caught a `phase === 'p7'` carve-out the suite could not

### `hetero-review-loop.js` collect appends to chain.json without a lock or atomic rename
- **Status**: open
- **Trigger**: two collects for the same phase ever run concurrently (today callers serialise by generation)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-D2-attempt1-parser-defect/`
- **Pointer**: docs/backlog/hetero-review-loop-js-collect-appends-to-chain-json-without-a-lock-or-atomic-ren.md
- **Context**: a lost chain entry would self-recover on retry, never forge a gate pass; MiniMax CUT/FOLLOW-UP on the D2 review 2026-09-04

### `finalize` closes an earlier verified finding by absence in a later generation
- **Status**: open
- **Trigger**: a future review-policy deliverable, or evidence that a reviewer missed a still-open finding
- **Effort**: Fix
- **Source**: same ledger dir as above
- **Pointer**: docs/backlog/finalize-closes-an-earlier-verified-finding-by-absence-in-a-later-generation.md
- **Context**: the plan defines closure as absence-in-later-findings; tightening to "explicitly re-verified" needs a policy decision (MiniMax CUT/FOLLOW-UP)

### autopilot effort vocabulary has no `minimal` — the muse-spark contributor tier cannot be examined at its cheapest setting
- **Status**: open
- **Trigger**: a Board request to examine or route a seat at `minimal` (asked 2026-09-03 for opencode-go/muse-spark-1.3-contributor), or a second provider whose cheapest reasoning tier is below `low`.
- **Effort**: L
- **Source**: v2.35.14 probe (`CHANGELOG.md`); opencode models.dev `reasoning_options` for the model
- **Pointer**: docs/backlog/autopilot-effort-vocabulary-has-no-minimal-the-muse-spark-contributor-tier-canno.md
- **Context**: `dispatch-hetero.sh` (`--effort` enum), `engine-scorecard.js` (`EFFORT_VALUES`), `src/engine/capability-evidence.js`, `schemas/review-loop-contract.schema.json`, `implementer-ladder.js` and the seat-hash partition all enumerate…

### `src/engine/local-deployment.js` carries its own transport rule (TLS outside loopback) — align with `resolve-endpoint.sh` before it gets a live caller
- **Status**: open
- **Trigger**: `dispatch-local-openai.js` / `probe-local-engine.js` gain a caller on a real rail, or a second transport-policy divergence between the two is reported.
- **Effort**: Fix
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)
- **Pointer**: docs/backlog/src-engine-local-deployment-js-carries-its-own-transport-rule-tls-outside-loopba.md
- **Context**: the named-endpoint resolver now owns the transport policy (loopback + disclosed `plaintext-private` for private-range IP literals).

### `dispatch-review` raw-log deviation 採信判準必要但不充分 —— 回音的 prompt 樣板可冒充 verdict
- **Status**: open
- **Trigger**: 下一次 depth-0 依 P5 判準（2026-07-31）以 raw-log deviation 採信一個 `no_verdict` 席次時；或為 `dispatch-review.sh` 加任何 verdict 解析路徑時。
- **Effort**: S
- **Source**: codepower `f65f29a7` qc panel 裁決 §4b；raw log `/tmp/dispatch-review-log-WPI98b`（sol）與 `-WO5A1B`（MiniMax）
- **Pointer**: docs/backlog/dispatch-review-raw-log-deviation-prompt-verdict.md
- **Context**: P5 立的採信條件是「verdict block 完整、nonce 匹配、block 閉合」。2026-08-08 codepower 的 qc panel 出現一個**同時滿足這三條、但內容是被回音的 prompt 樣板**的案例：`gpt-5.6-sol@codex`…

### Contract-first escalation and local-repair gates — P6D incident follow-up
- **Status**: open
- **Trigger**: An owner-approved corrective project is opened from the 2026-08-21 P6D incident record; before that project may claim completion, all three controls must have planted negative cases that demonstrate they can block (a) unjustified heavy…
- **Effort**: L
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md), including the quoted Fable 5 independent judgment.
- **Pointer**: docs/backlog/contract-first-escalation-and-local-repair-gates-p6d-incident-follow-up.md
- **Context**: A bounded six-file/three-command consumer task was routed through strict L5 Mission governance.

### `probe-runner-coverage` parallel-only flake — fork-pressure suspected, residue ruled out
- **Status**: open
- **Trigger**: next time it reds in a `--parallel` run (it passes standalone).
- **Effort**: Fix
- **Source**: fix/suite-residue-reaper QC round, depth-0 panel + foreman reproduction logs, 2026-08-28.
- **Pointer**: docs/backlog/probe-runner-coverage-parallel-only-flake-fork-pressure-suspected-residue-ruled.md
- **Context**: 2026-08-28 suite-reaper reproduction split the old diagnosis — the residue leak

### Suite reaper — symlinked-TMPDIR hosts fall back to rm -rf (git-worktree-remove path never engages)
- **Status**: open
- **Trigger**: first report of dangling `.git/worktrees` entries on a host with symlinked `/tmp`
- **Effort**: S
- **Source**: depth-0 qc panel 🔵, 2026-08-28.
- **Pointer**: docs/backlog/suite-reaper-symlinked-tmpdir-hosts-fall-back-to-rm-rf-git-worktree-remove-path.md
- **Context**: `_wt_is_registered_path` exact-string-compares realpath'd entry vs git's raw

### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Status**: open
- **Trigger**: 下一次動 `evals/impl-eval-*`/`runImplQualification` 時捎帶;或第三場正式施測之前(屆時 Stage-0 機械化與 live-rail smoke 應先落);或 reviewer 再報同類。
- **Effort**: M
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。
- **Pointer**: docs/backlog/implementer-suite-hardening-backlog-pre-merge-review-round-1-cut-list.md
- **Context**: v2.34.34 round-1 review 裁 CUT 的殘項(五個 MUST-FIX 已修:partial-corpus fail-open 雙層拒收、preflight prose-justification、dispatcher_called ETIMEDOUT 歸因、HELP、Stage-0 明文 operator-run):(1) **Stage-0 probe…

### agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)
- **Status**: open
- **Trigger**: 下一次要考 agy 家族 implementer 時（v2.35.13 起信封無效只是遙測遺失、狀態看 artifact，且 log 會留信封原文——重考就能同時拿到 row 與重現樣本）;或 agy 更新後 changelog/實測顯示…
- **Effort**: Fix
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。
- **Pointer**: docs/backlog/agy-output-envelope-invalid-on-create-a-new-file-responses-blocks-agy-implemente.md
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier…

### v2.34.37 first-pass review 的 cut list —— 六個「不是錯,但名字比保證大」的小項
- **Status**: open
- **Trigger**: 下一次動這六處任一 —— `hooks/tests/external-lifecycle-witness.test.sh` 的 `stop_bounded` 斷言、`hooks/tests/calendar-teeth-negative.test.sh` 的 `instant3`/`instant4`、`scripts/engine-qualify.js` 的 `wall_truncated`…
- **Effort**: S
- **Source**: 2026-08-23 v2.34.37 first-pass pre-merge review(autopilot:reviewer);run `fix-bundle-l4`。
- **Pointer**: docs/backlog/v2-34-37-first-pass-review-cut-list.md
- **Context**: v2.34.37 first-pass review(autopilot:reviewer,opus)判 Low risk、無 🔴 無 🟠,兩枚 MUST-FIX 皆為文件用語已當場修掉。剩下六項刻意不在該刀處理,逐條記下以免被吞:(1) `measureBoundedStop` 的死…

### `engine-qualify-impl.test.js` 單次無法重現的紅(1/24 solo,訊息未捕獲)
- **Status**: open
- **Trigger**: 下一次它在 full-suite / CI 或 solo 跑紅(歸因半件)。**保存半件已做(2026-08-23)**:`hooks/tests/run.sh` L1 現在把 `node --test` 全輸出 tee 進…
- **Effort**: S
- **Source**: 2026-08-23 v2.34.37 收尾實測(run `fix-bundle-l4`),foreman 直接觀察。
- **Pointer**: docs/backlog/engine-qualify-impl-test-js-1-24-solo.md
- **Context**: 2026-08-23 v2.34.37 收尾期間,`node --test scripts/engine-qualify-impl.test.js` 在約 24 次 solo 連跑中出現**一次** `pass 0 / fail 1`;當時的 harness 只 grep 摘要行、沒有保留 log,`AssertionError` 的 message…

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Status**: open
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Effort**: S
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。
- **Pointer**: docs/backlog/brain-seat-sittings-in-the-shipped-qualification-defaults-v2-artifact.md
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows.

### Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)
- **Status**: open
- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence…
- **Effort**: L
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026-08-21-p6d-corrective-gates/`(歸檔後)。
- **Pointer**: docs/backlog/durable-repair-lock-p6d-kr3.md
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum…

### Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）
- **Status**: open
- **Trigger**: 四層 redesign 的 Policy 層設計定案,且目標 skill 有 eval ON/OFF 證據（成績單前置）
- **Effort**: L
- **Source**: G2 review finding（MiniMax R8, 2026-08-16）;strategy thread 2026-08-16
- **Pointer**: docs/backlog/skill-contract-card-rewrites-under-g2-minimax-r8.md
- **Context**: 童子軍規則的漸近線——把重量級 skills（dev-flow、quality-pipeline 候選）改寫為 contract-card shape（trigger/inputs/decision-table/engine-pointers）。未評測前不得重寫。

### dev-flow card re-attempt — instrument repair first (V2-vacuous verdict 2026-08-18)
- **Status**: open
- **Trigger**: A new evidence campaign budget is approved AND the skill-onoff task set is repaired so ≥4 of 5 families are load-bearing (per the frozen V2 rule). Repair directions from the data: harder tasks where sonnet's base rate drops (F1/F5…
- **Effort**: M
- **Source**: dev-flow-contract-card P6 adjudication（2026-08-18）.
- **Pointer**: docs/backlog/dev-flow-card-re-attempt-instrument-repair-first-v2-vacuous-verdict-2026-08-18.md
- **Context**: The 499-line card draft is digest-frozen at `evals/skill-onoff/packs/dev-flow-card/` and was NON-INFERIOR on the only load-bearing family (F3 branch discipline: FULL 9/9, CARD 9/9, OFF 0/9 — total discrimination, perfectly preserved).

### Panel progress view — reviewer-cut cosmetic residuals (v2.34.31 round-1)
- **Status**: open
- **Trigger**: An operator incident actually caused by one of these: misread an exit-4 run because a never-dispatched seat shows `transport_exhausted`; `--panels` truncation at 10 hides a panel someone was looking for; `.tmp-<pid>` residue accumulates…
- **Effort**: S
- **Source**: autopilot:reviewer FIX-THEN-SHIP round-1, 2026-08-21;docs/projects/_archive/2026-08-21-panel-progress-view/
- **Pointer**: docs/backlog/panel-progress-view-reviewer-cut-cosmetic-residuals-v2-34-31-round-1.md
- **Context**: 2026-08-21 review 判 CUT/FOLLOW-UP 的殘項(行為今日驗證正確,純回歸保護/污染防護):(1) never-dispatched seat 標籤應為 `not_dispatched`(`dispatch-plan-review.js` settle 分支);(2) `--panels` 輸出加…

### Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED
- **Status**: open
- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by…
- **Effort**: S
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.
- **Pointer**: docs/backlog/arm-the-ordinary-strike-threshold-currently-shadow-only-dated-review-required.md
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`.

### Strike-decay deferrals — the five mechanisms the panel cut from the first instrument
- **Status**: open
- **Trigger**: Any of: (1) a detector is caught emitting strikes at an anomalous rate; (2) more than two seats trip in one short span and the cause turns out to be a gate bug, not the engines; (3) a re-exam is needed and nobody notices for a week; (4)…
- **Effort**: M
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.
- **Pointer**: docs/backlog/strike-decay-deferrals-the-five-mechanisms-the-panel-cut-from-the-first-instrume.md
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission.

### Capability-claim identity is coupled to its observation timestamp
- **Status**: open
- **Trigger**: When a receipt refresh is next needed, or before adding a fourth consumer to `platform-capability-claims.js`.
- **Effort**: M
- **Source**: 2026-08-18 capability-receipt expiry investigation.
- **Pointer**: docs/backlog/capability-claim-identity-is-coupled-to-its-observation-timestamp.md
- **Context**: `claim_id = sha256(claim body)` and the body includes `live_evidence.observed_at` + `freshness.expires_at`, while the required IDs are hardcoded constants in `dispatch-hetero.sh:1653-1654`, `dispatch-review.sh:169-170`,…

### dev-flow F4 ledger rule — re-measure before deciding (F6 leg RESOLVED 2026-08-18)
- **Status**: open
- **Trigger**: The skill-onoff instrument-repair campaign, at the point where its task fixtures are redesigned — F4 must be re-measured there, not decided from the existing data.
- **Effort**: S
- **Source**: dev-flow-contract-card primary block（`evidence/…/primary-sonnet-results.jsonl`）;P7 adjudication 2026-08-18.
- **Pointer**: docs/backlog/dev-flow-f4-ledger-rule-re-measure-before-deciding-f6-leg-resolved-2026-08-18.md
- **Context**: F4 (Fix step 6 ongoing-maintenance ledger row) measured 0/3 in the FULL arm, but n=3 and the fixture repo carried no `docs/` tree at all, so the model had to originate a directory rather than append a line — a materially different…

### Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check
- **Status**: open
- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights…
- **Pointer**: docs/backlog/outcome-shaped-quality-gate-enforcer-opt-in-replaces-the-rejected-invocation-che.md
- **Context**: P7 ruled out the obvious enforcer.

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Status**: open
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.
- **Pointer**: docs/backlog/scaffold-tier-effect-a-b-measurement-four-layer-d6-promised-row-repaired-2026-08.md
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred.

### Qualification CLI transport — runtime identity capture
- **Status**: open
- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Effort**: S
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.
- **Pointer**: docs/backlog/qualification-cli-transport-runtime-identity-capture.md
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo).

### Broker payload format token rename (unified_diff misnomer)
- **Status**: open
- **Trigger**: Next time the broker client protocol version bumps for any reason, or before onboarding a fourth non-diff payload family.
- **Effort**: S
- **Source**: VA suite plan v3 §6 (G1-F11 deferral); v2.34.17 pre-merge review.
- **Pointer**: docs/backlog/broker-payload-format-token-rename-unified-diff-misnomer.md
- **Context**: `qualification-case-broker.js` hardcodes `payload.format: unified_diff` in its sandbox client; brain round bundles (v2.34.14) and VA spec envelopes (v2.34.17) ship JSON content under that diff-named token (VA plan G1-F11; the reviewer…

### OpenCode `debug skill` truncation — restore portability check 16 to hard-fail
- **Status**: open
- **Trigger**: Upstream OpenCode fixes the corpus-volume-dependent `opencode debug skill` output truncation, or a supported OpenCode release changes the plugin/serve discovery surface again.
- **Effort**: Fix
- **Source**: 2026-07-17 OpenCode 1.17 migration run (v2.32.50); current `scripts/preflight-portability.sh` advisory wiring.
- **Pointer**: docs/backlog/opencode-debug-skill-truncation-restore-portability-check-16-to-hard-fail.md
- **Context**: `scripts/preflight-portability.sh` check 16 is intentionally advisory while OpenCode 1.17 can omit discovered skills from `debug skill` output.

### t14 long-horizon per-turn verification gate
- **Status**: open
- **Trigger**: The next experiment aimed at improving long-horizon constraint adherence, or before claiming that prompt re-injection solves t14-class drift.
- **Effort**: M
- **Source**: `docs/projects/_archive/2026-07-08-t14-reinject/report.md` § Follow-up.
- **Pointer**: docs/backlog/t14-long-horizon-per-turn-verification-gate.md
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift.

### Mission graph scheduler 與 portfolio optimization
- **Status**: open
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
- **Effort**: L
- **Source**: 2026-07-28 Mission Convergence Portfolio 34-phase runaway audit；`governance-correction.md`
- **Pointer**: docs/backlog/mission-graph-scheduler-portfolio-optimization.md
- **Context**: v2.34.0 只需要機械阻止 phase explosion：bounded deliverable count、DAG、parallel/batch/depth/gate budget 與 ready-node admission。Critical-path optimization、dynamic reorder、跨 repo portfolio、priority queue、進度…

### Mission authority store 與 cross-harness enforcement hardening
- **Status**: open
- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session…
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`
- **Pointer**: docs/backlog/mission-authority-store-cross-harness-enforcement-hardening.md
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider…

### Every gate needs a negative control — the caution needs a routine behind it
- **Status**: open
- **Trigger**: 下一次新增或修改任何「閘」（release gate、drift gate、anti-gaming scan、admission check、hook）時；或再抓到一個閘存在卻沒在擋東西。
- **Effort**: M
- **Source**: 2026-08-08 CI triage（11/273 → 1/273）三起獨立成因的共同模式；本檔另有三條各自的條目。
- **Pointer**: docs/backlog/every-gate-needs-a-negative-control-the-caution-needs-a-routine-behind-it.md
- **Context**: CLAUDE.md 已經寫著「腳本存在不是它在運作的證據」，但 2026-08-08 一天之內出現三次同一種形狀，全部通過既有 CI 而沒被發現——(1) managed dev-flow admission 對 bounded 非 Mission campaign…

### Test-integrity L0 cannot see an early `exit 0` spliced into a shell suite
- **Status**: open
- **Trigger**: 下一次有人想把這個閘升到 `block`,或再抓到一個 bash 套件「綠得太安靜」時。
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/test-integrity-l0-cannot-see-an-early-exit-0-spliced-into-a-shell-suite.md
- **Context**: v2.34.38 讓 `*.test.sh` 進入閘的視野,但三條 gaming vector 裡只有兩條半是機械可見的。

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Status**: open
- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/check-test-integrity-sh-warn-block-needs-an-accuracy-record-first.md
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行

### Engine and CLI have no session-mode fallback for bounded non-Mission campaigns
- **Status**: open
- **Trigger**: 要把 session-marker 紀律擴到非 Mission 的 managed campaign 時；或 threat model 升級為「同一 host 上未經 /l3–/l6 進入的呼叫端不得驅動 managed loop」。單純誠實使用者不觸發。
- **Effort**: M
- **Source**: 2026-08-08 v2.34.8 pre-push QC。兩個 family（MiniMax-M3、GLM-5.2）皆回 SHIP-AS-IS 且 findings=none，都沒抓到這條；MiniMax-M3…
- **Pointer**: docs/backlog/engine-and-cli-have-no-session-mode-fallback-for-bounded-non-mission-campaigns.md
- **Context**: 三條路徑對「contract 不帶 Mission projection」的處置不一致。`dispatch-hetero.sh:1710` 在 `CAMPAIGN_PROJECTION_BOUND != 1` 時仍跑 `check_session_mode_gate` +…

### Mission runtime retires superseded adoptions at closeout, not after the fact
- **Status**: open
- **Trigger**: 下一次 Mission 重試鏈再留下多個 COMPLETE adoption，或要動 `src/mission/runtime.js` 的收尾路徑時。
- **Effort**: M
- **Source**: 2026-08-07 v2.34.6 rollover ship；`docs/projects/_archive/2026-08-06-dispatch-residue-cleanup/README.md`。
- **Pointer**: docs/backlog/mission-runtime-retires-superseded-adoptions-at-closeout-not-after-the-fact.md
- **Context**: v2.34.6 的 `mission-terminal-reconcile.js rollover` 是**事後清理**——它能指名已整合的 adoption 並退役其餘，但根因沒動：runtime 只在 mission UNRESOLVED 時圍籬，COMPLETE…

### `next-touch-validation.test.sh` asserts against un-versioned local Mission state
- **Status**: open
- **Trigger**: 立刻——它在 CI 上**永遠**紅；或下次有人相信「本機全套綠」等於「CI 綠」時。
- **Effort**: M
- **Source**: 2026-08-08 CI triage（11/273 紅的最後一個，其餘十個已於 v2.34.8 修復）；2026-08-09 收尾。
- **Pointer**: docs/backlog/next-touch-validation-test-sh-asserts-against-un-versioned-local-mission-state.md
- **Context**: 該套件讀 `.git/autopilot/mission/next-touch-debt-retirement/successor-prepared.json` 並斷言 `validatePreparedReceipt(...).state === 'ACTIVE'`，另外還綁 `D8_PUBLICATION_SHA` 與…

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Status**: open
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Effort**: S
- **Source**: 2026-07-31 code/backlog audit。
- **Pointer**: docs/backlog/dispatch-branch-lifecycle-sha-256-check-ack-residual.md
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。

### context-budget T3 deny tier — calibration and obedience evidence
- **Status**: open
- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Effort**: M
- **Source**: context-budget follow-up audit。
- **Pointer**: docs/backlog/context-budget-t3-deny-tier-calibration-and-obedience-evidence.md
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Status**: open
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Effort**: S
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。
- **Pointer**: docs/backlog/skills-frontmatter-tier-b4-step-2-frontmatter.md
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Status**: open
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。
- **Pointer**: docs/backlog/certified-clean-evals-clean-diff-specificity-certified.md
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力…

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Status**: open
- **Trigger**: ALL remaining prerequisites are met (telemetry alone is NOT a trigger): (1) a **two-pass resolve** in `resolve-review-loop.sh` without breaking the single-shot JSON contract; (2) a **pre-impl planned-scope signal** for implementer…
- **Effort**: L
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.
- **Pointer**: docs/backlog/domain-aware-routing-consume-the-work-domain-telemetry-to-route-reviewer-impleme.md
- **Context**: `/l5` 現已把 resolved `reviewer_runner` 傳入 `dispatch-review.sh`，所以舊 prerequisite (1) 已完成；domain probe 仍只輸出 `work_domain`/`domain_source` telemetry，沒有 domain-conditioned roster 或 two-pass…

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Status**: open
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Effort**: L
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.
- **Pointer**: docs/backlog/l1-block-mode-override-re-enable-needs-a-real-isolation-boundary-cgroup-is-not-e.md
- **Context**: The override stays **DEFERRED**.

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Status**: open
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Effort**: S
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).
- **Pointer**: docs/backlog/qc-panel-refute-pass-graduate-from-shadow-to-gating-calibration-gated.md
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes).

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Status**: open
- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness…
- **Effort**: S
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).
- **Pointer**: docs/backlog/l5-hetero-parallel-width-fan-out-machinery-built-deliberately-unwired.md
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out.

### Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
- **Status**: open
- **Trigger**: next time a `/l4` / `/l5` foreman or a `quality-pipeline` / `qc-panel` sub-agent's context bloats from raw shell output (full `git diff`, full `pytest`/`vitest` runs, linter dumps) — i.e. a concrete in-the-wild "the leaf agent burned…
- **Effort**: S
- **Source**: 2026-06-23 `/next` follow-up — user-requested survey of headroom + rtk; two Explore-agent technical reports + same-session spike (rtk not installed, CC…
- **Pointer**: docs/backlog/leaf-level-output-compaction-for-dispatched-implementer-qc-shell-commands-rtk-st.md

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Status**: open
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Effort**: L
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。
- **Pointer**: docs/backlog/m3-band-fixtures-t15-t17-implementer-process-isolation.md
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09…

### First local runner capability semantics（availability/load，不是 quota）
- **Status**: open
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Effort**: S
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。
- **Pointer**: docs/backlog/first-local-runner-capability-semantics-availability-load-quota.md
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota…

### broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）
- **Status**: open
- **Trigger**: when a dispatched worker poisons a non-identity shared `.git/config` key
- **Effort**: L
- **Source**: 2026-07-17 U1b panel findings remediation on identity-containment port.
- **Pointer**: docs/backlog/broader-shared-config-containment-per-worktree-isolation-2026-07-17-follow-up.md
- **Context**: v2.32.51 identity rail contains ONLY `user.name`/`user.email` (local scope).

### Durable merge execution crash recovery
- **Status**: open
- **Trigger**: When a caller-owned durable merge receipt directory and recovery authority are standardized.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/durable-merge-execution-crash-recovery.md
- **Context**: A process crash after one ordered merge edge can lose the in-memory aggregate receipt; P3 intentionally omitted a WAL because its frozen contract supplied no storage-path authority.

### Bind dirty content continuity from preflight to execution
- **Status**: open
- **Trigger**: When merge preflight schema v2 is designed or a consumer requires cross-phase content-continuity proof.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/bind-dirty-content-continuity-from-preflight-to-execution.md
- **Context**: P3 detects content drift after execution starts, but cannot prove preserved bytes are unchanged since P2 issuance because the P2 receipt binds path categories rather than content/index digests.

### Controller helper API fail-closed hardening
- **Status**: open
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/controller-helper-api-fail-closed-hardening.md
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal…

### Boundary outcome and root dispatch semantics
- **Status**: open
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/boundary-outcome-and-root-dispatch-semantics.md
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.

### Portable byte and Work Order lifecycle hardening
- **Status**: open
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/portable-byte-and-work-order-lifecycle-hardening.md
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.

### Durable resume and review authority binding
- **Status**: open
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/durable-resume-and-review-authority-binding.md
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.

### Mission graph and campaign capacity boundary hardening
- **Status**: open
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/mission-graph-and-campaign-capacity-boundary-hardening.md
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.

### Orphan leaf liveness and resource reconstruction
- **Status**: open
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/orphan-leaf-liveness-and-resource-reconstruction.md
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.

### Terminal status and receipt trust boundary
- **Status**: open
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/terminal-status-and-receipt-trust-boundary.md
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller…

### Shared sealed zero-diff validator
- **Status**: open
- **Trigger**: 下次動 live-spend probe / capability 記錄 / engine preflight 時。
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/shared-sealed-zero-diff-validator.md
- **Context**: 2026-07-31 codepower P4 U2 實測：probe 用 codex CLI 預設模型（gpt-5.5）回 PROBE_OK，實際 dispatch 的 `gpt-5.3-codex-spark` 池已 rate_limited → dispatch 跑 342s 中斷、產物 broken-by-construction（registry…

### HETO task-return detection can miss completed work
- **Status**: open
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Effort**: S
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)
- **Pointer**: docs/backlog/heto-task-return-detection-can-miss-completed-work.md
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.

### No route for external field experience contributed INTO autopilot itself
- **Status**: open
- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
- **Effort**: S
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)
- **Pointer**: docs/backlog/no-route-for-external-field-experience-contributed-into-autopilot-itself.md
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Status**: open
- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
- **Effort**: M
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel
- **Pointer**: docs/backlog/peer-coordination-skill-ruled-in-blocked-on-a-spike-sweep.md
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has

### `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable
- **Status**: open
- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile,…
- **Effort**: L
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.
- **Pointer**: docs/backlog/hooks-tests-run-sh-is-red-on-develop-sealed-campaign-verify-cmd-is-unsatisfiable.md
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so every campaign fails acceptance. Host-red set at v2.36.71 (16/358, all pre-existing): `docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/full-run-summary.txt`.

### `hooks/tests/run.sh` TIMEOUT marker collides with a suite that self-exits 124/137
- **Status**: open
- **Trigger**: a suite observed to exit 124/137 on its own (e.g. propagating a child's SIGKILL) shows as `[TIMEOUT]` in the summary.
- **Effort**: M
- **Source**: rail-fix qc panel 2026-08-30 (GLM-5.2 🔵).
- **Pointer**: docs/backlog/hooks-tests-run-sh-timeout-marker-collides-with-a-suite-that-self-exits-124-137.md
- **Context**: `is_suite_timeout_ec` treats any 124/137 as the wrapper's timeout.

### `mission withdraw` cannot bind a `mission-subject-v2` claim to its ICC campaign — the intake journals no mission binding
- **Status**: open
- **Trigger**: any operator calling `mission withdraw --campaign-ledger <real ICC ledger>` on a claim minted by `grantMissionCampaign` (`identity_scheme: 'mission-subject-v2'`) whose campaign DID run; or the next time `campaign-intake.js`'s intake…
- **Effort**: S
- **Source**: U4 foreman 2026-08-31; cuda revival.3d QUIET-a 2026-09-06; v2.36.6 pre-merge review (opus) 🔴 C1.
- **Pointer**: docs/backlog/mission-withdraw-cannot-bind-a-mission-subject-v2-claim-to-its-icc-campaign-the.md
- **Context**: the claim id is `campaign-v2-<domain sha of the subject>` (`src/engine/mission-campaign-identity.js`); the ICC intake row is keyed `campaign-v1-<sha of repo, ticket, raw contract bytes>` (`src/engine/campaign-intake.js` ~1664) and…

### v2.35.5 qc-panel 🔵 follow-ups (managed-campaign rail debt, 2026-08-31)
- **Status**: open
- **Trigger**: next touch of the named files.
- **Effort**: S
- **Source**: v2.35.5 qc panels + foremen, 2026-08-31.
- **Pointer**: docs/backlog/v2-35-5-qc-panel-follow-ups-managed-campaign-rail-debt-2026-08-31.md
- **Context**: four Suggestion-tier items from the three-seat panels, all excluded from the ship with rationale: (1) whitespace re-indent churn in `src/campaign/cli.js` ~412-437/598 pollutes blame in the projection path — revert cosmetically; (2)…

### `peer-addressing.md` says message rows live forever; a spec says 7 days
- **Status**: open
- **Trigger**: hangar-bridge implements message-row retention. Today it has not — `packages/relay/src/purge.ts` deletes only `token` and `human` rows, `message` has no trigger or CASCADE, and a repo-wide search finds no `DELETE FROM message` — so…
- **Effort**: M
- **Source**: `autopilot:reviewer` round 4 on `0d3554e3`, 2026-09-01.
- **Pointer**: docs/backlog/peer-addressing-md-says-message-rows-live-forever-a-spec-says-7-days.md
- **Context**: `hangar-bridge/SUBJECT_ROUTING_SPEC.md:516,614` records an accepted 7-day retention/replay bound for subjected `@team` chat that was never built.

### context-budget falls back to inference after a long foreground tool call — live tick starves under the 120 s freshness cap
- **Status**: open
- **Trigger**: the next observed T2/T1 message without "(statusline)" on a host that has the live writer; or before shortening/lengthening `DEFAULT_MAX_AGE_MS`.
- **Effort**: S
- **Source**: v2.36.2 session live observation, 2026-09-05
- **Pointer**: docs/backlog/context-budget-falls-back-to-inference-after-a-long-foreground-tool-call-live-ti.md
- **Context**: observed 2026-09-05 in the v2.36.2 session: a 600 s foreground `hooks/tests/run.sh --parallel` was followed by a `context-budget` T2 at 155k with no "(statusline)" clause, while the live file 3 s later was fresh with…

### Stale `closed_findings` stamps on chain entries written by pre-v2.36.3 finalize have no repair path short of a new generation
- **Status**: open
- **Trigger**: a second field report of a receipt refused with "attributes … to generation N, which is aborted", or a request to re-finalize without re-collecting.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066 ledger, 2026-09-05
- **Pointer**: docs/backlog/stale-closed-findings-stamps-on-chain-entries-written-by-pre-v2-36-3-finalize-ha.md
- **Context**: v2.36.3 made `review-chain-derive` evidence-only (chain-entry `closed_findings` stamps are output, ignored as input) and the checker refuses a receipt whose `closed_findings` names an aborted generation.

### CEO/dev-flow guidance proportionality — peer request to soften "Boil the Lake" / near-zero completion cost, TaskCreate-missing semantics, reversible-candidate release gates
- **Status**: open
- **Trigger**: owner decides to open this; AND eval ON/OFF evidence exists for the affected skills (scorecard-first rule — an unevidenced rewrite of ceo-agent/dev-flow prose is an unevidenced trust change).
- **Effort**: M
- **Source**: cuda revival.3d peer message, 2026-09-06; ASTRA-SKILL-AUDIT report on cuda (/data/rw3d-evidence/2026-09-06/ASTRA-SKILL-AUDIT/report.md, not shared)
- **Pointer**: docs/backlog/ceo-dev-flow-guidance-proportionality-peer-request-to-soften-boil-the-lake-near.md

### CI runs only on version bumps — ordinary develop pushes never execute the suite, so regressions pile up unseen
- **Status**: open
- **Trigger**: owner decision on CI cost vs coverage, or the next time a release lands red for reasons older than that release
- **Effort**: S
- **Source**: 2026-09-23 PEACE-side CI repair (34 tests had rotted between releases; `.github/workflows/test.yml` path filter = `.claude-plugin/plugin.json` only)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: release-gating is deliberate (header comment). A cheap develop-triggered `dispatch-detach` smoke + `sync-all --check` would catch drift weeks earlier; the full suite can stay release-gated.

### `auto` consult seat silently overrides a DECLARED consult seat (same class as the fixed plan-chair "declared wins")
- **Status**: open
- **Trigger**: owner ruling on whether a declared `consult_engine` should win over topology/sonnet fallback under `consult_dispatch: auto`
- **Effort**: S
- **Source**: 2026-09-23 CI repair, review-loop cluster (5679a392 made consult default `auto`; resolve-review-loop-role-admission)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: plan chair was changed to declared-wins on 09-13; consult still follows the plan's Knob transition table. Tests were updated to current design, resolver untouched.

### Archive rewriter still rewrites UNSEALED frozen evidence (e.g. historical `observed_paths` in audits)
- **Status**: open
- **Trigger**: the next archive/migrate run of check-plan-graduation, or any new frozen-evidence file without a seal
- **Effort**: S
- **Source**: 2026-09-23 CI repair, mission cluster (6559da33 rewrote `candidate-path-audit.json` observed_paths; restored byte-identical)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: `frozenAssetFiles()` now covers `*.seal.json` targets, qualification-asset-seals PATHS and mission-sources plan/rubric; evidence frozen by convention only has no marker. Needs an explicit marker rather than a path heuristic.

### dispatch-author forwards three final-panel qc_panel admission warnings on every run (noise for the author role)
- **Status**: open
- **Trigger**: next edit to dispatch-author's resolver call or to resolve-review-loop's qc_panel notes
- **Effort**: S
- **Source**: 2026-09-23 CI repair, dispatch cluster (fa2a0c50 notes surface through dispatch-author stderr)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: product call whether author rails should suppress panel-intake notes; tests now read JSON from stdout only, so this is noise, not breakage.

### "park does not consume the finding-recurrence budget" is guaranteed only by code order — no test pins it
- **Status**: open
- **Trigger**: next edit to the pathless-finding repair path in autopilot-engine
- **Effort**: S
- **Source**: 2026-09-23 CI repair, dispatch cluster (620ef6ed fallback order: task_surface → round changed files → park)
- **Pointer**: docs/backlog/ci-repair-2026-09-23-followups.md
- **Context**: add a probe where both fallbacks are empty and assert the occurrence count is unchanged after park.
