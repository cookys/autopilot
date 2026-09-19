# Plan D — dispatch-author proves completion positively
1. RED: truncated preamble and tool-narrating draft both return authored at base.
2. Nonce-keyed AUTHOR/END frame (dispatch-review family) wraps the prompt; exactly-one BEGIN/END + zero tool fences ⇒ authored; else `truncated` exit 5 with reason. Codex transport untouched.
3. Artifact/raw_log written unframed so consumers keep their contract; manifest threads parent/root run id + depth like dispatch-hetero.
4. Pins; sync mirrors; verify (author, kimi, codex-transport, plan-review, verification-author suites); ONE commit.
Acceptance: the two 2026-08-29 outputs are `truncated`, a complete framed draft is `authored` with an unframed artifact.
