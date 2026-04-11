---
name: think-tank-dialectic
description: >
  Hegelian dialectic (Thesis → Antithesis → Synthesis) for irreversible or high-stakes decisions
  with genuine stalemate — NOT a "better think-tank", a different tool for a different situation.
  Use when: "this decision is hard to reverse", "both sides have real merit", "genuinely torn
  between X and Y", "irreversible decision", "real dilemma, not just tradeoffs", "need structured
  dialectic", "這個決定反悔成本很高", "兩邊都有道理", "在 X 和 Y 之間拉扯", "辯證一下",
  "不可逆決策", "逃不掉的 tradeoff". Always reach for `think-tank` first; escalate here only
  when think-tank's Decision Brief shows LOW consensus AND the decision is costly to reverse.
  Not for: everyday scope decisions (→ think-tank), pure tech selection (→ survey), reversible
  tasks where you can iterate, or reflexive "let's debate this" requests.
---

# Think Tank Dialectic — Hegelian Deliberation

Structured dialectic for hard decisions. Where `autopilot:think-tank` maps perspectives, `think-tank-dialectic` resolves genuine stalemates via Hegelian Thesis → Antithesis → Synthesis. Cost is higher; use is rare by design.

## This is NOT a "Better" Think-Tank

**Read this first**: `think-tank-dialectic` is a **different tool**, not an upgrade.

| Axis | `think-tank` | `think-tank-dialectic` |
|------|--------------|------------------------|
| **Question type** | "Who is affected? What perspectives exist?" | "Both positions have merit — how do we resolve?" |
| **Output** | Multi-perspective map + collision insights | Structured dialectic → Hegelian synthesis |
| **Failure mode** | 6 roles rubber-stamp (no real tension) | Dialectic-for-the-sake-of-dialectic (over-meta) |
| **Cost** | Low (single round parallel) | High (2 rounds + forced synthesis) |
| **Trigger** | Medium decisions | Irreversible or high-stakes, LOW consensus |

**If you're reaching for dialectic reflexively, stop.** Use `think-tank` first; escalate only when its Decision Brief shows LOW consensus AND the decision is expensive to reverse.

## Grounding Protocol — ANTI-DIALECTIC-OVERUSE

Five hard rules that constrain this skill's own overuse. All enforceable — no wall-clock dependencies, no cross-session assumptions.

### Rule 1: Max 2 rounds of deliberation

R1 (independent analysis) + optional R2 (Hegelian cross-examination). **There is no R3.** The execution sequence below physically has no R3 phase.

### Rule 2: Session-scoped re-entry guard

Before Step 0, Coordinator scans conversation history for prior `## Advance Decision Brief:` headers:

- **1st invocation on a topic**: normal full deliberation
- **2nd invocation on the *same* confirmed problem statement**: degrade to Quick Synthesis (only revisit prior brief, no fresh R1)
- **3rd invocation on the same topic**: **refuse**. Tell user: "此議題已辯論 3 次。再辯也不會有新資訊。請從以下擇一：(a) 接受先前 brief 的 majority recommendation, (b) 接受 minority report 的立場, (c) 記錄為 non-reversible commitment 並停止重訪, (d) 先 offline 累積新資訊，等有新 evidence 再回來"

**Similarity check**: Coordinator must quote both problem statements side-by-side in the reply before declaring match. Don't match on vibe.

**Note**: Cross-session tracking is Phase 2. Current implementation is session-scoped.

### Rule 3: HIGH consensus auto-downgrade

After R1, if ≥5/6 roles recommend the same direction → this is NOT a real dialectic. Dialectic's value requires genuine tension.

**Action**: Skip R2, skip Hegelian Arc section, output a **Downgrade Brief**:

```markdown
## Dialectic Downgrade Notice

This question had HIGH R1 consensus (5+/6 roles aligned). Dialectic
adds no value here.

Consensus direction: {X}
Single dissenter: {name + position}

Recommendation: next time, use `autopilot:think-tank` for this class of question.
```

Then provide a short summary brief (no Hegelian Arc, no forced synthesis).

