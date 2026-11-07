# docsz6 backlog notes (BL-0420..BL-0423)

## BL-0420 TERM forwarding tests for the cc-shim and claude-native paths
- scripts/dispatch-review.sh:1932 (anchor `CCSHIM_RC=$?`) and scripts/dispatch-author.sh:1432 (anchor `dispatch-author-ccshimcwd`): the cc-shim relies on timeout only and does not forward TERM.
- scripts/dispatch-hetero.sh:3971 (account, anchor `--purpose hetero-impl`) and 3983 (legacy, anchor `seed-claude-config.js" --parent`): claude-native relies on the `abort_dispatch` trap (`trap abort_dispatch INT TERM`), which calls `reap_container`; a real TERM was never exercised.
- Plan: add SIGTERM-leftover tests of the same kind the account rails have; fix any leak they show.
- Source: seedclean g3 review 7b5a4738; PM fleet 01M6SZQ03P (2026-11-07).

## BL-0421 other seedclean g3 hardening
- Account-path trap restore should put back the previous trap, not reset it (adb8f4b0).
- A window exists between fork and the trap taking effect (de92deb9).
- The review account path lacks timeout -k (76f11d50).

## BL-0422 band "waiting for you N" in the top menu row
- The count is global, not per card, so it belongs in the top menu row. Precondition: it fits 80 columns without truncation.
- Source: codeforge fleet 01M6SZVASD (2026-11-07); for now it sits in the main window title.

## BL-0423 panel multi-card claim runs serially
- With several cards sent at once, claims run in order, each retrying up to about 30 s (AUTOPILOT_CLAIM_RETRIES x 10 s); a dead courier stalls the whole batch.
- Decide parallel vs shorter retry once panelclaim is wired onto $.process.
- Source: panelclaim hand report (2026-11-07).
