# P3.5a Authenticated Intake Shadow Host

## Background

P3.3 freezes the complete Engine-to-Kernel mapping but deliberately delegates
signature, expiry, replay, peer identity, and host authority to a later
host-owned adapter. P3.4b proves a root-installed cross-UID one-shot launch
mechanism, but has no owner intake or bridge verification. Connecting an
ordinary worker-side verifier would leave the worker free to select its own
trust root and plan.

P3.5a adds the smallest real trust link: a root-installed Linux session host
starts a fixed unprivileged worker and verifier, receives a signed owner-intake
envelope through that worker, and uses an installed P3.3 compiler/verifier to
prove that the envelope binds the exact compiled shadow plan. The result is
evidence only. It is not an action permit, a Kernel decision, a witness record,
or acceptance.

## Design Decisions

1. The host is a separate P3.5 installer/launcher rather than a new mode in
   P3.4b. P3.4b remains a narrowly documented preflight probe; P3.5 gets its
   own versioned root-owned snapshot, persistent replay state, and
   `autopilot-verifier` non-login account.
   The release is assembled and validated in a root-owned sibling staging
   directory, then atomically renamed to the requested install root; a hard
   interruption can leave only an unreferenced staging tree and does not block
   a later install retry.
   When a root-owned system Node is unavailable, the root operator supplies a
   Node binary only at installation; it is copied into the snapshot and the
   installed runtime never executes the caller's path again. Installation
   proves the copied binary can perform the exact Ed25519 primitive required
   by this protocol before reporting success.
2. The owner signs a fixed Ed25519 canonical payload. The envelope cannot
   negotiate an algorithm, verifier, JWKS URL, issuer URL, config path, or
   executable. The installed keyring contains public SPKI keys only. Its
   canonical digest is the P3.3 attestation hash, and its root-owned keyring
   identifier is the P3.3 authority key ID. Key overlap is explicit in a
   keyring epoch; changing the keyring requires a new root installation.
3. A root-created `begin` session emits an opaque one-time challenge and a
   short expiry. The signer binds its hash, the install binding, P3.3 binding,
   and compiled-plan hash into the signature. A session is assembled under a
   root-only pending directory and atomically published only when complete;
   abandoned expired or stale-pending sessions are reaped on a later `begin`.
   During this worker-identity migration, that reaper recognizes the exact
   pre-isolation, current, sealed, and seal-in-progress P3.5a layouts. It
   removes only strict-pattern and identity-checked legacy request files and crash
   temporaries before removing an expired session, so an interrupted prior
   release does not wedge the new release.
   A root-owned begin lease serializes that reap-and-publish transaction and
   enforces the fixed session cap.
   `submit` claims the session atomically, accepts only bounded stdin bytes
   until the session deadline, and gives raw bytes only to the fixed worker
   through a one-shot Unix socket after its exact PID/cgroup is known. The
   socket path is worker-UID-owned `0600` inside a root-owned worker directory;
   root checks Linux `SO_PEERCRED` and cgroup membership before sending a
   framed payload, and closes every other peer without sending bytes. No raw
   request is written to a worker-readable file. The worker independently
   verifies that the socket server is the expected root host PID/UID/GID.
   The separate root-created `0440` release marker contains only the fixed
   verifier connection metadata. The worker is the distinct
   `autopilot-intake-worker` identity, never the P3.4 `autopilot-worker`
   broker; installation rejects a UID or GID alias when that legacy account
   exists. This avoids treating NSS account enumeration or shared group
   membership as a confidentiality boundary for raw intake bytes.
   Root never parses intake data. The installed
   verifier receives the immutable session expiry and
   checks it again at trusted verification time. A root-owned host lease
   serializes verifier transactions; a busy caller retains its still-open
   session and can retry rather than consuming it on replay-lock contention.
4. The gateway runs as `autopilot-verifier`, reads Linux `SO_PEERCRED` before
   parsing any bytes, and requires the exact dedicated worker PID, UID/GID and
   unified cgroup-v2 path. It forwards one bounded frame to the installed Node
   verifier. Once its ready record is validated, root changes the gateway
   socket directory through a root-held directory descriptor, revokes verifier
   pathname mutation by sealing it `root:worker 0710`, then changes the socket
   pathname to the exact worker UID `0600` before releasing the worker. The
   verifier retains its listener FD, while shared-group accounts cannot
   connect. The verifier re-compiles and calls
   `verifySupervisedEngineBridgeContract()` with a host-owned adapter.
   The gateway keeps P3.4's systemd hardening except
   `ProtectProc=invisible`, because it must read the verified worker PID's
   cgroup after `SO_PEERCRED`; hiding `/proc` would make that check impossible.
5. A verifier-owned persistent replay state records an atomic pending claim
   before issuing a receipt, then atomically replaces it with a durable
   complete record. Its exact duplicate operation is idempotent only when
   every binding is identical; a pending/corrupt or conflicting claim fails
   closed. The public P3.5a host session remains strictly one-shot and does
   not expose receipt recovery after completion or crash. A durable time
   high-water rejects material host-clock rollback. This is local verifier
   state, explicitly not an independent witness.
6. Every output is a `verified_intake` shadow receipt with
   `owner_kernel_authority: "none"` and `acceptance: "not_available"`.
   P3.5a does not construct `OwnerKernel`, call `AutopilotEngine`, mint or
   execute an action, append a production witness, or claim acceptance.

