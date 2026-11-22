---
id: 01M81D5455Q8ZT9BN7ZHXQVTM8
kind: issue
created: 2026-11-22T10:34:43.749Z
---
- **Since**: 2026-11-22
- **Problem**: bash-footgun-guard 對 $(command ls …) 內的 ls 也誤報，且建議改寫成 command command ls；應放行顯式 command ls 並給正確改寫。autopilot 席 2026-11-22。
- **Impact**: 守門誤報打斷正常操作
- **Trigger**: 下次在 Bash 工具用 $(command ls …) 時
- **Source**: self 2026-11-22
- **Pointer**: none
