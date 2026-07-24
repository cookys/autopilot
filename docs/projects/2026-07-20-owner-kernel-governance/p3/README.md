# P3 Compatibility Activation

P3 is split deliberately. P3.0-P3.6c are implemented prerequisites; full P3 remains blocked until the
P3.7 supervised host bridge controls a live Engine action sink and v2 acceptance. The intermediate
phases are not release activation: release metadata moves only after the full gate clears.

## P3.0 Implemented

- `src/engine/owner-kernel/compatibility.js` is the deterministic source of truth for `/l3` through
  `/l6` translation. It has no Kernel, acceptance, transition, or public append dependency.
- `node <autopilot-source>/scripts/owner-kernel.js translate-level --config <path> --level <lN>` is
  read-only for consuming projects. `<autopilot-source>` is an explicit source checkout or
  project-provided installed copy, never an assumed environment variable. It resolves the frozen
  policy, maps topology, and returns source/target hashes; `--all` renders the complete table.
- `governance.red_lines` and `governance.assurance_profile` are frozen into the policy hash. `-x`
  may only add canonical red-line tokens.
- `ShadowTranslationRuntime` is an integrating-host, ledger-only `/l3` bridge API. It needs the
  same trusted input, owner, qualification, translation, and witness adapters as an Owner Kernel
  run; it is not exposed through the public CLI. It permits no action catalog, no action authority,
  no acceptance coordinator, and no v2 acceptance.
- The bridge hashes and verifies the exact source/target mapping before calling
  `kernel.recordTranslation()`. A retry with the same run, invocation, and source hash returns the
  existing witnessed event; restart/resume preserves that idempotence.

The resulting telemetry is explicitly `owner_kernel_authority: "shadow"`,
`legacy_execution_authority: "unchanged"`, and `acceptance: "not_available"`. Correct deployment
still has to keep the bridge and trusted adapters outside model/workspace reach; P3.0 does not
itself establish that OS/IPC boundary. A local test `MemoryWitness` is machine-labelled
`test_only_not_eligible_for_alias_retirement` and never counts toward alias deletion telemetry.

## P3.1 Observational Engine Sidecar

`src/engine/engine-lifecycle-observation.js` adds a narrow, opt-in sidecar for the existing
`AutopilotEngine.runImplementationReviewLoop()` path. A host must inject the adapter in code with
`new AutopilotEngine({ lifecycleObserver })` and explicitly bind one run through
`lifecycleObservation`; there is no general CLI flag and an injected observer without that explicit
context is not called.

- The context binds an engine run ID, invocation ID, a host-supplied policy hash, and exactly `/l5`
  or `/l6`. The sidecar checks the hash shape and binds it into the record, but does not resolve or
  validate that policy. The adapter receives an `open` envelope, ordered `appendIfHead` records,
  and a `close` terminal record. Every append and close must advance the adapter's observation head.
- The adapter must echo the request bindings in every response: run ID, invocation ID, and the
  envelope hash for `open`; plus sequence, prior observation head, and record or terminal hash for
  `appendIfHead` and `close`. A response that reuses a head already observed in the current session,
  or that does not exactly echo those bindings, fails or becomes partial telemetry rather than an
  ordered receipt chain.
- It observes sanitized lifecycle facts: hashes for the prompt, branch, runner/model identities,
  findings, raw-log reference, and unbounded ledger metadata; immutable Git commits and bounded
  status/verification fields remain explicit. It never transfers raw prompt text, branch names,
  findings, raw log paths, worktree paths, or dispatcher stdout/stderr.
- A malformed, unavailable, or stale observer response is reported as `failed` or `partial`
  telemetry but cannot change the legacy implementation, verification, review, worktree, merge, or
  terminal result. The adapter is therefore not an authoritative witness, action broker, or
  acceptance coordinator. Its callbacks are synchronous, so a production host must bound them: a
  non-returning callback can stall this Node process and is not contained by the sidecar.
- The terminal labels are `engine_converged`, `engine_blocked`, or `engine_non_converged`. The
  terminal record and returned sidecar status remain `owner_kernel_authority: "none"`,
  `legacy_execution_authority: "unchanged"`, `acceptance: "not_available"`, and
  `alias_retirement_eligible: false`. In particular, `converged` is never mapped to `accepted`.

This is an observability seam for a future supervised host, not evidence of authenticated IPC,
durable external witnessing, side-effect mediation, or v2 acceptance. It cannot be used to retire
aliases or satisfy the full P3 gate.

## P3.2 Bounded External Lifecycle Witness Transport

`src/engine/external-lifecycle-witness.js` supplies an optional **Linux-local** transport
implementation for the P3.1 observer. It requires `/usr/bin/flock` and `/proc/self/fd`, runs a
separate Node process on a Unix-domain socket, and exposes only `open`, `append_if_head`, `close`,
and `get_head`. `BoundedUnixLifecycleObserver` invokes its client helper in a child process with a
finite socket and process timeout, so an unavailable or non-responsive observer becomes
failed/partial P3.1 telemetry instead of an indefinitely running in-process callback.

- The daemon permits only canonical, HMAC-bound requests. A request ID is the hash of the exact
  method/request tuple: retries return the same stored receipt, while a different request cannot
  reuse that ID. It maintains sequence and compare-and-append state separately for each hashed
  `(engine_run_id, invocation_id)` stream; it has no global action-use counter.
