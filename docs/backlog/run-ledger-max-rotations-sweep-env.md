# BL-0256 — RUN_LEDGER_MAX_ROTATIONS and the sweep environment

`src/engine/final-panel-seat-store.js` and `src/engine/work-order.js` read `process.env.RUN_LEDGER_MAX_ROTATIONS` (default 4).

Whether sweep-time environment values should influence ledger rotation is unclear. This needs an owner decision on intent before changing.

Left out of bluefix `d0d87b1c4`.
