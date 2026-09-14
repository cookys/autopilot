# agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次要考 agy 家族 implementer 時（v2.35.13 起信封無效只是遙測遺失、狀態看 artifact，且 log 會留信封原文——重考就能同時拿到 row 與重現樣本）;或 agy 更新後 changelog/實測顯示 envelope 修復。
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier 降:medium 6/8+2 stall、high 6/8、pro 2/8);編輯既有檔的家族全過。六案 raw log 皆為 `agy native JSON envelope invalid — response and usage NOT parsed`——wrapper commit 已落(scored_sha 存在)但 agy 輸出信封壞損,rail fail-closed nonzero 路徑觸發。FAIL row(scorecard event 144)依凍結 taxonomy 常駐;修復後屬 fresh evaluation。修向在 agy 上游或 dispatch-hetero 的 agy envelope 解析側,先重現最小案例再動。
- **Effort**: Fix(重現+定位)/ 上游依賴。
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。

