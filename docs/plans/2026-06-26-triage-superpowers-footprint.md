# P0 Triage — superpowers / voltagent footprint (keep / flip)

> **Phase**: P0 of `2026-06-26-ecosystem-standalone-and-onboard.md` (no code; gate before any edit).
> **Status**: **APPROVED (Board 2026-06-26).** FLIP set S1–S5 + V1–V3 confirmed. **G1 → (a) light-touch**
> (keep `voltagent-*` in think-tank as *optional*, bring think-tank up to dialectic's graceful-degradation
> framing; no excision). **G2 → reorder** `.claude/dispatch-config.md` autopilot-first (keep one superpowers
> fallback as a live coexistence fixture). §6 trio injection carried into P1.
> **Execution override**: P1 runs via **`/l5`** (was `/l4` in parent plan §4) with a **gpt-5.5 xhigh
> loop-review** roster — decorrelated reviewer looping until convergence.
> **Method**: `git grep -il` over tracked files, then context-read each live surface. Default verdict = **KEEP**
> (historical record or already-explicitly-optional); **FLIP** only where a surface *states or implies a
> superpowers/voltagent-first default*, or *recommends/assumes* voltagent as a peer.

## 1. Footprint totals (tracked)

| Token | Files | Of which pure-history (plans/projects/CHANGELOG/eval-workspace) | Live surfaces |
|-------|-------|---------------------------------------------------------------|---------------|
| `superpowers` | 65 | 40 (KEEP wholesale) | ~25 |
| `voltagent` | 25 | 11 (KEEP wholesale) | 14 |

Pure-history is **KEEP, untouched** (KR5: zero content lost). The triage below is over the **live surfaces only**.

## 2. FLIP set — superpowers (states/implies a superpowers-first default)

| # | File:line | Current | Why FLIP | Proposed |
|---|-----------|---------|----------|----------|
| S1 | `hooks/session-start.js:124` | `…invoke the skill… Autopilot sets rules; Superpowers executes.` | **Injected into EVERY session start.** Frames superpowers as the assumed executor — the single loudest "superpowers-adjacent" signal in the product. | Drop the tagline (or → "Autopilot sets the rules and runs them standalone; delegates to superpowers when installed"). |
| S2 | `.claude/dispatch-config.md:8,12,18` | autopilot's **own** dogfood config lists `superpowers:*` **first** in Code-Review / Parallel / Debugging chains | autopilot's own repo prefers superpowers-first — directly contradicts the new premise (KR3: "no skill body emits a superpowers-first default"). It's a 2026-05-14 D-1 dogfood fixture whose retention was always "TBD at Step 7". | Reorder autopilot-first (superpowers as documented fallback), **or** delete the file (defaults are already autopilot-only). Recommend: reorder, keep one superpowers fallback entry as a live coexistence smoke-fixture. |
| S3 | `docs/coexistence.md:37` | Scenario A ("you have superpowers installed") labelled **"Recommended default."** | The *recommended default* should be ecosystem-standalone, not the superpowers-installed scenario. | Relabel: standalone is the default; A is "if you also run superpowers". |
| S4 | `docs/architecture.md:11` | "Claude Code on its own — even with the **built-in** `superpowers` plugin…" | superpowers is **not** built-in to Claude Code; calling it built-in implies an assumed baseline. | "even with `superpowers` installed". |
| S5 | `hooks/failure-escalation.js:128` | "Consider invoking `superpowers:systematic-debugging` if you haven't already." | Opt-in hook unconditionally suggests a superpowers skill as if present; no autopilot path offered. | Lead with `autopilot:debug`; mention superpowers only "if installed". |

## 3. FLIP set — voltagent (recommends/assumes voltagent as a peer)

| # | File:line | Current | Why FLIP | Proposed |
|---|-----------|---------|----------|----------|
| V1 | `docs/architecture.md:86-107` | "**Companion Plugins**… we **recommend installing voltagent** alongside" + `/plugin install voltagent` + "voltagent's role agents are usually the **better primary choice**" | Active recommendation of a now-dropped peer; the strongest "assumed voltagent" surface. (B): drop voltagent as assumed peer; keep only as out-of-scope. | Remove the recommendation + install line; reframe role specialization as **out of autopilot's scope** (autopilot owns methodology; bring-your-own role agents if you have them). |
| V2 | `project-config-template/team-config.md:10` | example role row uses `voltagent-lang:typescript-pro` | Template seeds voltagent as the example role-agent vocabulary for every consuming project. | Swap to a generic / `codeforge:*` example, or a plugin-neutral placeholder. |
| V3 | `agents/README.md:23,26,35,69-80` (+ `.opencode/agent-bodies/*` mirrors) | "autopilot methodology agents **and voltagent role agents** coexist…", "voltagent's role agents are usually the better primary choice", layer-cake names voltagent as **the** Role layer | Frames voltagent as the assumed Role half of the layer cake. | Keep the layer-cake **concept** (methodology vs role vs project), but name the Role layer **plugin-neutral** ("a role-specialist plugin, e.g. codeforge / any voltagent-style catalog if installed"), not voltagent-as-default. |

