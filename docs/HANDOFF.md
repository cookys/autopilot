## 目標

實作 `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md`（四代 hetero review 後凍結）的
P0 起全部階段。**P0/P1/P2 已出貨並推上 `origin/develop`**（`e2495ae4`，v2.36.25）。
**沒有進行到一半的工作。** 下一步是 D3。

## 已出貨

| 版本 | 交付項 | 內容 |
|---|---|---|
| v2.36.23 | P0 | supersession anchor manifest + `check-supersession-anchors.js`；被取代的 Board 裁決必須帶 dated 指標，plan 宣告不碰的區段用 sha256 釘住 |
| v2.36.24 | P1 | operator pin store：`jsonl-store.writeSnapshot` + `pin-seat`/`unpin-seat`/`pins`，八欄位列、`expires` 必為 null、`--operator` 必填、每 role 至多一列無墓碑 |
| v2.36.25 | P2 | `--resolve-live`：無寫入解析模式，回傳 preferred/effective tuple + `substitution_reason` + `pending_revocation` |

全套 334 支綠（綁分支的 worktree；detached worktree 會讓 `next-touch-validation` 假紅）。

## 下一步：D3 起

plan 的 §4 定義 P2b 起：契約准入（KR1/KR2/KR11）→ strike fold + pending_revocation（KR3/KR4/KR7）
→ 替代路徑（KR5/KR8/KR9/KR12）→ negation + guidance + release（P7/P8/P9）。

**一個 mission 一個 deliverable**：governance `max_graph_depth: 2`、aggregate `max_gate_attempts: 12`、
且**一個 plan id 只能對應一個 graph node**。plan 的九個階段是 provenance，不是 DAG——不要試圖一次塞進去。

## 這輪最重要的發現

**三家族 panel 的第三席，兩次都一個人翻盤。** D1 和 D2 各是：MiniMax SHIP-AS-IS、GLM SHIP-AS-IS、
`gpt-5.6-sol` FIX-THEN-SHIP ×3。而且兩次都抓到**一條不可能失敗的測試**：

- D1 test 8：`grep withWriteLock` 匹配到的是區段自己的**註解**，拿掉鎖照樣綠
- D2 case 7：`if ...; then ok; else ok; fi`，兩個分支都通過

**寫出不能紅的斷言是這類工作的預設產物**，不是誰粗心。所以 `min_panel_size: 3` 與紅證都不可省。
修法的演進：D1 是把 grep 換成行為斷言（逐條修）；D2 是**遞迴檔案系統快照**（掃整棵樹，任何變動具名失敗）
——列舉只能找到你想得到要列的東西。

## 陷阱（rail）

- **managed rail 跑得動實作，跑不動修補。** 兩條獨立 lineage 確認為確定性：第二次（修補）必定在
  `prepare_implementation` 以 `MUTATION_FAILURE_EVIDENCE_REQUIRED` 卡死，claim 兩條路都撤不掉
  （`withdraw --never-started` 因已啟動被拒；`mission control --abort` 要 CLI 給不了的認證轉接器）。
  **實務後果：只要 review 判出要修，該輪就不可能是純 L5。** 修補改派 Claude hands。
- **修補的 grant 必須在實作 merge 之後拿**——契約在 grant 當下釘死 `base_sha`。D1/D2 各撞一次。
- `--mission-prepared <receipt>` 是原子 state store 的開關；缺了就 `mission_state_store_required`。
- `--campaign-ledger` 必須是 canonical 的 `.git/autopilot/implementation-campaign.jsonl`。
- **blocked intake 有時釋放 claim 有時不釋放**（`mission_grant_ref_mismatch` 不釋放），錯誤訊息講的是
  「base 過期」不是「上次拒絕沒收尾」。
- 未追蹤檔也算 dirty，spend 前就擋。
- 圖一改 digest 就變 → legacy disposition 要重綁 → marker 要重設，三件連動。
- authority envelope 只收 `authority_status: "shadow"`；mission 綁定欄位是**推導**的，不得由呼叫端給。
- `l5` marker 清不掉（rail 從未寫出 task-status 需要的 input bundle）。**不要手寫那個檔案去滿足閘門**
  ——那是製造閘門要檢查的證據。marker 24 小時後自然過期。

## 陷阱（自己）

- **變異測試要挑對變異點。** 本輪三次挑錯：拿掉 `renameSync`（等於永不寫入，剛好滿足斷言）、
  把 `withWriteLock(opts,fn)` 的頭換掉尾巴沒換（程式壞掉、無關斷言紅）、字面 anchor 被新註解打斷。
  已寫成 `references/evidence-discipline.md` §32：**看哪一條斷言動了，不是套件動了沒**。
- `pkill -f` 在 Bash 工具裡會比對到自己的指令列，把自己殺掉（exit 144）。用 PID。
- detached worktree 會讓 `next-touch-validation` 假紅（`git symbolic-ref --short HEAD` 無頭必失敗）。
  驗證用 worktree 一律 `-b <branch>`。
- 管線會吞退出碼：`node ... | head` 回報的是 `head` 的狀態。判成敗要分開捕獲。

## 驗證方式

```bash
cd /home/cookys/projects/autopilot
git status --porcelain                                        # 空
node -p "require('./.claude-plugin/plugin.json').version"      # 2.36.25
bash hooks/tests/engine-capability-pin.test.sh | tail -1       # 9 passed, 0 failed
bash hooks/tests/resolve-live-tuple.test.sh | tail -1          # 15 passed, 0 failed（約 90s）
node scripts/check-supersession-anchors.js; echo $?            # 0
AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh | tail -1   # 8/8
```

## Read-order

1. `docs/plans/2026-09-11-operator-pin-supersedes-qualification.md` §4（階段）與 §8（已裁示）。
2. `references/evidence-discipline.md` §32。
3. `docs/BACKLOG.md` 的兩條 2026-09-11 列（pin store 硬化、campaign intake 缺陷）。
4. `docs/plans/evidence/2026-09-11-operator-pin-supersedes-qualification/`（四代 review 的裁決明細）。
