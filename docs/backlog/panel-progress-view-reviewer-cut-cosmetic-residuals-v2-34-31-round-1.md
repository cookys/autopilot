# Panel progress view — reviewer-cut cosmetic residuals (v2.34.31 round-1)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: An operator incident actually caused by one of these: misread an exit-4 run because a never-dispatched seat shows `transport_exhausted`; `--panels` truncation at 10 hides a panel someone was looking for; `.tmp-<pid>` residue accumulates measurably in the runs dir; `--panel`(缺值)的 exit-2 訊息造成真實誤導。
- **Context**: 2026-08-21 review 判 CUT/FOLLOW-UP 的殘項(行為今日驗證正確,純回歸保護/污染防護):(1) never-dispatched seat 標籤應為 `not_dispatched`(`dispatch-plan-review.js` settle 分支);(2) `--panels` 輸出加 `total`/`truncated`;(3) panel lib flush catch 內 unlink tmp;(4) `--panel` 缺值時的用法訊息;(5) `--list` 的 panel 排除改以 `artifact_type` 判別而非檔名前綴(理論性:自產 run_id 不會撞 `panel-`)。全部單檔小改;證據與行號在 review 記錄(project archive)。另一獨立觀察(round-2):`preflight-release.sh` gate [3] 只比對版本字串,鏡像 **script 內容** 漂移不會被它抓 —— 測試套件是唯一 parity gate;若鏡像漂移再度逃到 develop,提升為獨立 Fix。
- **Effort**: S(單項)
- **Source**: autopilot:reviewer FIX-THEN-SHIP round-1, 2026-08-21;docs/projects/_archive/2026-08-21-panel-progress-view/

