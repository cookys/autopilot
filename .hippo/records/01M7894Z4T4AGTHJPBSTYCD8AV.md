---
id: 01M7894Z4T4AGTHJPBSTYCD8AV
kind: issue
created: 2026-06-11T00:00:00.000Z
---
- **Since**: 2026-06-11
- **Problem**: 安裝時若目的地是符號連結，會把來源檔案截成空檔。防護已出貨，向上游回報仍要擁有者同意才能送。
- **Impact**: 上游不知道這個會清掉檔案的行為，別人的安裝仍可能踩到。
- **Trigger**: Before the next agy plugin install of autopilot in the fleet, or the next hardening slot; owner must send the report
- **Source**: 2026-06-11 incident plus sandbox repro; restored 2026-10-19; dropped by 5d0b29c1d; audit docs/plans/evidence/2026-10-19-backlog-deletion-audit/
- **Pointer**: project/backlog/agy-install-symlinked-dest-upstream-report.md
- **Context**: Guard shipped in v2.15.1. The upstream report still needs the owner account and identity consent.