### Rule 4: Turn-count budget for interim brief

No wall clock. Instead, track `dispatched_count` in working memory — increment before every `Agent` tool call.

- **Budget**: 8 (6 R1 role dispatches + up to 2 AskUser interactions)
- **Soft limit**: 12 (allows R2 re-dispatches and hemlock prompts)
- **Hard stop**: If `dispatched_count > 12` AND no brief has been produced → **immediately stop all further dispatches**. Output a 200-word interim brief compressing available R1 data, and state: "Deliberation has exceeded budget without converging. Stop here or take this offline for thinking."

### Rule 5: R2 hemlock rule — targets agents, not users

During R2 enforcement scan, check each agent's R2 response for these drift patterns:

- (a) Repeats R1 position with no new argument
- (b) Shifts to neutral ("both have merit") with no concrete synthesis proposal
- (c) Evades direct engagement with the declared Thesis or Antithesis

If any agent exhibits (a), (b), or (c) → send a **hemlock prompt**:

```
Your R2 response has drifted to neutrality or repetition. In 50 words
or less, state your strongest position on this specific thesis vs
antithesis. No hedging. No 'both sides'. Just your committed claim.
```

Apply especially to the 2 adversarial roles (Falsifier + Inverter), which are structurally most prone to drift (see Role Composition section).

---

## Role Composition — 4 職能 + 2 對抗性

Six roles total. Four provide domain context; two provide structural dissent.

### 4 職能 Roles (voltagent subtypes)

| Role | voltagent subagent_type | Focus |
|------|------------------------|-------|
| **Architect** | `voltagent-qa-sec:architect-reviewer` | Technical feasibility, coupling, performance, debt |
| **Product Director** | `voltagent-biz:product-manager` | User impact, ROI, scope, success metrics |
| **Ops/SRE** | `voltagent-infra:sre-engineer` | Deploy, monitoring, blast radius, rollback |
| **QA Devil** | `voltagent-qa-sec:qa-expert` | Regression risk, edge cases, failure modes |

These overlap with standard `think-tank` roles intentionally — domain context is the same, only the protocol differs.

### 2 對抗性 Roles (general-purpose + inline prompts)

| Role | subagent_type | Source | Purpose |
|------|---------------|--------|---------|
| **Falsifier** | `general-purpose` | Popper-style (see references/role-prompts.md) | Find what would prove the consensus wrong |
| **Inverter** | `general-purpose` | Munger-style (see references/role-prompts.md) | Invert — what would guarantee this fails? |

**Why not voltagent for these?** No voltagent subagent maps to "pure red team" or "inversion specialist". Using `general-purpose` + inline prompt keeps the skill self-contained (no global agent file dependencies).

**Structural weakness + mitigation**: `general-purpose` subagents lack the system-prompt-level role anchoring that voltagent subtypes provide. Over 2 rounds, adversarial roles drift toward neutrality. Mitigated by:

1. **R2 full prompt re-injection** — don't just pass R1 outputs; re-send the entire role prompt at R2 (mechanical — done in the execution sequence below)
2. **Concrete example moves** — role-prompts.md includes 2-3 specific actions per role (not abstract "be adversarial")
3. **Anti-drift anchor sentence at prompt start** (front-weighted, not at end):
   > "Your job is NOT to find middle ground. If you arrive at 'both have merit', you have failed your role. Your value comes from maintaining the adversarial lens — the panel has other voices for synthesis, you are here to challenge."
4. **Grounding Protocol Rule 5** (hemlock) is specifically designed to catch adversarial drift

---

## Execution Sequence

Follow in order. Maintain `dispatched_count` in working memory (increment before every Agent tool call). No R3.

### STEP 0: Parse + Re-entry Guard

1. Read the user's question.
2. **Scan conversation history** for prior `## Advance Decision Brief:` markers.
   - If found with similar problem statement → apply Rule 2 ladder (2nd = Quick Synthesis, 3rd = refuse)
3. State: "Think Tank Dialectic convened. Panel: {6 roles}. Rule 1-5 active."
4. Initialize `dispatched_count = 0`.

