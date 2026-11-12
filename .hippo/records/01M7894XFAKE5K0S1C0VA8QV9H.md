---
id: 01M7894XFAKE5K0S1C0VA8QV9H
kind: issue
created: 2026-11-07T00:00:00.000Z
---
- **Since**: 2026-11-07
- **Problem**: 一次送多張卡時，認領是一張接一張，每張最多重試約 30 秒；courier 掛掉時整批會卡很久。
- **Impact**: courier 故障時操作員要等好幾分鐘才看到結果。
- **Trigger**: panelclaim is wired onto $.process
- **Source**: panelclaim hand report (2026-11-07)
- **Pointer**: project/backlog/docsz6-hardening-notes.md
