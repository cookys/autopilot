---
name: memory-health
description: >
  Audit memory system health — check MEMORY.md size, knowledge file sizes, INDEX.md overflow,
  stale verification dates, and orphan files. Invoke when reviewing memory health or as periodic maintenance.
---

# Memory Health Check

Run structured health audit across all memory/knowledge files. Produce a status report with actionable remediation.

## Checks

### 1. MEMORY.md Line Count

```bash
# Find the project memory file
find ~/.claude/projects/ -name "MEMORY.md" -path "*/memory/*" 2>/dev/null | head -1 | xargs wc -l
```

| Status | Lines | Why it matters |
|--------|-------|----------------|
| OK | <=170 | Safe margin |
| WARNING | 171-199 | Nearing truncation — Claude stops reading at line 200 |
| CRITICAL | >=200 | **Content after line 200 is silently lost** |

**Remediation**: Move detail sections to `memory/` sub-files, keep MEMORY.md as an index with links.

### 2. Knowledge File Sizes

```bash
wc -l .claude/knowledge/*.md 2>/dev/null
```

| Status | Lines | Why it matters |
|--------|-------|----------------|
| OK | <=300 | Reasonable read cost when invoked |
| WARNING | 301-500 | Read consumes ~2-4K tokens — diminishing ROI per entry |
| CRITICAL | >500 | Too expensive to read in full — entries get skipped |

**Remediation**: Archive old entries to `knowledge/archive/`, or split into sub-topic files.

### 3. Verification Staleness

Read first line of each knowledge file for `<!-- last-verified: YYYY-MM-DD -->`.

| Status | Age | Why it matters |
|--------|-----|----------------|
| OK | <=30 days | Trusted |
| STALE | 31-60 days | May contain outdated patterns |
| CRITICAL | >60 days or missing | High risk of wrong advice |

**Remediation**: Read the file, confirm each entry still applies, update the `last-verified` date.

### 4. INDEX.md Recent Learning Count

Count rows in the "recent learning" table (excluding header/separator).

| Status | Count |
|--------|-------|
| OK | <=10 |
| OVERFLOW | >10 — rotation needed |

**Remediation**: Trim oldest entries or run rotation script if your project has one.

### 5. Orphan Files

List `.md` files in `.claude/knowledge/` not referenced in INDEX.md.

**Remediation**: Add to INDEX.md, or delete if obsolete.

## Output Format

```
Memory Health Report (YYYY-MM-DD)

| Status | Item                  | Value     | Threshold |
|--------|-----------------------|-----------|-----------|
| ...    | MEMORY.md             | N lines   | <=200     |
| ...    | (each knowledge file) | N lines   | <=300     |

Stale Verification:
| File | Last Verified | Days Ago | Status |

INDEX.md Recent Learning: N / 10 — STATUS

Orphan Files: (none) or list

Recommended Actions:
1. [CRITICAL] ...
2. [WARNING] ...
```

## See Also
- `autopilot:context-reduce` — token budget analysis (complements this health audit)
- `autopilot:learn` — produces knowledge entries; this skill audits them
