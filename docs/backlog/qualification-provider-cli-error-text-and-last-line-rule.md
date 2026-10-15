# Qualification provider: CLI error text and reviewer last-line rule

Source: review of 763f77de, 2026-10-14. Live behavior UNVERIFIED.

1. **Exit-0 error text graded as an answer.** Done: `cliQuotaAuthError()` in
   `scripts/qualification-review-provider.js` turns a short quota/auth banner with no JSON into a provider
   failure (infra_abort, no strike). Merge of `lane/q161`, 2026-10-15.
2. **Reviewer last-line rule.** `parsePanelResult` (`:807-820`) takes the last parseable JSON object, so a
   broken prefix followed by `{"verdict":"pass","findings":[]}` grades as pass. This matches the parser's
   stated rule (not a false pass); decide whether it should instead count as a format violation, and
   document the rule either way.
