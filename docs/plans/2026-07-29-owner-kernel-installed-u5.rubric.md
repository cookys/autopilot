# Owner Kernel installed activation U5 rubric

## R1 Installed identity boundary

Six distinct service identities are root-provisioned, snapshot-bound, peer-credential checked, and
cgroup checked before any authenticated frame is consumed. Each listener authenticates the
endpoint's declared sender role, and pre-existing dedicated users or groups fail preflight.

## R2 Semantic witness authority

Installed Kernel semantic events advance only through the independent receipt-verifier and witness
compare-and-append/readback path; replay, stale head, wrong role, or binding drift fails closed.
The host cannot synthesize a completed result from request material.

## R3 Fixed reversible effect

Only `owner-kernel-probe-toggle-v1` can execute. Claim, authorization, broker receipt, independent
readback, restoration, and reconciliation are all bound and replay-safe. Completion requires the
exact handoff/cohort authority to be consumed and the restored sentinel to be independently
verified.

## R4 Crash and recovery honesty

Every tested crash window resolves to completed, failed, unknown, or recovery-required without
effect replay or inferred acceptance.

## R5 Disposable live proof

The opt-in privileged test proves real systemd/cross-UID execution and leaves no transient unit,
service identity, socket, sentinel, or runtime directory attributable to the test. It requires
authenticated probe-complete and quiesced acknowledgements from all six roles and cannot convert
an installed failure into success with an in-process fallback.

## R6 Scope containment

The implementation changes exactly the frozen output paths and does not enable the Engine sink,
acceptance, arbitrary effects, publication, or alias retirement.
