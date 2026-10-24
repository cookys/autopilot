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


## Status 2026-10-23

Merge 86274b421 (tintegrity) added precision rules (pure-add surface edits, same-topic replacement with a real assertion, if-! guard form). The tintegrity unit reported 83% false positive after it (v2 was 93.8%); mode stays warn until a re-replay is under 5% (BL-0060).

## Status 2026-10-24

Re-replay merged 7b84a5520 (docs/plans/evidence/2026-10-23-test-integrity-accuracy/): 91.7% false positives by record (11/12), 83.3% by group (5/6) over the v2 60 merges; supersedes the unrecorded 83% above. Mode stays warn. Three rules proposed there; a follow-up unit is implementing rules 1-2.

## Status 2026-10-24 (later)

Merge 1ce92330d (tirules) shipped rules 1-2: a closed equivalence rule (only =, == and -eq pair; literal changing side; verbatim subject; one-to-one pairs with identical indentation; exact bracket pairing) and the identifier-removal exemption. Precision costs are pinned as C1-C14. The 60-range replay reports the same 9 records. Left: rule 3 (substitution pairing) and a fresh re-replay that must show under 5% false positives before mode flips to block.
