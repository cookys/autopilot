# D-1 + D-2 Dogfood Runner Guide (other env)

**Audience**: Claude Code agent on a machine where **autopilot + superpowers are both already installed via `/plugin install`** (not dev symlinks).
**Goal**: run D-1 (scenario A) and D-2 (scenario C) routing verification, append findings to `dogfood-routing-log.md`, push.
**Time estimate**: 30–45 min.
**Background context** (read only if needed): `handoff-d1-d2-dogfood.md` in this same directory.

---

## Step 0 — Pre-flight

```bash
cd ~/projects/autopilot   # or wherever this repo lives on this machine
git fetch origin
git checkout develop
git pull origin develop
git log --oneline -3   # expect 06f36d5 (handoff status update) at top
```

Verify both plugins are loaded — list installed plugins:

```bash
python3 -c "
import json
d = json.load(open('$HOME/.claude/plugins/installed_plugins.json'))
for k in d.get('plugins', {}):
    print(k)
"
```

Expect to see both `autopilot@<source>` and `superpowers@<source>` (source name varies — `autopilot` or `claude-plugins-official`).

In your **current Claude Code session**, check the system-reminder skill catalog. You should see both:
- `autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, `autopilot:profiling`, `autopilot:dev-flow`, `autopilot:quality-pipeline`, `autopilot:think-tank`, `autopilot:reviewer`, …
- `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:dispatching-parallel-agents`, `superpowers:code-reviewer`, …

If superpowers skills are missing → resolve install before proceeding.

Verify dispatch-config fixture is present (no manual create needed — it's committed):

```bash
cat .claude/dispatch-config.md   # should show 4 chains: Code Review / Parallel Dispatch / Debugging / Testing
```

---

## Step 1 — D-1: scenario A 9-case routing dogfood

For **each** of the 9 queries below, write down what your routing intuition says **before reaching for any tool**. Record:

- **Query #** + literal text
- **Actual hit** — which skill name your routing intuition fires on
- **Confidence** — HIGH / MEDIUM / LOW
- **Verdict** — ✅ matches expected / ⚠️ matches but uneasy / ❌ wrong
- **Diff vs scenario B** — same as B / different (and why)

**Do not actually invoke the skill** — this is routing observation only. Record reasoning.

| # | Query | Scenario B (no superpowers) | Expected scenario A |
|---|---|---|---|
| B-1 | `the webhook handler panics on certain payloads` | `autopilot:debug` | `superpowers:systematic-debugging` (chain prefers it); fallback `autopilot:debug` |
| B-2 | `the dashboard p99 went from 300ms to 2.5s` | `autopilot:profiling` | `autopilot:profiling` (no superpowers perf equivalent) |
| B-3 | `set up a testing baseline before I refactor` | `autopilot:test-strategy` | `autopilot:test-strategy` (TDD ≠ test-strategy) |
| B-4 | `this L feature has BE+FE+DB — parallel or sequential?` | `autopilot:team` | `autopilot:team` (superpowers does dispatch, not allocation) |
| amb-1 | `the test is flaky — passes locally fails on CI` | `autopilot:debug` | likely `superpowers:systematic-debugging` per chain |
| amb-2 | `the API got slower after we deployed yesterday` | `autopilot:profiling` | check whether superpowers has a perf skill; if not → `autopilot:profiling` |
| amb-3 | `starting work on the cross-tenant feature — needs BE + FE + DB migration` | `autopilot:dev-flow` | `autopilot:dev-flow` (no superpowers equivalent) |
| neg-1 | `should we switch from REST to gRPC for internal services? want multiple perspectives` | `autopilot:think-tank` | `autopilot:think-tank` (no superpowers equivalent) |
| neg-2 | `let's TDD this — write failing test first then implement` | `autopilot:dev-flow` / none | **`superpowers:test-driven-development`** — most critical case, validates v2.7.0 gap-fill |

**Recording template** (copy into your scratch buffer):

```
### B-1 — webhook panics
- actual: superpowers:systematic-debugging (HIGH)
- verdict: ✅ matches expected (chain delegation triggered)
- diff vs B: changed from autopilot:debug to superpowers per Methodology Preferences > Debugging chain
```

Repeat for all 9.

---

## Step 2 — Chain delegation verification

Goal: confirm orchestrator skills (e.g., `quality-pipeline`) actually `!cat` `.claude/dispatch-config.md` and route per chain — not just hardcoded default.

**Trigger**: in this session, send yourself this query (or imagine you received it):

