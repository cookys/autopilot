# live band follow-ups left by the bandyield round 2 review (BL-0355)

Source: bandyield round 2 four-vendor review and acceptance, 2026-10-31.

## 1. Narrow-width overflow
- BandBar in mods/live/band.tsx can draw a row wider than columns when bodyColumns is narrow, only a few columns (roughly 30-35 or fewer) wider than the tab row itself.
- Define the tab row behaviour at narrow width, for example collapse to a single button.
- Origin: g2 review s0 Suggestion fcfc378c.

## 2. Duplicate slot buttons
- The "status" and "review" tab bodies redraw the slot Button the band row already has (same key prefixes position/unit/review/spend/decisions), so Tab-key focus stops a few extra times.
- Origin: g2 review s0 Suggestion d01080fc.

## 3. Pending-count slot entry only at wide width
- The pending-count slot diamond is drawn only at 160 columns or more. On a narrower terminal the only way into the pending tab is the tab row.
- Consider showing it at narrower widths too.

## 4. Flaky R2 assertion under load
- hooks/tests/dispatch-hetero-gate-rules.test.sh: the gone_after assertion after the R2 TERM goes red occasionally when the machine is loaded (full suite running at the same time); green when run alone.
- Make the wait condition independent of a fixed time window (poll for the state, with a generous ceiling).
