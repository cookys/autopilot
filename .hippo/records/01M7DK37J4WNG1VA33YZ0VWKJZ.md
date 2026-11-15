---
id: 01M7DK37J4WNG1VA33YZ0VWKJZ
kind: issue
created: 2026-11-13T00:00:00.000Z
---
- **Since**: 2026-11-13
- **Problem**: 資格掃描的第零階段探測會把錯誤與輸出檔寫進正在被量的專案目錄裡，掃描於是把那次測量判成越界而作廢。修法是把輸出改寫到被量目錄之外。
- **Impact**: 掃描一跑就被判越界作廢，引擎資格測量全部白跑。
- **Trigger**: ready
- **Source**: autopilot lane 2026-11-13
- **Pointer**: none
- **Context**: Stage-0 probe writes .dispatch.err/.out inside the measured probe project dir; the first 2026-11-13 sweep was judged boundary_rejected for it. Fix: write outputs outside the measured dir.
