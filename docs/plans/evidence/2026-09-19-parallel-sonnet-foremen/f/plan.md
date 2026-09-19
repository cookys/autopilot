# Plan F — two red suites become hermetic
1. Record the base FAIL sets (5 + ~35) as RED comments.
2. Fixture REVIEW_LOOP_CONFIG_OVERRIDE + ENGINE_SCORECARD_DIR built in TEST_TMP, applied to every check-scorecard / strict-bootstrap call; suites write their own qualified rows.
3. Negative control proving independence from the host's qualified set; no assertion loosened; genuine product reds left failing and named.
4. Green in normal and `env -i` runs; ONE commit; tests only.
Acceptance: both suites exit 0 on a host with no cursor qualification row and with an empty scorecard dir.
