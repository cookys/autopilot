# Qualification provider: CLI error text and reviewer last-line rule

Source: review of 763f77de, 2026-10-14. Live behavior UNVERIFIED.

1. **Exit-0 error text graded as an answer.** Since 763f77de,
   `scripts/qualification-review-provider.js:1608-1610` passes any non-empty exit-0 reply through as raw
   text for the host parser. Only empty output (`:1376-1385`) and a non-zero exit (`:1361-1364`) still
   count as provider failure; nothing in the file matches `is_error`, `usage limit` or `quota`. If a CLI
   prints a quota or auth error and exits 0, consult/discuss grade it as `protocol_violation` (tier2) and
   can reach `locked_fail`, writing a false failed row and a strike.
   Fix direction: per-runner known-error patterns → transport failure. First confirm, per runner, what
   the CLI does on quota/auth failure.
2. **Reviewer last-line rule.** `parsePanelResult` (`:807-820`) takes the last parseable JSON object, so a
   broken prefix followed by `{"verdict":"pass","findings":[]}` grades as pass. This matches the parser's
   stated rule (not a false pass); decide whether it should instead count as a format violation, and
   document the rule either way.
