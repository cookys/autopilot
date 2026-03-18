
# Completeness Gate (Anti-Stub Enforcement)

**Pre-commit completeness scan. Runs after tests pass, before code review.**

## What Gets Scanned

| Category | Patterns Detected | Why Prohibited |
|----------|-------------------|----------------|
| **TODO/FIXME markers** | `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP` | Unfinished work must not ship |
| **Empty implementations** | `return {};`, `return 0;` as sole function body | Every function must have real logic |
| **Skipped tests** | `DISABLED_`, `GTEST_SKIP()`, commented-out `TEST()` | No new skipped tests allowed |
| **Hardcoded test data** | Test values in `src/` (not `test/`) | Test data must not leak into production |
| **Incomplete proto** | `// TODO: add fields`, empty `message {}` body | Proto definitions must be complete |

## Execution

### Step 1: Automated Regex Scan

```bash
# Run your project's scan script, or manually check for TODO/FIXME/stubs
node .claude/scripts/pre-commit-scan.js  # adjust path for your project
```

**What the script does:**
1. Lists all staged files (`git diff --cached --name-only`), skipping binaries
2. For each file, runs regex patterns for all 5 categories above
3. Uses `git blame --porcelain` to classify each finding as **new** (uncommitted) vs **pre-existing**
4. Outputs JSON with findings grouped by type

**Example output (clean):**
```json
{
  "clean": true,
  "scannedFiles": 12,
  "findings": [],
  "summary": { "total": 0, "new": 0, "preExisting": 0, "byType": {} }
}
```

**Example output (findings):**
```json
{
  "clean": false,
  "scannedFiles": 8,
  "findings": [
    { "file": "src/games/big2/Big2WsAdapter.cpp", "line": 45, "type": "marker",
      "text": "// TODO implement reconnect state", "isNew": true },
    { "file": "src/lobby/LobbyManager.cpp", "line": 210, "type": "empty_impl",
      "text": "return {};", "isNew": true },
    { "file": "test/MahjongRulesTest.cpp", "line": 88, "type": "disabled_test",
      "text": "TEST(MahjongRules, DISABLED_FlowerScore)", "isNew": false }
  ],
  "summary": { "total": 3, "new": 2, "preExisting": 1,
    "byType": { "marker": 1, "empty_impl": 1, "disabled_test": 1 } }
}
```

### Step 2: Semantic Judgment (AI)

The script only does regex detection. These require AI judgment:

- **Hardcoded test data in production code** — regex cannot distinguish test values from valid constants
- **"Is this `return {}` a placeholder or a valid default?"** — context determines intent
- **"Is this TODO a genuine incomplete item or a design note?"** — read surrounding code

Evaluate each finding:
```
For each finding from Step 1:
├── Read 5-10 lines of surrounding context
├── Is it genuinely incomplete?
│   ├── Yes → must fix before commit
│   └── No (valid default, design note) → mark as false positive, move on
```

### Step 3: Fix or Dismiss

```
scan results
├── All clean → pass, proceed to code review
├── TODO/FIXME (new) → complete the implementation or remove the marker
├── DISABLED_ test (new) → enable the test or delete it
├── Empty impl (new) → implement real logic
└── Pre-existing findings → not required to fix this session (but encouraged)
```

## Exceptions

| Scenario | Allowed? |
|----------|----------|
| `TODO(Phase-N)` with explicit future phase reference | Yes — must be addressed in that phase |
| Pre-existing TODO (not introduced this session) | Yes — no obligation this session |
| Placeholder assertion in test (`EXPECT_TRUE(true)`) | **No** — test assertions must be meaningful |
| `return {}` as valid empty-collection return | Yes — if semantically correct (e.g., "no results found") |

## Example: Full Gate Pass

```
1. Run: # Run your project's scan script, or manually check for TODO/FIXME/stubs
node .claude/scripts/pre-commit-scan.js  # adjust path for your project
2. Output: 1 finding — "return {};" in getPlayerCards(), isNew=true
3. Read context: function should return current hand, not empty
4. Action: implement actual card retrieval logic
5. Re-run: clean=true
6. → Pass, proceed to code review
```

## See Also

| Skill | Boundary |
|-------|----------|
| `quality-pipeline` (code-review) | Runs after completeness gate passes |
| `dev-flow` | Orchestrates: test → completeness gate → code review |
| `quality-pipeline` | Unified quality pipeline entry point |