### STEP 1: Problem Restate Gate

(See `references/problem-restate-gate.md` for full prompt template.)

Dispatch all 6 roles in parallel with a 50-word restate prompt + alternative framing request. **`dispatched_count += 6`**.

Collect 6 restatements. If any restatement diverges significantly from the original, **flag to user before proceeding**:

```markdown
## Problem Restate Divergence Detected

{Role X} restated the problem as: "{their version}"
This differs from your stated question: "{original}"

Before we proceed, is {role X}'s framing closer to what you actually
want to decide? If yes, I'll use that as the confirmed problem statement.
```

Wait for user to confirm or reframe.

### STEP 2: Silent Pre-Check + Confirm

(See `references/silent-pre-check.md` for the 4-item checklist.)

Coordinator runs a silent self-audit — does not show the checklist to the user. Then presents the confirmed problem statement for one-line user confirmation.

### STEP 3: Round 1 — Informed Independent Analysis (PARALLEL, BLIND)

Dispatch all 6 roles in parallel with the R1 prompt (see `references/role-prompts.md`). Each role sees only the confirmed problem statement — no peer outputs.

**`dispatched_count += 6`**.

Wait for all to complete. Each role's output must be ≤400 words.

### STEP 4: Adaptive Depth Gate

Coordinator evaluates R1 consensus:

- **HIGH** (≥5/6 align on core recommendation): **Apply Rule 3 auto-downgrade.** Output Downgrade Brief and stop.
- **MEDIUM** (3-4 align): Default → go to R2
- **LOW** (<3 align): Default → go to R2

For MEDIUM / LOW, ask user ONE active probe question before proceeding:

```
R1 complete. Six roles, divided analysis. Before I go deeper —

Which role's R1 response made you most uncomfortable (either "that
can't be right" or "that hit too close to home")?

1. Architect
2. Product Director
3. Ops/SRE
4. QA Devil
5. Falsifier
6. Inverter
7. None — accept current brief

Your answer becomes the anchor for R2 (we'll stress-test that direction first).
```

If user picks 7 → output brief now without R2.
Otherwise → proceed to R2 with the selected role's position as focal point.

**`dispatched_count += 1`** (AskUser counts).

### STEP 5: Round 2 — Hegelian Cross-Examination

**Coordinator MUST first declare Thesis and Antithesis explicitly:**

```markdown
## Dialectic Framing

**Thesis** (R1 majority): {1-2 sentences — the dominant direction}
**Antithesis** (R1 strongest dissent): {1-2 sentences — the minority position}

R2 will examine both.
```

Then dispatch all 6 roles in parallel for R2. **Each dispatch payload must contain the FULL role prompt** (not just R1 outputs) — this is the re-injection step that keeps adversarial roles anchored.

**`dispatched_count += 6`**.

Each R2 response must:
- Reference at least 2 other roles by name
- Either strengthen their R1 position OR update it with evidence
- For adversarial roles: must attack specific claims, not restate generic red-team

