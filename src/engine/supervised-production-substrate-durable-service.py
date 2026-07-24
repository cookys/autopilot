#!/usr/bin/env python3
"""Role-local runner for the P3.6 durable service cohort.

This is not the P2b peer-probe runner.  It binds only its root-predeclared
durable listeners, waits for root to verify and seal them, validates a second
PID/cgroup-bound peer configuration, then exposes the P3a state core.  The
runner never loads an Engine or accepts an effect/acceptance decision.
"""

import argparse
import json
import os
import socket
import stat
import sys
import threading
import time


MODULE_DIRECTORY = os.path.dirname(os.path.realpath(__file__))
sys.dont_write_bytecode = True
if MODULE_DIRECTORY not in sys.path:
    sys.path.insert(0, MODULE_DIRECTORY)

import supervised_production_substrate_durable as durable
import supervised_production_substrate_durable_transport as transport


SCHEMA_VERSION = 1
ROOT_CONFIG_MODE = 0o440
ROLE_CONFIG_ROOT_MODE = 0o710
SOCKET_STAGING_MODE = 0o2710
SOCKET_MODE = 0o660
ACK_SOCKET_MODE = 0o660
ACK_MODE = 0o600
MAX_CONFIG_BYTES = 131072
MAX_LIFECYCLE_SECONDS = 300
# The receipt verifier has four sequential fixed probes.  Four six-second
# bounded retries plus acknowledgement fit inside the host's 35-second hold.
SELF_PROBE_TIMEOUT_SECONDS = 6
SELF_PROBE_RETRY_SECONDS = 0.05


def fail(message):
    sys.stderr.write("supervised-production-substrate-durable-service: " + message + "\n")
    raise SystemExit(2)


def canonical(value):
    return transport.canonical(value)


def sha256_value(value):
    return transport.sha256_value(value)


def guard(callback):
    try:
        return callback()
    except (transport.DurableTransportError, durable.DurableStateError) as error:
        fail(str(error))


def require_exact_identity(uid, gid):
    if os.geteuid() != uid or os.getegid() != gid:
        fail("durable service process does not match its configured identity")
    try:
        groups = set(os.getgroups())
    except OSError as error:
        fail("durable service groups cannot be inspected: " + str(error))
    if groups != {gid}:
        fail("durable service process has unexpected supplementary groups")


