---
id: 01M7894XVJ3NN91KZECRJK6SWM
kind: issue
created: 2026-11-01T00:00:00.000Z
---
- **Since**: 2026-11-01
- **Problem**: 封存基準的改寫檢查對每筆清單條目都重掃全部約四千六百筆，一次檢查要算約兩千一百萬次路徑對應；結果正確但很慢。
- **Impact**: 搬檔階段每次跑檢查都要等很久。
- **Trigger**: P1 file-move lane uses check-rewrite and finds it slow
- **Source**: sealbase review, 6b31d2a67, 2026-11-01
- **Pointer**: project/backlog/seal-baseline-filledbymove-slow.md
