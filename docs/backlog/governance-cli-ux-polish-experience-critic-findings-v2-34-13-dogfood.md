# Governance CLI UX polish（experience-critic findings, v2.34.13 dogfood）

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次動五支治理腳本任一時捎帶;或 critic 再報同類。
- **Context**: KR5 dogfood(GLM-5.2 critic,post-merge)對五支治理 CLI 的三條產品缺口:(1) `next-pick parse` 輸出是裸 JSON array,沒有 `schema_version`/`artifact_type` envelope(R4 尺,其餘四支都有);(2) 拒絕訊息只講條件不給修法(例 veto 的「no decision 'nope'」沒說怎麼列出可否決清單);(3) usage error 只列 mode enum,無 flag 級範例(R2 尺)。另兩條 MUST-FIX 是對 dogfood 證據本身的(valid-flow 覆蓋 3/5、exit code 未錄),屬 evidence 品質非產品。critic 的 severity 標籤無阻擋力 —— 全部在此排隊。Raw log:`docs/plans/_archive/evidence/2026-08-17-autonomous-brain-integration/dogfood-critic-raw.log`。
- **Effort**: S。
- **Source**: v2.34.13 KR5 dogfood(2026-08-17);critic run bvxubvq39。

