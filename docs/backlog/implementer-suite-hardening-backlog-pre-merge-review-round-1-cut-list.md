# Implementer suite hardening backlog (pre-merge review round-1 cut list)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次動 `evals/impl-eval-*`/`runImplQualification` 時捎帶;或第三場正式施測之前(屆時 Stage-0 機械化與 live-rail smoke 應先落);或 reviewer 再報同類。
- **Context**: v2.34.34 round-1 review 裁 CUT 的殘項(五個 MUST-FIX 已修:partial-corpus fail-open 雙層拒收、preflight prose-justification、dispatcher_called ETIMEDOUT 歸因、HELP、Stage-0 明文 operator-run):(1) **Stage-0 probe 機械化**(qualifier 內建 receipt writer + frozen-token literal containment + attempt cap 消費;現為 operator-run,程序在 engine-onboarding SKILL.md);(2) §7 未落 fixture 列:runner-config-editor、malicious-git-config(現為 neutralized-not-labeled——`repoHygieneViolations` 不掃 repo-local config)、replacement-ref、add-then-revert canary、dirty-worktree、question-staller、quota-phrase+exit1、parser/output-bomb、runner-crash;(3) §2 live-rail smoke(真 rail + `--runner-bin` deterministic engine + 兩紅控);(4) §6 consumer matrix (b)-(f)(凍結舊 validator 拒新 row 的負向、qualityOf T0 斷言、dispatch-contract/review-loop 分支、非 N/N 控制);(5) capability-evidence.test.sh 的 impl_dispatch 單元覆蓋;(6) TTL 30/31/90/91 邊界測試;(7) `--trials` 精確斷言;(8) cosmetics:`corpus_version` 重複字面(已凍進 event 143 rows)、dead `wrapDispatchBin`、no_verdict stub 上 stdout。
- **Effort**: M(合併一輪)。
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。