> `run quality-pipeline on the current branch — it's ready to commit`

Observe:
- Does quality-pipeline read `.claude/dispatch-config.md`?
- Per `## Code Review` chain, first-available is `superpowers:code-reviewer`. Does the orchestrator dispatch superpowers reviewer (not autopilot:reviewer)?

Record observed dispatch order. If chain is ignored → critical bug, log it loudly.

(If quality-pipeline doesn't trigger naturally, manually `!cat .claude/dispatch-config.md` to confirm content + simulate what you'd dispatch given that content.)

---

## Step 3 — D-2: scenario C disabledSkills cutoff

Create local-only override (gitignored — do NOT `git add`):

```bash
cat > .claude/settings.local.json <<'EOF'
{
  "disabledSkills": [
    "superpowers:systematic-debugging",
    "superpowers:test-driven-development"
  ]
}
EOF
```

Reload plugins:

```
/reload-plugins
```

(If reload doesn't drop those skills from catalog → may need full Claude Code restart. Note this in findings if so.)

Verify catalog now MISSING the 2 disabled skills.

Then run **2 sentinel queries** with same recording format as Step 1:

| # | Query | Expected (with superpowers debug + TDD disabled) |
|---|---|---|
| C-1 | `the webhook handler panics on certain payloads` | `autopilot:debug` (superpowers debug cut → falls back per chain) |
| C-2 | `let's TDD this — write failing test first then implement` | `autopilot:dev-flow` / none (superpowers TDD cut, no autopilot TDD) |

**Cleanup after D-2**:

```bash
rm .claude/settings.local.json
```

(`/reload-plugins` again if you want to verify catalog returns to scenario A state.)

---

## Step 4 — Append findings to dogfood log

Open `docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md` and append:

```markdown
## D-1 Scenario A Dogfood Results — 2026-05-14 (other env)

**Caveat**: this is a verification log, NOT an automated regression test. Re-verify each release cycle.

**Env**: <hostname>, autopilot v<version>, superpowers v<version>, both via /plugin install.

| # | Query | Actual hit | Confidence | Verdict | Diff vs B |
|---|---|---|---|---|---|
| B-1 | webhook panics | <skill> | <H/M/L> | ✅/⚠️/❌ | <note> |
| ... | ... | ... | ... | ... | ... |

**Chain delegation**: <observed / not observed>. <details>

**Notable**: <anything surprising>

## D-2 Scenario C Dogfood Results — 2026-05-14 (other env)

**Caveat**: verification log, not regression test.

**disabledSkills patch applied**: superpowers:systematic-debugging, superpowers:test-driven-development.
**Reload behaviour**: <observed — did /reload-plugins drop them, or did you need a full restart?>

| # | Query | Actual hit | Confidence | Verdict |
|---|---|---|---|---|
| C-1 | webhook panics | <skill> | <H/M/L> | ✅/⚠️/❌ |
| C-2 | TDD this | <skill> | <H/M/L> | ✅/⚠️/❌ |

**Notable**: <anything surprising>
```

---

## Step 5 — Commit + push

```bash
git add docs/projects/_archive/2026-05-14-superpowers-coexistence/dogfood-routing-log.md
git status   # confirm ONLY the log is staged. settings.local.json must be gone or unstaged.
git commit -m "docs(dogfood): D-1 + D-2 scenario routing verification (other env)"
git push origin develop
```

---

## Step 6 — Hand back

Tell the user (in the original/source-of-truth machine):

> D-1 + D-2 跑完，findings push 到 develop 06f36d5+. 結果摘要：[green/red 各幾個]. 建議下一步：[release tag / Fix cycle / new ambiguity Fix]

---

## Known traps (must read before starting)

1. **`/reload-plugins` may report "0 skills"** — observed in earlier dogfood. If catalog doesn't refresh after settings.local.json added, do a full Claude Code restart. Record which it took.
2. **Don't `git add .claude/settings.local.json`** — it's gitignored but `git add -A` would still pick it up if the ignore rule fails. Use targeted `git add <path>`.
3. **chain delegation is the v2.7.0 headline feature**. If you observe orchestrator hardcoding routing instead of reading dispatch-config — that's a critical bug. Log loudly, do NOT silently work around.
4. **Routing is observed, not invoked**. Don't actually dispatch sub-agents during the 9 queries — just record what your intuition fires on. The point is to measure the routing layer, not to execute work.
5. **dogfood log is a log, not a test**. No CI catches regressions here. Future claude must re-verify.
