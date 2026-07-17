# Handoff — 2026-07-17

Mid-work session-continuation scratchpad (untracked-by-convention; refreshed each session).

## 已完成 (recent)

- **Run A**（shipped）— L1 harness 韌性修（cache-key parity gate v2.32.49、CI go-detect timeout v2.32.48、case-6b GOTOOLCHAIN hardening）。
- **Run C**（shipped v2.32.50）— OpenCode 1.17 plugin 遷移（check 15 根治：prerelease `@opencode-ai/plugin/v2` subpath 不存在被 loader 靜默吞→改文件化 `{id, server}` shape）＋ preflight check 16 降級 advisory（上游 `opencode debug skill` 截斷）＋ `classify-error` 認得 grok 402 balance-exhausted 為 `quota_exhausted`。
- **C-Spike**（SPIKE-PASS 2026-07-17）— codex loader 端到端接受 install 時生成的 payload（marketplace add + plugin add → `installed/enabled:true`），sync 腳本零 git 依賴。

## 下一步 (next)

1. **7/23 roster 復位** — codex 池 7/23 重置後，把 `.claude/review-loop-config.md` 的 implementer 從斷糧期的暫代（grok/agy）復位回 `gpt-5.3-codex-spark`＋評估 gpt reviewer 席；grok 目前 402 balance-exhausted、codex quota-dead（見 memory `codex-quota-outage-roster-swap`）。
2. **C 遷移條件（Codex payload install-time generation）** — SPIKE 已過，遷移 L 尚缺三前置：(a) `codex exec` e2e 信心（blocked on quota until 7/23）、(b) `marketplace upgrade` live re-read 語意未測、(c) install-time hook 設計。三者到位才退役 committed mirror＋drift gates。
3. **「No-go zones」→「紅線」改名 task** — CEO 啟動 Q4 概念名仍分裂；frontmatter description 是 routing trigger，需搭配 slash-entry probe＋手測回歸，不可 drive-by（BACKLOG，routing-sensitive）。
4. **OpenCode 上游 issue** — 向 opencode 開 `debug skill` 輸出截斷 issue（check 16 回收 hard-fail 的前置）。