> Note: `agents/{reviewer,debugger,planner}.md` + `skills/quality-pipeline/references/code-review.md` only use
> voltagent as an **example mapping target** for the `NEEDS_DOMAIN_EXPERT` enum, behind "the **calling skill**
> maps to the appropriate role" — they already do **not** assume voltagent (agents explicitly have *no*
> voltagent catalog awareness, no runtime detect). Verdict: **KEEP**, optionally s/voltagent role/role
> specialist/ in the example text for consistency with V1–V3 (cosmetic, not a default-flip).

## 4. GRAY — two Board decisions (the real gate)

**G1 — voltagent role names inside `think-tank` / `think-tank-dialectic`.** These two skills *hard-name*
`voltagent-*` subagent_types as the **preferred** role dispatch (think-tank/SKILL.md:49-56 + role-prompts.md;
dialectic:108-134). This is the one place voltagent is **structural**, not just recommended. Note the asymmetry:

- `think-tank-dialectic` **already degrades gracefully** — an explicit block (lines 119-134): "voltagent is
  optional — degrade gracefully… the dialectic must run with zero voltagent agents present." → **already KR3-conformant.**
- `think-tank` is **lighter** on the disclaimer (role table reads as the primary mapping; the optional/native
  fallback lives only in the dispatcher row :148 + `<voltagent-type>` placeholder :95).

Two readings of "drop voltagent" for these:
- **(a) Light / positioning (recommended):** keep the `voltagent-*` names as an *optional preferred* dispatch,
  but bring `think-tank` up to dialectic's explicit graceful-degradation framing. Voltagent becomes
  "supported-if-present", never assumed. Cheap; matches KR3's "explicitly-optional" bar; preserves a working
  feature.
- **(b) Heavy / excision:** rip `voltagent-*` names out of think-tank entirely, replace with
  `general-purpose` + inline role prompts. Larger diff, removes a real (if optional) capability, and arguably
  over-scrubs (KR5 spirit). Out of proportion to a positioning recalibration.

→ **Recommend (a).** Confirm or override.

**G2 — fate of `.claude/dispatch-config.md` (S2).** Reorder autopilot-first (keep as a live coexistence
fixture) **vs** delete (defaults are already autopilot-only, so the file is pure dogfood residue).
→ **Recommend reorder** (keeps one real superpowers-chain smoke-test in-repo). Confirm or override.

## 5. KEEP set (no edit — for the record)

All **already** standalone-first / explicitly-optional / historical; touching them would only risk KR5 loss:

- **README.md** (`if you have it`), **CLAUDE.md** §Coexistence, **docs/skills.md** (superpowers-equivalent
  *comparison column* — factual), **docs/configuration.md:40** (example), **project-config-template/dispatch-config.md**
  ("create this file only when you have third-party plugins" — already gated), **project-config-template/quality-gate-config.md**.
- **Skill Coexistence sections** — `debug` / `team` / `test-strategy` / `profiling` SKILL.md: these are the
  *standalone-fallback* framing and **embody** the new premise already.
- **Graceful-fallback prose** — `skills/ceo-agent/SKILL.md:304`, `skills/research-to-ship/SKILL.md:73`,
  `skills/think-tank/SKILL.md:148` (dispatcher falls back to native).
- **references/plan-template.md:3**, **docs/BACKLOG.md** (history/attribution).
- **All 40 superpowers + 11 voltagent pure-history files** (docs/plans/*, docs/projects/*, CHANGELOG.md,
  skill-creator-workspace/* eval fixtures).

## 6. KR3 positive half — name the ecosystem trio (carry into P1, not a flip)

KR3 is two-sided: not just *remove* superpowers-first, but *name autopilot+codeforge+mnemos as the assumed
baseline where a baseline is stated*. **codeforge / mnemos are currently named nowhere.** Inject the trio at
the baseline-stating surfaces in P1:

- `README.md` intro (the "what is autopilot / what's the assumed environment" sentence),
- `docs/architecture.md` (replace the dropped voltagent "Companion Plugins" framing with the trio),
- `CLAUDE.md` §"What this repo is" (optional — dev-facing).

→ Not a P0 flip; logged so P1 doesn't miss the positive requirement.

---

### Gate ask (Board)

1. **Approve the FLIP set** S1–S5 + V1–V3 (8 surfaces)?
2. **G1** → (a) light-touch think-tank, keep voltagent optional? [recommended] or (b) excise?
3. **G2** → reorder `.claude/dispatch-config.md` autopilot-first? [recommended] or delete?

On confirmation, P1 applies exactly this flip-set + the §6 trio injection; P2–P6 proceed per the parent plan.
