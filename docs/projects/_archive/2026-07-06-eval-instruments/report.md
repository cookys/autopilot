# eval-instruments — 量測報告 (2026-07-06)

## 執行摘要

這一批(v2.32.3)交付兩件事:三組新的量測數字,以及支撐這些數字、且可重複執行的儀器(instruments)。目標不是再產出一次「100% 通過」式的儀式性結論,而是把 reviewer 資格認證、弱協調器(weak-orchestrator)行為、以及 acceptance-pattern prompt pack 的效果,換成可重跑、可驗證的量測。三組結果都誠實地收斂在「沒有可測得的提升」或「頂到量測上限(ceiling)」——這本身就是有用的訊號,取代了先前缺乏原始 artifact、無法重跑的舊基準。

同一批也修好 QC panel 在審查這批儀器時抓到的 4 個問題,其中一個是「dead instrument」等級的缺陷:t13 的 oracle 因為字串跳脫錯誤而永遠拋出 SyntaxError,導致所有候選(包括正確實作)全部判定失敗;更糟的是它斷言的數值全部可從候選可見的 `run-tests.sh` 反推,等於一個可被硬編碼答案繞過的假 oracle。兩個問題疊在一起意味著這個測項此前從未真正驗證過任何東西。已重寫並以三向探測(no-op 失敗 / 正確實作通過 / 硬編碼作弊失敗)驗證修復有效。

## 三組量測數字

### 1. Reviewer 資格認證(engine-qualify.sh,12 個 planted-defect diff)

| Engine | 通過率 | false_pass_on_critical | capability_score | 狀態 |
|---|---|---|---|---|
| gpt-5.5 (codex) | 12/12 | 0 | 1.0 | qualified(scorecard 記錄,到期 2026-10-03) |
| claude-sonnet-5 | 12/12 | 0 | — | qualified |
| claude-opus-4-8 | 12/12 | 0 | — | qualified |

三個 engine 在 `evals/known-bad/` 這 12 筆 diff 上全部零漏放,`--allow-unqualified-reviewer` 這個逃生門對 engine run 現在已經關閉——engine 執行路徑不再能繞過資格檢查。

**誠實限制**:known-bad 這個地板測不出 Sonnet 5 與 Opus 4.8 的排名差異——兩者在天花板打平。v2.32.0 那次「opus 換 headroom」的路由決策仍是判斷呼叫(judgment call),沒有被這次量測推翻也沒有被證實;sonnet 仍是合理的成本優先選項。這次量測取代的是被退休的那個儀式性「100%」數字,換成一個真正可重跑的儀器。

### 2. 弱協調器活動(flash / Gemini 3.5 Flash High via agy,t2-extract-verbatim,ON/OFF × 5)

| 指標 | ON | OFF | 判讀 |
|---|---|---|---|
| oracle_pass | 5/5 | 5/5 | 頂到天花板(ceiling) |
| patterns_named | 5/5 | 0/5 | pack 改變詞彙,符合預期 |
| adjudication_valid | 0/5 | 2/5 | pack 對協定遵從度沒有幫助,甚至反向 |

haiku 在同一個任務上量到的 +80pp 提升(見 campaign R1b),在 flash 這一層**不會轉移**——flash 本身已經不需要那份操作程序(recipe)就能正確完成任務,所以 ON/OFF 都是滿分。`adjudication_valid` 這一項再次重現 campaign R1 的核心發現:prompt pack 移動的是詞彙,不是協定遵從度。

**限制**:agy runner 目前沒有 arm 隔離(共用 `~/.gemini` 狀態),harness 已對此發出警告;MiniMax 路徑因為 endpoints 尚未設定,完全未測。

### 3. Acceptance-pattern 活動(haiku / claude-haiku-4-5,新任務 t10–t13,ON/OFF × 3)

| 任務 | 模式 | ON | OFF | 判讀 |
|---|---|---|---|---|
| t10 | A1 round-trip | 3/3 | 3/3 | 天花板 |
| t11 | A2 perturbation | 3/3 | 3/3 | 天花板 |
| t12 | A4 idempotency | 2/3 | 2/3 | 無差異 |
| t13 | A5 negative self-check(nonce-fixed oracle) | 2/3 | 2/3 | 無差異 |

在 haiku 這一層,A1/A2/A4/A5 四種 prose recipe **沒有量到任何提升**。這把先前「假設有提升」的說法,明確轉換成「未被證實有提升」。目前唯一一次真正量到提升的,是 A3 的操作程序類型(t2,campaign R1b 的 haiku 3/3 vs 0/3)。

**限制**:n=3/cell 偏小——這個量測規模能偵測到像 t2 那種巨大效應,但偵測不出中等程度的提升;不能反過來說「證明沒有提升」。

## 儀器清單(本分支新增)

由 Gemini 實作、gpt-5.5 xhigh review(附 `--spec-file` baseline)完成 G/H/I/J 四個單元:

- `evals/reviewer-bench/` — panel-cmd adapters(`panel-cmd-claude.sh` / `panel-cmd-dispatch.sh`),fail-closed no-verdict 附 stderr 警告。
- `evals/orchestration/tasks/t10`–`t13` — pattern discriminator 任務;oracle 自帶 fixture,經 qc grep 驗證零 pattern 詞彙污染。
- `scripts/error-path-scan.sh`(ADVISORY:swallowed_error / broadened_catch / error_path_untested)+ `scripts/secret-scan-diff.js`(BLOCKING,重用 `hooks/_shared/secret-patterns.js`)——兩者已接入 quality-pipeline 的 completeness gate 與 CLAUDE.md 腳本清單。
- Multi-turn eval 模式(`turns/` contract,`cc --resume`,stub;agy 明確 fail loud;單輪 `result.json` 保持 byte-identical)+ `t14-constraint-horizon`(5-turn 約束漂移任務)——補上「long-horizon 宣稱零實證」的儀器缺口;第一次真正的量測留待未來執行。

## QC panel 在本分支抓到的問題(均以實際 repro 驗證)

1. **gpt-5.5**:兩個新 gate 腳本缺 exec bit。
2. **gpt-5.5**:t14 oracle 缺少 `cd` 回 repo 根目錄的步驟。
3. **claude eval-integrity lens**:t13 oracle 是**死儀器**——f-string 裡的跳脫引號寫錯,任何候選(包含正確實作)都在載入時 SyntaxError,永遠判定失敗。
4. **claude eval-integrity lens**:t13 oracle 斷言的所有數值都能從候選端可見的 `run-tests.sh` 反推出來,等於一個可被「輸出硬編碼」繞過的假 oracle。

#3 與 #4 疊加意味著 t13 從被引入以來從未真正驗證過任何東西。修復方式:改用 env 餵入的 heredoc python + 每次執行獨立的 `ORACLE_NONCE`;以三向探測驗證——no-op 必須 FAIL、正確實作必須 PASS、硬編碼作弊必須 FAIL。

## 下一步

- **t14 首次量測**:5-turn constraint-drift 任務目前只有儀器,沒有任何真實跑過的數字——這是本批交付後最直接的空白。
- **MiniMax endpoints**:弱協調器量測裡缺的那一條路徑,需要先設定 endpoints 才能補測。
- **更難的任務測 flash 的提升空間**:flash 在 t2 上已經頂到天花板,若要量到 flash 這一層的提升,需要比 t2 更難、更能區分的任務。
