---
name: learn
description: >
  Save a hard-won lesson or surprising fix so future sessions benefit. Use when: "save this to
  knowledge", "record this", "remember for next time", "/learn", user shares a gotcha or non-obvious
  fix, solution took 2+ attempts, environment-specific workaround discovered. Also handles:
  "knowledge health audit", "check MEMORY.md size", stale knowledge cleanup. Not for: active
  debugging, writing tests, or project status updates.
---

# learn

Record reusable knowledge so future sessions avoid the same mistakes.

## When to Record

| Trigger | Category |
|---------|----------|
| Bash command failed on path/config, then fixed | `env` |
| Compile error took 2+ retries to fix | `build` |
| Searched 3+ times to find a file/class | `env` |
| API usage was wrong, then corrected | `api` |
| Architecture decision required iteration | `arch` |

## Flow

1. **Dedup check** — search existing knowledge before writing:
   ```bash
   grep -ri "<keyword>" .claude/knowledge/*.md
   ```
   - Already recorded and complete: skip
   - Recorded but incomplete: update existing entry (Edit)
   - Not found: add new entry

2. **Read** the target knowledge file (by category):
   - `build-errors.md` | `debug-patterns.md` | `architecture.md` | `environment.md`

3. **Append** entry using this template:
   ```markdown
   ## [Title]
   **Date**: YYYY-MM-DD | **Context**: what you were doing
   **Problem**: what went wrong
   **Solution**: what fixed it
   ```
   Add `**Failed attempts**:` and `**Related**:` lines only when they add value.

4. **Update INDEX.md** "recent learning" table

5. **Rotate** — keep recent list at 10 entries max:
   ```bash
   # If your project has a rotate script:
   node .claude/scripts/learn-rotate.js
   # Otherwise: manually trim the oldest entries
   ```

## Categories

| Category | File | Content |
|----------|------|---------|
| `build` | `build-errors.md` | Compile/link/CMake errors |
| `debug` | `debug-patterns.md` | Debugging techniques, crash patterns |
| `arch` | `architecture.md` | Design decisions, pitfalls |
| `env` | `environment.md` | Paths, Docker, config |
| `api` | (in relevant file) | API misuse patterns |

## Invocation

```
/learn [category] [brief description]
```

Examples:
```
/learn build Missing dependency — install with apt/brew/pip
/learn env Script path wrong — use relative path from project root
```

---

## Session Learning Summary (L-size)

At the end of L-size tasks, produce a structured summary before the dev-flow session-end phase:

```markdown
### Errors Encountered
- [error] <problem> — Root cause: <cause> — Fix: <fix> — Recorded? Y/N

### Key Decisions
- [decision] <what was decided> — Reason: <why>

### Surprises
- <anything that was different from expected>

### Action Items for Future Sessions
- [ ] Record <item> to knowledge/<category>.md (if not yet recorded)
- [ ] Update skill <name> (if pattern repeated 3+ times)
- [ ] Refresh MEMORY.md (if applicable)
```

For S-size tasks: skip the full summary. Instead ask: "Did I retry any operation 2+ times?" If yes, record via standard flow above.

## Knowledge Health Audit

Run a structured health audit across all memory/knowledge files. Produce a status report with actionable remediation.

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

### Health Report Output Format

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