- The daemon writes a private `0600` JSONL journal. Its binding header freezes the daemon identity
  hash and attestation hash; each receipt binds the previous journal head, request hash, stream hash,
  content hash, and deterministic observation head. It durably fsyncs every newly-created runtime
  directory and its parent, then writes the complete buffer and fsyncs the journal file plus pinned
  parent directory. It accepts no further mutation after any write, fsync, close, or post-write
  in-memory failure. A journal must end every record with a newline; malformed, unterminated, stale,
  duplicate, wrong-binding, or internally inconsistent chains fail closed on restart.
- Before creating files, daemon and client walk every ancestor without following symlinks. Every
  ancestor must be root- or daemon-owned and non-group/world-writable; the final parent must be
  daemon-owned. The socket final parent must additionally deny every group/world access bit before
  bind. They retain that parent directory descriptor and operate through `/proc/self/fd`, so a later
  replacement of the configured pathname cannot redirect the daemon's socket, journal, or client
  request. The socket is checked as daemon-owned `0600` before the client sends a request.
- A persistent private sidecar lock exists for both the journal and socket, acquired in one global
  order with kernel `flock`. The lease holder is tied to a pipe owned by the daemon: daemon death
  closes that pipe and releases both leases. Only after holding the socket lease may a restart remove
  a stale private daemon socket. This prevents normal concurrent daemons from forking a journal or
  replacing an active socket while still allowing crash recovery.
- The journal deliberately stores hashes, not raw observer payloads. It does not retain the prompt,
  branch, verification command, findings, raw logs, terminal payload, raw daemon identity, or client
  key. Journal parents must be daemon-owned and non-group/world-writable; socket parents are private
  to the daemon UID and the socket is forced to `0600`, never `0666`.
- The helper verifies the daemon's response HMAC before returning the exact P3.1 receipt shape. Its
  absolute socket deadline and killable child-process timeout bound a peer that trickles bytes or
  never responds. Daemon shutdown destroys all open peer sockets before releasing either lease. This
  is still an operating-system process-management mechanism, not a proof against a compromised host
  or uninterruptible kernel state.

This is an external-process durability and bounded-callback component, **not** the supervised host
required by full P3. The `0600` socket intentionally has no cross-UID worker route yet; the HMAC key
authenticates this transport request but is not an authenticated user/owner channel. It offers no
action descriptor, permit, broker execution, user approval, Owner Kernel event minting, acceptance
coordinator, peer-credential verification, namespace boundary, or independent remote witness root.
The P0 corpus has not been re-run against it. Therefore its telemetry remains
`owner_kernel_authority: "none"`, `acceptance: "not_available"`, and ineligible for alias retirement.

The trusted boundary is only a normal same-UID Linux host filesystem: root, the daemon UID, and a
compromised host are out of scope. P3.2 can replay and idempotently return an already-durable receipt,
but P3.1 has no protocol to resume a partially open observation session from `get_head`; a new P3.1
session can replay its idempotent `open`, but its first append against an advanced remote stream becomes
partial rather than silently continuing it.

## P3.3 Frozen Engine-to-Kernel Bridge Contract

`src/engine/supervised-engine-bridge-contract.js` is a pure compiler and verifier for the future
supervised host boundary. It maps every current dependency-injected `AutopilotEngine` control seam,
including verification-worktree fallback deletion, to the only Owner Kernel destinations that a later
host may use. The module-load inventory validator rejects duplicate sink IDs/seams, duplicate or
unsupported Kernel destinations, missing P2 permit/execution routes, and invalid action requirements.
The focused contract test also reads the full constructor option inventory and fails when it diverges
from the declared control or runtime-context allowlist.

- Compilation requires a frozen governance policy, a v2 acceptance contract, a lowercase immutable
  Git base, an absolute workspace root, bounded run/invocation identifiers, and one distinct frozen
  action-catalog entry for every dispatch or mutation sink. Each entry must match that sink's fixed
  operation/tool signature, meet its minimum risk class, and require mediation; command execution also
  requires a command-bound catalog entry. The bridge plan contains policy and contract hashes, catalog
  IDs plus entry/requirement hashes, and only hashes for the workspace root, prompt, branch, and
  verification command. It never serializes raw policy, acceptance-contract, workspace, or sensitive
  input objects.
- The plan explicitly records `bridge_status: "contract_only"`,
  `owner_kernel_authority: "none"`, and `acceptance: "not_available"`. It maps every engine terminal
  outcome, including `engine_converged`, to `not_accepted`; an ordinary review is never a challenge
  unless a qualified independent hash-bound condition is supplied by a later host. Every catalog-bound
  sink includes P2's `mintActionDecision` and `executeAuthorizedAction` route; review/implementation
  dispatch retain their semantic delegation records only in addition to that permit/receipt path.
- Compilation is deterministic but does not authenticate its caller. Verification requires an opaque
  `trustedIntakeEnvelope`, a **host-owned** `trustedIntakeVerifier` adapter, and a host-pinned
  issuer/key/attestation tuple. The adapter must return the authenticated binding plus the exact
  canonical compiled-plan hash. The binding covers run IDs, policy/contract hashes, immutable base,
  workspace-root and sensitive-input hashes, the full sink-inventory hash, and the static bridge ABI
  hash. This makes a self-consistent worker-side change to destinations or mappings fail against the
  host-issued envelope; the plan hash also binds the resolved catalog mappings. P3.3 validates this
  adapter protocol and exact comparison only: it does not verify signatures, credentials, replay,
  expiry, or peer identity itself. P3.5 must provide and pin that adapter in the cross-UID host rather
  than letting the worker select it. The contract does not construct an Owner Kernel, mint a permit,
  invoke a dispatcher, run a command, change a worktree, or alter the existing review loop.

