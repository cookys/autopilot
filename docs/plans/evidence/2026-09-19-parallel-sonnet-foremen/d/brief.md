# Brief D — unit name for this run: `author-d` (repair: `author-d-r2`, retry: `author-d-retry`)
clone = /home/cookys/projects/autopilot-par2/d-author · base_sha = 6d19cd18ca676318440fac9e40b7fa7a95971a0e (clone HEAD, includes the shadow commit) · run_id = par3-d · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/d/run

# `dispatch-author.sh` must prove completion positively; truncated or tool-narrating output is `truncated`, not `authored`

BACKLOG row: "`dispatch-author.sh` success predicate is 'non-empty stdout' — truncated / tool-narrating output reports
`authored`" (fired twice 2026-08-29, qoderclicn/Qwen3.8-Max-Preview: a 100-byte preamble ending at `[` and a 130 KB
mid-file draft with 36 text-form tool-narration fences (a triple-backtick fence whose info string is `tool`) both returned `status:authored`, exit 0, `final_status:null`).
Sidecar: `docs/backlog/dispatch-author-sh-success-predicate-is-non-empty-stdout-truncated-tool-narratin.md`.

Facts at base (verify): header contract `scripts/dispatch-author.sh:81-102` (status enum
`authored|empty_output|precondition_failed|runner_failed`, exit 0/1/2/3, 4=containment_breach). For every non-codex
runner the only gate before `emit_result "authored"` (`:1231`) is the non-empty grep at `:1205-1208`; the codex
transport (`CODEX_TRANSPORT=1`, `:1176-1223`) has chrome/witness/session checks, others have none. `dispatch-review.sh:540-574`
already owns a nonce-keyed `<<<AUTOPILOT-REVIEW-<32hex>>>>` / `<<<AUTOPILOT-END-…>>>` frame convention — the model.
`schemas/runner-result.schema.json:10-13` `status` is an open string (adding `truncated` is not a schema break).
Manifest `:842` hardcodes `parent_run_id: null, root_run_id: null, depth: 0` while `dispatch-hetero.sh:1701` threads the
exported lineage.

## Product
1. RED first, in `hooks/tests/dispatch-author.test.sh` (model: `:126` "normal output returns authored status",
   `:319-334` grok late-flush cases; use the suite's existing fake-runner seam): (a) a runner that prints a 100-byte
   preamble ending in `[` and exits 0 → at base `status: authored`, exit 0; (b) a runner that prints a draft containing
   tool-narration fences (triple-backtick fences whose info string is `tool`) → at base `authored`. Record both observed outputs in RED comments.
2. Positive completion predicate for the non-codex runners: the author prompt is wrapped with a derived, nonce-keyed
   terminal frame in the SAME family as dispatch-review (`<<<AUTOPILOT-AUTHOR-<32hex>>>>` … `<<<AUTOPILOT-END-<32hex>>>>`,
   the nonce generated per run, never guessable from the prompt text); the artifact is the framed body. Locate the
   frame with the SAME locator rules dispatch-review.sh uses (`:540-574`, incl. the grok preamble split and the
   duplicate-BEGIN handling of v2.36.4/v2.36.70) — copy them faithfully, do not hand-roll a third parser, and name the
   duplication in REPORT.md as a follow-up for a shared lib. Success requires
   exactly one BEGIN and one END with the run's nonce, in order, and zero text-form tool-narration fences
   (a triple-backtick fence whose info string is `tool`, `tool_call` or `function_call`, or a literal `<tool_call>` tag) inside the frame. Missing/incomplete frame with
   non-empty output ⇒ NEW status `truncated` (exit code 5, documented in the header next to the others, with the
   reason: `frame_missing` / `end_missing` / `tool_narration`), never `authored`. `empty_output` keeps its meaning.
   Codex transport (`CODEX_TRANSPORT=1`) keeps its own checks byte-identical — do not touch that branch.
3. Consumers that read the authored artifact (`grep -rn "dispatch-author" scripts/*.js scripts/*.sh src | grep -v test`
   — at least `dispatch-plan-review.js` and the l6 verification-author path `scripts/dispatch-author-kimi.js` if it
   reads the raw log) must receive the UNFRAMED body (strip the frame in dispatch-author before writing the artifact
   file / `raw_log`), so their contracts do not change. Verify with their suites (below).
4. Manifest lineage: `:842` threads `AUTOPILOT_PARENT_RUN_ID` / `AUTOPILOT_ROOT_RUN_ID` / depth the same way
   `dispatch-hetero.sh:1701` does (read that code; same env names), `null`/0 only when unexported.
5. Codex mirror of every touched script via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first; `# RED at <base sha>: …` comment beside each new assertion; never weaken an existing one)
- `hooks/tests/dispatch-author.test.sh`: the two RED cases → `truncated` exit 5 with reasons; a well-framed output →
  `authored` and the artifact/raw_log has NO frame lines; an output with the frame but a foreign nonce → `truncated`;
  exported `AUTOPILOT_ROOT_RUN_ID` appears in the manifest.
- `hooks/tests/dispatch-author-result-failures.test.sh`: the exit-code table includes 5.

