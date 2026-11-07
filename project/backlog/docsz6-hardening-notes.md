# docsz6 backlog notes (BL-0421..BL-0423)

## BL-0421 other seedclean g3 hardening
- Account-path trap restore should put back the previous trap, not reset it (adb8f4b0).
- A window exists between fork and the trap taking effect (de92deb9).
- The review account path lacks timeout -k (76f11d50).

Added from the termtest g1 review:
- Put the trap before the fork, not after it, so no window is left (same finding as de92deb9, now with a concrete fix).
- Verify exit 137 with a stand-in that ignores the signal: the test must prove the -k kill fires, not only that TERM is forwarded.
- The review path's cc-shim launch (scripts/dispatch-review.sh, anchor `CCSHIM_RC=$?`) gets `timeout -k` like the other paths.

## BL-0422 band "waiting for you N" in the top menu row
- The count is global, not per card, so it belongs in the top menu row. Precondition: it fits 80 columns without truncation.
- Source: codeforge fleet 01M6SZVASD (2026-11-07); for now it sits in the main window title.

## BL-0423 panel multi-card claim runs serially
- With several cards sent at once, claims run in order, each retrying up to about 30 s (AUTOPILOT_CLAIM_RETRIES x 10 s); a dead courier stalls the whole batch.
- Decide parallel vs shorter retry once panelclaim is wired onto $.process.
- Source: panelclaim hand report (2026-11-07).
