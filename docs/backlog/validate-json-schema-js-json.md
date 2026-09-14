# `validate-json-schema.js` 拒絕所有非整數數字 —— 任何帶小數的 JSON 文件都驗不了

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一個要 schema 驗證的 artifact 帶浮點數;或下一次動 `scripts/validate-json-schema.js` 的 `parseNumber`/`assertJsonValue`。
- **Context**: `parseNumber`(`validate-json-schema.js:161`)在 **schema 求值之前**的 document preflight 就把任何含 `.`/`e`/`E` 的數字字面量判為 `UNSUPPORTED_JSON_NUMBER`(exit 2),與 schema 內容無關;`assertJsonValue:71` 同樣要求 `Number.isSafeInteger`。這是刻意的 lossless round-trip 保守設計,但代價是**任何帶比例、分數、機率的 artifact 都無法被這支 validator 驗證**。v2.34.36 撞上:`references/official-qualification-defaults.json` 的 `capability_score` 是 `cases_passed/cases_total`(0.75、0.9166666666666666、0.9583333333333334、0.6666666666666666、0.9761904761904762 五筆,經機械掃描確認是整份 artifact 唯一的非整數)。當前作法是 `build-qualification-defaults.js` 把那些欄位正規化成 0 之後才送驗(schema 對該欄位只約束 number-or-null,披露區塊完全不受影響),並在 `references/qualification-defaults.md` 明寫這道限制 —— 不是修好,是**明說**。順帶發現:`schemas/hook-event.schema.json` 自己也不通過這支 validator(它用了不在 `SUPPORTED_KEYWORDS` 裡的 `description`)。
- **Effort**: S(接受有限精度浮點,或加一個明確的 `--allow-non-integer-numbers` 開關;要帶 planted negative 證明 lossless 保證沒被整體放掉)。
- **Source**: 2026-08-23 official-qualification-defaults 施工實測(run `official-defaults-l4`)。