## Verify (foreground, all exit 0)
```
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-author-result-failures.test.sh
bash hooks/tests/dispatch-author-kimi.test.sh
bash hooks/tests/dispatch-author-codex-transport.test.sh
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/verification-author-resolver.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`scripts/dispatch-author.sh`, `scripts/dispatch-author-kimi.js` (only if it reads the raw artifact and must strip the
frame), their codex twins under `platforms/codex/plugin/`
via the sync script, `hooks/tests/dispatch-author.test.sh`, `hooks/tests/dispatch-author-result-failures.test.sh`.
Nothing else; no schema files; do not touch `dispatch-review.sh`, `dispatch-hetero.sh` or `scripts/dispatch-plan-review.js`
(a sibling unit owns it; its generic non-`authored`+`error` handling will carry `truncated` — say so in REPORT.md).

## How you work (foreman rules — identical for every unit)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout, never `cd` the main
  checkout. All product work is done by ONE hand you dispatch; you verify by git artifacts (`git -C <clone> diff --stat`,
  `git -C <clone> log`, the hand's result JSON), never by its self-report. Depth 0 reaches the verdict from git after you
  finish. Every git/script command runs against YOUR clone: `git -C <clone> …` and `cd <clone> && bash scripts/…`.
- Your clone carries one clone-local commit ("PARALLEL-RUN LOCAL ONLY … enforcement_mode shadow") on top of the base;
  `<base_sha>` for the hand is that clone HEAD (given at the top of the brief). Depth 0 cherry-picks the hand's commit
  only; the shadow commit is never merged. Do not touch `.claude/owner-kernel-governance.json`.
- Hand dispatch (exact form; substitute <unit>, <clone>, <run_dir>, <base_sha>; keep every other flag). Run it with the
  Bash tool's `run_in_background: true` (it takes up to 40 min; a foreground call would time out) and **in the same
  turn** start a dead-man's switch, also `run_in_background: true`: `sleep 3000; echo WAKE-<unit>`. Then END YOUR TURN
  and wait for the harness notification (either one). Never foreground-poll, never `sleep` in the foreground, never
  read the background task's output file with a shell command.
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.dispatch.json 2> <run_dir>/<unit>.dispatch.err; echo "rc=$?" >> <run_dir>/<unit>.dispatch.err`
  Write `<run_dir>/hand-<unit>.md` first (one heredoc): paste the "Product", "Tests", "Verify" and "Allowed files"
  sections below VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync
  scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the
  mirror in the same commit if it changed; run every verify command in the foreground before committing; never set
  `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run."
  On ANY wake (notification or dead-man): first `grep -c '^rc=' <run_dir>/<unit>.dispatch.err`. If 0 the hand is
  still running (the dispatch is detached and lands its result in the ledger even if the shell was killed): run
  `cd <clone> && node scripts/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement --timeout 500 --json`
  in the foreground once; if it reports landed, read the result from the ledger/dispatch JSON; if not, start another
  background dead-man (`sleep 1500; echo WAKE-<unit>`) and end your turn — at most 3 extra waits, then ESCALATION.md.
  When the result is there: read `<run_dir>/<unit>.dispatch.json` with `head -c 3000` (status, branch, head sha, acceptance) — never
  the raw hand log. `status: implemented` + `git -C <clone> log --oneline <base_sha>..hands/<run_id>/<unit>` showing
  exactly one commit is the only success signal.
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <clone> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run (also `run_in_background`
  + a `sleep 1200; echo WAKE-review-<unit>` dead-man; append `; echo "rc=$?" >> <run_dir>/<unit>.review.err` the same way):
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json 2> <run_dir>/<unit>.review.err`
  Read the verdict with `node -e` printing only `verdict`, and each finding's severity + title (never the whole JSON).
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head sha of hands/<run_id>/<unit>>` and `--run-id <unit>-r2`, prompt =
  the original hand prompt + "## Repair round — fix these review findings" listing them verbatim; re-review the delta
  (`git diff <r1 head>..hands/<run_id>/<unit>-r2`). At most one repair round; then report.
- Budget: 40 Bash calls total (a guard denies the 41st). Plan them: write prompt (1), dispatch+deadman (2), read
  result (1), log/diff-stat (2), review+deadman (2), read verdict (1), optional repair (6), report (1). Do NOT read
  large files into your context; use `head`/`grep -n`/`sed -n`.
- If the hand fails before committing (precondition_failed, transport error, acceptance_failed with no commit), read
  `<unit>.dispatch.err` tail and the failure reason, then dispatch ONE retry with the same prompt plus the failure
  reason appended (`--run-id <unit>-retry`, branch `hands/<run_id>/<unit>-retry`). Two failures ⇒ write ESCALATION.md
  (exact reason, what you tried) and stop.
- REPORT.md (write to `<run_dir>/REPORT.md`, ≤ 80 lines) must name: hand branch(es) and head sha(s), `diff --stat`
  vs base, the review verdict and every finding with accepted/refuted + one line why, the verify commands' tail lines
  as recorded in the dispatch JSON, anything NOT done, and any BACKLOG-row text you found to be wrong. Your final
  message to depth 0 is the REPORT.md content verbatim, nothing else.
