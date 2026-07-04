# Plan — distill 情節模式（episodic mode）＋ 定期呼叫整合

> Status: ✅ Shipped in v2.31.18 — merged as `362f7d5` (2026-07-05, /l6)。
> Size: S–M（distill SKILL.md 擴一節 ＋ finish-flow/next 各一行整合；無新腳本、無新 skill → PATCH）。
> Source: 2026-07-04 首次 /distill 全量掃描的實驗結論 ＋ 同期五個手寫 skill 的情節式蒸餾實戰。

## 1. 問題（有實驗數據）

distill 現況只有**頻率模式**（n-gram 掃描史料）。2026-07-04 首跑證實兩個結構性盲區：

1. **單次深方法論不可見**：一個專案級的完整方法論（如教材製作七階段）只發生一次，
   頻率門檻（≥3×）永遠不會提案 —— 但它是最值得蒸餾的東西。
2. **複合命令儀式不可見**：同 session 跑了 ≥8 次的「rewrap→encrypt→push」發布儀式，
   因為每次都是一個大複合 Bash 命令，trigram 完全沒抓到（tokenizer 只取首 token；
   已另立 BACKLOG 條目修 scanner 召回率）。

同期的**情節式蒸餾**（剛活過 → 趁熱寫 skill）實戰產出五個 skill 並經 RED-phase 驗證，
證明這條路徑有效且與頻率模式互補：**頻率管跨週遺忘的長尾，情節管熱記憶的深流程**。

## 2. 提案：distill 雙模式（不加新 skill）

在 `skills/distill/SKILL.md` 增加「Episodic mode（情節模式）」一節。兩模式共用
Step 3–5（identifier lint、human gate、normalize-slug、write+commit-on-approve、
pack sync/consolidate）—— **只有 Step 1–2 的訊號源不同**：

### Episodic mode 的 Step 1–2（草稿，可直接改寫入 SKILL.md）

**觸發語**（併入 description）：「把剛做完的專案蒸餾成 skill」「趁熱把這套流程收下來」
「這個專案的方法論值得留」「distill this project/session」。

**Step 1E — 情節回溯（LLM 判斷，非掃描）**：對「剛完成的專案/長 session」回答四題：
1. 這次有沒有一個**可移轉**的完整流程（換個題目仍成立）？
2. 過程中哪些步驟**返工過**？（每次返工＝一條帶屍體背書的規則）
3. 哪些部分已經腳本化/模板化？（skill 三件套的承重層：**散文講判斷、
   檔案給模板/腳本、指標指成品** —— RED 實測「模板免疫、散文中彈」）
4. 這個流程未來由**誰**執行（自己/弱模型/其他 harness）？→ 決定檢核清單粒度
   （給弱模型必須枚舉到可機械自查 —— RED 第四定律：自評失真是檢核粒度的函數）。

**Step 2E — 提案（≤3 個，寧缺勿濫）**：每個候選附「來源事件」（哪一次返工/哪個
決策），不是頻率計數；無法舉出具體來源事件的候選不提。routing 同現行規則
（global → pack；project → 專案 .claude/skills）。

**Step 2E-quality（可選但建議）— RED 驗收**：對「要分享/給弱模型用」的產出跑一輪
RED（弱模型 headless 跑真任務 → 只驗屍產出物 → 枚舉式補丁）。方法論參照
（外部 reference，不進 autopilot）：使用者 pack 的 skill-red-testing。

## 3. 定期呼叫整合（兩個既有錨點，各一行）

| 錨點 | 變更 | 理由 |
|---|---|---|
| **finish-flow L-5.6**（learn 評估旁） | 評估題加一條：「本專案是否產生可移轉的方法論／被返工淬火的流程？是 → 建議跑 `distill`（episodic mode）」 | 情節模式的天然觸發點＝深專案收尾、記憶最熱時；與 learn 的分界：learn 記「教訓事實」，distill 產「可執行程序」 |
| **/next Phase 0 / B 級掃描** | 檢查 `~/.autopilot/distill/scan-state.json` 的 mtime，> 14 天 → Maintenance 區列「distill 頻率掃描逾期」建議 | 頻率模式的定期性不靠人記得；掃描本身增量、幾秒完成，建議成本趨近零 |

不建議 SessionStart hook / cron：頻率模式沒有即時性需求，掛在 /next 的節奏剛好；
情節模式必須跟著專案收尾走，cron 抓不到正確時點。

## 4. 驗收

1. `skills/distill/SKILL.md` 含 Episodic mode 一節（Step 1E/2E/2E-quality），
   description 增觸發語；`scripts/validate.sh` 綠。
2. `skills/finish-flow/SKILL.md` L-5.6 增評估題一條。
3. `skills/next/SKILL.md`（或 phase0-hygiene reference）增 scan-state 年齡檢查一行。
4. 版本：PATCH（改既有 skill 行為）；CHANGELOG 一句。
5. 情節模式產物仍走既有 Step 3–5 → lint/gate/commit-on-approve 行為不變（KR：零回歸）。

## 5. 明確不做（本 plan 範圍外）

- scanner 召回率修正（複合命令拆解、friction 過濾）→ 已是獨立 BACKLOG 條目。
- 把 skill-red-testing 搬進 autopilot → 它是使用者 pack 的產品；autopilot 只在
  2E-quality 提及方法論（另一條 BACKLOG「distill Step 4.5」談的就是這個引用）。
- 新增獨立 skill →雙模式共用管線，單一入口 routing 更乾淨。