def require_exact_directory(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o7777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")


def require_exact_socket(path, uid, gid, mode, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != uid
        or info.st_gid != gid
        or (info.st_mode & 0o777) != mode
    ):
        fail(label + " does not have the expected ownership and mode")


def read_root_group_json(path, expected_gid, label):
    path = guard(lambda: transport.require_absolute_path(path, label + " path"))
    expected_gid = guard(lambda: transport.require_positive_int(expected_gid, label + " gid"))
    parent = os.path.dirname(path)
    require_exact_directory(parent, 0, expected_gid, ROLE_CONFIG_ROOT_MODE, label + " parent")
    try:
        initial = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(initial.st_mode)
        or not stat.S_ISREG(initial.st_mode)
        or initial.st_uid != 0
        or initial.st_gid != expected_gid
        or (initial.st_mode & 0o777) != ROOT_CONFIG_MODE
        or initial.st_nlink != 1
        or initial.st_size <= 0
        or initial.st_size > MAX_CONFIG_BYTES
    ):
        fail(label + " does not have the expected root-owned mode")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != expected_gid
            or (opened.st_mode & 0o777) != ROOT_CONFIG_MODE
            or opened.st_nlink != 1
            or opened.st_dev != initial.st_dev
            or opened.st_ino != initial.st_ino
            or opened.st_size != initial.st_size
        ):
            fail(label + " changed while opening")
        raw = os.read(descriptor, MAX_CONFIG_BYTES + 1)
        if len(raw) > MAX_CONFIG_BYTES:
            fail(label + " exceeds the byte limit")
        final = os.fstat(descriptor)
        if (
            final.st_dev != opened.st_dev
            or final.st_ino != opened.st_ino
            or final.st_size != opened.st_size
        ):
            fail(label + " changed while reading")
    except OSError as error:
        fail(label + " cannot be read safely: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return decode_root_group_json(raw, label)


def decode_root_group_json(raw, label):
    """Parse a root config, whose on-disk canonical form has one final LF.

    Transport frames intentionally have no trailer.  Root-created config files
    instead follow the existing P2b file convention: canonical JSON followed
    by exactly one newline, so a torn or whitespace-extended config is never
    silently accepted as a frame.
    """

    if not isinstance(raw, bytes) or len(raw) < 2 or not raw.endswith(b"\n"):
        fail(label + " is not canonical root-config JSON")
    return guard(lambda: transport.decode_canonical_json(raw[:-1], label, MAX_CONFIG_BYTES - 1))


def require_lifecycle_seconds(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > MAX_LIFECYCLE_SECONDS:
        fail(label + " must be a bounded whole-second lifecycle value")
    return value


def fixed_endpoint(endpoint_id):
    return guard(lambda: transport.endpoint_by_id(endpoint_id))


def normalize_static_endpoint(raw, role, label):
    value = guard(
        lambda: transport.require_exact_keys(
            raw,
            {"endpoint_id", "socket_root", "socket_path", "sender_role", "recipient_role", "sender_gid"},
            label,
        )
    )
    endpoint = fixed_endpoint(value["endpoint_id"])
    socket_root = guard(lambda: transport.require_absolute_path(value["socket_root"], label + ".socket_root"))
    socket_path = guard(lambda: transport.require_unix_socket_path(value["socket_path"], label + ".socket_path"))
    if (
        os.path.dirname(socket_path) != socket_root
        or value["sender_role"] != endpoint["sender_role"]
        or value["recipient_role"] != endpoint["recipient_role"]
        or role not in {endpoint["sender_role"], endpoint["recipient_role"]}
    ):
        fail(label + " does not match the durable fixed topology")
    return {
        "endpoint_id": endpoint["endpoint_id"],
        "socket_root": socket_root,
        "socket_path": socket_path,
        "sender_role": endpoint["sender_role"],
        "recipient_role": endpoint["recipient_role"],
        "sender_gid": guard(lambda: transport.require_positive_int(value["sender_gid"], label + ".sender_gid")),
    }


def read_bootstrap(path):
    raw = read_root_group_json(path, os.getegid(), "durable bootstrap")
    value = guard(
        lambda: transport.require_exact_keys(
            raw,
            {
                "schema_version",
                "kind",
                "role",
                "identity",
                "uid",
                "gid",
                "attestation_hash",
                "release_path",
                "release_token",
                "ready_path",
                "ack_socket_path",
                "quiesce_path",
                "quiesce_token",
                "peer_config_path",
                "state_leaf",
                "release_timeout_seconds",
                "hold_seconds",
                "endpoints",
                "bootstrap_hash",
            },
            "durable bootstrap",
        )
    )
    material = dict(value)
    bootstrap_hash = material.pop("bootstrap_hash")
    if sha256_value(material) != guard(lambda: transport.require_sha256(bootstrap_hash, "durable bootstrap hash")):
        fail("durable bootstrap hash does not match content")
    if (
        guard(lambda: transport.require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable bootstrap schema"))
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_service_bootstrap"
    ):
        fail("durable bootstrap has an unsupported schema or kind")
    role = guard(lambda: transport.require_token(value["role"], "durable bootstrap role"))
    if role not in transport.SERVICE_ROLES:
        fail("durable bootstrap role is unsupported")
    uid = guard(lambda: transport.require_positive_int(value["uid"], "durable bootstrap uid"))
    gid = guard(lambda: transport.require_positive_int(value["gid"], "durable bootstrap gid"))
    require_exact_identity(uid, gid)
    state_leaf = value["state_leaf"]
    if role in {"receipt_verifier", "witness", "coordinator"}:
        state_leaf = guard(lambda: transport.require_absolute_path(state_leaf, "durable state leaf"))
    elif state_leaf is not None:
        fail("stateless durable service received a durable state leaf")
    if not isinstance(value["endpoints"], list):
        fail("durable bootstrap endpoints must be a list")
    endpoints = []
    endpoint_ids = set()
    for index, item in enumerate(value["endpoints"]):
        endpoint = normalize_static_endpoint(item, role, "durable bootstrap endpoint")
        if endpoint["endpoint_id"] in endpoint_ids:
            fail("durable bootstrap repeats an endpoint")
        endpoint_ids.add(endpoint["endpoint_id"])
        endpoints.append(endpoint)
    expected_ids = {
        endpoint["endpoint_id"]
        for endpoint in transport.DURABLE_ENDPOINTS
        if role in {endpoint["sender_role"], endpoint["recipient_role"]}
    }
    if endpoint_ids != expected_ids:
        fail("durable bootstrap does not retain every endpoint for its role")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_service_bootstrap",
        "role": role,
        "identity": guard(lambda: transport.require_token(value["identity"], "durable bootstrap identity")),
        "uid": uid,
        "gid": gid,
        "attestation_hash": guard(lambda: transport.require_sha256(value["attestation_hash"], "durable bootstrap attestation")),
        "release_path": guard(lambda: transport.require_absolute_path(value["release_path"], "durable release path")),
        "release_token": guard(lambda: transport.require_token(value["release_token"], "durable release token")),
        "ready_path": guard(lambda: transport.require_absolute_path(value["ready_path"], "durable ready path")),
        "ack_socket_path": guard(lambda: transport.require_absolute_path(value["ack_socket_path"], "durable acknowledgement socket path")),
        "quiesce_path": guard(lambda: transport.require_absolute_path(value["quiesce_path"], "durable quiesce path")),
        "quiesce_token": guard(lambda: transport.require_token(value["quiesce_token"], "durable quiesce token")),
        "peer_config_path": guard(lambda: transport.require_absolute_path(value["peer_config_path"], "durable peer config path")),
        "state_leaf": state_leaf,
        "release_timeout_seconds": require_lifecycle_seconds(value["release_timeout_seconds"], "durable release timeout"),
        "hold_seconds": require_lifecycle_seconds(value["hold_seconds"], "durable hold seconds"),
        "endpoints": endpoints,
        "bootstrap_hash": guard(lambda: transport.require_sha256(bootstrap_hash, "durable bootstrap hash")),
    }


def read_release_token(path, expected_token, expected_gid):
    parent = os.path.dirname(path)
    require_exact_directory(parent, 0, expected_gid, ROLE_CONFIG_ROOT_MODE, "durable release parent")
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError as error:
        fail("durable release file cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != expected_gid
        or (info.st_mode & 0o777) != ROOT_CONFIG_MODE
        or info.st_nlink != 1
        or info.st_size > 256
    ):
        fail("durable release file does not have the expected root-owned mode")
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != expected_gid
            or (opened.st_mode & 0o777) != ROOT_CONFIG_MODE
            or opened.st_nlink != 1
        ):
            fail("durable release file changed while opening")
        content = os.read(descriptor, 256).decode("ascii")
    except (OSError, UnicodeDecodeError) as error:
        fail("durable release file cannot be read safely: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
    if content != expected_token + "\n":
        fail("durable release token does not match this service invocation")
    return True


def wait_for_release(bootstrap):
    deadline = time.monotonic() + bootstrap["release_timeout_seconds"]
    while True:
        if read_release_token(bootstrap["release_path"], bootstrap["release_token"], bootstrap["gid"]):
            return
        if time.monotonic() >= deadline:
            fail("durable service release timed out")
        time.sleep(0.025)


def wait_for_quiesce(bootstrap, listener_context):
    """Wait for root's second phase while surfacing late listener failures."""

    deadline = time.monotonic() + bootstrap["hold_seconds"]
    while True:
        if listener_context is not None and listener_context["errors"]:
            fail("durable listener failed before root quiescence: " + str(listener_context["errors"][0]))
        if read_release_token(bootstrap["quiesce_path"], bootstrap["quiesce_token"], bootstrap["gid"]):
            return
        if time.monotonic() >= deadline:
            fail("durable service quiescence timed out")
        time.sleep(0.025)


def bind_listener(endpoint, bootstrap, sender_gid):
    if endpoint["recipient_role"] != bootstrap["role"]:
        fail("durable service attempted to bind a sender-owned endpoint")
    require_exact_directory(
        endpoint["socket_root"],
        bootstrap["uid"],
        sender_gid,
        SOCKET_STAGING_MODE,
        endpoint["endpoint_id"] + " socket root",
    )
    if os.path.lexists(endpoint["socket_path"]):
        fail(endpoint["endpoint_id"] + " socket path already exists")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(endpoint["socket_path"])
        os.chmod(endpoint["socket_path"], SOCKET_MODE)
        require_exact_socket(
            endpoint["socket_path"],
            bootstrap["uid"],
            sender_gid,
            SOCKET_MODE,
            endpoint["endpoint_id"] + " listener socket",
        )
        listener.listen(8)
        return listener
    except BaseException:
        listener.close()
        raise


def publish_owned_json(path, expected_uid, expected_gid, value, label):
    parent = os.path.dirname(path)
    require_exact_directory(parent, expected_uid, expected_gid, 0o700, label + " parent")
    if os.path.lexists(path) or os.path.lexists(path + ".pending"):
        fail(label + " path already exists")
    content = (canonical(value) + "\n").encode("utf-8")
    descriptor = None
    pending = path + ".pending"
    pending_exists = False
    try:
        descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, ACK_MODE)
        pending_exists = True
        os.fchmod(descriptor, ACK_MODE)
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:])
            if written <= 0:
                fail(label + " short write")
            offset += written
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_gid != expected_gid
            or (info.st_mode & 0o777) != ACK_MODE
            or info.st_nlink != 1
        ):
            fail(label + " pending file did not preserve service ownership")
        os.link(pending, path, follow_symlinks=False)
        os.unlink(pending)
        pending_exists = False
    except OSError as error:
        fail(label + " cannot be atomically published: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if pending_exists:
            try:
                os.unlink(pending)
            except OSError:
                pass
    try:
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        os.fsync(directory)
    except OSError as error:
        fail(label + " directory cannot be synchronized: " + str(error))
    finally:
        try:
            os.close(directory)
        except (NameError, OSError):
            pass


def write_ready(bootstrap, listener_ids):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_listener_ready",
        "role": bootstrap["role"],
        "identity": bootstrap["identity"],
        "pid": os.getpid(),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "bootstrap_hash": bootstrap["bootstrap_hash"],
        "listener_endpoint_ids": listener_ids,
    }
    value = dict(material, ready_hash=sha256_value(material))
    publish_owned_json(bootstrap["ready_path"], bootstrap["uid"], bootstrap["gid"], value, "durable listener readiness")
    return value


