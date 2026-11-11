# Baseline reds: skill-onoff-d0gate-cc and qualification-consult-discuss-transport (BL-0428)

Found during the stack4 merge (66fc4f426, 2026-11-11). On develop 2baff5f99, before that merge, both fail when run alone:

- `hooks/tests/skill-onoff-d0gate-cc.test.sh`: `FAIL: kept G4 evidence` (projects-files.json shape `[]`).
- `scripts/qualification-consult-discuss-transport.test.js`: "consult: end-to-end broker -> sandbox -> socket -> real provider.js succeeds" reports `actual failed`.

Root cause not investigated yet.