This is intentionally a coverage and integration contract, not a live bridge. A workspace-root hash is
not a descriptor-pinned filesystem identity, and the legacy Engine still allows its ordinary `cwd`
overrides. P3.4b supplies only the installed peer-credential mechanism; P3.5 must reject unbound
workspace overrides and complete the Linux supervised substrate with authenticated owner intake,
broker-held effects, durable independent witnessing, and an externally run P0 corpus before it can
consume this contract for real authority.

## P3.4a Cross-UID Supervised Host Mechanism Probe

`src/engine/supervised-host-preflight.js` and
`src/engine/supervised-host-peercred.py` implement a manual Linux-host mechanism probe, not a reusable
host boundary. A strict compiler freezes one unprivileged broker identity, the existing
`nobody:nogroup` worker identity (`65534:65534`), a per-run runtime root, helper/python/systemd path
strings, a plan hash, nonce hash, and fixed systemd hardening. The compiler rejects a same UID or GID, a
root broker, noncanonical paths, and an altered plan. Separately,
`preflightSupervisedHostRuntime()` rejects a non-Linux host, a non-root caller, or an untrusted helper
ancestry when a root-owned launcher calls it. P3.4a has no such runtime caller: its live fixture is a
user-writable checkout that manually copies the helper to a root-owned snapshot and invokes root commands.
It must never be treated as the authoritative execution path.

- The manual root fixture creates a `root:nogroup 0710` run directory, a `root:root 0700` state directory,
  a root-owned helper snapshot, and a `broker:nogroup 0710` socket parent. The broker retains its frozen
  primary UID/GID and joins `nogroup` only as a supplementary group to create its `0660` socket. Thus the
  worker can traverse the known endpoint but cannot list or mutate its parent and cannot read state. This
  is not a filesystem or socket allowlist.
- The Python gateway has exactly one `p34_hello` operation. Before parsing any bytes it reads Linux
  `SO_PEERCRED`, requires the frozen worker UID/GID, and requires an exact
  `/system.slice/<service-unit>` cgroup path. It then checks a bounded canonical frame and nonce hash. Any
  peer or request failure consumes the one-use endpoint; a successful receipt is hash-bound to the run,
  invocation, plan, gateway identity, and actual peer identity. The worker independently checks socket
  ancestry/inode ownership/mode, the connected broker's `SO_PEERCRED` UID/GID, and the entire receipt
  binding before treating the hello as successful.
- The opt-in privileged live probe runs a root-owned helper snapshot, demonstrates that a broker-UID
  connection is rejected before request parsing, demonstrates that a correct `nobody:nogroup` peer outside
  the expected cgroup is rejected, demonstrates that `nobody` cannot read the state directory, and then
  accepts the real `nobody:nogroup` transient-systemd peer. Its systemd invocations use `--collect` and
  `CollectMode=inactive-or-failed`, and the test verifies that passed and failed transient units vanish.
  On the local Linux host it passed 30
  assertions on 2026-07-23. The probe removes its unique `/run/autopilot-supervisor` directory afterward.

P3.4a remains `owner_kernel_authority: "none"` and `acceptance: "not_available"`. It contains no Owner
Kernel construction, P3.3 trusted-intake verifier, action permit, broker-held effect, witness append,
acceptance coordinator, or live `AutopilotEngine` integration. `SO_PEERCRED` is local process evidence,
not authenticated owner approval or a remote identity. The current account's unrestricted passwordless
sudo also means this is a trusted-host probe rather than a deployment profile for an untrusted outer
runner. The shared `nobody:nogroup` endpoint can also be consumed by another same-group local process,
which causes a fail-closed denial but cannot pass the exact cgroup gate. P3.4b replaces the probe fixture
with the narrowly installed root-owned launcher, a dedicated non-login worker identity, and per-run
PID/endpoint binding. P3.5 must pin the P3.3 verifier, add durable witness coordination, and only then
mediate an Engine action sink.

## P3.4b Root-Owned Supervised Host Launcher

`src/engine/supervised-host-launcher.py` adds a root-only installer and installed launcher, while
`src/engine/supervised-host-worker-wait.py` holds the systemd worker before it can connect. The installer
is an explicit root-operator trust handoff: it may snapshot a checked-out source at install time, but the
installed runtime later reads only its root-owned `sbin/`, `lib/`, and `etc/` tree. The root-owned config
hash-pins the launcher, peer helper, and wait-wrapper content, fixed root-owned Python/setpriv/systemd
paths, one unprivileged broker identity, the fixed runtime parent, and the systemd hardening properties.
The installed `run` command has no config, command, helper, worker, broker, or runtime-root override.

- Installation creates or verifies the dedicated non-login `autopilot-worker` system account and its
  private primary group, then freezes its resolved UID/GID and rejects any supplementary group drift.
  Unlike P3.4a, this worker is not shared `nobody:nogroup`. A root-owned but worker-inaccessible snapshot
  ancestor is rejected before the unit starts; the worker can traverse the known root-owned executable path
  without being able to modify it.
- Each run generates a unique unit, runtime directory, endpoint, nonce, and release token. The systemd
  worker begins in a root-created wait wrapper. The fixed runtime parent is an exclusive lease, so a stale
  or overlapping run fails closed rather than sharing cleanup. The launcher discovers its `MainPID`, verifies
  that PID is in the exact unified cgroup-v2 `/system.slice/<unit>` path, starts a broker gateway pinned to
  that PID and cgroup, then creates the release file. The wrapper `exec`s the fixed client so the observed
  peer PID remains the PID the launcher discovered. The client also reads `SO_PEERCRED` and requires the
  broker UID/GID before sending its hello. The worker release budget is bounded at 15 seconds; the gateway
  and client protocol budget remains 5 seconds.
