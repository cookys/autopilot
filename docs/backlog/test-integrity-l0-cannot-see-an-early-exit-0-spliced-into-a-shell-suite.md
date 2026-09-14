# Test-integrity L0 cannot see an early `exit 0` spliced into a shell suite

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: 下一次有人想把這個閘升到 `block`,或再抓到一個 bash 套件「綠得太安靜」時。
- **Context**: v2.34.38 讓 `*.test.sh` 進入閘的視野,但三條 gaming vector 裡只有兩條半是機械可見的。
  刪除與弱化走語言無關的 `deleted_line`;新增 skip 走新的 `shell` skip 規則;**塞在套件中段的
  `exit 0` / `return 0` 抓不到**——它沒有刪任何一行、沒有任何 skip token,而 line-level regex 分不出
  它和本 repo 既有的正當 bail-out:260 個 `*.test.sh` 裡 **19 個**有 top-level `exit 0`、41 個有
  任意縮排的、只有 2 個是放在最後一行,也就是說多數是 guard clause——正是 gaming early-exit 的形狀。
  要分開需要 L0 沒有攜帶的檔案位置資訊
  (「這個 exit 後面還有沒有斷言」),那是 AST/位置層的工作,不是加一條 regex。真要補,候選形狀是:
  比較 base/head 兩側的**斷言計數**(`assert_*` / `PASS [` 出現次數只增不減),那是檔案層而不是行層的
  不變量,也順帶涵蓋刪除與弱化。這條缺口目前在三個地方各寫一次(設定檔註解、引擎註解、本條),並被
  `check-test-integrity.test.sh` §11e 一條**會在缺口被補上時轉紅**的斷言釘住——修好它記得同步這三處。
  **注意這條缺口是目前唯一一條**:first-pass review 抓到的另外兩條(`${#…}` 截斷、line-start
  錨點漏掉 `&& skip` 與裸 `skip`)都比這條便宜,已在 v2.34.38 內修掉並各配常駐負控制。
  另有一個**已記錄的假陽性類別**:把 skip 寫進 fixture 的套件(例如
  `check-test-integrity.test.sh` §11c-bis 自己的 `sed` payload)逐字等同於自己 skip 的套件,
  行層偵測器分不出資料與程式碼;`warn` 下無成本,但翻 block 會擋住對該測試檔的編輯。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

