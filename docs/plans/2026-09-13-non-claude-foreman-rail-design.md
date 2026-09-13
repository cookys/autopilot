# A non-Claude engine in the foreman seat — design, round 1

**Status**: design (round 1), 2026-09-13. **Owner ruling 2026-09-13: round 2 builds Shape B** —
the motive is Claude quota, and Shape A does not move spend. No rail is built by this document.
**Requested by**: `308-db` (2026-09-13) and, independently, `chatgpt-tunnel-host` (2026-09-12).
**Owner ruling**: build the rail rather than bypass it; this round delivers the design.
**Evidence**: `docs/plans/evidence/2026-09-13-non-claude-foreman/kimi-probes/` — every kimi
claim below is a captured file there (P1–P5c). Anything not measured is marked **未驗證**.
**Decorrelated read**: GLM-5.2 via `dispatch-author.sh` (the configured consult seat, grok, is
behind the 402 paywall); its five answers are folded in below and marked ⟨consult⟩.

## 1. What is true today

There is no supported path for a non-Claude engine to hold the control loop. `skills/l4/SKILL.md`
states l4 is all-Claude and routes a heterogeneous implementer to l5; `scripts/dispatch-hetero.sh`'s
contract is only-IMPLEMENTS with the verdict retained at depth 0. That is an implementer rail. The
foreman is a native `Agent(run_in_background, isolation:"worktree")` — a Claude subagent by
construction (`skills/ceo-agent/references/level-front-door.md` § Dispatching the foreman).

So an operator who names `kimi-code/k3` as the foreman is reduced to `kimi -p "$(cat brief)"` in
the main checkout by hand — which is exactly the shape that produced item (E) (`agy` committing to
the main branch) and is now blocked by v2.36.32's main-checkout boundary **for rail-dispatched
hands only**. A hand-typed foreman sits outside every gate this repo has.

## 2. What the foreman seat actually requires

From `level-front-door.md` § The foreman and `skills/l4/SKILL.md`, the foreman today:

| Responsibility | Concrete demand on the engine |
|---|---|
| Runs dev-flow's admitted deliverable INLINE at depth 1 (planning, gating) | Long, accumulating context: reads the brief, the plan, the rubric, prior handoff; keeps state across 40 Bash calls |
| Leaf-dispatches the implementer and first-pass reviewer to depth 2 | Tool calling with shell access; must invoke `dispatch-hetero.sh` / `dispatch-review.sh` and parse their JSON |
| Reads `[ESCALATION]` from workers, escalates to depth 0 | Multi-turn: must be resumable so depth 0 can answer and the foreman continues |
| Writes `autopilot:handoff` at the 40-Bash cap (一刀一命) | File writes in the worktree; must stop itself, not be killed |
| Obeys `foreman-guard` (PreToolUse deny on the 41st Bash, on polling, on Monitor) | **This hook is Claude-Code-native.** A non-CC engine has no PreToolUse surface; the ironlaw must be enforced by the rail wrapping it, or it is not enforced |
| Emits a run-ledger the depth-0 `watch-foreman.js` can sense | Structured, line-buffered output the wrapper can translate to `run-ledger.sh` records |
| Never holds merge authority; verdict stays at depth 0 | Whatever shape is chosen must not let the foreman integrate or pronounce |

The last two rows are the ones a model name cannot satisfy on its own; they belong to the rail.

## 3. What kimi 0.41.0 can do — measured

