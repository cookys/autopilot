# Interactive-CC drivability spike — pre-registration (2026-08-20)

Context: option B (multi-turn / event-instrumented harness) needs a runtime that can SEE
dev-flow forcing functions. Zero-cost archaeology (this session, before any spend) established:

- TaskCreate EXISTS in interactive CC 2.1.23x and dev-flow forcing functions fire in
  production: `~/.claude/projects/-home-cookys-projects-{308,autopilot}/*.jsonl` transcripts
  dated 2026-08-17 and 2026-08-20 contain `tool_use: TaskCreate` with L-1.5/L-1.6 subjects.
- The OLD residue channel (`~/.claude/tasks/<session>/<id>.json` with blocks/blockedBy) is
  DEAD: newest task JSON machine-wide is 2026-07-27; later dirs hold only `.highwatermark`
  (a counter, still advancing → tasks still allocated) + `.lock`.
- Replacement channel: project transcript JSONL records every tool_use with full input and
  `caller` attribution.

Remaining unknown, and the ONLY question this spike answers: **can interactive CC be
sandbox-isolated, script-driven, plugin-armed, and its transcript harvested?**

## Pre-registered predicates (frozen before first live call)

| # | Predicate | PASS condition |
|---|---|---|
| P1 | Isolated launch | scratch HOME + scratch CLAUDE_CONFIG_DIR (credentials-only seed) + `--plugin-dir` reaches input-ready state in tmux |
| P2 | Arm realization | plugin skill invocable: transcript shows `tool_use: Skill {skill:"autopilot:dev-flow"}` |
| P3 | Task-tool presence + harvest | direct mechanical instruction to create a task yields `tool_use: TaskCreate` (or successor name) in a transcript file findable under the scratch sandbox |
| P4 | Multi-turn drive | a second user turn is delivered and transcript separates the turns; quiescence detection (transcript-size stability + pane state) correctly identifies turn end |

## Budget & stop rule

≤ 8 live calls (1 driven user turn = 1 call). Plan: session 1 carries P1-P4 in 2 turns;
remaining 6 are retry buffer. Any predicate still FAIL after buffer exhausted → spike closes
NO-GO; that is a result, not a failure to report.

## Scope guard (G1-B11)

GO licenses exactly one thing: designing the option-B harness on this channel. It licenses
NO harness design decisions, NO behavioral claims about dev-flow, NO campaign. P3 tests tool
PRESENCE via direct instruction — deliberately NOT skill-driven behavior, which is the
campaign's question, not the spike's.

## Probe prompts (frozen)

- Turn 1: "List the exact names of the skills you can invoke through the Skill tool. Then
  invoke the skill autopilot:dev-flow with args 'probe'. Do nothing else."
- Turn 2: "If a tool exists that creates a task (for example TaskCreate), call it to create
  one task titled spike-probe-task and report the tool's exact name. If none exists, say
  NO_TASK_TOOL. Do nothing else."

Model: sonnet. CLI: claude 2.1.237. Flags: `--model sonnet --plugin-dir <synthetic>
--dangerously-skip-permissions`. Sandbox: scratch HOME, scratch CLAUDE_CONFIG_DIR seeded with
`.credentials.json` only, `.claude.json` with hasCompletedOnboarding+bypassPermissionsModeAccepted,
fresh one-commit git repo as cwd. Driver: tmux send-keys; quiescence = transcript byte-size
stable + pane input-ready marker.

---

# Results (2026-08-20, same session — 2 live calls of 8)

| # | Verdict | Evidence |
|---|---|---|
| P1 | **PASS** | Input-ready reached. Required seeds beyond the -p recipe: `oauthAccount` + `theme` + `bypassPermissionsModeAccepted` in `.claude.json` (seeded into BOTH scratch HOME and scratch CLAUDE_CONFIG_DIR; which is read was not isolated). Dialogs still hit once: trust-folder (Enter). Without oauthAccount seed: full login screen. |
| P2 | **PASS** | `driven-session-transcript.jsonl` contains `tool_use: Skill {"skill":"autopilot:dev-flow","args":"probe"}` + "Successfully loaded skill". |
| P3 | **CHANNEL PASS / TOOL ABSENT** | Subject ran ToolSearch twice (`TaskCreate`, `task create`) then answered `NO_TASK_TOOL`. The channel (transcript tool_use records incl. ToolSearch) is fully harvestable; the tool does not exist. |
| P4 | **PASS** | Two real user turns separated with per-record timestamps. Scorer caveat: `"type":"user"` records also include tool_results and Skill-load injections — filter by content shape. |

## The finding that outgrew the spike

**The task-tool family (TaskCreate/TaskUpdate) is absent from ALL runtimes at CC ≥ 2.1.233 — interactive included. It is a version cliff, not a headless-vs-interactive split.**

Machine-wide transcript scan (per-record `version` + `timestamp` fields, not file mtime):

| CC version | last record seen | task-tool calls | last call |
|---|---|---|---|
| 2.1.231 | 2026-08-14 | 50 | 2026-08-13 |
| 2.1.232 | 2026-08-16 | 24 | 2026-08-16 |
| 2.1.233 | 2026-08-20 | **0** | — |
| 2.1.234 | 2026-08-18 | **0** | — |
| 2.1.237 | 2026-08-20 | **0** | — |