- Root setup is limited to its exact unit and unique paths. It uses isolated Python, a sanitized child
  environment, `NoNewPrivileges`, private network/tmp, protected system/home, hidden `/proc`, namespace
  and SUID restrictions, empty capabilities, `--collect`, and `CollectMode=inactive-or-failed`.
  Success and failure both stop/reset only the named unit, require `LoadState=not-found`, and remove the
  per-run files/directories. The dedicated account is intentional persistent host provisioning.
- The explicit self-hosted gate installs into a disposable root-owned `/run` tree, mutates the
  user-writable source staging copy after installation, then proves the installed launcher still runs the
  hash-pinned snapshot. It also mutates the installed config after a successful run
  and proves the binding mismatch fails before runtime setup. On this Linux host it
  passed 37 assertions on 2026-07-23.

P3.4b is an installed Linux mechanism boundary, not Owner Kernel authority. Its output remains
`owner_kernel_authority: "none"` and `acceptance: "not_available"`; it performs no P3.3 trusted-intake
verification, action permit/execution, durable witness append, acceptance coordination, or live Engine
integration. A caller with unrestricted root already lies outside this containment model. P3.5 must pin
the P3.3 verifier and integrate the broker/witness/action path before any autonomous authority claim.

## P3.5a Authenticated Intake Shadow Host

`src/engine/supervised-authenticated-intake.js` implements the signed owner-intake verifier and durable
local replay store. `src/engine/supervised-intake-host.py`,
`src/engine/supervised-intake-gateway.py`, `src/engine/supervised-intake-worker.py`, and
`src/engine/supervised-intake-verifier.js` compose it into a root-installed Linux shadow host. This is
the first real P3.3 host adapter, but it remains evidence only: every successful record says
`status: "verified_intake"`, `owner_kernel_authority: "none"`, and
`acceptance: "not_available"`.

- Installation is an explicit root-operator handoff. It snapshots the host, P3.4 support code, gateway,
  worker, verifier, P3.3 contract and its minimal dependencies, canonical public keyring, and a Node
  executable into a root-owned release tree. The Node executable is an install-time source input because
  this host may not have a system Node binary; runtime executes only the hash-bound root-owned snapshot.
  Installation runs a fixed Ed25519 crypto preflight against that copied snapshot before succeeding.
  It assembles and validates the snapshot in a root-owned sibling staging directory, then atomically renames
  it to the requested release root; a hard interruption leaves no partial release at that root and does not
  block a later retry.
  The installed `begin` and `submit` commands accept no alternate config, keyring, Node, module, policy,
  executable, state-root, socket, or worker path.
- A separate non-login `autopilot-verifier` identity owns the verifier and its `0700` durable state;
  P3.5 creates `autopilot-intake-worker`, a distinct no-supplementary-group identity from the pre-existing
  P3.4 `autopilot-worker` worker identity and its private group, which the P3.4 broker receives as a
  supplementary group. Installation rejects any UID/GID alias between the P3.5 account and the legacy
  identity. Root emits a one-time short-lived
  session challenge on `begin`, stores only its SHA-256 hash, atomically publishes a fully assembled session,
  and reaps expired/stale-pending sessions on a later `begin` under a root-owned begin lease that enforces the
  fixed session cap. During this one-time worker-identity migration, the reaper accepts only exact old,
  current, sealed, or seal-in-progress P3.5a layouts. It removes only strict-pattern, identity-checked legacy
  request files and crash temporaries before removing an expired session, so an interrupted prior release does
  not wedge `begin`. `submit` gets an exclusive root-owned claim. V1 treats stdin as opaque bounded bytes
  until the session deadline; v2 root performs only a bounded, non-authenticating canonical structural
  preflight to reject reserved raw workspace-path fields before a worker starts, then passes the original
  bytes opaquely. It cleans only the session it claimed. A root-owned host lease serializes verifier
  transactions; a busy submit leaves its open session
  retryable instead of consuming it on replay-lock contention. Root transfers raw intake only through a
  one-shot Unix socket after discovering the exact worker PID/cgroup. Its path is worker-UID-owned `0600`
  inside a root-owned worker directory; root verifies `SO_PEERCRED` and the cgroup before sending any bytes,
  and closes every other peer without a payload. No raw request is written to a worker-readable file, so
  confidentiality does not depend on enumerating every NSS account or private-group member. The worker
  independently validates the root handoff server PID/UID/GID. The separate root-created,
  `root:autopilot-intake-worker` `0440` release marker contains only verifier connection metadata. The common
  session parent is root-owned `0711`, providing traversal of known children but neither directory listing nor
  root-state access; the gateway socket directory starts verifier-owned, worker-group `2710`.
- The verifier gateway reads `SO_PEERCRED` before any request parsing and requires the exact discovered
  worker PID, UID/GID, and unified cgroup-v2 path. The worker independently checks socket ancestry, mode,
  and the connected verifier PID/UID/GID through `SO_PEERCRED`. After the gateway ready record is verified,
  root seals the socket directory through a held descriptor as `root:worker 0710`, then changes its socket
  pathname to worker-UID-owned `0600` before releasing the worker. The verifier retains its listener FD but
  cannot swap the pathname during root metadata changes. Both units retain P3.4's no-new-privileges,
  private network/tmp, protected system/home, namespace/SUID restrictions, empty capabilities, collection,
  and exact cleanup. `RuntimeMaxSec=45s` and `TimeoutStopSec=5s` bound each transient unit even when the
  root host is killed before its normal cleanup. The verifier intentionally omits `ProtectProc=invisible`: it must read the peer PID's
  cgroup evidence after `SO_PEERCRED`; retaining that property would hide the evidence and fail closed.
