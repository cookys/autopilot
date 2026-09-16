Recommendation: blind the input and the process boundary, not the runner. Any runner can sit on a panel if it receives a content-addressed clean packet and runs behind a kernel-enforced isolation profile. Blinding becomes a property you can test with canaries instead of a runner allow-list.

## 1. The design

**Packet blinding, mandatory for every seat.** Replace "copy diff and spec into scratch" with a packet builder that produces one directory per candidate commit, hashed, and shared by all seats:

- `tree/`: a `git archive` export of the candidate commit. No `.git`, so no history, no commit messages, no `.git/autopilot`.
- `diff.patch`: generated with `git diff base candidate`, never `format-patch`, so no commit text rides along.
- `spec.md`: the task spec only. The implementer's report, self-attestations, and prior-round reviewer text are never in the packet. Prior-round findings the operator wants re-checked go into the spec as neutral acceptance criteria, rewritten by the rail, not pasted.
- A deny-list applied to `tree/` and the diff: `.autopilot/**`, evidence dirs, `**/*.receipt.json`, review decision records. Defaults ship in config; the canary test below proves the list works.
- `MANIFEST.json` with the packet hash. Every seat receipt records that hash, so "all seats saw identical input" is asserted, not assumed.

Code comments and test names stay visible. They are the code under review. A reviewer who reads "verified, passes" in a comment is reviewing an untrustworthy comment, and the rail re-derives anyway per ADR-0001. What blinding must remove is what a seat could adopt as a conclusion: other seats' verdicts, receipts, evidence, and the implementer's narrative. The packet removes all of those.

**Two seat tiers, both count.** A runner declares `tools: false` or `tools: true` in the runner table.

- `packet` tier: prompt-only runners, run as today on the packet.
- `cleanroom` tier: tool-capable runners, run inside the packet under an isolation profile. The reviewer can grep the tree, run the suites, and probe for tautological tests. This is the mode that found today's two bad tests, so it should be allowed, and I would let the operator require at least one cleanroom seat per panel.

**Isolation profile for cleanroom seats.** The A2 spike is big because it tries to prove bwrap semantics for one CLI. Use a UID drop instead, which the kernel enforces regardless of which CLI is inside:

- One-time host setup creates review UIDs, one per parallel slot, such as three for a three-seat panel plus one standby.
- The dispatcher creates the packet copy and a per-seat scratch HOME owned by that UID, mode 0700, containing only the credential files the runner needs. No sessions, no history, no MCP entries.
- The seat runs via `setpriv` with a cleared environment. The operator's home, the real repo, `.autopilot`, and sibling seats' HOMEs are unreadable by permission, whatever `--sandbox` flag codex thinks it has. Seats write nothing except stdout, which the dispatcher captures. Sibling scratch copies contain only the identical packet, so even a readable sibling cwd carries nothing to leak.
- Network stays on. That is the residual channel. Mitigate by asserting the sanitized config has no MCP servers and no shared local endpoints. bwrap can be layered later as a second profile if you want to close `/proc` and `/tmp` enumeration, but it is no longer a prerequisite.

**Ordering.** All panel seats dispatch concurrently from the same packet. Independence comes from packet identity plus isolation, not from sequencing, and parallelism also eliminates the window where a late seat could observe a finished one.

## 2. Gate placement

Both, but with different jobs. Intake decides. The resolver only re-checks a snapshot.

At intake, for each pinned seat, run a preflight that makes no model call: build a tiny canary packet, exec the seat's isolation profile with a stub reviewer that tries to read the real repo path, the operator HOME, the dispatcher's `/proc` cwd, and a sibling HOME, and assert every read fails. This takes seconds. A tool-capable runner on a host without review UIDs fails here with a specific error, not an hour later. Optionally add a one-token auth call per seat.

Intake then snapshots the resolved panel into campaign state. The final panel resolves from that snapshot, never from live config, so a pin change mid-campaign cannot cause a late refusal. If the live pin differs at panel time, log it and proceed with the snapshot.

Mixing tiers should satisfy `min_panel_size` and family rules. Tiers are orthogonal to families. The only tier rule I would add is the optional `require_cleanroom` minimum. The A3 "advisory seat that does not count" variant becomes unnecessary once cleanroom seats are properly blinded.

