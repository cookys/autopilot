# Hetero Review-Loop Automation — Proposal

> Research + design doc. No shipped code touched. Goal: turn the user's hand-typed
> "generation-adversarial heterogeneous review loop" into a config-driven, near-one-command
> dispatch.
> Created 2026-06-26 · grounds every claim in `path:line`.

The pattern being automated (user's words, decoded):

1. depth-0 CEO dispatches a **subagent to write plan + acceptance criteria** (the spec);
2. **gpt-5.5 xhigh adversarial LOOP review** of the spec → fix → re-review to convergence;
3. dispatch the **implementer to a heterogeneous engine** (agy/Gemini Flash 3.5 high *or* codex `gpt-5.3-codex-spark`);
4. **gpt-5.5 xhigh adversarial LOOP review** of the impl + independent verification, to convergence;
5. dispatch a **subagent for qc-gate** to finish (QC-Verdict, merge-back).

Key properties: (a) generator ≠ reviewer engine (decorrelated failure modes); (b) review is a **loop to convergence**, not one-shot; (c) implementer offloaded to a cheaper/decorrelated engine; (d) depth-0 holds authoritative control + qc.

---

## 1. TL;DR

`/l5` already encodes ~70% of this loop's *control structure* (background foreman, depth-0 control loop, hetero implementer via `dispatch-hetero.sh`, authoritative qc@depth-0, artifact-not-self-report verification, merge-back, worktree GC). The DELTA that's still hand-typed is the **engine roster + loop policy as data**: which engine *reviews* (the loop today reviews with a **Claude** depth-0 panel, not gpt-5.5), the **loop-to-convergence** policy for both review steps, the implementer engine **per project** (autopilot's own repo must use codex, not agy), and the reasoning efforts. None of that is config today.

**Build:** one new resolver `scripts/resolve-review-loop.sh` reading a new project config `project-config-template/review-loop-config.md` (schema in §3), consumed by `skills/l5/SKILL.md` + `references/level-front-door.md`. It pins `{spec_author, spec_reviewer_engine, impl_engine, impl_engine_fallback, impl_reviewer_engine, reasoning efforts, loop cap/convergence token, qc_gate engine}`. Plus **two one-line fixes** to `dispatch-hetero.sh` so the roster the user actually names works (`gpt-5.3-codex-spark` doesn't currently route to codex; reasoning effort is hardcoded `xhigh`). After a one-time `cp` + edit of the config, the loop becomes `/l5 <goal>` (the existing trigger) with the roster honored — no new command needed.

---

## 2. Current state — what `/l5` already gives, and the precise manual delta

### Already free (cite)

| Loop step | What `/l5` already does | Where |
|-----------|-------------------------|-------|
| Background foreman + depth-0 control | `Agent(run_in_background, isolation:"worktree")`, budget cap → `TaskStop`, outcome→action table, merge-back, GC | `skills/ceo-agent/references/level-front-door.md:46-293` |
| (3) hetero implementer | foreman leaf-dispatches impl to `dispatch-hetero.sh`; outcome JSON carries `runner`/`model` provenance | `skills/l5/SKILL.md:24-34`; `level-front-door.md:72-79` |
| Artifact-not-self-report | verify by git artifacts (commit/diff/cleanliness), never agent prose | `references/hetero-dispatch.md:18`; `scripts/dispatch-hetero.sh:8-12` |
| (4/5) authoritative qc@depth-0 | **≥3 adversarial QC reviewers**, distinct lenses, cite `file:line`, default-assume-broken, CEO synthesizes verdict, holds merge | `level-front-door.md:229-253` |
| (5) merge-back + GC | depth-0 cherry-pick after qc passes; reap worktree+branch | `level-front-door.md:256-293` |
| codex path exists | `gpt-5.5` → `IS_CODEX=1` → `codex exec … -c model_reasoning_effort="xhigh"` | `scripts/dispatch-hetero.sh:107-109,143-148` |
| per-project routing precedent | `resolve-dispatch.sh` reads `.claude/model-routing-config.md` first, else defaults; `resolve-qc-gate.sh` / `resolve-doa.sh` use the same cwd→repo→template→fail-closed chain | `scripts/resolve-dispatch.sh:75-138`; `resolve-qc-gate.sh:10-16` |

### The precise DELTA that is still manual

1. **The REVIEW engine is wrong / not selectable.** The user wants *gpt-5.5 xhigh* doing both review loops. But `/l5`'s authoritative qc is a **Claude** depth-0 panel (`level-front-door.md:234-243` — "dispatched subagents", Claude). There is **no config row** that says "review with gpt-5.5". The decorrelation the user is paying for (generator ≠ reviewer family) is only half-present: impl is hetero, review is homogeneous-Claude. This is the single biggest gap.

2. **There is no SPEC-review step at all.** The loop's step 2 (review the *plan/acceptance criteria* before implementing) is not in `/l5`. `/l5` goes goal → foreman plans → impl → qc. The user wants a gpt-5.5 loop-review **gate between plan and impl**. Missing entirely.

3. **"LOOP to convergence" is not encoded.** Both review steps are loops (review→fix→re-review until SHIP). `/l5`'s qc is described as one synthesis pass that "fixes or reverts every real issue before integration" (`level-front-door.md:243`) — it does not specify *iterate the reviewer until clean*, nor a round cap / convergence token. The user's loop is explicitly multi-round (and repo memory records "Dialectic review preference: multi-round … each round re-checks prior round's fixes").

4. **The engine roster is hardcoded, not per-project — and the codex path the user names is half-broken.**
   - `dispatch-hetero.sh:107` triggers codex **only** on `*"gpt-5.5"*`. The user's implementer is **`gpt-5.3-codex-spark`** — verified it does **not** match, so it would fall through to the **agy/Gemini** branch (`:149-169`) and try to run Gemini under that model name. Bug.
   - Reasoning effort is **hardcoded `xhigh`** (`:147`). The user wants Gemini Flash **"high"** for impl and gpt-5.5 **xhigh** for review — different efforts per role. Not expressible.
   - The default model is `Gemini 3.5 Flash (High)` (`:59`), but **agy is unreliable for the autopilot repo itself** — it writes to its plugin install copy → `no_op` + false self-report (memory `agy-writes-install-dir`; this L1 README:30). So the roster MUST be **per-project** (autopilot → codex; other repos → agy is fine).

5. **The qc-gate finisher engine is not pinned to the roster.** `resolve-qc-gate.sh` governs *whether* a push needs evidence (`resolve-qc-gate.sh:17-18`), not *which engine* produces it. The user's step 5 "subagent for qc-gate" is currently just "the depth-0 Claude panel + the pre-push trailer gate" — fine, but the roster should name it so the loop is fully declared in one place.

Net: the *control loop* is built; the *roster + loop policy* is hand-typed every run. That's exactly what a resolver + config file removes.

---

## 3. Proposed automation

**Design rule (from CLAUDE.md "Don't hardcode dispatch model/mode"):** extend the existing resolver pattern, do **not** invent a parallel system. Three pieces, in priority order.

### 3a. New config: `project-config-template/review-loop-config.md`

One file declaring the full roster + loop policy. Same resolution chain as `resolve-qc-gate.sh`/`resolve-doa.sh` (`$OVERRIDE` → cwd `.claude/` → repo `.claude/` → template → fail-closed). Ship this content:

```markdown
# review-loop-config — hetero generation-adversarial review loop roster

> Copy to `.claude/review-loop-config.md` in the consuming project to override.
> Resolved by `scripts/resolve-review-loop.sh`; consumed by `/l5` (and the
> ceo-agent foreman). Pins the engine roster + loop policy so the whole
> "spec → review-loop → hetero-impl → review-loop → qc-gate" pipeline runs from
> `/l5 <goal>` with no hand-typed prompt.
>
> Sibling of model-routing-config.md (per-ROLE model/mode for Claude subagents);
> this file pins the HETEROGENEOUS engine roster + the LOOP convergence policy
> that model-routing-config.md does not cover.

## Settings (one `key: value` per line; first match wins)

# --- roster (who does each loop step) ---
- spec_author: claude-subagent          # step 1: writes plan + acceptance criteria (Claude planner subagent)
- spec_reviewer_engine: gpt-5.5          # step 2: adversarial review of the SPEC
- spec_reviewer_effort: xhigh
- impl_engine: gpt-5.3-codex-spark       # step 3: heterogeneous implementer
- impl_engine_fallback: Gemini 3.5 Flash (High)   # used when impl_engine unavailable AND repo is agy-safe
- impl_effort: high
- impl_reviewer_engine: gpt-5.5          # step 4: adversarial review of the IMPL
- impl_reviewer_effort: xhigh
- qc_gate_author: claude-subagent        # step 5: qc-gate finisher (QC-Verdict, merge-back)

# --- loop policy (both review steps) ---
- review_loop: convergence               # convergence = loop review→fix→re-review until SHIP; oneshot = single pass
- review_round_cap: 3                     # fail-closed escalate at cap (never a silent continue)
- review_converge_token: SHIP             # reviewer emits this verbatim when no Critical/Major remains

## Field reference
| Key | Values | Meaning |
|-----|--------|---------|
| spec_author / qc_gate_author | `claude-subagent` \| `<engine>` | who writes the spec / runs the qc-gate finish |
| *_reviewer_engine | engine name (codex `gpt-5.*` / agy model / `claude`) | the ADVERSARIAL reviewer; SHOULD differ in family from the generator |
| impl_engine / _fallback | engine name | primary + fallback heterogeneous implementer |
| *_effort | `low`\|`medium`\|`high`\|`xhigh` | reasoning effort passed to the engine |
| review_loop | `convergence` \| `oneshot` | loop-to-SHIP vs single pass |
| review_round_cap | int | escalate (never silently continue) when hit |
| review_converge_token | string | verbatim convergence signal the loop greps for |

## Defaults & fail-closed
Missing/unparseable → all-Claude, `review_loop: convergence`, `review_round_cap: 3`
(degrades to today's `/l5`-with-Claude-qc behavior — safe). Set per-project; the
autopilot repo's own `.claude/review-loop-config.md` MUST set
`impl_engine: gpt-5.3-codex-spark` because agy self-corrupts this repo (memory
`agy-writes-install-dir`).
```

### 3b. New consumer: `scripts/resolve-review-loop.sh`

Mirror `resolve-qc-gate.sh` exactly (it's ~80 lines; copy the config-locate + `read_field` machinery verbatim — `resolve-qc-gate.sh:44-60`). Output one JSON object with all the keys above; `--field <key>` for shell consumers. Fail-closed to all-Claude/convergence/cap-3. This is the single lookup `/l5` calls instead of the LLM re-deriving the roster from the prompt each run.

### 3c. Two one-line FIXES to `dispatch-hetero.sh` (so the roster the user names actually works)

Both are PATCH (hardening a shipped script):

- **Codex trigger** (`:107`): broaden so the user's implementer routes to codex.
  `if [[ "$MODEL" == *"gpt-5.5"* ]]` → `if [[ "$MODEL" == gpt-5.* || "$MODEL" == *codex* ]]`. Without this, `gpt-5.3-codex-spark` runs the **Gemini/agy** branch (verified: `:107` substring match fails for `5.3`). This is a latent bug independent of this proposal.
- **Reasoning effort flag** (`:147`): add `--effort <v>` (default `xhigh`) instead of hardcoding, so impl can run `high` and review `xhigh`. Thread it into the `-c model_reasoning_effort` arg.

### 3d. Trigger — no new command

`/l5 <goal>` stays the front door. Three small prose edits make it honor the config:

1. `skills/l5/SKILL.md` "On invocation": before dispatch, `resolve-review-loop.sh` → roster JSON; pass `impl_engine`/`impl_effort` to `dispatch-hetero.sh --model … --effort …`. (Replaces the hardcoded Gemini default for the impl row.)
2. `references/level-front-door.md` §"qc@depth-0" (`:229-253`): when `spec_reviewer_engine`/`impl_reviewer_engine` ≠ `claude`, the depth-0 review panel dispatches the **named hetero engine** (via the same `dispatch-hetero.sh` recipe used read-only, per `references/hetero-dispatch.md:71-78` qc-panel pattern — feed `reviewer.body.md` + the diff to the engine in a throwaway dir). This is the bit that makes review **decorrelated** from the Claude generator.
3. `references/level-front-door.md`: add the **spec-review gate** (loop step 2) between foreman-plan and impl, and make BOTH review steps honor `review_loop: convergence` (loop until the reviewer emits `review_converge_token`, escalate at `review_round_cap`). Reuse `scripts/check-redispatch-prompt.sh` (already exists) on each round-2+ prompt so the convergence loop doesn't leak round-cycle meta-signal to the blind reviewer.

**Why extend, not fork:** the config lives beside `model-routing-config.md`/`qc-gate-config.md`/`doa-config.md`; the resolver is a `resolve-qc-gate.sh` clone; the consumer is the existing `/l5`. No new command namespace, no new dispatch engine — just the roster + loop policy lifted out of the hand-typed prompt into data, exactly the pattern CLAUDE.md mandates.

---

## 4. Skill inventory — USED vs IGNORED

### USED by the loop

| Skill / script | Loop step it serves |
|----------------|---------------------|
| `l5` (front door) → `ceo-agent` | The whole pipeline; depth-0 control + authoritative qc |
| `ceo-agent` references/`level-front-door.md` | Foreman topology, control loop, merge-back, GC |
| `planner` agent (`autopilot:planner`) | Step 1 — six-element spec / acceptance criteria (`spec_author`) |
| `reviewer` agent (`autopilot:reviewer`) / `quality-pipeline` | Steps 2 & 4 — adversarial review (Three Red Lines, `file:line`); its `reviewer.body.md` is the engine-neutral prompt fed to hetero reviewers |
| `dispatch-hetero.sh` | Step 3 — hetero implementer (and, read-only, the hetero reviewer) |
| `resolve-dispatch.sh` / `model-routing.md` | Claude subagent model/mode for spec_author + Claude reviewers |
| `resolve-qc-gate.sh` + pre-push gate | Step 5 — QC-Verdict trailer / `.qc/<sha>.verdict.json` enforcement at merge |
| `resolve-doa.sh` | Depth-0 authority bounds during the run |
| `finish-flow` | Step 5 — closing sequence (merge, learn, version, archive) |
| `check-redispatch-prompt.sh` / `check-dispatch-suppression.sh` | Anti-gaming on round-2+ review prompts in the convergence loop |
| `check-test-integrity.sh` / `check-disjointness.sh` | L0 anti-gaming gate during qc (esp. relevant to the L1 host project) |

### IGNORED — orthogonal vs real GAP

| Skill | Verdict | One-line judgment |
|-------|---------|-------------------|
| **brainstorm** | **GAP (conditional)** | The L1 README itself says "Consider `brainstorm` or `survey` before coding" for under-specified specs. The loop jumps straight to "subagent writes spec" — for a fuzzy goal it should gate spec-authoring behind brainstorm. Recommend: `/l5` offers a brainstorm pre-step when the goal has no verifiable end-state. |
| **survey** | **GAP (conditional)** | Same as brainstorm but for *external* best-practice. For a "do it the rigorous way" goal the spec quality is bounded by missing industry context. The pinned skill **research-to-ship** already chains survey→plan→loop-review→project→dev-flow — it is the **participatory cousin of this exact loop**. The hetero loop is the *autonomous* version; survey should be an opt-in spec-input step. |
| **learn** | **GAP (real)** | The loop captures no lessons at the end. `finish-flow` L-5.6 makes `learn` near-mandatory, and repo memory is the user's primary cross-session asset. The loop SHOULD auto-evaluate the 5 learn-triggers after qc passes (e.g. "agy corrupted this repo again" is exactly a learn-worthy gotcha). Wire `learn` into the qc-gate finisher (step 5). |
| **doc-sync** | **GAP (mild)** | Hetero impl + adversarial review catch code bugs, not doc drift. For any change touching shipped surfaces, `doc-sync`'s deterministic gate (links/version/CLI-surface) should run **before** the qc-gate finisher so the QC-Verdict isn't issued over stale docs. Cheap, deterministic — fold into step 5. |
| **think-tank** / **think-tank-dialectic** | Orthogonal (mostly) | These are decision tools (scope/tradeoff/irreversible). The loop is execution, not decision. Fine to skip — but the **dialectic multi-round review** the user described maps conceptually onto think-tank-dialectic's structure; the loop borrows the *form* (multi-round adversarial) without invoking the *skill*. No integration needed. |
| **audit** | Orthogonal | Two-impl comparison; not this loop's job (unless the goal *is* a parity check). |
| **retro** | Orthogonal | Git-history productivity metrics; post-hoc, not in-loop. |
| **distill** | Orthogonal | Extracts recurring procedures into personal skills — meta-level; ironically THIS proposal is what distill would eventually produce from the user repeating the loop. Not in-loop. |
| **profiling** / **debug** | Orthogonal (on-demand) | The loop invokes them reactively if impl introduces a perf/correctness regression; not a fixed step. |
| **test-strategy** | Orthogonal (advisory) | Informs the acceptance criteria in step 1; the planner already references it. Not a separate step. |
| **next** / **project-lifecycle** | Orthogonal | Pre/post-project housekeeping (what-to-work-on, bootstrap/archive). `project-lifecycle` archive IS part of `finish-flow` L-5.5, so covered transitively. |
| **team** | Orthogonal | Width/parallel allocation; the loop is width-1 by default (`level-front-door.md:83`). Only relevant if a goal fans into ≥2 disjoint units (then Phase L applies). |
| **dev-flow** | Used transitively | The foreman runs dev-flow inline at depth 1 (`level-front-door.md:65`); not separately invoked by the user. |
| **research-to-ship** | Adjacent, not in-loop | The participatory sibling (human gates at each phase). The hetero loop is the autonomous variant; they shouldn't both fire. Listed so the relationship is explicit. |

**Top 3 real gaps:** (1) `learn` never fires at loop end; (2) spec step has no `brainstorm`/`survey` on-ramp for fuzzy goals (the L1 README flags exactly this); (3) `doc-sync` deterministic gate not run before the QC-Verdict.

---

## 5. Recommended next steps (prioritized)

| # | Action | Size | Semver |
|---|--------|------|--------|
| 1 | **Fix `dispatch-hetero.sh` codex trigger + add `--effort`** (`:107`, `:147`) — without this the user's stated `gpt-5.3-codex-spark` roster silently runs Gemini. Latent bug, fix regardless. | Fix | **PATCH** |
| 2 | **Ship `review-loop-config.md` template + `resolve-review-loop.sh`** (clone of `resolve-qc-gate.sh`) + add the autopilot repo's own `.claude/review-loop-config.md` pinning `impl_engine: gpt-5.3-codex-spark` (agy-unsafe repo). | S | **PATCH** (new script + new reference; per CLAUDE.md bump table, a new script is PATCH) |
| 3 | **Wire the roster into `/l5`**: `skills/l5/SKILL.md` + `references/level-front-door.md` read the resolver for impl engine/effort AND for the **review engine** (hetero reviewer via the qc-panel `reviewer.body.md` recipe). This is the decorrelation payoff. | L | **PATCH** (prose/behavior change to an existing skill) |
| 4 | **Encode the convergence loop + spec-review gate** in `level-front-door.md`: loop both review steps to `review_converge_token`, cap at `review_round_cap` (escalate, never silent-continue), reuse `check-redispatch-prompt.sh` per round. Add the plan→impl spec-review gate (loop step 2). | L | **PATCH** |
| 5 | **Close the 3 skill gaps**: `learn` auto-eval at step 5; optional `brainstorm`/`survey` spec on-ramp for fuzzy goals; `doc-sync` deterministic gate before the QC-Verdict. | S | **PATCH** (or no-bump if doc-only wiring) |

**Build order:** 1 first (it's a standalone bug fix and unblocks the user's exact roster today). Then 2 (the data + resolver — zero behavior change, pure plumbing). Then 3+4 (the `/l5` wiring that makes the config live — the real value). 5 is incremental polish.

**One-time onboarding after this lands:** `cp project-config-template/review-loop-config.md <project>/.claude/`, edit the roster (codex for autopilot-the-repo, agy elsewhere), then every run is `/l5 <goal>` — the hand-typed prompt is gone.