After R2 collection, run **Enforcement Scan** (Rule 5):
- Check each response for drift patterns (a)(b)(c)
- If drift detected → send 50-word hemlock prompt to that specific agent
- **`dispatched_count += N`** (N = # of hemlocks)
- Wait for corrected responses
- If `dispatched_count > 12` at any point → **stop immediately**, apply Rule 4 interim brief

Dissent Quota check: at least 2 non-overlapping objections must remain after scan. If <2 → send counterfactual prompts to the 2 roles most likely to dissent (Falsifier and Inverter are default picks). **`dispatched_count += 2`**.

### STEP 6: Coordinator Synthesis

Coordinator identifies the Hegelian Arc:

1. **Thesis** (majority position from R1/R2)
2. **Antithesis** (strongest dissent from R1/R2)
3. **Synthesis** — **NOT a compromise**. A higher-order integration that transcends both. If you can't find one honestly, say so in the brief; don't fake it.

### STEP 7: Output Advance Decision Brief

Use the template at `references/brief-template.md`. Must include:

- Hegelian Arc (Thesis / Antithesis / Synthesis)
- Minority Report (first-class, full text not summary) — see `references/minority-report.md`
- Unresolved Questions (factual gaps)
- Questions Only You Can Answer (value/preference, panel structurally can't answer)
- **Recommended Next Steps (always present, even in non-CEO mode)**
- Epistemic Diversity Scorecard — see `references/epistemic-diversity-scorecard.md`
- CEO Recommendation (only if invoked from CEO mode)
- Confidence level with specific reasoning

### STEP 8: Follow-Up Prompt

Output a retrospective reminder:

```markdown
### Follow-Up Tracking

After you've acted on this decision, come back to log:
- What did you choose?
- Did the panel's analysis change your mind, or confirm what you already knew?
- Which role's position best predicted the outcome?

This feedback is the only way we'll know if dialectic is actually changing decisions.
```

---

## When to Use (Trigger Conditions)

Use `think-tank-dialectic` only when **all** of these are true:

1. You've already considered the decision for a while (it's not fresh)
2. There are two or more positions with real merit — this isn't a "which library" question
3. The decision is **irreversible or expensive to reverse** (architecture choice, platform migration, team structure, business model)
4. You can articulate **why** both sides have merit (if you can't, you haven't thought about it enough — use `think-tank` first)
5. You are willing to **commit** after the dialectic — you won't use it as another way to avoid deciding

If any of these is false, use one of:
- `autopilot:think-tank` — multi-perspective mapping
- `autopilot:survey` — external research on options
- `autopilot:brainstorming` (superpowers) — exploration with no set options

## Escalation from think-tank

Normal flow: user invokes `autopilot:think-tank` → R1 analysis → Decision Brief shows LOW consensus → brief's Escalation footer suggests `think-tank-dialectic`. User then invokes dialectic.

Do **not** skip think-tank and go straight to dialectic for a fresh question. Dialectic is higher-cost and less useful without a prior consensus assessment.

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Using dialectic for every strategic question | Over-meta, expensive, tool fatigue |
| Skipping `autopilot:think-tank` and going straight here | No consensus baseline to justify the cost |
| Ignoring Rule 3 auto-downgrade ("I want the full protocol anyway") | HIGH consensus dialectic produces hollow synthesis |
| Disabling Rule 2 re-entry guard ("I want to argue this again") | Infinite rehash. Use the escape hatch: commit as non-reversible and stop |
| Asking "which side is right" and expecting a verdict | Dialectic synthesizes; it does not adjudicate who wins |
| Treating Questions Only You Can Answer as "more work to do" | Those are structural limits — the panel **cannot** answer them, no amount of further analysis helps |

## Relationship to Other Skills

```
survey       → external research (what do others do?)
think-tank   → internal multi-perspective mapping (what perspectives exist?)  [entry point]
        ↓ (if R1 shows LOW consensus + irreversible)
think-tank-dialectic  → Hegelian resolution (how do we reconcile real tension?) [this skill]
        ↓
ceo-agent    → autonomous execution on the decision
```

| Skill | Relationship |
|-------|-------------|
| `autopilot:think-tank` | Parent — dialectic is an escalation target, not a replacement |
| `autopilot:survey` | If dialectic reveals an evidence gap, chain to survey to fill it |
| `autopilot:ceo-agent` | CEO may invoke dialectic for irreversible decisions within its Board-approval zone |
| `superpowers:dispatching-parallel-agents` | Used internally for R1/R2 parallel dispatch |

## References

- `references/role-prompts.md` — 6 role prompt templates (4 职能 + 2 adversarial) with R1, R2, and hemlock variants
- `references/brief-template.md` — Advance Decision Brief template with Hegelian Arc, Minority Report, Scorecard, and all required sections
- `references/problem-restate-gate.md` — 50-word restate + alternative framing prompt, divergence detection rule
- `references/silent-pre-check.md` — 4-item Coordinator self-audit checklist
- `references/minority-report.md` — section template and rules for preserving dissent faithfully
- `references/epistemic-diversity-scorecard.md` — scorecard calculation and trust ceiling rules