- Owner envelopes use only Ed25519 over a domain-separated exact canonical JSON payload. They cannot select
  an algorithm, verifier, key URL, issuer URL, or key. The root-owned keyring fixes issuer, keyring ID,
  epoch, public SPKI keys, and key lifetime; its canonical SHA-256 is the P3.3 attestation hash. A claim
  binds its session challenge hash, install binding, expiry/not-before/TTL, issuer-scoped `jti`, complete
  P3.3 trusted-intake binding, and compiled-plan hash. The installed Node verifier re-compiles the bridge
  from the submitted raw input and invokes `verifySupervisedEngineBridgeContract()` through its own
  host-pinned adapter. It remains the only semantic and authentication parser; the v2 root preflight only
  checks bounded canonical structure and reserved raw workspace-path field names. The verifier receives the
  immutable session expiry for a final verification-time expiry check.
- Replay state is verifier-owned local durable state, not an independent witness. The gateway holds an
  advisory file lock; the verifier writes a durable high-water clock record, claims a `jti` with an
  exclusive pending file, then atomically publishes a complete receipt. The store can return its historical
  receipt for an internal exact duplicate, but the public P3.5a host session is strictly one-shot and exposes
  no receipt-recovery protocol. Conflicting `jti`, pending/corrupt state, overlong/future/expired claims,
  unknown or inactive keys, and host-clock rollback fail closed. A crash after the pending claim intentionally
  blocks automatic replay rather than silently reissuing evidence.

The explicit `AUTOPILOT_P35_LIVE=1` gate passed on this Linux host on 2026-07-23. It installed a disposable
`/run` snapshot with an ephemeral Ed25519 key, completed a genuine cross-UID signed P3.3 shadow verification
with a UTF-8 prompt, rejected a conflicting durable `jti`, concurrent same-session submit, expiry while stdin
was open, modified installed config, and modified support code before import. A root fork race proved one
atomic session-claim winner; a direct cross-UID socket probe verified that an unexpected peer is closed before
receiving bytes and the exact worker PID/cgroup receives the one bounded payload. The installer rejected both
untraversable release-root and verifier-state-root parents. It reaped an expired
  abandoned session, an exact legacy worker-layout session, sealed and seal-in-progress sessions, and their
  strict-pattern release, handoff-socket, and gateway-state crash temporaries. It left no transient
  `autopilot-p35-*` unit or runtime directory. The persistent P3.4
`autopilot-worker`, P3.5 `autopilot-intake-worker`, and `autopilot-verifier` accounts are intentional
provisioning; the test key, release snapshot, replay state, and runtime session are removed.

P3.5a must not be read as owner-action authority. It does not construct `OwnerKernel`, instantiate or call
`AutopilotEngine`, mint or execute an action, run a dispatcher/verification command/git operation, append a
production witness, issue a permit, or map `verified_intake` to acceptance.

## P3.5b Fail-Closed Shadow Admission

`src/engine/supervised-shadow-engine-consumer.js` is snapshot-pinned beside the P3.5a verifier. After the
verifier has recompiled the P3.3 plan and authenticated the owner envelope, it creates one private,
hash-only shadow capsule and records it under the verifier-owned `0700` state root. The component does not
instantiate `AutopilotEngine`, construct `OwnerKernel`, import a dispatcher, invoke a command/Git/worktree
seam, mint a P2 permit, or call a P2/external witness API.

- The capsule binds the signed-intake issuer/key/attestation/envelope/install provenance, P3.3 plan,
  intake-binding, sink-inventory, and ABI hashes, and the owner/Engine/invocation IDs plus policy,
  contract, immutable-base, workspace, prompt, branch, and verification-command hashes. It does not retain
  raw envelope bytes, bridge input, prompt, workspace path, branch, command, or a caller-supplied state
  path.
- A record uses a deterministic intake ID and contains fixed evidence-only disclosure:
  `engine.status: "not_started"`, `owner_kernel_authority: "none"`,
  `legacy_execution_authority: "unchanged"`, `effect_authority: "none"`,
  `broker_authority: "not_available"`, `acceptance: "not_available"`, and
  `witness_assurance: "local_verifier_state_not_independent_witness"`. Gateway and root independently
  reject a verifier result with any other authority or acceptance vocabulary before returning the compact
  summary to the caller.
- State moves from an exclusive, fsynced `pending` file to an exclusive `recorded` file. An exact recorded
  capsule is idempotent. A same-ID mismatch, symlink, noncanonical state, mode/owner/link drift, or
  conflicting state fails closed. On the next verifier transaction, a surviving pending record is converted
  only to `recovery_required`; it is never promoted to recorded, re-verified, replayed, closed, or used to
  start an Engine. The gateway's existing verifier/replay lock covers this sweep.

P3.5b remains restart diagnosis for a pure hash record, not end-to-end intake recovery. Its verifier-local
record is retained alongside, rather than upgraded into, the P3.5c witness below. The P0 production corpus
remains mandatory before a mediated effect, P2 authority, acceptance, or alias retirement is considered.

## P3.5c Root-Held Workspace Binding and Separate-UID Shadow Witness

