## Plan
# Plan D — dispatch-author proves completion positively
1. RED: truncated preamble and tool-narrating draft both return authored at base.
2. Nonce-keyed AUTHOR/END frame (dispatch-review family) wraps the prompt; exactly-one BEGIN/END + zero tool fences ⇒ authored; else `truncated` exit 5 with reason. Codex transport untouched.
3. Artifact/raw_log written unframed so consumers keep their contract; manifest threads parent/root run id + depth like dispatch-hetero.
4. Pins; sync mirrors; verify (author, kimi, codex-transport, plan-review, verification-author suites); ONE commit.
Acceptance: the two 2026-08-29 outputs are `truncated`, a complete framed draft is `authored` with an unframed artifact.

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

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by
hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it
changed; run every verify command in the foreground before committing; never set
`AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