def normalize_peer_config(bootstrap):
    raw = read_root_group_json(bootstrap["peer_config_path"], bootstrap["gid"], "durable peer config")
    value = guard(
        lambda: transport.require_exact_keys(
            raw,
            {
                "schema_version",
                "kind",
                "role",
                "durable_binding",
                "runtime_services",
                "endpoints",
                "peer_config_hash",
            },
            "durable peer config",
        )
    )
    material = dict(value)
    peer_config_hash = material.pop("peer_config_hash")
    if sha256_value(material) != guard(lambda: transport.require_sha256(peer_config_hash, "durable peer config hash")):
        fail("durable peer config hash does not match content")
    if (
        guard(lambda: transport.require_exact_int(value["schema_version"], SCHEMA_VERSION, "durable peer config schema"))
        != SCHEMA_VERSION
        or value["kind"] != "p36_durable_peer_config"
        or value["role"] != bootstrap["role"]
    ):
        fail("durable peer config does not match its bootstrap role")
    binding, runtime_services = guard(lambda: transport.normalize_runtime_services(value["runtime_services"], value["durable_binding"]))
    expected_runtime_roles = {bootstrap["role"]}
    for endpoint in bootstrap["endpoints"]:
        expected_runtime_roles.add(endpoint["sender_role"])
        expected_runtime_roles.add(endpoint["recipient_role"])
    if set(runtime_services) != expected_runtime_roles:
        fail("durable peer config discloses a non-route runtime service")
    own = runtime_services[bootstrap["role"]]
    if (
        own["identity"] != bootstrap["identity"]
        or own["uid"] != bootstrap["uid"]
        or own["gid"] != bootstrap["gid"]
        or own["attestation_hash"] != bootstrap["attestation_hash"]
        or own["pid"] != os.getpid()
        or not transport.cgroup_v2_matches(own["pid"], own["cgroup_path"])
    ):
        fail("durable peer config does not bind this exact PID/UID/GID/cgroup")
    if not isinstance(value["endpoints"], list) or len(value["endpoints"]) != len(bootstrap["endpoints"]):
        fail("durable peer config endpoint count differs from bootstrap")
    endpoints = []
    for index, raw_endpoint in enumerate(value["endpoints"]):
        expected = bootstrap["endpoints"][index]
        endpoint = normalize_static_endpoint(raw_endpoint, bootstrap["role"], "durable peer config endpoint")
        if endpoint != expected:
            fail("durable peer config endpoint differs from bootstrap")
        endpoints.append(endpoint)
    return {
        "binding": binding,
        "runtime_services": runtime_services,
        "endpoints": endpoints,
        "peer_config_hash": peer_config_hash,
    }


