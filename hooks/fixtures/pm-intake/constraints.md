# Operator constraints

What the operator has said about HOW things are done. PM-owned. Written by `scripts/ledger.sh`
(`--constraint "<scope>::<forbid regex>::<requirement>"`), never by hand except backfill.
Read by `scripts/pm-intake --constraints` (hook C): a plan that matches a scope and hits a forbid regex is blocked;
to release it the go must carry `override:<constraint sha>:<operator answer id>` (plan 2026-11-21-project-full-picture, 7.3-7.4).
Host names in quotes are replaced by roles (no host facts in pm commits).

## Scope vocabulary

A plan's scope is the set of tags whose keywords appear in its text (case-insensitive substring).
Keywords are separated by commas.

| scope | keywords |
|---|---|
| migration | migrate, migration, 搬遷, 遷移, 搬家, 搬到, 整機, vzdump, cutover |
| ui | pane, tui, ui, 介面, 畫面, 互動, screenshot, 截圖, 裝置 ui |
| gpu-slot | gpu, slot, bench, 顯卡, 算力 |
| credentials | credential, token, login, 憑證, 金鑰, 登入, scope, key rotation |
| rollout | rollout, deploy, release, 上線, 部署, 發佈, 推出 |
| review | review, 審查, hetero, 凍結, 核准, approve |

## Entries

### C-16c69c54-f2 migration
- ledger: 16c69c54
- scope: migration
- quote: 搬遷用目錄打包，不整機複製（operator's earlier statement; the operator line is not in the go-ledger, backfilled from plan 2026-11-21-project-full-picture section 1 F2 at 16c69c54; the openclaw migration v2 used a whole-VM dump and froze the hub for 4 hours, 11-20 to 11-21）
- forbid: `vzdump|整機備份|whole-VM|snapshot 串流`
- requires: 搬遷用目錄打包，不整機複製

