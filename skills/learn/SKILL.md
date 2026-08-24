---
name: learn
description: >
  Save a hard-won lesson or surprising fix so future sessions benefit. Boundary: learn records
  facts/gotchas; distill produces reusable multi-step procedures from conversation history. Use
  when: "save this to knowledge", "record this", "remember for next time", "/learn", "記下來",
  "存到 knowledge", "記住這個", user shares a gotcha or non-obvious fix, solution took 2+ attempts,
  environment-specific workaround discovered. Also handles: "knowledge health audit",
  "check MEMORY.md size", stale knowledge cleanup. Not for: active debugging, writing tests,
  project status updates, or extracting recurring procedures from history (→ distill).
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

0. **Decide the destination** — before writing anything, apply the one question from
   [`references/knowledge-routing.md`](../../references/knowledge-routing.md) §2:
   **「把所有 fleet-specific token 刪掉後,這段還能教人嗎?」**

   | Answer | Destination | Write contract |
   |---|---|---|
   | **No** — the identifiers were the content | `~/.claude/projects/<slug>/memory/` | Default sink. Write directly; done. |
   | **Yes** — a publishable fact or gotcha | `.claude/knowledge/` | **Promotion** (below). Steps 1–5 apply. |
   | **Yes**, and it binds *other skills* rather than being looked up | `references/` | Normal review path — see the Categories table. |

   `.claude/knowledge/` is **deliberately gitignored** (`.gitignore` line 6 — the `.claude` dir is
   local state, fail-closed so scratch never leaks into this public repo). A write there is therefore
   not a save. Completing it means finishing the promotion contract in one motion:

   ```bash
   git add -f .claude/knowledge/<file>.md .claude/knowledge/INDEX.md
   git diff --cached .claude/knowledge/   # show the user — this is the disclosure gate
   git commit -m "docs(knowledge): <one-line summary>"
   ```

   > **不 commit 就等於沒寫.** An uncommitted file there is invisible to `git status` (ignored), to
   > every other clone, and to CI — one `git clean -xdf` or worktree teardown from gone. Precedent:
   > the last row of `.claude/knowledge/INDEX.md` records `claude-code-plugin-dogfood-lessons.md`
   > (2026-05-14) as 從未 commit 進本 repo, found missing by a doc-sync sweep 2026-07-16 and never
   > recovered. It was written; it was indexed; it is gone.

   The `git diff --cached` step is the **human disclosure gate**, not ceremony:
   `scripts/identifier-scan.js` sees structured tokens only and is blind to bare hostnames, client
   names, pane addresses and endpoint aliases (routing doc §5).

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
| `discipline` | `references/` (typically the `evidence-discipline.md` family) | Repo-level rule binding **other** skills — not a fact to look up but a rule to follow. Normal review path, never `git add -f`. |

Destination for every category above is decided by step 0, not by this table: a `debug` lesson that
only makes sense on one machine still goes to `memory/`.

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
