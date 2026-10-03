# w111 landing — STOPPED at gates (not released)
Landing clone: /tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad/land, branch release/v2.36.111 (8 picks reworded, enforcement_mode=enforce after each)
Landed (local only): 142aadaf(A) 50a96e1b(C) c155b545(C-r2) 7547f5f2(A-r2) feb1a666(A3) 1aa27e77(A3 repair) f239e687(B) a4cb6360(D)
Full suite: 392 files, 1 red: hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh
 - assertion: "Population B: every 'reviewer_engine:' file pins the switches explicitly or is a POP_B_DEFAULT_ALLOW member" -> unreviewed: hooks/tests/campaign-resume-reviewing-phase.test.sh, hooks/tests/final-panel-seat-resume.test.sh, hooks/tests/lib/final-panel-seat-xproc-driver.js
 - green at origin/develop, red solo on branch; bisect: first bad = 142aadaf (row A) (already red there; later rows add the other two files)
 - slash-entry-probe FAIL lines in log are nested fixture noise (suite SKIPs/passes solo; not in Summary)
Not run: check-js-syntax, sync-codex check, validate.sh, review, release steps.
# w111 landing — SHIPPED v2.36.111, pushed 79c0960f
911b9a65 fix(campaign): resume admits a transient final-panel review failure; changed-file cap applies only to writing resumes (w111 row A)
4380ce34 fix(engine): final-panel resume re-dispatches only failed seats, reusing verdicts re-derived from artifacts bound to the same packet (w111 row C)
9350ae49 fix(engine): reused final-panel seats are re-qualified and reuse is proven across a real --resume (w111 row C-r2)
bbbb3dac fix(tests): the REVIEWING-resume suite finalizes and asserts the resumed status; a gate rejects lib.sh suites without finalize_test (w111 row A-r2)
68a3b0b4 fix(tests): the REVIEWING-resume engine stage resumes a final-panel transient fault to converged; finalize gate recognizes indirect finalizers (w111 row A3)
89e1bb9d fix(tests): finalize gate counts a bare FAIL test only as the last command; a node exitCode is no longer a finalizer (w111 row A3 repair)
c4cae9c9 fix(review): max-effort reviewer seats get a thinking-sized output budget; thinking-only max_tokens is a named failure (w111 row B)
43ba0308 fix(dispatch-author): a symlinked TMPDIR no longer breaks the agy bwrap scratch bind or the polarity verify command (w111 row D)
34ce65a9 fix(tests): register the w111 reviewer_engine fixtures with the Population B consult/discuss switch gate (w111 landing repair)
79c0960f release(v2.36.111): final-panel resume after transient faults reuses valid seat verdicts; max-effort reviewer output budget; symlinked TMPDIR; lib.sh finalize gate

Gates: full suite 392 files, 1 red (Pop B registration, bundle-only, repaired by e8a0becd, solo 60/60); L1 green in full; check-js-syntax, sync --check, validate.sh (30/30), preflight 9/9 green. slash-entry-probe passes.
Review: SHIP-AS-IS, claude-fable-5-1, review-1790988220-2436217-0822 (3 🔵 in CHANGELOG)
Note: author email rewritten to the 2537196+cookys noreply address (GitHub rejected cookys@gmail.com for privacy); trailers intact.
