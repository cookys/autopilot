# BL-0375 probe policy: review follow-ups (BL-0385)

Four Suggestion-level findings from the probepol review (g1/g2, 2026-11-04). None blocks anything. Each item: problem, then impact.

a. No-registry test does not compare bytes (`scripts/claude-account-capture.test.js`, around line 777). It asserts only `code === 0` and the top-level readdir, not stdout/stderr bytes against 05a70bf82. Impact: the byte-for-byte proof lives only in the evidence file.
b. A manual `usage-probe --purpose foo` audit line also counts as demand (`scripts/lib/account-probe.js`, `demandAliases`). Fix idea: exclude every line the probe command writes itself. Impact: a manual probe can keep an alias looking demanded.
c. `hooks/tests/config-audit.test.sh` line 73 says a schema-1 user "sees exactly the schema-2 entry", but nothing asserts the count of 1 or that the entry names `accounts.quota_probe`. Impact: the claim in the comment is unchecked.
d. The dry-run ctx in `claude-account.js` `cmdUsageProbeDue` is a shallow `Object.assign` copy. If ctx ever gains getters or becomes a class, the copy would diverge silently. Impact: latent only.

Source: probepol review g1/g2 (2026-11-04). Effort S.