| Capability | Measured | Probe |
|---|---|---|
| Non-interactive prompt, shell tool executes | **Yes.** `-p` runs a `Bash` tool call and returns its output | P1 |
| File editing | **Yes.** `Read` + `Edit` tool calls, file changed on disk | P2 |
| Multi-turn / resume | **Yes.** Both `kimi -r <id>` (the hint's spelling) and `kimi -S <id>` resume with prior-turn memory | P3 |
| ACP over stdio | **Yes.** `initialize` answered with `loadSession`, session list/resume/fork/close, MCP http/sse | P4 |
| Prompt ceiling | **The ~120 KB limit is the kernel's per-string `MAX_ARG_STRLEN` (32×PAGE_SIZE = 131072) on the single `-p` argv**, not kimi's context: 128 KB passes, **129 KB** dies `argument list too long` (exit 127, before kimi runs) while `ARG_MAX` is 2 MB — so it is the per-string limit, not total argv ⟨consult asked for exactly this distinction⟩ | P5 |
| Large context via file | **Yes.** A 300 KB file read through the `Read` tool returned the trailing nonce | P5b |
| stdin prompt | **No.** `-p -` is taken literally | P5c |
| `--output-format stream-json` | **Yes**, and it is the only auditable format: every tool call and result is a line | P1 |
| `--auto` / `-y` combined with `-p` | **未驗證 here** — peer chatgpt-tunnel-host reports the CLI refuses the combination but bare `-p` already executes shell non-interactively; P1 corroborates the second half |
| Wait-tool cap, 10-minute reopen | **未驗證** — peer report only |
| Behaviour at the 40-tool-call cap when nobody enforces it | **未驗證** — there is no cap; kimi will keep going |

**The peer's crux, re-derived**: "120 KB is the wrong shape for a role that accumulates context"
is true for `-p`-only usage and **false as stated** — the ceiling is argv, and the model reads
files past it. What remains true: the foreman's context must be **files it reads**, not a prompt
it is handed, and `-r` multi-turn means it does not have to be re-briefed per turn.

## 4. Two rail shapes

### Shape A — thin foreman: Claude keeps the loop, outsources decisions

```
CEO (depth 0)
└── foreman = Claude sub-orchestrator (depth 1), as today
    ├── decision-consult → kimi via dispatch-consult / dispatch-discuss   ← NEW: the seat
    ├── implementer worker (depth 2)
    └── first-pass reviewer (depth 2)
```

The foreman remains a native Agent; kimi is asked *what to do next* at each loop decision point
(admit/skip, retry/escalate, repair scope) through the existing read-only consult rail, and the
Claude foreman executes. kimi never holds a tool.

| | |
|---|---|
| "verdict stays at depth 0" | **Preserved mechanically, not socially** ⟨consult⟩. kimi holds no tool and no rail to the repo, so it cannot integrate or pronounce. But if the Claude foreman complies with the consult answer every time, the decision's *substance* has migrated to kimi and depth 0 merely pronounces it. Mitigation: the foreman records consult answer vs its own decision per decision point (`ledger` row), so the migration is measurable rather than assumed |
| foreman-guard / 一刀一命 | Unchanged — the Claude foreman is still the one under PreToolUse |
| Main-checkout boundary | Unchanged — no new hands |
| What the operator actually gets | Decorrelated *judgement* in the loop, not decorrelated *execution*. **A does not touch quota** ⟨consult: the cited digest names spend as the motive, and A leaves every foreman Bash call on Claude's bill⟩. If quota is the request, A is a measurement step, not a deliverable |
| Cost | S. `dispatch-consult.sh` exists; a foreman brief clause + a consult-at-decision-points contract |

### Shape B — true foreman: kimi holds the loop

```
CEO (depth 0)
└── foreman = kimi (depth 1) via NEW scripts/dispatch-foreman.sh
    ├── implementer worker (depth 2)  ← kimi invokes dispatch-hetero.sh itself
    └── first-pass reviewer (depth 2) ← kimi invokes dispatch-review.sh itself
```

kimi runs in a dispatcher-created worktree (never the main checkout), with the brief and plan as
**files** (P5b), `--output-format stream-json` captured as the audit log, resumed with `-r` when
depth 0 answers an escalation (P3). The rail, not the model, enforces what `foreman-guard` enforces
for Claude: it counts `Bash` tool-call lines in the stream and kills at 41; it applies the
main-checkout boundary and content gate from v2.36.32 to anything the foreman's hands commit; it
translates stream events to `run-ledger.sh` records so `watch-foreman.js` works unchanged.

| | |
|---|---|
| "verdict stays at depth 0" | **At risk, must be enforced by the rail.** kimi can run `git merge`. The rail must (a) run kimi under the v2.36.32 no-push hooksPath env, (b) put the worktree on a branch depth 0 later integrates, (c) treat any foreman-side integration as `boundary_rejected`. The contract is the same one dispatch-hetero already has for hands — "only IMPLEMENTS, verdict at depth 0" becomes "only ORCHESTRATES, verdict at depth 0" |
| foreman-guard / 一刀一命 | **Must be re-implemented in the rail** — count tool calls in stream-json, force a handoff write at the cap. Two implementations of one ironlaw is the shape that produced 7840hs (4); mitigate by making the rail the only implementation for non-CC foremen and citing the same constant |
| Main-checkout boundary | Inherited from v2.36.32 if kimi is launched through `run_worker`-equivalent env; **未驗證** that kimi's child processes inherit `GIT_CONFIG_*` (they should — it is env) |
| Rail-owned enforcement the first draft missed ⟨consult⟩ | (1) **Audit-log placement**: P2 proves kimi edits files in its worktree; the stream-json capture and run-ledger must live OUTSIDE the worktree or the audited party can rewrite its own trail. (2) **Self-reported stream is not a ledger**: the rail must verify claimed actions at git level (commits exist, branch is where it says) rather than translate kimi's own events into ledger rows. (3) **Egress**: P4 shows MCP http/sse; nothing gates the foreman's outbound channels the way `foreman-guard` gates Claude — the rail needs an egress policy or an explicit "unbounded" receipt. (4) **Orphans at kill**: killing kimi at the cap does not kill depth-2 workers it dispatched; the rail needs process-group containment (dispatch-hetero's `setsid`/cgroup `run_worker` is the existing shape). (5) **Secrets in env**: the doc asked whether `GIT_CONFIG_*` reaches kimi's children; the symmetric question — what ELSE in the env reaches them — is the one that matters |
| Transport | ACP (P4) or `-p` + `-r` (P1/P3). ACP gives session control (list/resume/fork) and MCP; `-p` is what dispatch-hetero already wires for the kimi implementer seat (argv-only with the byte gate). Start with `-p`/`-r`: it is proven, argv-gated, and the foreman's inputs are files anyway |
| Cost | M. New rail + guard re-implementation + ledger bridge + tests; the kimi transport is not from zero |

### The split, applied

Two of chatgpt-tunnel-host's four root causes were general and are already handled or queued
outside any foreman rail: (E) main-checkout boundary → **shipped v2.36.32**; (D) candidate-commit
identification → `dispatch-hetero(<engine>): edits on …` subject, now asserted by the content gate's
range checks. (A) output-path namespace collision and (B) exit-file contract remain general
detached-dispatch defects and stay on the general list; Shape B **depends on (B)** — a kimi foreman
polling for its workers is the exact spin they measured — so (B) is a prerequisite, not a part.

## 5. Recommendation

**Shape A first, as a measured step, then decide B on evidence.** Reasons, in order:

1. The contract at stake — verdict at depth 0 — is preserved mechanically in A and only by
   diligence in B. Every gate this repo has shipped this week exists because diligence failed.
2. A costs S and produces a measurement: how often the non-Claude judgement differs from the
   Claude foreman's at a decision point, and whether it was right. ⟨consult: this is NOT the
   metric a quota-motivated B needs — that metric is spend per deliverable, which A cannot
   produce because A does not move any spend.⟩ So A justifies B only if the request is
   judgement diversity; if the request is quota, A is a detour and the honest sequence is B
   with the five rail-owned enforcements above as its acceptance criteria.
3. B's prerequisite (exit-file contract, (B) above) is unbuilt. Building B first means building
   (B) inside a foreman rail, which fixes it for foremen only — the split ruling again.

If the operator's goal is specifically **Claude quota** (the cuda 2026-09-04 digest: four Sonnet
foremen at 79% of spend), A does not address it and B is the only shape that does. That is a
question for the operator, not this document; the document's claim is only that B must not skip
the rail-side enforcement listed above.

## 6. The question this document could not answer — now answered

Is the request **judgement diversity** or **Claude quota**? The two peers' wording says foreman
seat; the cost digest says quota. Put to the operator 2026-09-13: **quota**. So round 2 is
**Shape B**, with the five rail-owned enforcements in §4 as its acceptance criteria and the
exit-file contract ((B) in §4's split) as a prerequisite built on the general rail, not inside
the foreman one. Shape A is not built.

## 7. Open items marked 未驗證

- ~~kimi child processes inherit `GIT_CONFIG_*` (env-config push block) — needs one probe.~~ **Measured** (P9, evidence README): the `Bash` tool sees `GIT_ALLOW_PROTOCOL=` and the `GIT_CONFIG_*` entries. Round 2 built the rail: [`2026-09-13-foreman-rail-b-build.md`](2026-09-13-foreman-rail-b-build.md).
- `-p` with `--auto`/`-y` refusal — peer-reported, not re-run.
- kimi behaviour when a tool call is denied/killed mid-stream — needed for the rail-side cap.
- Whether ACP's `session/prompt` accepts embedded file context large enough to replace the
  file-read pattern — `embeddedContext: true` is advertised (P4), size ceiling unmeasured.
