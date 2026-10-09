# Epistemic Diversity Scorecard

> Used by `think-tank-dialectic` Step 7 brief section. Self-evaluation of the deliberation itself: were the 6 roles genuinely divergent, or did they all echo the same reasoning dressed in different clothes?

## Purpose

This is a **meta-check** on the brief itself. A dialectic session can technically complete all 7 steps but produce a low-quality brief because the 6 roles converged on the same reasoning from the same frame. The scorecard is the canary that warns the user: "the brief looks complete but the underlying deliberation was shallow".

**Reference**: `council-of-high-intelligence/SKILL.md` lines 521-525 (Epistemic Diversity Scorecard in the Council Verdict output template). Council includes this because multi-provider routing can fail silently — same reasoning from different providers still counts as convergence, not diversity. In `think-tank-dialectic`'s Claude-only environment, the risk is even higher: all 6 roles run on the same model family, so "diversity" must come from prompt-level differences, which are inherently weaker than architectural differences.

## The Scorecard

```markdown
### Epistemic Diversity Scorecard

- **Perspective spread** (1-5): {score with 1-line justification}
- **Evidence mix**: {% empirical / % mechanistic / % strategic / % ethical / % heuristic}
- **Convergence risk**: {Low | Medium | High} — {1-sentence reason}
- **Trust ceiling**: {HIGH | MEDIUM | LOW}
```

## Perspective Spread (1-5)

How orthogonal were the 6 roles' R1 positions?

| Score | Meaning | Example |
|-------|---------|---------|
| **5** | Genuinely divergent — at least 3 distinct analytical frames produced different recommendations | Architect says "rewrite", Product says "ship as-is", Ops says "defer", with different reasoning chains |
| **4** | 2 clearly different positions + some nuanced middle ground | Majority says X, strong minority says Y, rest cluster between |
| **3** | 1 dominant direction with scattered hedges | 4/6 say X, 2/6 hedge but don't offer alternatives |
| **2** | Near-consensus with cosmetic variation | 5/6 say X with slight phrasing differences, 1 says "X but with caveats" |
| **1** | Pure echo chamber | All 6 say the same thing in slightly different words |

**Scoring rule**: Count **distinct recommendations** (not distinct phrasings). If 4 roles recommend "rewrite in Rust" and 2 recommend "refactor in place" with genuinely different rationales → that's 2 distinct positions. If 4 roles recommend "rewrite" with different reasons but the same conclusion → that's still 1 distinct position.

**HIGH consensus auto-downgrade check**: If perspective spread is 1-2 AND you somehow got past Rule 3 without auto-downgrading (maybe MEDIUM consensus technically but the "disagreements" were superficial), this scorecard is the second-chance catch. Mention the downgrade recommendation in Confidence.

## Evidence Mix

Classify every major claim in the 6 R1 outputs into one of 5 categories:

- **empirical**: Based on observed data, measurements, or specific file/code evidence. "The test suite takes 47 seconds" is empirical.
- **mechanistic**: Derived from understanding how the system works. "This change will cascade to X because Y depends on Z" is mechanistic.
- **strategic**: Based on competitive, business, or political dynamics. "Shipping first gives us a moat" is strategic.
- **ethical**: Based on what should be done regardless of consequences. "We shouldn't ask the team to carry this debt without telling them" is ethical.
- **heuristic**: Rule of thumb, experience-based, or "industry standard" invocations. "Monoliths don't scale past 50 engineers" is heuristic.

Calculate percentages. **Target mix** depends on the question:

- **Technical decision**: Should be heavy on empirical + mechanistic. If >50% heuristic, the brief is weak.
- **Strategic decision**: Should have meaningful strategic + some empirical. If 100% strategic with no empirical anchor, the brief is detached from reality.
- **Values decision**: Should have meaningful ethical component. If 100% strategic/empirical with 0% ethical, the panel is treating a values question as an optimization problem.

**Warning flag**: If any single category is >70% of the mix, the panel is reasoning with only one toolkit. Flag in Convergence Risk.

