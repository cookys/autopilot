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

Process pending maintenance items from `.claude/improvement-queue.json`.

### 1. Read Queue

```bash
cat .claude/improvement-queue.json 2>/dev/null
```

If file missing or no `status: "pending"` items, report clean and skip to Causal Chain.

### 2. Present Pending Items

```
N pending improvements:

1. [knowledge-oversize] architecture.md exceeds 300 lines (currently 306)
   -> Archive old entries or split file

2. [knowledge-stale] debug-patterns.md not verified in 45 days
   -> Review content, update last-verified date

approve <N> / reject <N> / skip all
```

### 3. Execute Approved Items

| Type | Action |
|------|--------|
| `knowledge-oversize` | Read file, identify archivable entries, move to `archive/` |
| `skill-oversize` | Suggest split plan (do not auto-execute) |
| `index-overflow` | Remove oldest entries until <=10 |
| `knowledge-stale` | Read file, verify each entry, update `last-verified` |
| `skill-gap` | Confirm skill is truly unused; if so, record reminder in knowledge |
| `repeated-error` | Analyze error pattern; if worth persisting, invoke `autopilot:learn` |

**Backlog bridging**: If an approved item is M-size or larger (not a quick fix), add it to `doc/BACKLOG.md`:
```markdown
### [Auto-detected] <title>
- **Source**: improvement-queue <type>
- **Trigger**: <when this needs attention>
- **Benefit**: <expected improvement>
```

### 4. Update Queue Status

Mark processed items as `done` or `rejected`:

```bash
node -e "
const f = process.argv[1];
const d = JSON.parse(require('fs').readFileSync(f));
d.items = d.items.map(i => i.id === 'TARGET_ID' ? {...i, status: 'done'} : i);
d.last_updated = new Date().toISOString();
require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
" .claude/improvement-queue.json
```

### 5. Efficiency Rules

- Spend at most **2 minutes** per invocation
- If >5 pending items, process only the top 5 by priority:
  `repeated-error > skill-gap > knowledge-stale > knowledge-oversize > index-overflow > skill-oversize`
- `skill-oversize`: suggest only, never auto-split

### 6. Categorize for Phase 1

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
