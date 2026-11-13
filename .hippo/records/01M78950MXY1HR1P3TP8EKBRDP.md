---
id: 01M78950MXY1HR1P3TP8EKBRDP
kind: issue
created: 2026-10-27T00:00:00.000Z
---
- **Since**: 2026-10-27
- **Problem**: 推送前跑套件，有十幾支在 base 上本來就紅（非新引入），每次都要人工判讀；清單與各自的紅法見旁檔。
- **Impact**: 真正的新紅會被淹沒，每次推送都得重新分辨。
- **Trigger**: next pre-push suite run, or a lane touches one of the listed suites
- **Source**: pre-push suite runs 2026-10-26 to 10-27 (noexpiry, agyargv2, fbland, fbv3)
- **Pointer**: project/backlog/base-red-suite-list.md
- **Context**: bash-launch-guard timing is BL-0305 and is not repeated here.
