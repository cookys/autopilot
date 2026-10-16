# 五個模型 x 七個角色 考試矩陣 (2026-10-14)

規則：資格沒有期限；只考「沒考過」和「上次沒過」兩種格子。所有考試由 `scripts/engine-qualify.sh` / `engine-qualify.js` 施測，本 bundle 不寫入成績單，由協調者用 `record.sh` 登錄。

## 摘要

| 狀態 | 格子 |
|---|---|
| 現在開考（已啟動 runner） | MiniMax-M3 VA；MiniMax-M3.1 VA、implementer；Qwen3.8-Max VA；Kimi K3 VA、implementer（Kimi 需 OAuth 可用） |
| 已在跑 | minimax31 reviewer（out/minimax31）、kimi reviewer（out/kimi） |
| 暫緩（等 consult/discuss/brain 改成全題考完、新 checkout） | GLM consult/discuss/brain；MiniMax-M3 discuss/brain；MiniMax-M3.1 consult/discuss/brain；Qwen discuss/brain；Kimi discuss/brain。參數層已 dry-run 通過（`dry-all.sh`） |
| 不能考 | owner（全部五個模型） |
| 跳過（已過、或今天剛考） | 見下表 |

## 逐格

欄位：測不測 / transport 可行 / 配方來源 / 時間與題數 / 提早停止機制 / 不能考原因。

| 模型 | 角色 | 測不測 | transport | 配方來源 | 時間、題數 | 提早停止 | 備註 |
|---|---|---|---|---|---|---|---|
| GLM-5.3 | reviewer | 跳過（今天剛考，事件 240-242） | HTTP | cell.sh | 42 題 x 2 輪 | 無（僅首個死案例的 transport 中止） | |
| GLM-5.3 | VA | 跳過（已過） | | | | | |
| GLM-5.3 | implementer | 跳過（已過） | | | | | |
| GLM-5.3 | consult | 測（上次沒過，18/60） | HTTP（舊列是 cc-shim；本次走 HTTP，身分與舊列不同，需協調者知悉） | 2026-08-28-consult-discuss-qualify seat 腳本 + derive-matrix.js | 60 題，最多 3 輪，5-35 分 | 有：Tier-1、locked_fail、locked_qualify | 暫緩 |
| GLM-5.3 | discuss | 測（沒考過） | HTTP | 同上 | 48 題，5-12 分 | 有（同 consult） | 暫緩 |
| GLM-5.3 | brain | 測（沒考過） | HTTP（provider brain 模式） | 2026-09-21-flash-next-brain-qualify | 24 輪，10-20 分 | 有：判分器遇 malformed/forged 即停止評分 | 暫緩 |
| GLM-5.3 | owner | 不能考 | provider 無 owner 模式，`owner-provider.js` 未提交 | | | | 無考場 |
| MiniMax-M3 | reviewer | 跳過（今天剛考） | | | | | |
| MiniMax-M3 | VA | 測（上次沒過，7/24） | HTTP | cellx.sh + derive-matrix.js | 4-6 分 | 無（僅 transport 中止） | 現在開考 |
| MiniMax-M3 | consult | 跳過（已過） | | | | | |
| MiniMax-M3 | discuss / brain | 測（沒考過） | HTTP | 同 GLM | 5-12 / 10-20 分 | 有 | 暫緩 |
| MiniMax-M3 | implementer | 跳過（已過） | | | | | |
| MiniMax-M3 | owner | 不能考 | 同上 | | | | |
| MiniMax-M3.1-Flash-Preview | reviewer | 已在跑（沒考過） | HTTP，effort max，max_tokens 32768 | cell-m31.sh | 42 題 x 2 輪 | 無 | out/minimax31 |
| MiniMax-M3.1-Flash-Preview | VA | 測（沒考過） | HTTP | cellx.sh | 4-6 分 | 無 | 現在開考 |
| MiniMax-M3.1-Flash-Preview | implementer | 測（沒考過） | live rail，cc-shim + `--endpoint minimax` | qualification-sweep.sh --plan 的指令（不走其自動登錄） | 24 次派工，10-15 分 | 無（只有牆鐘截斷、engine_unavailable） | 現在開考，排最後 |
| MiniMax-M3.1-Flash-Preview | consult / discuss / brain | 測（沒考過） | HTTP | 同上 | 見上 | 有 | 暫緩 |
| MiniMax-M3.1-Flash-Preview | owner | 不能考 | | | | | |
| Qwen3.8-Max | reviewer | 跳過（今天剛考） | | | | | |
| Qwen3.8-Max | VA | 測（沒考過；只有 Preview 考過，正式版算不同模型） | CLI qoderclicn，tools 為空 | cellx.sh | 4-6 分 | 無 | 現在開考 |
| Qwen3.8-Max | consult / implementer | 跳過（已過） | | | | | |
| Qwen3.8-Max | discuss / brain | 測（沒考過） | CLI qoderclicn | 同上 | | 有 | 暫緩 |
| Qwen3.8-Max | owner | 不能考 | | | | | |
| Kimi K3 | reviewer | 已在跑（沒考過；上一次 auth 失敗未成績） | CLI kimi | cell-v2.sh | 42 題 x 2 輪 | 無 | out/kimi |
| Kimi K3 | VA | 測（沒考過） | CLI kimi（containment 面由 `kimi-containment.js`，provider 無 tool-deny） | cellx.sh | 4-6 分 | 無 | 排在 reviewer 之後；需 OAuth |
| Kimi K3 | implementer | 測（沒考過） | live rail，runner kimi | sweep --plan 指令 | 10-15 分 | 無 | 排最後；需 OAuth |
| Kimi K3 | consult | 跳過（已過） | | | | | |
| Kimi K3 | discuss / brain | 測（沒考過） | CLI kimi | | | 有 | 暫緩；需 OAuth |
| Kimi K3 | owner | 不能考 | | | | | |