def handler_for_role(role, binding, state_leaf):
    if role == "receipt_verifier":
        if state_leaf is None:
            fail("durable receipt verifier has no root-created receipt anchor leaf")
        anchor = durable.DurableReceiptAnchor(state_leaf, binding)
        return (
            lambda payload, envelope_hash: durable.create_revocation_unavailable_result(binding, payload, envelope_hash),
            anchor.availability,
            anchor,
        )
    if role == "witness":
        if state_leaf is None:
            fail("durable witness has no root-created state leaf")
        instance = durable.DurableWitness(state_leaf, binding)
        return instance.handle, instance.availability, None
    if role == "coordinator":
        if state_leaf is None:
            fail("durable coordinator has no root-created state leaf")
        instance = durable.DurableCoordinator(state_leaf, binding)
        return instance.handle, instance.availability, None
    if state_leaf is not None:
        fail("stateless durable role received a state leaf")
    if role == "broker":
        return (
            lambda payload, envelope_hash: durable.create_effects_disabled_broker_result(binding, payload, envelope_hash),
            None,
            None,
        )
    if role == "worker":
        return None, None, None
    fail("durable service role is unsupported")


def self_probe_id(binding, suffix):
    """Return an opaque, cohort-unique request id with no user input."""

    # Stateless peer views redact unrelated service bindings.  Probe ids must
    # nevertheless agree across the receipt-verifier/coordinator routes, so
    # derive them from the immutable common cohort facts rather than the full
    # five-role binding representation.
    cohort_seed = sha256_value({
        "kind": "p36_durable_fixed_probe_seed",
        **{
            key: binding[key]
            for key in (
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "substrate_plan_hash",
                "durable_abi_hash",
                "cohort_id",
                "generation",
            )
        },
    })
    return "p36d-probe-" + cohort_seed[:24] + "-" + suffix