## 3. Speed cuts

- **Run each verification suite once per candidate tree.** Key the sealed results by tree hash. The in-rail stage and the final panel stage share the same tree, so the second run is redundant. Depth-0 re-derivation means the rail derives it, not that it derives it twice.
- **Delete the in-rail single-seat review when a final panel is configured.** It is a subset of the panel with one seat and delays the panel by its own wall clock. Keep it as an opt-in fast mode with a short timeout for campaigns that have no panel.
- **Panel seats run in parallel.** Panel time becomes the slowest seat rather than the sum.
- **Overlap.** Start packet build and panel dispatch the moment the implementer commits. Run the rail's own suites concurrently with the panel. Cleanroom seats run tests themselves anyway. Union-on-verified-critical then re-derives only the criticals the seats raised.
- **Standby seat.** Dispatch one extra seat in parallel. A single transport timeout or format fault no longer fails the panel, which is where MiniMax and GLM hurt you this week. Discard the extra receipt if the minimum is met.

Expected effect: the review phase drops from serial single review plus serial panel plus a second suite run to one packet build plus one parallel panel plus one suite run. A refused panel costs seconds at intake instead of an hour at the end.

## 4. Migration

Modules to change:

- `src/runners/review.js`: replace the scratch copy with `buildPacket` as described. Return the packet path and hash. Redaction lives here.
- `scripts/dispatch-review.sh`: replace the four-runner allow-list with a capability lookup. `tools: false` runs as today. `tools: true` requires an isolation profile and execs through `setpriv` with the per-seat HOME. Add a `--preflight` flag that runs the stub probe without a model call.
- `campaign-intake.js`: seat admission calls preflight per seat, validates size and family rules against the resolved set, and writes the panel snapshot into campaign state.
- `autopilot-engine.js` `performFinalPanel`: read the snapshot, build one packet, dispatch all seats with `Promise.allSettled`, run the output canary check on each receipt, then union and re-derive. Gate the in-rail review on `review.in_rail`.
- Runner table: add `tools` and `isolation_required` fields.

Operator knobs:

- `review.redact`: deny-list of packet paths.
- `review.isolation`: `uid` or `bwrap`; `none` is refused at intake for tool-capable runners.
- `panel.seats`, `panel.min_size`, `panel.min_families`, `panel.require_cleanroom`, `panel.standby`.
- `review.in_rail`: `off` by default when a panel exists.
- `verify.reuse_by_tree_hash`: on by default.

Red-first tests, each written to fail on today's code:

1. **Packet canary.** Plant three unique tokens: one in an untracked evidence file, one in a commit message, one in a deny-listed tracked file. Build the packet and grep the whole directory. Zero hits.
2. **Attestation canary.** The implementer's report contains a token. Assert the packet spec lacks it.
3. **Adversarial seat.** A stub runner declared `tools: true` runs under the isolation profile and attempts to read the real repo, operator HOME, `.autopilot`, and every readable path under `/proc/*/cwd`. Assert its stdout contains no planted token and that each read returned permission denied.
4. **Sibling isolation.** Two stub seats in parallel each write a token to their HOME and stdout. Assert neither output contains the other's token.
5. **Packet identity.** All receipts in a panel carry the same packet hash.
6. **Fast fail.** Pin a tool-capable seat on a host with no review UIDs. Intake must fail in under ten seconds with the isolation error. Then change the pin after intake and assert the panel uses the snapshot.
7. **Lying seat.** A stub seat reports a verified critical that the tests pass. Assert the rail runs the verify command anyway and its result overrides.

Trade-offs to accept:

- Cleanroom seats lose git history. The spec must carry intent. This is the price of removing commit text, and it is the right price.
- Hosts that cannot create review UIDs still refuse tool-capable seats, but now at intake, and the reason is a host fact rather than a design ceiling.
- Cleanroom seats are slower because they run suites. Parallel dispatch hides that behind the slowest seat, so budget the panel timeout to the cleanroom seat.
- Network remains open inside the sandbox. Assert the sanitized config has no MCP or local endpoints, and note the residual in the blind-dispatch reference.