## 風險

- Kimi OAuth：上次 `The provided authorization grant is invalid`（憑證 10-02 過期）。kimi runner 每格開考前先跑 `kimi-auth-probe.sh`，失敗則該格以 rc=3 結束、不計費、後面 Kimi 格子一併跳過；需主人重新登入。
- 同一 OAuth 不可並行：kimi runner 先等 out/kimi 的 `rc=`。minimax runner 先等 out/minimax31 的 `rc=`。
- Kimi K2.8 Preview：見文末追加段。
- 提早停止機制的行號（約 :3939、:4189-4350、:1850、:2372、:2683）未逐行逐一複核；協調者的調查結論為準。

## 追加：Kimi K2.8 Preview（owner 2026-10-14）

- 模型：CLI 設定裡 `kimi-code/kimi-for-coding` 的 display_name 是 "K2.8 Preview"（由真 `~/.kimi-code/config.toml` 暫存出的複本；CLI 清單為 kimi-for-coding=K2.8 Preview、kimi-for-coding-highspeed=K2.7 Code Highspeed、k3、k3-256k）。送進 CLI 的 id 原樣為 `kimi-code/kimi-for-coding`；這是浮動別名，日後顯示名可能換。身分欄 engine=`kimi-k2.8-preview`、model_version=`kimi-for-coding:K2.8-Preview`。
- 現在排：reviewer、verification_author、implementer（effort high，`run-kimi28.sh`，排在 K3 家之後；transport_fail 不算 verdict，改名 `-attemptN-transport` 重考，最多 3 次）。VA 走 qrp-lenient.js（壞 JSON 判不及格、不中止）。
- 待考（等考試工具修正合併後）：consult、discuss、brain（參數層已 dry-run，`dry-k28.sh`）。
- owner 不能考（同其他模型）。

## 2026-10-16 Kimi retake

Kimi K3 and K2.8 reviewer v6, discuss, brain; K2.8 consult. Events 304-310: reviewer, discuss, consult qualified; both brain
rows failed. Details and the credential-rotation incident: README.md "2026-10-16 Kimi retake".