Corroboration: official CHANGELOG 2.1.233–2.1.237 says nothing about task tools (undocumented);
`~/.claude/tasks/` JSON residue died earlier (2026-07-27) while `.highwatermark` kept advancing
— the "tasks" concept appears re-purposed for background executions (TaskOutput/TaskStop remain).

Reframe of prior evidence: the 2026-08-18 headless probe measured a version truth, not a mode
truth — at 2.1.234 interactive had no task tools either. The June 2026 record (2.1.175) and the
8/13–8/16 interactive transcripts show the tools existed before the cliff.

**Trap caught in-flight**: initial archaeology dated TaskCreate hits by file mtime ("8/17, 8/20")
— wrong; resumed sessions touch old files. Per-record timestamps put every hit at ≤ 8/16 /
≤ 2.1.232. File mtime is not a record timestamp.

## Consequences

1. **Production defect, bigger than the eval question**: every dev-flow forcing function
   (L-1.6 / L-5 / H-9 / S-scope-gate), finish-flow sub-tasks, and ceo-agent/l3-l6/team task
   trees reference a tool that no longer exists for ANY user on CC ≥ 2.1.233. 16 shipped
   files reference TaskCreate. Repairing dev-flow precedes measuring it.
2. **Drivability GO**: sandbox-isolated, script-driven, plugin-armed interactive CC with
   transcript-JSONL harvest is proven (this doc + transcript). The option-B harness has a
   working channel for everything that still exists.
3. **Scope guard holds**: GO licenses the channel only. The FF families cannot be measured
   until the mechanism they instrument exists again — in whatever replaces TaskCreate.

---

# Follow-up: the gate found, decompiled, and the lever verified (same day, +2 live calls = 4/8)

## Mechanism (binary archaeology, CC 2.1.237 bundle)

```js
function NW(){ if(q.CLAUDE_CODE_ENABLE_TASKS===!1)return!1; return!0 }        // kill switch, default on
function dZ(){
  if(Kk()||mIs())return!0;
  let e=UDr();                                    // current model
  if(e===void 0||Wxv(e))return!0;                 // model NOT ≥ list threshold → tools on
  if(q.CLAUDE_CODE_ENABLE_TODO_TOOLS===!0)return!0;  // explicit opt-in → on
  return nt("tengu_rosy_wren",!1)===!0            // statsig gate, DEFAULT FALSE
}
function Ere(){ return NW()&&dZ() }
// zxv = [["opus",[4,8]],["sonnet",[5]],["fable",[5]],["mythos",[5]]]  (at-or-later semantics)
```

Differential: `tengu_rosy_wren` absent in the 2.1.231 binary, present in 2.1.234/2.1.237 —
the gate shipped at 2.1.233 (released 2026-08-14), matching the machine-wide usage cliff.
Per-(version,model) scan: fable-5 made 24 TaskCreate calls at 2.1.232 (8/16, pre-gate);
zero calls by ANY 5-era model at ≥2.1.233.

## Official confirmation

- SDK docs (code.claude.com/docs/en/agent-sdk/todo-tracking): TS SDK ≥0.3.233 / Py ≥0.2.139,
  TodoWrite+TaskCreate/Get/Update/List unavailable on **Opus 4.8, Sonnet 5, Fable 5, Mythos 5
  or later of those families** unless opted in. Three levers: `allowedTools` naming a task tool,
  `tools` option, or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. `CLAUDE_CODE_ENABLE_TASKS=0` swaps Task
  tools back to legacy TodoWrite.
- CC CHANGELOG: silent about all of this (the 2.1.233 release notes do not mention task tools).
- Issue #80401: a SECOND, model-matched remote kill-switch `tengu_vellum_ash` (cached in
  `~/.claude.json`) can unregister exactly TaskCreate/TaskGet/TaskList/TaskUpdate mid-session
  even on pre-2.1.233 builds. No Anthropic response in-thread. ⇒ only the env var pin is
  deterministic; server-side state is not to be trusted by a harness (or by production).

## A/B/C verification (same sandbox, same frozen prompt, sonnet, 2.1.237)

| Arm | Env | Result |
|---|---|---|
| A interactive | (none) | ToolSearch×2 → `NO_TASK_TOOL`; no residue |
| B interactive | `CLAUDE_CODE_ENABLE_TODO_TOOLS=true` | `Tool used: TaskCreate`; task list UI renders; `config/tasks/<sid>/1.json` written (blocks/blockedBy schema intact) |
| C headless -p | `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | stream-json contains TaskCreate tool_use; final text names the tool; `1.json` residue written (`headless-envvar-probe.jsonl`) |

## Consequences (supersedes two prior hard boundaries)

1. **"Headless -p has no task tools regardless of flags" (2026-08-18 probe) was a MODEL-GENERATION
   truth, not a runtime truth.** That probe ran sonnet(-5) — a gated model — with the gate's
   default-false statsig. Under `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` every forcing-function family
   is observable in plain headless -p: tool_use channel AND durable task-JSON channel.
2. **Option B no longer needs an interactive lane to see forcing functions.** Multi-turn -p +
   env pin covers FF; the tmux-driven interactive lane (proven anyway, P1-P4) is now an
   external-validity upgrade, not a necessity.
3. **Production**: on 5-era models without the env var, every dev-flow forcing function
   silently no-ops (16 shipped files reference TaskCreate). Repair lever exists and is
   official; `tengu_vellum_ash` means even non-gated setups can lose the tools mid-session —
   pin the env var, don't trust the default.
