# Plan D — acceptance_failed reaches a journaled terminal disposition
1. RED: engine case with an injected acceptance_failed dispatcher → blocked at campaign_terminal_journal.
2. Root-cause the digest mismatch (appender vs reducer binding of the campaign_terminal reference); fix on the binding, not the evidence rule.
3. Reducer pin: correct digest accepted with repair_lineage; wrong digest still refused.
4. Sync mirrors; verify; one commit on the hands branch. Wall-expiry only if same path.
Acceptance: an acceptance-failed hand leaves MUTATION_FAILED journaled, lease released, summary JSON written.