P3.5c adds Linux-local, host-held workspace provenance and a separate-UID diagnostic journal. Its design is
recorded in [the P3.5c plan](../../../plans/2026-07-23-p3-5c-workspace-shadow-witness.md). It preserves the
P3.3 bridge and authenticated owner envelope at v1: the existing signed `workspace_root_hash` and
`immutable_base` claims are exact-matched to a root-created host ticket. The descriptor fingerprint is
runtime-local provenance, not a portable owner intent claim.

- `src/engine/supervised-workspace-registry.py` accepts exactly one root-opened `O_PATH` directory descriptor
  through `SOCK_SEQPACKET`/`SCM_RIGHTS`, validates peer credentials before packet parsing, requires Linux
  `openat2` and `statx`, derives a hash-only identity from the held FD, and retains only the descriptor in memory. It
  neither persists nor reopens a workspace path, invokes Git, or transfers the descriptor to the worker,
  verifier, witness, or Engine. A registration is unique, expires, reserves once, and closes on completion;
  daemon restart loses every descriptor and fails closed.
- `begin --workspace-registration-id` emits a root-owned, verifier-readable ticket with hashes only. The
  installed Node verifier recomputes the P3.3 plan and rejects any signed workspace hash or immutable-base
  mismatch. The ticket never contains a path, FD number, inode, mount ID, or Git data.
- P3.3 v1 still sends the user-supplied `workspaceRoot` through the existing worker/verifier request so the
  pinned verifier can recompute the signed path hash. P3.5c does not copy the root registration path or a
  descriptor into that route, ticket, witness, or output, but it does not make the verifier path-confidential.
- `src/engine/supervised-shadow-witness.py` runs as the distinct
  `autopilot-shadow-witness` account with a `0700` state root. It accepts only the exact verifier gateway
  PID/UID/GID/cgroup, or the exact root host PID for readback, before it reads request bytes. Its four-method
  protocol is limited to `open_shadow`, `append_shadow_observation`, `read_shadow_record`, and
  `close_shadow_diagnostic`; it persists canonical hash-chain entries and fsyncs both the file and journal
  directory. Interrupted records are diagnostic-only `shadow_recovery_required`, never auto-completed.
- The root host starts and seals the witness after the gateway PID/cgroup is known, then returns a bound
  result only after an independent root readback exactly matches the gateway summary. The public disclosure
  remains `engine.status: "not_started"`, `owner_kernel_authority: "none"`,
  `effect_authority: "none"`, and `acceptance: "not_available"`; its witness assurance explicitly says it
  is separate-UID local evidence and not P2 authority.

The expanded `AUTOPILOT_P35_LIVE=1` gate passed on this Linux host on 2026-07-23. It installs all three
distinct service accounts, starts the root registry, registers a real directory, proves the descriptor-backed
ticket exact-matches the signed P3.3 plan, validates the three-entry witness journal's ownership and hash
chain, checks root readback, proves a competing registry cannot remove the active listener, rejects descriptor
reuse, and leaves no registry socket, session, or transient unit.

P3.5c does not prove repository content, grant an owner registration namespace, create P2 authority, start
an Engine, broker an effect, or accept a result. Its v1 lane remains available only for compatibility and
still exposes the caller's workspace path to the verifier. P3.5d supplies the separate path-free shadow
lane below; neither lane may be treated as an effect-capable broker or a production P2 witness.

## P3.5d Descriptor-Bound Authenticated Intake v2

P3.5d adds a parallel, explicitly selected descriptor-bound authenticated intake ABI. Its design is
recorded in [the P3.5d plan](../../../plans/2026-07-23-p3-5d-descriptor-bound-intake-v2.md). It does not
upgrade, reinterpret, or retire P3.3/authenticated-intake v1: a legacy request has no
`schema_version` discriminator and continues through the original v1 path, while a v2 request must select
every v2 discriminator exactly.

- Root configuration registration is still the only point that accepts a raw workspace path. A v2
  `begin --intake-protocol-version 2 --workspace-registration-id <id>` returns the root-issued hash-only
  registration ID, workspace-root hash, immutable base, descriptor-binding hash, and one-use ticket hash.
  The root-held descriptor, FD, inode, mount ID, and Git data never enter the worker handoff, verifier
  request, receipt, shadow state, witness journal, or public result; its registration path never enters as
  a structured workspace-path field. Free-form prompt, branch, and verification-command text remains
  caller-provided opaque input and is not path-classified by this boundary.
- The bridge plan uses `schema_version: 2`; its signed `workspace_binding` exact-matches all five values
  from that root ticket. The authenticated envelope uses a separate `/v2` signing domain and v2 replay
  fingerprint, and the host request carries its own explicit protocol version. Missing, mixed, extra,
  replayed, expired, structured raw-path, or substituted registration/hash/base/binding/ticket fields fail
  before shadow admission. Root preflight rejects a structured raw workspace field before worker launch;
  the verifier repeats the guard before compilation.
- The root verifier reads its own ticket and exact-matches the session's registration ID, workspace-root
  hash, immutable base, descriptor-binding hash, and ticket hash. Registration ID alone is never workspace
  authority. The worker receives no ticket file or descriptor and the shadow consumer persists only its
  existing hash-safe capsule fields.
- A v2 `begin` result and a successful v2 public result state `effect_authority: "none"`; the latter also
  states `engine.status: "not_started"`, `owner_kernel_authority: "none"`, and
  `acceptance: "not_available"`. Its v2 workspace assurance says only that the root-held descriptor
  matched the signed ticket and base; it does not prove content, authorize an action, or accept a result.

