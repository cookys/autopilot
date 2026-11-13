---
id: 01M7894XKVC9GY0BXZPD5NRXR2
kind: issue
created: 2026-11-04T00:00:00.000Z
---
- **Since**: 2026-11-04
- **Problem**: mirror 鎖優先用 flock 指令，沒有時改用 perl；標準 macOS 沒有 flock 指令，perl 這條路徑沒在 macOS 上跑過。
- **Impact**: macOS 主機上若 perl 路徑壞掉，mirror 寫入會失敗並在 status 顯示 lock_helper，不會寫壞資料。
- **Trigger**: 3.0.0 之後；第一次在 macOS 主機跑 G40 mirror 時
- **Source**: BL-0374 結案時留下的後續（cd7f28002）
- **Pointer**: project/backlog/g40-mirror-oslock-macos-perl-unverified.md
