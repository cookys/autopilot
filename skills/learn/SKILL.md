---
name: learn
description: Record knowledge to .claude/knowledge/ — invoke after retrying 2+ times, finding non-obvious solutions, or recovering from environment-specific errors (path failures, compile loops, repeated searches). Also auto-triggered by CLAUDE.md rules on bash failure->fix cycles.
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
