# Every gate needs a negative control — the caution needs a routine behind it

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次新增或修改任何「閘」（release gate、drift gate、anti-gaming scan、admission check、hook）時；或再抓到一個閘存在卻沒在擋東西。
- **Context**: CLAUDE.md 已經寫著「腳本存在不是它在運作的證據」，但 2026-08-08 一天之內出現三次同一種形狀，全部通過既有 CI 而沒被發現——(1) managed dev-flow admission 對 bounded 非 Mission campaign **永遠 deny**，沒有任何呼叫端或 fixture 能滿足；(2) `resolve-worktree-teardown` 的 template-tier 斷言被 repo 自身 dogfood 設定遮蔽，測的不是它宣稱在測的東西；(3) `check-test-integrity.sh` 對 263 個 shell 測試檔一個都沒看，回 exit 0。三者的共通點是 **exit 0 被當成「有在保護」**，而沒有人證明過它能變紅。警語擋不住這個，因為警語要人想起來才會啟動。可能的形狀：閘的測試必須含一個 negative control 案例（刻意違反 → 斷言變紅），並讓某個 meta-gate 檢查每個閘都有這樣一條；或讓閘在「零輸入匹配」時回非零而不是 0。先決定要哪一種，不要三種都做。
- **Progress**: 三個實例裡的 (3) 在 v2.34.38 補上了負控制——四條 gaming 動作各有 BEFORE/AFTER/BLOCK 記錄,並立成常駐迴歸(`hooks/tests/check-test-integrity.test.sh` §11),外加一條 coverage meta-test 把「閘看得到的檔案數」綁在 `git ls-files` 的真實清單上。**這條 row 本身不因此結案**:缺的是那個 meta-gate——沒有任何機制檢查「每個閘都有一條負控制」,(1) 與 (2) 也還沒有。v2.34.38 提供的是一個可抄的形狀,不是那個機制。
- **Effort**: M。
- **Source**: 2026-08-08 CI triage（11/273 → 1/273）三起獨立成因的共同模式；本檔另有三條各自的條目。

