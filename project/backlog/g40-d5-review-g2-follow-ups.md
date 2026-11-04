# G40 D5 second-generation review: six follow-up suggestions (BL-0376)

Six findings (they collapse to four distinct problems; review finding ids in brackets), all Suggestion-level (blue) follow-ups from the G40 D5 review, generation 2. None blocks anything. Source for all: G40 D5 review g2 (2026-11-04). Each item: the problem in one sentence, then its impact.

1. Adapter failure code lost on the first attempt (`scripts/claude-account.js` around line 916, findings f5d07e4c, a1a56841). Problem: when the first attempt already has its own capture reason, the adapter's failure code is dropped. Impact: only a diagnostic is lost; no output or parity changes.
2. Adapter failure attributed to the wrong alias (`scripts/claude-account.js` around line 631; finding 091e20d5). Problem: an unpinned run syncs every enabled alias but folds all adapter failures into one code on the first attempt's audit line, even if that attempt ran a different alias. Impact: the audit line can name the wrong alias; pick and status notes still identify the right one.
3. Golden `--check` compares only a fixed projection (`scripts/lib/fixtures/gen-account-pick-g37-golden.js` around lines 235-237; findings 649ac32f, 286d8243). Problem: a new result-level field outside audit and runs would not be seen by check mode. Impact: drift check could miss a future field; the test path still compares audit and runs fully.
4. The `observations newest_age:` line is stripped from every status compare (`gen-account-pick-g37-golden.js` around line 54; finding f0c063e5). Problem: the line's value is never pinned, only its presence and count. Impact: a mirror row that changed the value would not be caught; the line is timing-dependent by design and the variance was accepted in D5.

Items 1 and 2 are the same code area; items 3 and 4 are the same fixture file.
