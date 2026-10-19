# BL-0259 — engine-scorecard record accepts calendar-impossible dates

`validateRecordRow` in `engine-scorecard.js` accepts calendar-impossible dates such as `2026-02-30`. The local row stores the value rolled over (30 February becomes 2 March).

`bl194x` added `queueRowForOutbox` so the outbox copy keeps the original stamp. That preserves the caller's stamp on the way out. It does not stop the local row from storing a rolled-over date. It is a workaround, not a fix.

The right fix is to make `validateRecordRow` reject dates that do not exist on the calendar. After that rejection is in place, `queueRowForOutbox` can be deleted.

Origin: self. Surfaced by hetero-review bl194x g2 (`538aac4f` / `cf3d4745`).

Trigger: next change to engine-scorecard record validation, or the next scorecard row with an impossible date.