The privileged `AUTOPILOT_P35_LIVE=1` gate completed one real v2 session on this Linux host on 2026-07-23.
It registers a real descriptor, begins a v2 session, signs the returned five commitments without a raw
workspace field, submits through the separate-UID host, checks the exact v2 result/witness disclosure,
scans the valid worker/verifier/witness/public artifacts for the root-derived path, and proves the completed
descriptor cannot be reused. The deterministic host gate separately proves an injected structured raw
workspace field is rejected before a worker launches or receives bytes.

P3.5d does not construct `OwnerKernel`, call `AutopilotEngine`, invoke P2, mint a permit, execute through a
broker, coordinate acceptance, prove repository content, add aliases or multi-mapping selection, replace the
P3.5c local witness with a production witness, or make the P0 corpus production evidence. A supervised
broker and Engine integration remain separate later gates; any future effect-capable use must consume this
v2 boundary and a production P2 witness rather than reuse the shadow witness.

## P3.6 A0 Durable Substrate

P3.6 consumes only the root-published, one-shot P3.5d v2 handoff. It starts a
fresh five-role Linux cohort and remains refusal-only:
`owner_kernel_authority: "none"`, `effect_authority: "none"`,
`broker_authority: "disabled"`, and `acceptance: "not_available"`. It has no
Engine construction, action descriptor, permit, action effect, or acceptance
operation.

The retained durable state has three independently owned role-private leaves:
the receipt verifier owns a local receipt anchor, the witness owns the witness
journal, and the coordinator owns fenced unavailable/unknown state. The receipt
anchor is not an IPC route and accepts no caller-selected operation. It commits
only hash-safe results from the fixed `receipt_verifier_witness` mutation
probes. Root can read both leaves after teardown and rejects a witness
mutation/head ledger rewritten from genesis even when the rewritten ledger
recalculates its own internal hashes. Fixed `getHead`/`readback` query records
remain locally journal-chained but are outside this independent anchor scope.
Root provisions and audits these leaves; it is not a receipt writer.

The opt-in `AUTOPILOT_P0_A0_LIVE=1` gate uses an installed P3.5 host and an
installed P3.6 host, rather than a synthetic handoff. It proves a root-created
same-UID outsider outside the worker unit cgroup is closed before its valid
frame is parsed, and cannot forge the root ACK socket. The host requires a
second clean-quiescence ACK before it retains any probe evidence or terminal
availability disclosure. Stateful services recompute their availability only
after their listeners stop, so the final disclosure reflects the quiesced
durable state. A failed second phase records a terminal tombstone but no
verified probe-evidence record. The gate then starts a new real P3.5 handoff to
prove recovery, checks the exact worker-inaccessible classes, and verifies the
post-teardown mutation/head rewrite audit. That is a bounded A0 substrate result only; the
original P0 Owner-Kernel semantics and all fifteen baseline categories remain
unevaluable until a later authority-bearing phase exists.

P3.6c completed this bounded substrate and its independent receipt-evidence
hardening. The next authority-bearing work is frozen in
[`2026-07-24-owner-kernel-p37-activation.md`](../../../plans/2026-07-24-owner-kernel-p37-activation.md):
P3.7a adds semantic witnessing without effects, P3.7b adds one fixed reversible
broker effect, and P3.7c adds the acceptance coordinator plus one Engine sink.

```bash
PYTHONDONTWRITEBYTECODE=1 bash hooks/tests/supervised-production-substrate-p0-replay.test.sh
AUTOPILOT_P0_A0_LIVE=1 PYTHONDONTWRITEBYTECODE=1 \
  bash hooks/tests/supervised-production-substrate-p0-live.test.sh
```

## P3.7 Authority Contracts

P3.7a-c are implemented as production-code external-host contracts:

- P3.7a consumes an exact P3.5d v2 handoff, exclusive P3.6 claim, durable cohort, policy,
  acceptance contract, immutable base, workspace descriptor, and six distinct Kernel/worker/broker/
  receipt-verifier/witness/coordinator identities. Every event receipt is compare-and-appended,
  read back, and independently anchored. This profile has no effects or acceptance.
- P3.7b enables only `owner-kernel-probe-toggle-v1`. The caller cannot select a command, target,
  path, tool, or receipt root. The focused gate performs and restores the effect, rejects action
  substitution, receipt-root substitution, and authorization replay.
- P3.7c enables only `engine-implementation-dispatch-v1`, crosses the real
  `AutopilotEngine.implementTask()` seam exactly once, binds the delivered manifest to verification,
  independent challenge, and action audit, then commits `acceptance` plus `complete` in one durable
  witness batch. Engine `committed`/`converged` alone never terminates the Kernel.

The project default and a one-run `owner-led`/`milestone-led` override are resolved into the same
route policy hash used by the Kernel. A supplied profile or nested override that disagrees is
rejected before session start.

`hooks/tests/owner-kernel-production-corpus.test.sh` reports all eight named attacks and all fifteen
frozen baseline categories separately. Each of the 23 rows requires a scenario-specific marker from
the production test that executed it; 46 additional mutations prove the report cannot silently alter
an outcome or evidence hash. There are no `not_applicable` rows. Its scope is
`production_code_with_external_host_contracts`: deterministic tests inject the external calls. The
P3.6 privileged live gate remains the installed cross-UID substrate evidence; P3.7 does not relabel
that A0 evidence or claim that a systemd P3.7 adapter has been deployed.

```bash
bash hooks/tests/supervised-owner-kernel-semantic-witness.test.sh
bash hooks/tests/supervised-owner-kernel-probe-effect.test.sh
bash hooks/tests/supervised-owner-kernel-engine-acceptance.test.sh
bash hooks/tests/owner-kernel-production-corpus.test.sh
```

