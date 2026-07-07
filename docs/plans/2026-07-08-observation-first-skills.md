# Observation-first skills — 驗證合約必答 + 密度去硬編碼 + 演化規則

> Status: DRAFT → 五家族 loop review 中
> Evidence base: `docs/projects/_archive/2026-07-06-eval-instruments/report.md`(匯率實驗、驗證錨定實測、逃逸懸崖、t14 n=35)

## 背景:量測已定案的五件事

| # | 發現 | 數字 |
|---|------|------|
| 1 | 散文不改變行為;操作程序與機械合約才會 | campaign R1/R2、t10-t13 零增益、t14 p=0.279 |
| 2 | 管線價值 = 模型與任務難度的落差 | haiku t2 0/3→3/3;M3 t13 3/3→2/3 @12× |
| 3 | 驗證是法官、審查是偵探(verify-first) | 救援保留 -36%、稅砍 4×、倒退消除 |
| 4 | 象限規則:模型強 或 驗證強,才可免審 | t2×medium 驗證 = 100% 逃逸 |
| 5 | 兩份真相必漂移 | reviewer_runner enum 雙站點(K7/K8) |

## 設計原則(本 plan 的憲法)

**強制只放在觀測層;干預層一律 evidence-triggered。**

| 層 | 例子 | 政策 |
|----|------|------|
| 觀測(事後看結果) | 跑 verify-cmd、記 ledger | 可以強制 — 實測對強模型成本 ~20s、零品質損傷 |
| 干預(改變模型怎麼工作) | 審查迴圈、修復輪、程序要求、提示包 | 預設關;只在「觀測到失敗」或象限判定(弱模型×弱驗證)時啟動 |

強模型的預設路徑因此是「裸跑 + 事後觀測」— 比現狀**更自由**,不是更受限。

## Scope(三項,全部是編輯不是重寫)

### A. dev-flow:驗證合約必答(觀測層強制)

Sizing(S/L/H/Fix 全尺寸)intake 增加一題:
> **「這個任務做完,跑什麼命令能客觀證明?」**

- 合法答案一:一條 shell 命令(測試/oracle/harness)→ 流進 `engine implement-review --verify-cmd` 與 pipeline 的驗證錨定路徑;象限「驗證強」列成立,qualified implementer 走 verify-first。
- 合法答案二:**「沒有客觀驗證」** — 誠實宣告,路由到象限「驗證弱」列:審查員常駐(resolver 既有行為),且此宣告記入 run summary。
- 禁止:逼生假驗證。有洞的考卷比沒有考卷更危險(逃逸懸崖:t2×medium = 100% 自信出貨壞品)。
- 與既有機制的關係:L-size plan 的 acceptance-criteria 條款(dev-flow:331)已要求驗證方法 — 本項把它(1)前移到 sizing、(2)覆蓋全尺寸、(3)接上引擎參數,不重複造輪子。

### B. 密度去硬編碼(四站點,改指向 resolver)

| 站點 | 現文 | 改為 |
|------|------|------|
| `skills/l4/SKILL.md:21` | 「≥3 adversarial reviewers」 | 「panel 規模與家族數由 `resolve-review-loop.sh` 依象限決定」 |
| `level-front-door.md:302` | 「fan-out of ≥3 adversarial QC reviewers」 | 同上(保留 lens 多樣性的要求,刪固定數字) |
| `level-front-door.md:314` | 「the ≥3 reviewers are Claude subagents」 | 隨 302 改寫 |
| `finish-flow/SKILL.md:60` | 「max 3 rounds」 | 「輪數上限 = resolver `loop_max_rounds`(密度縮放後)」 |

原則:skill 文字裡不出現審查數量的字面數字;數字只活在 resolver 與其 config。

### C. 演化規則入法(CLAUDE.md conventions,~10 行)

1. **童子軍規則**:任何原因觸碰 skill 時,順手向「合約卡」方向修剪(觸發/輸入/決策表/引擎指標;判斷散文移 references/)。north-star gate 逐版看守方向。
2. **成績單前置**:重寫或刪除任何 skill 前,必須先有 eval ON/OFF 兩臂證據(harness 已存在);無證據的重寫 = 無證據的信任,同罪。

## Non-goals(明確不做)

- ❌ 不動任何 `description:` frontmatter(路由面,MAJOR 風險)
- ❌ 不重寫方法論型 skill(debug/survey/think-tank…— 無失敗證據,不干預)
- ❌ 不做全面「每輪規則重注入」(只測過 haiku;tier-gated + 先量測,進 BACKLOG)
- ❌ 不把任何干預(迴圈/程序)變成強制

## 驗收

- A:dev-flow 修改處引用引擎參數名;S/Fix 路徑各有一行必答條款;「沒有客觀驗證」的路由語句存在
- B:`grep -rn "≥ ?3.*(reviewer|QC)" skills/`(排除 model-routing 生成副本)= 0;四站點全部指向 resolver 欄位名
- C:CLAUDE.md 有兩條規則;字數 ≤12 行
- 機械 gates 全綠(validate/invariants/payload/slash-probe);north-star prose 淨減或持平
- 本 plan 先過**五家族 loop review**(gpt-5.5 / MiniMax / GLM / grok / opus)收斂,才派實作

## 風險與緩解

- dev-flow 是入口協定(爆炸半徑高)+ 散文效果無 oracle(驗證弱)→ 依象限本 plan 即屬 review_risk=high,故五家族聯審,且實作後跑 slash-probe + 全套件
- 審查 churn(「永不說 ship」)→ 裁決規則:finding 必須含具體失敗情境才可觸發修改;純風格意見記錄不行動
