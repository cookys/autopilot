
# Test Failure Investigation (All Sizes, Mandatory)

**Test failure = stop and investigate. Never skip, never assume pre-existing.**

## Mandatory Flow

```
tests fail?
├── 1. Stop implementation immediately
├── 2. Investigate root cause
│   ├── Test bug? → fix the test
│   ├── Code bug (introduced this session)? → fix the code
│   └── Pre-existing? → switch to develop and verify
│       ├── develop also fails → confirmed pre-existing, still fix it
│       └── develop passes → regression introduced this session, fix it
├── 3. Re-run tests until all pass (known infra issues like DB connection excepted)
└── 4. Report summary to user
```

### Step-by-Step with Examples

**Step 1: Stop implementation.**
Do not continue coding. The failing test takes priority over new features.

**Step 2: Investigate root cause.**

Example A — test bug:
```
FAIL: MahjongRulesTest.FlowerTileCount
Expected: 8  Actual: 7
→ Read test: assertion counts bonus flowers but not season flowers
→ Fix: update expected count to include both types, or fix test setup
```

Example B — code bug (this session):
```
FAIL: BigTwoRulesTest.StraightFlush
Expected: STRAIGHT_FLUSH  Actual: STRAIGHT
→ git diff shows: modified isStraightFlush() to add a suit check
→ The new suit check has an off-by-one: `suit > 3` should be `suit >= 3`
→ Fix: correct the comparison
```

Example C — pre-existing verification:
```
FAIL: ReconnectTest.GameStateRestore
→ Not obviously related to current changes
→ scripts/verify-preexisting.sh '<your-test-command>' --base develop
  → JSON: {"head":"fail","base":"fail","verdict":"PRE_EXISTING"}
  → Still fix it: the state serializer was missing a field
  → (verdict INTRODUCED ⇒ regression this session; NO_FAILURE ⇒ rerun)
```

The script stashes uncommitted work, checks out base, runs the test, restores. Replaces the manual `git stash && checkout develop` recipe — fewer ways to leave the work tree in a bad state.

**Step 3: Re-run until clean.**
```bash
<your-test-command>  # e.g., npm test, make test, dev.sh test
# If specific test: docker exec -it $CONTAINER bash -c "cd /build && ctest -R 'FailingTest' --output-on-failure"
```

**Step 4: Report.**
```
Summary:
- 2 failures found
- ReconnectTest.GameStateRestore: pre-existing, missing field in serializer → fixed
- BigTwoRulesTest.StraightFlush: regression from this session, off-by-one → fixed
```

## Tool Selection

| Scenario | Approach |
|----------|----------|
| Single clear failure | Read the test file + implementation directly |
| Multiple failures or unclear root cause | Dispatch `Explore` agent for deep investigation |
| Possible cross-module impact | Dispatch `general-purpose` agent for full analysis |

## Prohibited Behaviors

Test failure prohibitions: skip pre-existing, skip even 1 failure, commit before fixing, assume unrelated.
> Full list: [_base/prohibited-behaviors.md](../_base/prohibited-behaviors.md)


# Pre-existing Error Cleanup (All Sizes, Mandatory)

**After completing main task: if pre-existing compile errors/warnings exist, analyze and fix them.**

## Scope

| Type | Example | Action |
|------|---------|--------|
| Compile error (project code) | unused variable, type mismatch | Fix directly |
| Compile error (auto-generated) | protobuf codegen unused param | Record root cause in codegen config, do not edit generated file |
| Compile warning | implicit conversion, deprecation | Fix directly (if too many, open backlog) |
| Lint / type-check error | TS noUnusedLocals, ESLint | Fix directly |

## Flow

```
main task done → run build/type-check
├── Has error/warning?
│   ├── Introduced this session? → must fix
│   └── Pre-existing?
│       ├── Project hand-written code? → analyze + fix
│       ├── Auto-generated code? → record root cause, don't edit generated file
│       └── Third-party dependency? → record, don't fix
└── All clean → pass
```

### Examples (compressed)

```
# Pre-existing project warning — fix directly
src/games/big2/Big2Rules.cpp:142: implicit conversion loses precision
  int count = cards.size();  // size_t → int (pre-existing per git blame)
→ Fix: auto count = static_cast<int>(cards.size());

# Auto-generated — record root cause, don't hand-edit
proto/gen/game.pb.cc:1234: unused parameter 'arena'
→ Root cause: protobuf codegen missing LITE_RUNTIME → record in backlog
```

## Prohibited Behaviors

Pre-existing error prohibitions: leave untouched, dismiss as "just a warning", defer to "later."
> Full list: [_base/prohibited-behaviors.md](../_base/prohibited-behaviors.md)

## See Also

| Skill | Boundary |
|-------|----------|
| the project test skill | Test commands, E2E setup, feature flags |
| `quality-pipeline` (completeness-gate) | Anti-stub scan (TODO/FIXME/empty impl) |
| `quality-pipeline` (code-review) | Code review after tests pass |