def self_probe_specs(role, binding):
    """Fixed no-effect probes that exercise all five sealed durable routes."""

    binding_hash = durable.normalized_binding_hash(binding)
    plan_hash = binding["substrate_plan_hash"]
    stream_id = self_probe_id(binding, "stream")
    batch_stream_id = self_probe_id(binding, "batch-stream")
    transaction_id = self_probe_id(binding, "transaction")
    common = {"schema_version": durable.SCHEMA_VERSION, "substrate_plan_hash": plan_hash}
    if role == "worker":
        return [{
            "endpoint_id": "worker_broker",
            "payload": dict(common, request_id=self_probe_id(binding, "worker-execute"), operation="execute"),
            "expected_code": "BROKER_EFFECTS_DISABLED",
        }]
    if role == "broker":
        return [{
            "endpoint_id": "broker_receipt_verifier",
            "payload": dict(
                common,
                request_id=self_probe_id(binding, "broker-revocation"),
                operation="check_revocation",
                broker_result_hash=sha256_value({"kind": "p36d_probe_broker_result", "binding_hash": binding_hash}),
            ),
            "expected_code": "REVOCATION_UNAVAILABLE",
        }]
    if role == "receipt_verifier":
        return [
            {
                "endpoint_id": "receipt_verifier_witness",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "witness-append"),
                    operation="appendIfHead",
                    stream_id=stream_id,
                    expected_head=None,
                    event_hash=sha256_value({"kind": "p36d_probe_event", "binding_hash": binding_hash}),
                    event_payload_hash=sha256_value({"kind": "p36d_probe_payload", "binding_hash": binding_hash}),
                ),
                "expected_code": "WITNESS_RECORDED",
            },
            {
                "endpoint_id": "receipt_verifier_witness",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "witness-batch"),
                    operation="appendBatchIfHead",
                    stream_id=batch_stream_id,
                    expected_head=None,
                    events=[
                        {
                            "event_hash": sha256_value({"kind": "p36d_probe_batch_event", "binding_hash": binding_hash, "index": 1}),
                            "event_payload_hash": sha256_value({"kind": "p36d_probe_batch_payload", "binding_hash": binding_hash, "index": 1}),
                        },
                        {
                            "event_hash": sha256_value({"kind": "p36d_probe_batch_event", "binding_hash": binding_hash, "index": 2}),
                            "event_payload_hash": sha256_value({"kind": "p36d_probe_batch_payload", "binding_hash": binding_hash, "index": 2}),
                        },
                    ],
                ),
                "expected_code": "WITNESS_RECORDED",
            },
            {
                "endpoint_id": "receipt_verifier_coordinator",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "coordinator-prepare"),
                    operation="prepare",
                    transaction_id=transaction_id,
                    fence=1,
                    expected_witness_head=None,
                ),
                "expected_code": "COORDINATOR_PREPARED",
            },
            {
                "endpoint_id": "receipt_verifier_coordinator",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "coordinator-cancel"),
                    operation="cancel",
                    transaction_id=transaction_id,
                    fence=1,
                    expected_witness_head=None,
                ),
                "expected_code": "COORDINATOR_CANCELLED",
            },
        ]
    if role == "coordinator":
        return [
            {
                "endpoint_id": "coordinator_witness",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "witness-head"),
                    operation="getHead",
                    stream_id=stream_id,
                ),
                "expected_code": "WITNESS_AVAILABLE",
            },
            {
                "endpoint_id": "coordinator_witness",
                "payload": dict(
                    common,
                    request_id=self_probe_id(binding, "witness-readback"),
                    operation="readback",
                    stream_id=stream_id,
                    from_sequence=1,
                    limit=8,
                ),
                "expected_code": "WITNESS_AVAILABLE",
            },
        ]
    if role == "witness":
        return []
    fail("durable self-probe role is unsupported")


