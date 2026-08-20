# Phase A/B pre-registration — single freeze (2026-08-20, BEFORE any corpus contact)

## Frozen executable
- `evals/skill-onoff/archaeology-scan.js` sha256 `51030691b4359b76ea7a3b3b97c2d192043a852ba1d74e08ad752af02c5d0142`
- Validity gate (run before this freeze, all PASS): G3 synthetic-green (eligible, all four
  markers =1; fixture sha256 `aeb46c31ee4053c9b3caa5f806dd5ed81e59415cb52f867ed72f87f8e99933e4`), G4 synthetic-inert (eligible, all markers 0; sha256
  `7e85b44370bb6c1b16e91d9e960f65fd33a854fb935efdd633aedd7b775bf71b`), G1 spike-A (NOT eligible — sonnet/2.1.237 excluded; raw Skill detected; the
  skill-injection pseudo-turn correctly NOT counted), G2 spike-B (raw TaskCreate detected;
  m4=0 — non-FF subject).

## Frozen Phase A parameters (verbatim from the scanner constants)
- Corpus root: `/home/cookys/.claude/projects/` (absolute, pinned). Executed ONCE.
- Qualifying record: assistant, non-sidechain, version ≤ 2.1.232, model claude-opus-5.
- Eligibility: ≥3 real user turns AND Skill tool_use `autopilot:dev-flow` on a qualifying
  record. Real-turn exclusion prefixes: `Base directory for this skill:`, `<`, `Caveat:`.
- Markers m1-m4 and the write-command predicate exactly as in the frozen scanner source.
- Labels: observed ≥2 sessions fired; absent = 0 detected across ≥5 eligible; else
  insufficient. Zero is a detection claim.

## Frozen Phase B texts (exercisable ONLY on explicit owner go)
- Task: `evals/skill-onoff/tasks/d2-l-multimodule/task.md` sha256 `47da3af77be633786622b24e40660d5ea165c637624f0a466b8f89a39b762a06` (turn 1 verbatim).
  Selection rule "first two L-size d2 tasks" degenerates without discretion: the frozen pack
  holds exactly ONE d2 task → Phase B = 2 reps of it.
- Turn 2 (frozen): "Also add plugin de-registration support: a public unregisterPlugin(name)
  that removes a registered plugin."
- Turn 3 (frozen, no wrap cue): "Thanks, that covers what I needed."
- Runner: headless sonnet, spike sandbox recipe, fixture settings.json pins
  CLAUDE_CODE_ENABLE_TODO_TOOLS=1. FS/git-residue markers only. Cap ≤6 calls incl. re-runs.

## Disclosure (MH4/676e32ab)
Depth-0 saw parts of the corpus earlier today for a DIFFERENT question (task-tool presence):
per-(version,model) TaskCreate usage counts and two sessions' L-1.5/L-1.6 TaskCreate
subjects (2f6d30b0, 82bd9ddb). Predicates were frozen from the plan text and validated on
non-corpus fixtures; no per-session marker tuning occurred. This prior exposure is why M4
expectations are non-zero; it does not touch m1-m3.
