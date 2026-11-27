---
id: 01M8FDVY57DB3E3HSRVX9ZVTK4
kind: issue
created: 2026-11-27T21:16:33.319Z
---
- **Since**: 2026-11-27
- **Problem**: 多支套件改用 WORKER_MOUNT_FORCE_MODE=no_root，PM 席不再走 sudo_private_ns 正式路徑，只剩 worker-busy-sudo-wrapper 一支在守。
- **Impact**: sudo_private_ns 路徑的 env 清除與 commit-quiet 這類回歸，下次改 rail 時可能無測試察覺。
- **Trigger**: 任何改動 dispatch-hetero 的 run_worker 或 worker-containment 前
- **Source**: Fleet-Task 01M88GP63J9GTMXM23MNW5HSRK PM 席提醒
- **Pointer**: none
- **Context**: fix cd64de2f1 3fcfdf5cf dbc40854b a18358c2b