def endpoint_socket_path(peer_config, endpoint_id):
    endpoint_id = guard(lambda: transport.require_token(endpoint_id, "durable self-probe endpoint"))
    matches = [item for item in peer_config["endpoints"] if item["endpoint_id"] == endpoint_id]
    if len(matches) != 1:
        fail("durable self-probe endpoint is absent from the root-pinned peer config")
    return matches[0]["socket_path"]


def run_self_probes(role, peer_config, receipt_anchor):
    """Exchange only fixed refusal/state probes after every listener is sealed."""

    if role == "receipt_verifier" and receipt_anchor is None:
        fail("receipt verifier cannot self-probe without its durable receipt anchor")
    if role != "receipt_verifier" and receipt_anchor is not None:
        fail("only the receipt verifier may own a durable receipt anchor")
    results = []
    for spec in self_probe_specs(role, peer_config["binding"]):
        deadline = time.monotonic() + SELF_PROBE_TIMEOUT_SECONDS
        last_error = None
        while time.monotonic() < deadline:
            try:
                request_value, response = transport.request_response(
                    endpoint_socket_path(peer_config, spec["endpoint_id"]),
                    peer_config["binding"],
                    peer_config["runtime_services"],
                    spec["endpoint_id"],
                    spec["payload"],
                    timeout_seconds=min(
                        transport.FRAME_TIMEOUT_SECONDS,
                        max(0.1, deadline - time.monotonic()),
                    ),
                )
            except transport.DurableTransportError as error:
                last_error = error
                time.sleep(min(SELF_PROBE_RETRY_SECONDS, max(0.0, deadline - time.monotonic())))
                continue
            if response.get("code") != spec["expected_code"]:
                fail("durable self-probe received an unexpected " + spec["endpoint_id"] + " result")
            if (
                receipt_anchor is not None
                and spec["endpoint_id"] == durable.DurableReceiptAnchor.ENDPOINT_ID
            ):
                receipt_anchor.record_witness_response(
                    durable.canonical(request_value["payload"]).encode("utf-8"),
                    transport.sha256_value(request_value["envelope"]),
                    response,
                )
            results.append(
                {
                    "endpoint_id": spec["endpoint_id"],
                    "request_id": spec["payload"]["request_id"],
                    "operation": spec["payload"]["operation"],
                    "code": response["code"],
                    "response_hash": sha256_value(response),
                }
            )
            break
        else:
            fail("durable self-probe timed out on " + spec["endpoint_id"] + ": " + str(last_error))
    return results


