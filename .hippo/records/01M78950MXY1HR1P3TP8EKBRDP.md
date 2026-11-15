---
id: 01M78950MXY1HR1P3TP8EKBRDP
kind: issue
created: 2026-10-27T00:00:00.000Z
---
- **Since**: 2026-10-27
- **Problem**: 推送前跑套件，旁檔裡較早的那批在 base 上本來就紅（非新引入），每次都要人工判讀。2026-11-13 點名的 12 支已單獨跑過：11 支轉綠；post-tool-chain-differential 在固定 flock 鎖不可寫時改為 SKIP（主機環境，鏈本身沒跑）。
- **Impact**: 真正的新紅會被淹沒，每次推送都得重新分辨。
- **Trigger**: next pre-push suite run, or a lane touches one of the listed suites
- **Source**: pre-push suite runs 2026-10-26 to 10-27 (noexpiry, agyargv2, fbland, fbv3)
- **Pointer**: project/backlog/base-red-suite-list.md
- **Context**: bash-launch-guard timing is BL-0305 and is not repeated here. The 2026-11-13 twelve are in the Pointer: eleven green alone, one host SKIP. BL-0428 is closed. 2026-11-16 vs base 761162e91: test-pipefail-grep-q still red.
