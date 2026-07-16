# Engineer-narrative panel (round 2) — 2026-07-16

Engines: **codex gpt-5.6-sol** (primary) · **agy** · **MiniMax-M3** · **glm-4.7**  
Scope: state machine + /demo /levels /recipes /landing after engineer rewrite  
Raw: `/tmp/panel-site-eng/out-*.txt`

## Adopted (codex — highest fidelity to repo SSOT)

| Finding | Fix shipped |
|---------|-------------|
| /l3–/l6 is **topology**, not “who writes” only | Levels: caller/foreman/implementer/verify author/gate/worktree matrix + H1 lead |
| Missing **DISPATCH** (worktree/foreman control plane) | Added to demo state table + landing strip |
| Missing **FINALIZE** after GATE | Added; happy path GATE→FINALIZE→DONE |
| REVIEW must label **issuer** | Demo invariants + IMPLEMENT⇄REVIEW evidence column |
| “Human only IDLE/ESCALATE” overclaim | Caveat: Autopilot lifecycle only; CC permission/auth prompts out of guarantee |
| Demo needs event **trace** not only ASCII | /l5 schematic trace table (honest: not a recorded run_id) |
| Nav: story first | Demo → Levels → Recipes → Install → Proof; Philosophy/Skills demoted |

## Partial / deferred

| Idea | Decision |
|------|----------|
| Real fixture-recorded run with SHAs | **Deferred** — needs a committed known-good run artifact in repo; schematic labeled honest |
| Kill Philosophy page | **Keep** but demoted; content already state-mapped |
| agy: rename Proof → Benchmark | **Reject** — product is honesty/scars, not perf theater |
| MiniMax: no IMPLEMENT←REVIEW loop | **Reject as stated** — loop is real (Critical → re-implement); wording clarifies direction is findings-driven |
| glm: CI parallel PRE_FLIGHT / ROLLBACK states | **Reject** — not this product’s control plane; would invent SSOT |

## agy useful bits kept as polish debt

- Collapse duplicate tables behind details (optional UX)
- ESCALATE resume path already documented (→ INTAKE\|DECIDE)

## Copy frozen from panel C (codex)

- 把目標與紅線交給 Autopilot；它依可檢查的證據推進，在需要你的決定時才停下。
- /l3 inline；/l4 背景 worktree foreman；/l5 異質 implement–review；/l6 再派 verification authoring；gate+merge 在 depth-0。

## Status

**Satisfied for this sleep cycle** on: engineer vocabulary consistency, topology accuracy, honest schematic bounds.  
**Not claiming:** live recorded demo fixture (next dogfood task).
