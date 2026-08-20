# Frozen instantiation — v2.34.13 governance CLI scripts (dogfood, KR5)

Q1 consumer: an autopilot depth-0 orchestrator session (and its human operator
reading refusals/reports) driving the five governance scripts from a shell.
Q2 render: RUN the CLIs as a first-time consumer — invoke each with --help-less
wrong args, a minimal valid flow, and read every refusal message end-to-end.
Machine-consumable fully; no human-only qualities for this artifact class.
Q3 root-cause taxonomy (CLI class): unreadable refusals (no fix named), silent
exit codes, inconsistent flag vocabulary, error before usage guidance.
Q4 rulers (5):
  R1 every refusal names the violated rule AND the fix path
  R2 usage errors (exit 2) always show what a valid invocation looks like
  R3 flag names are consistent across the five scripts (--ledger, --contract...)
  R4 JSON outputs all carry schema_version + artifact_type
  R5 exit codes follow the documented 0/1/2 convention exactly
Q5 consistency registry: flag vocabulary + exit-code convention + refusal
  message shape ("REFUSED"/"BUILD ERROR" prefixes) across all five scripts.
