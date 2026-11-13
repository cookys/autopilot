---
id: 01M78950XETB0YEARC5RD0BGRF
kind: issue
created: 2026-10-29T00:00:00.000Z
---
- **Since**: 2026-10-29
- **Problem**: 選出幾百支套件時，看不出是哪個改動檔把它們拉進來的，也就不知道該先處理哪個。
- **Impact**: 每次都要手動逐檔試跑才能找出灌水來源，這次調研就花了大量時間。
- **Trigger**: 3.0.0 之後；work can start now
- **Source**: owner request 2026-10-29 (suite speed research)
- **Pointer**: project/backlog/pre-push-suite-speed.md
- **Context**: Contribution report: add per-file contrib to --json. Negative control: single-suite diff reports exactly 1 sole-pulled. After BL-0332.
