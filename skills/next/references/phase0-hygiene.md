# Phase 0: Hygiene (Silent Processing)

Process accumulated digests and improvement-queue items without user interaction.

## Digests

```bash
ls .claude/session-digests/*.json 2>/dev/null | head -5
```

For each digest with `"processed": false`:

| Judgment | Action |
|----------|--------|
| Already in knowledge | Mark processed, skip |
| Noise (sandbox/Edit mismatch/one-off error) | Mark processed, skip |
| High-value (non-obvious error-recovery/user-correction) | Invoke `learn` to record; show in [Knowledge] section |
| Uncertain | List in [Maintenance] section for user decision |

**Cap**: Process at most 5 unprocessed digests. Mark the rest as processed.

## Improvement Queue

```bash
cat .claude/improvement-queue.json 2>/dev/null
```

- S-size items → include in recommendation candidates
- L-size items → list on dashboard only

## Causal Chain Prediction (B/C level only)

Check `.claude/knowledge/evolution.md`:

```
If recently completed project matches a causal chain's "precursor":
  Show: Evolution Prediction
    Historical pattern: <completed> → <predicted next>
    Suggestion: Consider whether <predicted next> is needed
```

Advisory only — do not auto-create plans or projects.
