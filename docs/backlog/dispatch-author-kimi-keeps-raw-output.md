# dispatch-author-kimi.js deletes the raw output when the runner fails, so the cause is invisible (BL-0343)

Found while adding kimi-code/k3.1-pro (merge 098057d53): missing k3.1-pro in the kimi CLI config gave only runner_failed.

Fix direction: keep the raw output on failure, or print the key error lines to stderr. Negative control: a failing runner must leave a readable cause.