## Implementation Steps

1. Add a reusable strict signed-envelope verifier with canonical payload
   parsing, Ed25519 keyring validation, time/key lifetime checks, host session
   binding, P3.3 adapter output, replay storage, and deterministic clock/state
   injection for tests.
2. Export the P3.3 trusted-intake binding normalizer so the host adapter uses
   the exact same binding schema rather than maintaining a shadow copy.
3. Add a root-installed P3.5 launcher, a non-root peer-credential gateway,
   and a fixed worker client. The installer snapshots all Node dependencies,
   keyring, and system executables into a hash-bound config; the installed
   runtime bootstraps the P3.4 support-file hash before import and accepts no
   replacement executable/keyring/config/module paths. Installation also
   rejects an install-root or verifier-state-root ancestor that the fixed
   service identities cannot traverse.
4. Add deterministic attacks for malformed/noncanonical input, wrong key,
   expiry/not-before/TTL/clock rollback, session and install-binding drift,
   P3.3 plan/binding drift, replay conflict/crash state, root config tampering,
   wrong gateway and root-handoff peer identity, and negative authority controls. Add an opt-in
   privileged Linux gate using only an ephemeral test key.
5. Sync the Codex skill mirror and document the exact P3.5a boundary, local
   state semantics, evidence, and remaining P3.5b/full-P3 work.

## Acceptance Criteria

1. A valid fresh Ed25519 envelope passes only when its pinned key, keyring
   epoch, time window, host session challenge, install binding, P3.3 binding,
   ABI/sink inventory, and compiled-plan hash all match.
2. The verifier replay store returns its exact durable receipt only for an
   internal exact duplicate; the public host session is one-shot and never
   claims receipt recovery. The same `jti` with different signed claims,
   binding, plan, or envelope fails. Pending, malformed, and clock-rollback
   replay state fails closed.
3. The root handoff sends raw bytes only to the discovered dedicated worker
   PID/UID/GID in the exact transient systemd cgroup, and the real gateway
   likewise rejects a connection before JSON parsing unless the peer matches.
   The worker independently validates both root-handoff and verifier socket
   peers.
4. Installed runtime files, config, Node binary, keyring, and state path are
   root/verifier owned and hash-bound; neither the worker nor a caller can
   supply an alternate verifier, keyring, module, executable, or policy.
5. No P3.5a source path can construct an Owner Kernel, invoke an Engine sink,
   issue an action permit, execute an action, write acceptance, or describe a
   successful intake as an accepted result.

## Risks

- The outer host and root installer remain trusted. A root operator can install
  a malicious snapshot; P3.5a makes that handoff explicit but does not solve
  release provenance. This includes an install-time Node binary when the host
  does not provide a root-owned system Node.
- Local replay state is durable but not independent. A compromised host or
  verifier identity is outside this proof and must not be represented as a
  remote witness.
- P3.3 still hashes a workspace path rather than pinning a filesystem
  descriptor. Because P3.5a has no action path, this does not authorize a
  filesystem effect; descriptor-pinned workspace identity remains a later gate.

## Review Summary

| Perspective | Final verdict | Material findings resolved |
| --- | --- | --- |
| Architect | SHIP | 🟠 Major reaper wedges from legacy request/crash temporaries and incomplete snapshot directory durability; fixed with strict artifact cleanup plus bottom-up snapshot-directory fsync before publish. |
| Integration / QA | SHIP | 🟠 Major gateway negative coverage was source-only and its new peer-rejection fixture had an early-close race; fixed with a real PID/cgroup rejection path and expected close errno handling. |
| Security | SHIP | 🟠 Major verifier-writable socket-parent TOCTOU during root metadata changes; fixed by sealing the opened directory descriptor to `root:worker 0710` before any listener path operation. |

## Local Evidence

On 2026-07-23, `AUTOPILOT_P35_LIVE=1 bash
hooks/tests/supervised-intake-live-host.sh` passed on this Linux host. It used
a disposable `/run` root snapshot and a test-only Ed25519 key, verified a real
dedicated-worker peer and exact cgroup through the verifier gateway, completed
the P3.3 adapter path with a UTF-8 prompt, rejected a conflicting durable
issuer-scoped `jti`, concurrent same-session submit, expiry while stdin was
open, modified config, and modified P3.4 support before import. A root fork
race proved exactly one atomic session claim winner; a real cross-UID one-shot
socket probe proved an unexpected peer receives no raw bytes while the exact
   worker PID/cgroup receives the bounded payload. It rejected both an
untraversable install-root parent and an untraversable verifier-state-root
parent, reaped an expired abandoned session, and removed its
   runtime/session/transient units. It also reaped expired exact legacy,
   sealed, and seal-in-progress P3.5a layouts, including strict-pattern release,
   handoff-socket, and gateway-state crash temporaries. The persistent P3.4 `autopilot-worker`, P3.5
`autopilot-intake-worker`, and `autopilot-verifier` accounts are intentional
host state; no test key,
snapshot, or replay state remains.

## Out of Scope

- `AutopilotEngine` runtime integration, Owner Kernel construction, action
  permits or effects, independent witness append/readback, acceptance,
  non-Linux support, remote key discovery, and release activation.