def write_ack(bootstrap, peer_config, state_snapshot, self_probe_evidence, phase="probe_complete"):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_durable_release_ack",
        "status": "released_durable_no_effect",
        "phase": phase,
        "role": bootstrap["role"],
        "identity": bootstrap["identity"],
        "pid": os.getpid(),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "bootstrap_hash": bootstrap["bootstrap_hash"],
        "peer_config_hash": peer_config["peer_config_hash"],
        "binding_hash": durable.normalized_binding_hash(peer_config["binding"]),
        "state_snapshot": state_snapshot,
        "self_probe_evidence": self_probe_evidence,
        "owner_kernel_authority": "none",
        "effect_authority": "none",
        "broker_authority": "disabled",
        "acceptance": "not_available",
    }
    return dict(material, ack_hash=sha256_value(material))


def send_ack(bootstrap, peer_config, state_snapshot, self_probe_evidence, phase):
    """Send an ACK over root's socket, never via a service-owned file.

    The host validates SO_PEERCRED plus the exact cgroup before it reads this
    frame.  A same-UID process outside the transient unit therefore cannot
    substitute a forged ACK for the launched service process.
    """

    value = write_ack(bootstrap, peer_config, state_snapshot, self_probe_evidence, phase)
    path = bootstrap["ack_socket_path"]
    require_exact_directory(
        os.path.dirname(path), 0, bootstrap["gid"], ROLE_CONFIG_ROOT_MODE, "durable acknowledgement socket parent"
    )
    require_exact_socket(path, 0, bootstrap["gid"], ACK_SOCKET_MODE, "durable acknowledgement socket")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(SELF_PROBE_TIMEOUT_SECONDS)
        connection.connect(path)
        guard(lambda: transport.send_frame(connection, transport.encode_frame(value), SELF_PROBE_TIMEOUT_SECONDS))
        confirmation = connection.recv(1)
        if confirmation != b"\x01":
            fail("durable acknowledgement socket did not return root confirmation")
    except OSError as error:
        fail("durable acknowledgement socket cannot be reached: " + str(error))
    finally:
        connection.close()
    return value


def start_listener_context(listener_pairs, peer_config, handler, hold_seconds):
    """Start recipient loops before outbound probes can race their peers."""

    deadline = time.monotonic() + hold_seconds
    context = {
        "deadline": deadline,
        "errors": [],
        "stopped": threading.Event(),
        "listeners": [listener for _endpoint, listener in listener_pairs],
        "threads": [],
    }

    def stop_for_error(error):
        if not context["errors"]:
            context["errors"].append(error)
        context["stopped"].set()
        for value in context["listeners"]:
            try:
                value.close()
            except OSError:
                pass

    def serve_endpoint(endpoint, listener):
        while (
            time.monotonic() < context["deadline"]
            and not context["stopped"].is_set()
        ):
            remaining = max(
                0.05,
                min(transport.FRAME_TIMEOUT_SECONDS, context["deadline"] - time.monotonic()),
            )
            try:
                transport.serve_one(
                    listener,
                    peer_config["binding"],
                    peer_config["runtime_services"],
                    endpoint["endpoint_id"],
                    handler,
                    remaining,
                )
            except transport.DurableTransportError as error:
                # An accept timeout only means no trusted peer arrived during
                # this bounded poll.  Any accepted bad frame/peer is terminal.
                if "did not accept a request" in str(error):
                    if context["stopped"].is_set():
                        return
                    continue
                stop_for_error(error)
                return
            except durable.DurableStateError as error:
                stop_for_error(error)
                return
            except Exception as error:  # No listener exception may disappear in a thread.
                stop_for_error(error)
                return

    context["threads"] = [
        threading.Thread(target=serve_endpoint, args=(endpoint, listener), daemon=False)
        for endpoint, listener in listener_pairs
    ]
    for thread in context["threads"]:
        thread.start()
    return context