## Convergence Risk (Low / Medium / High)

This is the **main canary**. Did the deliberation genuinely probe the question, or did it reflect confirmation in 6 different fonts?

### Low convergence risk
- Perspective spread 4-5
- Evidence mix has ≥3 categories each ≥15%
- R2 produced at least one genuine position update (some role changed their mind)
- Dissent Quota was met without needing Counterfactual prompts
- Minority Report is substantive (not a formality)

### Medium convergence risk
- Perspective spread 3
- Evidence mix dominated by 1-2 categories but ≥1 minor category
- R2 mostly reinforced R1 positions
- Dissent Quota required 1 Counterfactual prompt to force
- Minority Report exists but is thin

### High convergence risk
- Perspective spread 1-2
- Evidence mix >70% single category
- R2 was basically R1 repeated with engagement language
- Dissent Quota required hemlock prompts OR failed despite hemlock
- Minority Report is a placeholder ("the Falsifier mentioned but did not emphasize X")

## Trust Ceiling

The trust ceiling is **the maximum confidence this brief can support**, regardless of what the Confidence section says.

**Formula** (apply in order, first match wins):

1. If Convergence Risk = **High** → Trust ceiling = **LOW**. The brief cannot support a high-confidence decision. User should treat the Synthesis as one input, not an answer.

2. If Perspective Spread ≤ 2 → Trust ceiling = **LOW**. Regardless of other factors.

3. If any evidence category is >70% of the mix → Trust ceiling = **MEDIUM**. Single-toolkit reasoning.

4. If Dissent Quota required hemlock prompts to meet → Trust ceiling = **MEDIUM**. Adversarial drift was active.

5. Otherwise → Trust ceiling = **HIGH**. The deliberation was genuinely diverse.

**Critical rule**: If the Confidence section says "High" but the Trust ceiling is "LOW" or "MEDIUM", the **Trust ceiling wins**. The brief must display the ceiling explicitly so the user knows to discount confidence claims.

## Where to Place the Scorecard

The scorecard goes **between** the "Recommended Next Steps" section and the "Confidence" section in the Full Brief. This positioning is intentional: the user sees next steps (what to do), then sees the scorecard (how much to trust the preceding analysis), then sees confidence (the brief's self-rating).

## Example Scorecards

### Low-risk example

```markdown
### Epistemic Diversity Scorecard

- **Perspective spread**: 4 — Architect recommended rewrite, Product recommended defer, Falsifier recommended neither but proposed a third path
- **Evidence mix**: 45% empirical, 25% mechanistic, 15% strategic, 10% heuristic, 5% ethical
- **Convergence risk**: Low — R2 produced 2 position updates, Minority Report is substantive (Falsifier held firm)
- **Trust ceiling**: HIGH
```

### High-risk example

```markdown
### Epistemic Diversity Scorecard

- **Perspective spread**: 2 — All 6 roles essentially recommended "go with option A" with different framings
- **Evidence mix**: 72% heuristic, 18% strategic, 8% mechanistic, 2% empirical, 0% ethical
- **Convergence risk**: High — Dissent Quota required 2 hemlock prompts and was met only nominally; R2 mostly repeated R1
- **Trust ceiling**: LOW

**Note**: Despite the Synthesis section recommending option A with "High" confidence, the Trust ceiling is LOW. This brief should be treated as one input, not an answer. Consider rerunning with a different problem framing (Rule 2 permits 1 more invocation on this topic).
```

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Gaming the scorecard to justify HIGH trust | The scorecard exists precisely because Coordinator motivation is to produce a "clean" brief. Resist |
| Treating Trust ceiling as advisory | It's prescriptive — if it's LOW, the Confidence section must be capped |
| Skipping the scorecard for short briefs | Short briefs benefit most from the meta-check. Always include |
| Inflating perspective spread based on phrasing | Count distinct recommendations, not distinct wording |
| Putting Trust ceiling after Confidence | The ordering (Scorecard before Confidence) exists so the ceiling constrains the claim, not the other way around |
