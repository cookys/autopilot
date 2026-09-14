# `check-test-integrity.sh` warn → block needs an accuracy record first

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
  提議把 `.claude/test-integrity-config.md` 的 `mode` 翻成 `block`。
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行
  刪除**記一條 `deleted_line`,而這個 repo 的日常測試維護(改 case 名、修 `assert_eq` 參數順序、收緊
  一個界)天天在刪行 —— block 會擋掉幾乎每個誠實的 commit,然後有人就會把它關掉,而那正是它當初瞎掉的
  路徑(`references/evidence-discipline.md` §1)。block 另外會把每個 `surface_touch` 升成 violation,而本
  repo 的測試本來就會正當地改 `hooks/tests/lib.sh` 與 fixtures。要升 block,先要有記錄:實際 range 上
  violation 的真陽性/假陽性比例,以及 `.qc/<sha>.verdict.json` waiver 路徑在真實工作流下的成本。**沒有
  那份記錄之前不要翻**,翻了就是把一個會報告的閘換成一個會被關掉的閘。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

