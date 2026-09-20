# Plan — Integration receipt records what was produced, what was accepted, and how

> Status: **R0 — DRAFT** (depth-0, 2026-09-12) · Deliverable node: `p1-integration-receipt-sha-ledger` ·
> Shared context and the two peer reports behind this work:
> [`2026-09-12-integration-ledger-and-marker-gates.md`](2026-09-12-integration-ledger-and-marker-gates.md)

## 1. Problem

The peer report says "neither receipt records which commit was accepted". Re-derived here, that is **too
strong**. `schemas/merge-execution-receipt.schema.json` `$defs.edgeReceipt` already requires
`source_validation.actual_sha` (what the lane produced) and `after_sha` / `merge_commit` (what is in the
tree). For a git-merge edge the pair already exists.

Three things are genuinely missing:

1. **`mode` is a two-value enum — `no-ff` / `ff-only`.** There is no vocabulary for the integration the
   peer actually performed (`git diff --binary <base>..<hands> | git apply --index`, then a fresh
   commit). The receipt does not merely lack a field: it **refuses the event**.
2. **No unit identity.** `source_ref` is a ref name — reused, renamed, deleted. It does not answer
   "which deliverable produced this".
3. **Coverage.** Only `src/merge/cli.js` writes this receipt. Integration by a foreman or by hand — how
   all six of the peer's lanes landed — produces no receipt at all.

Consequence, measured on their side: `merge-base --is-ancestor` against six hands-branch SHAs returned
six NOT-LANDED, and the conclusion "never merged" was committed. Each lane had a different, freshly
authored accepted commit, all ancestors of HEAD. The question was wrong and nothing in the record said
which question to ask.

## 2. Scope

`schemas/merge-execution-receipt.schema.json`, `src/merge/cli.js`, a new
`scripts/record-integration.js`, and a new `hooks/tests/integration-receipt-sha-ledger.test.sh`. Plus
the codex mirrors.

**`scripts/record-integration.js` is in scope and is the point.** Problem 3 above is that integration
performed outside the merge rail produces no receipt at all — which is how all six of the peer's lanes
landed. Adding enum members without a writer that can emit them would leave `apply+fresh-commit` a shape
**no producer produces**, so every downstream test of it would be a hand-authored fixture. That is the
same vacuity-in-the-input that let the D4 admission bypass ship green, and it would be built in
deliberately this time. The writer takes the source SHA, the accepted SHA, the method and the unit id,
re-derives what it can from git, and emits a schema-valid receipt.

**`mode` is not touched.** It is the merge *strategy input* — `src/merge/cli.js:665-667` turns it
straight into `git merge --no-ff` vs `--ff-only` — while `integration_method` is the *outcome*. Two
different axes; adding the second neither widens nor replaces the first, and no existing consumer of
`mode` changes. `mode` stays meaningful only for the `merge` / `ff` methods.

## 3. Out of scope

- The containment assertions that consume these fields (separate deliverable).
- Retrofitting receipts onto integrations already performed. The writer records new ones.
- Wiring `record-integration.js` into any hook or SOP by default. It ships callable and documented;
  switching it on is a separate decision with its own evidence.

## 4. Phase

Add to `$defs.edgeReceipt`, all required:

| Field | Meaning |
|---|---|
| `source_sha` | the commit the lane produced |
| `accepted_sha` | the commit actually in the integration target |
| `integration_method` | closed enum: `merge`, `ff`, `cherry-pick`, `rebase`, `squash`, `apply+fresh-commit` |
| `unit_id` | the deliverable/lane identity, independent of any ref name |

Neither SHA is derivable from the other — recording only `source_sha` makes every containment check read
NOT-LANDED (the peer's exact failure); recording only `accepted_sha` loses the lane's delta, which their
measurement showed is not zero (file counts went 8→9, 8→9, 9→10).

Populate in `src/merge/cli.js` from what it already has: `source_validation.actual_sha` → `source_sha`;
`merge_commit` when `mode === 'no-ff'` else `after_sha` → `accepted_sha`; `integration_method` `merge`
for `no-ff` and `ff` for `ff-only`.

## 5. Acceptance

Executable, with the expected output named:

```
node scripts/validate-json-schema.js --schema schemas/merge-execution-receipt.schema.json \
  --instance <fixture: integration_method "apply+fresh-commit">      # exit 0
node scripts/validate-json-schema.js --schema schemas/merge-execution-receipt.schema.json \
  --instance <fixture: integration_method "hand-wave">               # non-zero
node scripts/validate-json-schema.js --schema schemas/merge-execution-receipt.schema.json \
  --instance <fixture: source_sha omitted>                           # non-zero
bash hooks/tests/integration-receipt-sha-ledger.test.sh              # (1) a real merge through
                                                                      # src/merge/cli.js writes a
                                                                      # receipt whose source_sha and
                                                                      # accepted_sha DIFFER and whose
                                                                      # integration_method is "merge";
                                                                      # (2) a real apply+fresh-commit
                                                                      # in a sandbox, recorded by
                                                                      # scripts/record-integration.js,
                                                                      # validates against the schema and
                                                                      # its source_sha is NOT an
                                                                      # ancestor of the target
node scripts/check-js-syntax.js
node scripts/check-claude-md-inventory.js
bash scripts/sync-codex-plugin-skills.sh --check
```

The `source_sha !== accepted_sha` assertion is the one that matters: a writer that sets both from the
same variable would satisfy every schema check and reproduce the original defect.

## 6. Acceptance IDs

- `p1-receipt-records-source-accepted-and-method`
- `p1-method-enum-admits-apply-style`
- `p1-writer-emits-distinct-source-and-accepted`
- `p1-apply-style-receipt-comes-from-a-real-writer`
