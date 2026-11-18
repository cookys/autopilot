# Kimi broker runner verification

Historical evidence for the original runner branch at the immutable base below. The
local-stop integration retains local jury/readiness/capability gates and enables only
broker-backed implementer selection; current policy is in
[`references/hetero-dispatch.md`](../../references/hetero-dispatch.md#kimi-broker-implementer).

Fleet task: 01M7Q4E2XJ8HFMF16ZZFHPY6EG. Immutable base: `c1003c903e45e539e6cca874ccd2fe6496777285`.
All logs and companion exit-code files are under `/tmp/kimi-broker-evidence-01M7Q4E2/`.

## 1. Task and acceptance

Replace default account-local Kimi implementer execution with the shared broker, reusing the Cursor protocol and clone lifecycle. Acceptance: unchanged Cursor 23-assertion suite, Kimi commit/metadata/clone cleanup, structured billing exhaustion and clearing, model/CN refusal before connecting, socket/quota-only automatic eligibility, no additional dispatch failures, executable Kimi suite, negative control, inventories and generated mirrors synchronized.

## 2. Located original lines

- Client: `function readPrompt(file) {` and composer-only model predicate; clone helper: `fs.realpathSync(process.env.AUTOPILOT_CURSOR_WORK_ROOT || '/srv/cursor-work')`.
- Kimi precondition: `command -v "$KIMI_BIN" ... || die_precondition "kimi binary not found ..."`.
- Kimi launch: `run_worker bash -c 'cd "$1" && exec "$2" -m "$4" -p "$(cat "$3")" --output-format text'`.
- Metadata: billing reason hardcoded as `cursor_stopped_billing`; timeout/verdict fields cursor-specific.
- Availability: pace used only `exhaustedKimi({})`; jury used `fs.accessSync(path.join(os.homedir(), '.kimi-code', 'bin', 'kimi'), fs.constants.X_OK)`; topology used `resolveBinaryPath(binaryName, r)`; safe readiness spawned local `--version`; safe capacity wrapper used `runner_bin_fallback kimi`.
- The before-edit quotes and subsequent criterion results were reported in sequence; the running record is `scaffold.md` in the evidence directory.

## 3–4. Incremental changes and verification

1. Parameterized the existing client/run helpers by runner deployment policy. Unchanged Cursor suite: `step3-shared-cursor`, exit 0, 23 assertions.
2. Added broker-default Kimi dispatch and explicit local fixture seam. Separate cases a/b/c/f: exits 0 (3/3/5/7 assertions), `step3-kimi-{a,b,c,f}`. CN refusal case d: exit 0, 12 assertions across transcript/sensitive/core-size/novel/review-role inputs with unchanged socket connection count.
3. Migrated the five automatic availability call sites. Case e: exit 0, verifies missing/non-socket/stub-socket, exhausted, cleared and invalid-pattern states across pace/topology/jury/readiness/safe capacity, then performs auto broker dispatch. Stock Kimi disabled entry was removed; measured quota and other gates remain. Pace unit isolation repair: exit 0, 45 passed, `step3-pace-isolated`.
4. Registered deployment keys, updated inventories/contracts and generated mirrors. Initial sync caught an overlong script-inventory line; after splitting it, `step3-sync-fixed` exits 0 with all 16 rituals green.
5. Final checks found two transport fixtures missing the test-only CN bypass; their sentinel transports were isolated without changing the product gate. Both reruns are green (178 and 79 assertions). The legacy quota unit fixture lacked a socket, used an obsolete pace row and compared two unknown selections; its original scratch replay is red (`quota-fixture-red`, exit 1), repaired scratch replay green (`quota-fixture-green`, exit 0/5). The new oracle checks available → exhausted → reset → exhausted → done and zero socket connections.

Broker negative control: only the Kimi execution arm was restored to the base local-CLI arm in `negative/scripts/dispatch-hetero.sh`; case a exits 1 (`negative-control.log` / `.rc`). Exact red line:

`FAIL [kimi-broker-runner] (a) kimi broker dispatch exits 0: expected '0', got '1'`

Restoring the broker arm in that scratch copy makes case a exit 0/3 assertions (`restored-control.log` / `.rc`). A sentinel local binary exits 99, so the negative control never uses a real login.

## 5. Final verification

| Command | Exit | Result / artifact |
|---|---:|---|
| `bash hooks/tests/cursor-broker-runner.test.sh < /dev/null` | 0 | 23 assertions; source unchanged; `final-cursor-broker.log` |
| `bash hooks/tests/dispatch-hetero.test.sh < /dev/null` | 1 | 394 passed / 16 failures; immutable base identical; comparison green; `final-dispatch-hetero.log` |
| `node --test scripts/pace-select.test.js < /dev/null` | 0 | 45 passed; `final-pace.log` |
| `node --test scripts/kimi-quota-observe.test.js < /dev/null` | 0 | 5 passed; `final-kimi-quota.log` |
| `bash hooks/tests/cleanroom-launch-kimi-agy.test.sh < /dev/null` | 0 | Suite own final summary green; `final-cleanroom-launch-kimi-agy.log` |
| `bash hooks/tests/dispatch-author-kimi.test.sh < /dev/null` | 0 | Suite own final summary green; `final-dispatch-author-kimi.log` |
| `bash hooks/tests/dispatch-kimi.test.sh < /dev/null` | 0 | Suite own final summary green; `final-dispatch-kimi.log` |
| `bash hooks/tests/dispatch-review-blind-kimi-agy.test.sh < /dev/null` | 0 | Suite own final summary green; `final-dispatch-review-blind-kimi-agy.log` |
| `bash hooks/tests/final-panel-kimi-agy-intake.test.sh < /dev/null` | 0 | Suite own final summary green; `final-final-panel-kimi-agy-intake.log` |
| `bash hooks/tests/kimi-broker-runner.test.sh < /dev/null` | 0 | Suite own final summary green; `final-kimi-broker-runner.log` |
| `bash hooks/tests/qualification-kimi-spelling.test.sh < /dev/null` | 0 | Suite own final summary green; `final-qualification-kimi-spelling.log` |
| `bash hooks/tests/qualify-kimi-credential-writeback.test.sh < /dev/null` | 0 | Suite own final summary green; `final-qualify-kimi-credential-writeback.log` |
| `bash hooks/tests/role-kit-kimi.test.sh < /dev/null` | 0 | Suite own final summary green; `final-role-kit-kimi.log` |
| `bash hooks/tests/strike-kimi-engine-spelling.test.sh < /dev/null` | 0 | Suite own final summary green; `final-strike-kimi-engine-spelling.log` |
| `bash scripts/sync-codex-plugin-skills.sh < /dev/null` | 0 | Generated mirrors; `final-mirrors.log` |
| `bash scripts/sync-all.sh --check < /dev/null` | 0 | All 16 rituals green; `final-sync.log` |

The final test driver opens stdin as the null device (Node `stdio: ignore`), equivalent to the requested shell redirection. Test environments use absent broker socket overrides unless the suite creates its own stub. The immutable base dispatch archive run exits 1 with 394 passed / 16 failed (`base-dispatch-hetero.log`). Full final Summary tails match after normalizing only fixture temporary paths: `root-dispatch-comparison.log` / `.rc`, exit 0, **0 new failing assertions**. The 16 cc-shim fixture failures are explicitly recorded; the suite itself is not claimed green.

The new suite is executable on disk; Git mode must be 100755 at staging. The Cursor broker suite source is unchanged. Root independent Kimi/Cursor reruns also passed 35/23 assertions (`root-kimi-broker.log`, `root-cursor-broker.log`).

## Changed files (one reason per file)

- `CHANGELOG.md` — Record broker-default Kimi behavior, eligibility and preserved CN gates without a version bump.
- `docs/dev/kimi-broker-runner-verification.md` — Record ordered scaffold steps, final exit codes, negative controls, file reasons and scope limitations.
- `docs/scripts-inventory.md` — Index the existing helpers as shared Cursor/Kimi transport and document structured quota observation.
- `hooks/tests/dispatch-review-blind-kimi-agy.test.sh` — Isolate sentinel transport tests from the CN gate and ambient credential-bearing environment.
- `hooks/tests/kimi-broker-runner.test.sh` — Add executable stub-broker integration, quota/refusal/availability/verdict tests and scratch-script seam.
- `hooks/tests/role-kit-kimi.test.sh` — Isolate sentinel role-kit tests from the CN gate and credential-bearing recorder environment.
- `platforms/codex/plugin/references/hetero-dispatch.md` — Regenerate the canonical references/hetero-dispatch.md mirror: Document Kimi deployment policy, shared lifecycle, eligibility, limits and rollback.
- `platforms/codex/plugin/scripts/dispatch-hetero.sh` — Regenerate the canonical scripts/dispatch-hetero.sh mirror: Use the shared broker by default for Kimi with metadata/verdict mapping; retain explicit local fixture seam.
- `platforms/codex/plugin/scripts/kimi-quota-observe.test.js` — Regenerate the canonical scripts/kimi-quota-observe.test.js mirror: Replace the obsolete local-availability oracle with an unconnected socket and real measured-seat state transitions.
- `platforms/codex/plugin/scripts/lib/config-keys.json` — Regenerate the canonical scripts/lib/config-keys.json mirror: Register Kimi socket/root/model-pattern/group seams and correct shared-helper reader locations.
- `platforms/codex/plugin/scripts/lib/cursor-broker-client.js` — Regenerate the canonical scripts/lib/cursor-broker-client.js mirror: Parameterize one protocol client by runner policy, structured observer and socket/quota admission.
- `platforms/codex/plugin/scripts/lib/cursor-broker-run.js` — Regenerate the canonical scripts/lib/cursor-broker-run.js mirror: Parameterize the existing shared-clone and diff-import lifecycle for both broker runners.
- `platforms/codex/plugin/scripts/lib/kimi-quota-observe.js` — Regenerate the canonical scripts/lib/kimi-quota-observe.js mirror: Consume structured done/billing-stop verdicts independently of broker log text.
- `platforms/codex/plugin/scripts/lib/pace-roles.json` — Regenerate the canonical scripts/lib/pace-roles.json mirror: Enable eligible broker-backed Kimi while retaining minimax in the disabled list.
- `platforms/codex/plugin/scripts/pace-select.js` — Regenerate the canonical scripts/pace-select.js mirror: Exclude Kimi unless the broker socket exists and its quota is not exhausted.
- `platforms/codex/plugin/scripts/pace-select.test.js` — Regenerate the canonical scripts/pace-select.test.js mirror: Isolate ambient broker quota and retain a non-vacuous disabled-pool oracle.
- `platforms/codex/plugin/scripts/probe-engine-capability.sh` — Regenerate the canonical scripts/probe-engine-capability.sh mirror: Make safe status/capacity admission use broker availability while preserving explicit live probes.
- `platforms/codex/plugin/scripts/resolve-dispatch-topology.js` — Regenerate the canonical scripts/resolve-dispatch-topology.js mirror: Make installed-runner discovery admit Kimi through its broker instead of a local binary.
- `platforms/codex/plugin/scripts/review-jury.js` — Regenerate the canonical scripts/review-jury.js mirror: Use broker availability before any Kimi PATH or HOME binary lookup.
- `platforms/codex/plugin/skills/dev-flow/references/card-relocated.md` — Regenerate the canonical skills/dev-flow/references/card-relocated.md mirror: Expose the existing shared broker helpers in the available-scripts index.
- `platforms/codex/plugin/src/readiness/probe.js` — Regenerate the canonical src/readiness/probe.js mirror: Use socket/quota admission for Kimi safe-surface readiness.
- `references/hetero-dispatch.md` — Document Kimi deployment policy, shared lifecycle, eligibility, limits and rollback.
- `scripts/CLAUDE.md` — Identify the cursor-named helpers as the shared Cursor/Kimi broker implementation.
- `scripts/dispatch-hetero.sh` — Use the shared broker by default for Kimi with metadata/verdict mapping; retain explicit local fixture seam.
- `scripts/kimi-quota-observe.test.js` — Replace the obsolete local-availability oracle with an unconnected socket and real measured-seat state transitions.
- `scripts/lib/config-keys.json` — Register Kimi socket/root/model-pattern/group seams and correct shared-helper reader locations.
- `scripts/lib/cursor-broker-client.js` — Parameterize one protocol client by runner policy, structured observer and socket/quota admission.
- `scripts/lib/cursor-broker-run.js` — Parameterize the existing shared-clone and diff-import lifecycle for both broker runners.
- `scripts/lib/kimi-quota-observe.js` — Consume structured done/billing-stop verdicts independently of broker log text.
- `scripts/lib/pace-roles.json` — Enable eligible broker-backed Kimi while retaining minimax in the disabled list.
- `scripts/pace-select.js` — Exclude Kimi unless the broker socket exists and its quota is not exhausted.
- `scripts/pace-select.test.js` — Isolate ambient broker quota and retain a non-vacuous disabled-pool oracle.
- `scripts/probe-engine-capability.sh` — Make safe status/capacity admission use broker availability while preserving explicit live probes.
- `scripts/resolve-dispatch-topology.js` — Make installed-runner discovery admit Kimi through its broker instead of a local binary.
- `scripts/review-jury.js` — Use broker availability before any Kimi PATH or HOME binary lookup.
- `skills/dev-flow/references/card-relocated.md` — Expose the existing shared broker helpers in the available-scripts index.
- `src/readiness/probe.js` — Use socket/quota admission for Kimi safe-surface readiness.

## Deferred and limitations

- No live broker, real lanegit permission, authentication or service deployment was exercised. All broker connections target fixture sockets; no /srv, hangar, real ~/.kimi-code or ~/.claude files were modified. No credential source file was intentionally inspected or changed.
- A pre-existing failed transport recorder inherited endpoint credentials and its raw failure output was displayed during diagnosis. That temporary log was redacted, and both recorder suites now scrub secret-bearing environment names before recording and use an absent endpoint-env fixture. This incident is recorded rather than claiming no credential exposure occurred; no values are reproduced here.
- The exact wire protocol has no effort field. Broker deployment owns effort; explicit local `--kimi-bin` retains its legacy environment control and argv byte guard. Existing parser validation remains; no extra wire key or invented effort mapping was added.
- Explicit author/reviewer/qualification/version and live-spend local transports remain outside this implementer change. Existing qualification, role and CN gates remain authoritative.
- No version bump, release, push, merge, deployment or credential rotation. Independent review by another model family remains the caller's gate; no cross-family reviewer verdict is asserted here.

## Live broker availability (2026-11-18)

- The shared kimi broker socket `/srv/kimi-broker/sock` went live at 19:02 Taipei time; hangar test run `6076788e4c9c`.
- The socket directory is group `lanegit` (mode 2750), so a dispatching shell must carry that group (`sg lanegit -c ...`); without it the availability check reports the broker as absent and kimi is not selected.
- The local kimi CLI stays stopped (`scripts/lib/kimi-local-stop.js`); only implementer jobs sent through the broker are admitted.
