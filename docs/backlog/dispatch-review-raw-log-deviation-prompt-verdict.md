# `dispatch-review` raw-log deviation 採信判準必要但不充分 —— 回音的 prompt 樣板可冒充 verdict

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次 depth-0 依 P5 判準（2026-07-31）以 raw-log deviation 採信一個 `no_verdict` 席次時；或為 `dispatch-review.sh` 加任何 verdict 解析路徑時。
- **Context**: P5 立的採信條件是「verdict block 完整、nonce 匹配、block 閉合」。2026-08-08 codepower 的 qc panel 出現一個**同時滿足這三條、但內容是被回音的 prompt 樣板**的案例：`gpt-5.6-sol@codex` 在額度耗盡前只吐出 `VERDICT: SHIP-AS-IS or FIX-THEN-SHIP` / `FINDINGS: one finding per line, or the single word none` —— 那是提示裡的格式說明，不是答案；nonce 之所以兩端匹配，是因為 nonce 本來就寫在 prompt 裡。259 bytes、閉合、匹配，depth-0 差一步就把空回讀成 SHIP。三條判準無法區分「模型回答了」與「模型把題目抄回來了」。**建議補第四條：block 內容必須與 prompt 樣板實質不同**（例如樣板行的字面比對、或要求 FINDINGS 之外至少一個非樣板 token）。同一 run 另有一個相鄰案例可作對照：`MiniMax-M3` 的 block 內容是真的（4 條具體 MUST-FIX），只因多印一行未填的 `NO-FINDING-PROOF:` 樣板而被 parser 判 `no_verdict` —— **一個該擋沒擋、一個不該擋卻擋了**，兩者都指向「以樣板殘留為訊號」這個維度尚未被建模。
- **Effort**: S
- **Source**: codepower `f65f29a7` qc panel 裁決 §4b；raw log `/tmp/dispatch-review-log-WPI98b`（sol）與 `-WO5A1B`（MiniMax）