## Deferred Full P3 Gate

Do not reduce `/l4` through `/l6` to aliases yet. Their worktree isolation, strict dispatch
contracts, artifact boundary, depth-0 QC, merge, session marker, and recovery rails are currently
the active enforcement path. P3.7 now has one bounded Owner Kernel action-sink bridge and the
external coordinator contract, but no installed P3.7 systemd adapter has replaced those rails.

Full activation requires all of the following:

1. A Linux-scoped supervised host/broker with authenticated user/owner/translation IPC, durable
   external witness compare-and-append/batch/readback, bounded callbacks, restart recovery, and the
   complete P0 attack corpus re-run against it.
2. `AutopilotEngine` integration that maps intake, exact action descriptors, dispatch provenance,
   verification, independent challenge, audit reconciliation, abort, resume, and final manifest into
   one v2 Owner Kernel ledger. Existing `converged` is not `accepted`.
3. Active conservative policy enforcement in the Kernel predicate: legacy-equivalent qualified,
   independent panel coverage must be checked from frozen policy, never borrowed from the legacy
   flow as a bypass.
4. Low-risk dogfood before high-risk activation, a qualified challenger, KR8/KR10 evidence, and the
   plan's 14-day witnessed zero-use migration gate before removing aliases.

`hooks/tests/level-governance-translation.test.sh` covers the P3.0 table, monotonic red lines,
host-witnessed event shape, replay idempotence, and no-authority negative controls.
`hooks/tests/engine-lifecycle-observation.test.sh` covers P3.1's explicit host binding, ordered
compare-and-append observations, receipt-binding/replayed-head rejection, raw-data exclusion,
observer-failure containment, and the `converged`-is-not-`accepted` negative control.
`hooks/tests/external-lifecycle-witness.test.sh` covers P3.2's external process transport, strict
receipt shapes, request/response authentication, per-stream compare-and-append/idempotency, raw-payload
exclusion from the journal, crash replay, paired lease contention, close/short-write fail-stop,
unterminated journal tails, durable runtime-directory creation, descriptor-pinned path replacement,
private socket directories, bounded trickling peers/shutdown, same-instance replay, and
unavailable-client FD cleanup.
`hooks/tests/supervised-engine-bridge-contract.test.sh` covers P3.3's complete constructor-option and
injected-sink inventory, static inventory validation, exact distinct mediated action-catalog bindings
and risk floors, v2-only acceptance contract, hash-only workspace/sensitive inputs, host-owned trusted
intake verification, pinned issuer/key/attestation, ABI/inventory/compiled-plan binding, no-authority
terminal mapping, deterministic verification, and mutation/tampering rejection. Its P3.5d cases preserve
the v1 ABI while proving the separate v2 descriptor-binding compiler rejects raw path/mixed-version and
commitment-substitution inputs.
`hooks/tests/supervised-host-preflight.test.sh` covers P3.4a's exact frozen preflight, root/path/identity
negative controls, one-use gateway arguments, bounded frame and response binding, and no-Owner-Kernel
authority source scan. `AUTOPILOT_P34_LIVE=1` adds the host-specific systemd/SO_PEERCRED proof; it is
explicitly opt-in because ordinary CI must not require sudo.
`hooks/tests/supervised-host-launcher.test.sh` covers P3.4b's strict installed-config material,
no-override parser surface, exact PID/cgroup-v2 helper path, timeout hardening, supplementary-group drift,
exclusive runtime-parent lease, failure cleanup collection, and no-authority source scan.
`AUTOPILOT_P34B_LIVE=1` adds the root-installed dedicated-worker proof and is likewise an explicit self-hosted
gate.
`hooks/tests/supervised-authenticated-intake.test.sh` covers real Ed25519 verification, exact canonical
payload parsing, keyring/attestation pinning, host-session/install/plan/binding coupling, time-window and
clock-rollback rejection, P3.3 adapter integration, durable replay idempotence/conflict/pending state, and
the no-authority receipt. `hooks/tests/supervised-intake-host.test.sh` covers the root snapshot material,
no runtime trust-input override, hash-only challenge state, opaque root submit, peer-before-frame ordering,
replay serialization, worker peer verification, strict non-authoritative shadow-summary validation, and
no-authority source controls. `hooks/tests/supervised-shadow-engine-consumer.test.sh` covers exact
plan/receipt/install binding, raw-data exclusion, durable idempotency, symlink rejection, cleanup of an
unpublished interrupted temporary, `pending` to `recovery_required` restart behavior, and no live Engine or
action dependency. The live P3.5 gate also verifies the compact shadow summary over the real root/systemd/
SO_PEERCRED path. `hooks/tests/supervised-workspace-registry.test.sh` covers root-held descriptor identity,
one-shot reserve/complete/expiry, symlink and replacement rejection, path exclusion, and no command surface.
`hooks/tests/supervised-shadow-witness.test.sh` covers canonical chained journal transitions, restart recovery,
idempotency, corruption rejection, peer-before-payload ordering, and no P2/Engine surface. The expanded
`hooks/tests/supervised-intake-host.test.sh` covers P3.5c ticket and root-readback validation. The opt-in
`hooks/tests/supervised-intake-live-host.sh` gate additionally proves the installed descriptor and separate-
UID witness path under root/systemd/SO_PEERCRED. Its P3.5d cases additionally prove the v2 ticket's five
exact commitments, protocol forwarding, public no-effect disclosure, and root-derived path exclusion across
the valid live worker/verifier/witness/result boundary; the deterministic host test proves an injected
structured raw workspace field launches no worker and reaches no handoff.