def stop_listener_context(context):
    context["stopped"].set()
    for listener in context["listeners"]:
        try:
            listener.close()
        except OSError:
            pass
    for thread in context["threads"]:
        # A peer accepted just before close can remain in a bounded frame read.
        # Wait through that bound so a late invalid peer cannot disappear after
        # the service has emitted its final quiescence acknowledgement.
        thread.join(transport.FRAME_TIMEOUT_SECONDS + 1)
    if any(thread.is_alive() for thread in context["threads"]):
        fail("durable listener did not stop after its socket was closed")


def wait_for_listener_context(context):
    for thread in context["threads"]:
        thread.join(max(0.1, context["deadline"] - time.monotonic() + 1))
    if any(thread.is_alive() for thread in context["threads"]):
        stop_listener_context(context)
        fail("durable listener did not stop before its bounded deadline")
    if context["errors"]:
        fail("durable listener failed: " + str(context["errors"][0]))


def serve_until_deadline(listener_pairs, peer_config, handler, hold_seconds):
    if not listener_pairs:
        time.sleep(hold_seconds)
        return
    context = start_listener_context(listener_pairs, peer_config, handler, hold_seconds)
    try:
        wait_for_listener_context(context)
    finally:
        stop_listener_context(context)


def run(args):
    bootstrap = read_bootstrap(guard(lambda: transport.require_absolute_path(args.bootstrap_config, "bootstrap config")))
    listeners = {}
    try:
        for endpoint in bootstrap["endpoints"]:
            if endpoint["recipient_role"] == bootstrap["role"]:
                sender_gid = None
                # The bootstrap has no runtime claims yet, but every sender
                # GID is pinned in the root-created socket staging root.  The
                # root service host records it in this static endpoint field.
                sender_gid = endpoint.get("sender_gid")
                if sender_gid is None:
                    fail("durable bootstrap endpoint omits its sender gid")
                listeners[endpoint["endpoint_id"]] = bind_listener(endpoint, bootstrap, sender_gid)
        write_ready(bootstrap, list(listeners))
        wait_for_release(bootstrap)
        peer_config = normalize_peer_config(bootstrap)
        handler, availability, receipt_anchor = handler_for_role(
            bootstrap["role"], peer_config["binding"], bootstrap["state_leaf"]
        )
        listener_pairs = [
            (endpoint, listeners[endpoint["endpoint_id"]])
            for endpoint in bootstrap["endpoints"]
            if endpoint["recipient_role"] == bootstrap["role"]
        ]
        listener_context = (
            start_listener_context(listener_pairs, peer_config, handler, bootstrap["hold_seconds"])
            if listener_pairs
            else None
        )
        try:
            # All recipient loops are listening before a sender starts retrying
            # its sealed fixed probe.  These probes are the only traffic in A0.
            self_probe_evidence = run_self_probes(bootstrap["role"], peer_config, receipt_anchor)
            if listener_context is not None and listener_context["errors"]:
                fail("durable listener failed during self-probe: " + str(listener_context["errors"][0]))
            state_snapshot = availability() if availability is not None else None
            send_ack(bootstrap, peer_config, state_snapshot, self_probe_evidence, "probe_complete")
            wait_for_quiesce(bootstrap, listener_context)
            if listener_context is not None:
                stop_listener_context(listener_context)
                if listener_context["errors"]:
                    fail("durable listener failed during root quiescence: " + str(listener_context["errors"][0]))
            # A first-phase availability snapshot can precede a peer's final
            # fixed mutation. Recompute only after every recipient loop has
            # stopped so the terminal disclosure describes the quiesced state.
            state_snapshot = availability() if availability is not None else None
            send_ack(bootstrap, peer_config, state_snapshot, self_probe_evidence, "quiesced")
        finally:
            if listener_context is not None:
                stop_listener_context(listener_context)
    finally:
        for listener in listeners.values():
            try:
                listener.close()
            except OSError:
                pass


def parser():
    root = argparse.ArgumentParser()
    root.add_argument("--bootstrap-config", required=True)
    return root


def main():
    run(parser().parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
