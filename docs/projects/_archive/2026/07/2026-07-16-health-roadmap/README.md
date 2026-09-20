# health-roadmap — 健檢優先序 roadmap 執行（/l5 CEO 全權委任）

> Board 授權 2026-07-16：「讓 CEO 全委 /l5 go 到底」。接手同日三線健康檢查
> （架構／可維護性／基建）產出的優先序 roadmap，依序執行到底。

## OKR

**O**: 把健檢找到的結構性債（CI 安全網缺位、已漂移的複製債、儀式散落）收斂掉，
讓 repo 的品質儀式從「單機依賴 cookys 本機」變成「CI 為必經安全網」。

**KR（可驗證）**:
1. CI 對 develop 轉綠且成為 required status check；失敗時 log artifact 可下載。
2. `json_escape`（bash ×12+，換行語意已分裂三種）與 config-ladder/`read_field`
   收斂為 `scripts/lib/` 單一實作，全 call-site 遷移，行為由測試鎖定。
3. Node 四個 JSONL store（engine-scorecard／engine-capability-state／
   adjudicate-findings／tree.js）的 flock+PID-stale-breaker 收斂為共用 lib。
4. `sync-all`/`check-all` 單一入口存在，pre-commit／CI／preflight 引用同一份
   清單；`sync-opencode-plugin --check` 缺口補上。
5. 兩個孤兒測試（`ladder-run.test.sh`、`qc-metric-emit.test.js`）進 CI 掃描面。
6. 全程 142+ 測試綠、每階段 preflight-release 過、版本儀式照 PATCH 禮儀。

## Phases

| Phase | 內容 | 執行姿態 |
|-------|------|----------|
| P1 | CI 安全網完成：綠燈確認、required status check、failure artifact、孤兒測試接入 | depth-0（repo 設定＋小編輯） |
| P2 | bash lib 收斂：`scripts/lib/json-emit.sh` + `scripts/lib/resolve-config.sh`＋全 call-site 遷移＋lib 測試 | /l5 hetero implement-review |
| P3 | node lib 收斂：`scripts/lib/jsonl-store.js`＋四 store 遷移＋lib 測試 | /l5 hetero implement-review |
| P4 | sync-all/check-all manifest 收斂＋opencode gap＋CLAUDE.md inventory membership check | /l5 hetero implement-review |
| P5 | 測試時窗修復（dispatch-detach sleep 2、dispatch-status 8s 窗）＋run.sh 平行分桶＋npm fixture cache | /l5 hetero implement-review |
| P6 | Codex payload 脫離 committed-copy（release-time 生成）— 設計先過 think-tank，Board 可見 | 設計 gate 後另議 |

## 邊界（explicitly out of scope）

- HANDOFF 已決事項不重議：website deploy 維持手動；「No-Go Zones→紅線」改名不
  drive-by；endpoints 探針 `claude-3-haiku-20240307` id 不換。
- `run-ledger.sh` Node 化（2157 行遷移）＝ocean，BACKLOG，不在本輪。
- OpenCode 1.17 遷移收尾（preflight 15/16、16/16 兩紅）維持既有 BACKLOG 追蹤。
- macOS CI matrix、多 Node matrix：健檢判定過度工程，不做。

## 里程碑紀錄

- 2026-07-16: v2.32.40（`4cb7888`）reap self-kill guard＋workflow 三修
  （skip slash probe／timeout／concurrency）已 push，CI run 29493921810 等判決中。
  這是 P1 的前半。
- 2026-07-16: **P4 完成** — v2.32.45 `sync-manifest.json`（DATA）＋`sync-all.sh` 單一入口
  ＋`check-claude-md-inventory.js` membership gate；pre-commit／CI／preflight-portability 三
  consumer 全改 delegate（portability 5 sync check 保留為 5 個 `--only` 席次，17-count 不變）；
  補上 `sync-opencode-plugin --check`（原本 wired NOWHERE）。閘語意不變（plumbing consolidation）。
  /l5 foreman 直作＋MiniMax-M3 去相關審（FIX-THEN-SHIP 的兩「真 bug」經 artifact 反證為誤報，
  採 1 條 whitespace-trigger fail-loud 硬化）。sync-all.test.sh 22 斷言、全套件綠、preflight 15/17
  ＋release 8/8。depth-0 持權威 QC＋merge。
- 2026-07-17: **P5 完成**（無版本 bump，純測試/CI 基建）— 時窗修復（poll_until＋timing factor）、
  version-keyed 離線 npm cache（斷網證明）、run.sh `--parallel`（462s→72s，6.4×；serial 預設不變）。
  三單元全程 in-loop（grok×MiniMax 各 1 輪 SHIP-AS-IS——v2.32.46 endpoint wiring 首戰即通）。
  QC 留三個 Minor 追蹤：①workflow↔script 的 jest/vitest version-key 無 parity gate（可掛進
  sync-manifest）②npm cache 併發 mv 巢狀 cruft（`mv -T` 一旗修）③CI parallel 下 timing 斷言
  放寬 3×（已知取捨，記錄即可）。
