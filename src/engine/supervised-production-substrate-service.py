#!/usr/bin/env python3
"""P3.6 P2b role-local fixed-topology peer probe runner.

The root-owned host supplies one immutable bootstrap config before launch and a
second immutable peer config only after every service PID and cgroup has been
verified. This runner creates only its predeclared listeners, verifies Unix
peer credentials before it reads a frame, and reports a no-effect receipt.
There is no Engine, action, permit, effect, acceptance, workspace, or durable
state surface in this program.
"""

import argparse
import json
import os
import socket
import stat
import sys
import threading
import time
from types import SimpleNamespace


MODULE_DIRECTORY = os.path.dirname(os.path.realpath(__file__))
sys.dont_write_bytecode = True
if MODULE_DIRECTORY not in sys.path:
    sys.path.insert(0, MODULE_DIRECTORY)

import supervised_production_substrate_peer as peer


SCHEMA_VERSION = 2
ROOT_CONFIG_MODE = 0o440
ROLE_ROOT_MODE = 0o710
SOCKET_ROOT_MODE = 0o2710
SOCKET_MODE = 0o660
ACK_MODE = 0o600
MAX_LIFECYCLE_TIMEOUT_SECONDS = 180


def fail(message):
    sys.stderr.write("supervised-production-substrate-service: " + message + "\n")
    raise SystemExit(2)


def canonical(value):
    return peer.canonical(value)


def sha256_value(value):
    return peer.sha256_value(value)


def require_schema_version(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value != SCHEMA_VERSION:
        fail(label + " must be the exact substrate schema version")
    return value


def require_lifecycle_timeout(value, label):
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 1
        or value > MAX_LIFECYCLE_TIMEOUT_SECONDS
    ):
        fail(label + " must be a bounded whole-second lifecycle timeout")
    return value


def peer_guard(callback):
    try:
        return callback()
    except peer.PeerProtocolError as error:
        fail(str(error))


def require_exact_identity(expected_uid, expected_gid):
    if os.geteuid() != expected_uid or os.getegid() != expected_gid:
        fail("service process does not match its configured identity")
    if set(os.getgroups()) != {expected_gid}:
        fail("service process has unexpected supplementary groups")


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
    path = peer_guard(lambda: peer.require_absolute_path(path, label + " path"))
    expected_gid = peer_guard(lambda: peer.require_nonroot_id(expected_gid, label + " gid"))
    parent = os.path.dirname(path)
    require_exact_directory(parent, 0, expected_gid, ROLE_ROOT_MODE, label + " parent")
    try:
        info = os.lstat(path)
    except OSError as error:
        fail(label + " cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != expected_gid
        or (info.st_mode & 0o777) != ROOT_CONFIG_MODE
    ):
        fail(label + " does not have the expected root-owned mode")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        fail(label + " cannot be opened safely: " + str(error))
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != expected_gid
            or (opened.st_mode & 0o777) != ROOT_CONFIG_MODE
        ):
            fail(label + " changed while opening")
        raw = os.read(descriptor, 65537)
    except OSError as error:
        fail(label + " cannot be read safely: " + str(error))
    finally:
        os.close(descriptor)
    if not raw or len(raw) > 65536:
        fail(label + " has an invalid size")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, ValueError) as error:
        fail(label + " is invalid JSON: " + str(error))
    if canonical(value) + "\n" != text:
        fail(label + " is not canonical")
    return value


def static_service_claim(value, label):
    value = peer_guard(
        lambda: peer.require_exact_keys(
            value,
            {"role", "identity", "uid", "gid", "attestation_hash"},
            label,
        )
    )
    return {
        "role": peer_guard(lambda: peer.require_token(value["role"], label + ".role")),
        "identity": peer_guard(
            lambda: peer.require_token(value["identity"], label + ".identity")
        ),
        "uid": peer_guard(lambda: peer.require_nonroot_id(value["uid"], label + ".uid")),
        "gid": peer_guard(lambda: peer.require_nonroot_id(value["gid"], label + ".gid")),
        "attestation_hash": peer_guard(
            lambda: peer.require_sha256(value["attestation_hash"], label + ".attestation_hash")
        ),
    }


def normalize_static_endpoint(value, label):
    value = peer_guard(
        lambda: peer.require_exact_keys(
            value,
            {"endpoint", "socket_root", "socket_path", "sender", "recipient"},
            label,
        )
    )
    endpoint = peer_guard(lambda: peer.require_endpoint(value["endpoint"], label + ".endpoint"))
    socket_root = peer_guard(
        lambda: peer.require_absolute_path(value["socket_root"], label + ".socket_root")
    )
    socket_path = peer_guard(
        lambda: peer.require_unix_socket_path(value["socket_path"], label + ".socket_path")
    )
    sender = static_service_claim(value["sender"], label + ".sender")
    recipient = static_service_claim(value["recipient"], label + ".recipient")
    if (
        os.path.dirname(socket_path) != socket_root
        or sender["role"] != endpoint["sender_role"]
        or recipient["role"] != endpoint["recipient_role"]
    ):
        fail(label + " does not match its fixed socket topology")
    return {
        "endpoint": endpoint,
        "socket_root": socket_root,
        "socket_path": socket_path,
        "sender": sender,
        "recipient": recipient,
    }


def read_bootstrap(path):
    value = read_root_group_json(path, os.getegid(), "peer bootstrap")
    value = peer_guard(
        lambda: peer.require_exact_keys(
            value,
            {
                "schema_version",
                "kind",
                "role",
                "identity",
                "uid",
                "gid",
                "attestation_hash",
                "release_path",
                "ack_path",
                "ready_path",
                "peer_config_path",
                "release_token",
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "release_timeout_seconds",
                "hold_seconds",
                "endpoints",
                "bootstrap_hash",
            },
            "peer bootstrap",
        )
    )
    material = dict(value)
    bootstrap_hash = material.pop("bootstrap_hash")
    if sha256_value(material) != peer_guard(
        lambda: peer.require_sha256(bootstrap_hash, "peer bootstrap.bootstrap_hash")
    ):
        fail("peer bootstrap hash does not match content")
    bindings = peer_guard(
        lambda: peer.require_bindings(
            {
                "install_binding_hash": value["install_binding_hash"],
                "run_binding_hash": value["run_binding_hash"],
                "substrate_abi_hash": value["substrate_abi_hash"],
            },
            "peer bootstrap bindings",
        )
    )
    bootstrap = {
        "schema_version": require_schema_version(
            value["schema_version"], "peer bootstrap.schema_version"
        ),
        "kind": value["kind"],
        "role": peer_guard(lambda: peer.require_token(value["role"], "peer bootstrap.role")),
        "identity": peer_guard(
            lambda: peer.require_token(value["identity"], "peer bootstrap.identity")
        ),
        "uid": peer_guard(lambda: peer.require_nonroot_id(value["uid"], "peer bootstrap.uid")),
        "gid": peer_guard(lambda: peer.require_nonroot_id(value["gid"], "peer bootstrap.gid")),
        "attestation_hash": peer_guard(
            lambda: peer.require_sha256(
                value["attestation_hash"], "peer bootstrap.attestation_hash"
            )
        ),
        "release_path": peer_guard(
            lambda: peer.require_absolute_path(value["release_path"], "peer bootstrap.release_path")
        ),
        "ack_path": peer_guard(
            lambda: peer.require_absolute_path(value["ack_path"], "peer bootstrap.ack_path")
        ),
        "ready_path": peer_guard(
            lambda: peer.require_absolute_path(value["ready_path"], "peer bootstrap.ready_path")
        ),
        "peer_config_path": peer_guard(
            lambda: peer.require_absolute_path(
                value["peer_config_path"], "peer bootstrap.peer_config_path"
            )
        ),
        "release_token": peer_guard(
            lambda: peer.require_token(value["release_token"], "peer bootstrap.release_token")
        ),
        **bindings,
        "release_timeout_seconds": require_lifecycle_timeout(
            value["release_timeout_seconds"], "peer bootstrap.release_timeout_seconds"
        ),
        "hold_seconds": require_lifecycle_timeout(
            value["hold_seconds"], "peer bootstrap.hold_seconds"
        ),
        "endpoints": [],
        "bootstrap_hash": bootstrap_hash,
    }
    if bootstrap["schema_version"] != SCHEMA_VERSION or bootstrap["kind"] != "p36_phase2b_bootstrap":
        fail("peer bootstrap has an unsupported schema or kind")
    require_exact_identity(bootstrap["uid"], bootstrap["gid"])
    if not isinstance(value["endpoints"], list) or not value["endpoints"]:
        fail("peer bootstrap endpoints must be a non-empty list")
    endpoint_ids = set()
    for index, item in enumerate(value["endpoints"]):
        endpoint = normalize_static_endpoint(item, "peer bootstrap endpoint")
        endpoint_id = endpoint["endpoint"]["endpoint_id"]
        if endpoint_id in endpoint_ids:
            fail("peer bootstrap repeats an endpoint")
        endpoint_ids.add(endpoint_id)
        if bootstrap["role"] not in {
            endpoint["endpoint"]["sender_role"],
            endpoint["endpoint"]["recipient_role"],
        }:
            fail("peer bootstrap grants an unrelated endpoint")
        own = (
            endpoint["sender"]
            if endpoint["endpoint"]["sender_role"] == bootstrap["role"]
            else endpoint["recipient"]
        )
        if own != {
            "role": bootstrap["role"],
            "identity": bootstrap["identity"],
            "uid": bootstrap["uid"],
            "gid": bootstrap["gid"],
            "attestation_hash": bootstrap["attestation_hash"],
        }:
            fail("peer bootstrap endpoint does not retain this role identity")
        bootstrap["endpoints"].append(endpoint)
    return bootstrap


def normalize_runtime_endpoint(value, bootstrap_endpoint, bootstrap, label):
    value = peer_guard(
        lambda: peer.require_exact_keys(
            value,
            {"endpoint", "socket_root", "socket_path", "sender", "recipient"},
            label,
        )
    )
    endpoint = peer_guard(lambda: peer.require_endpoint(value["endpoint"], label + ".endpoint"))
    socket_root = peer_guard(
        lambda: peer.require_absolute_path(value["socket_root"], label + ".socket_root")
    )
    socket_path = peer_guard(
        lambda: peer.require_unix_socket_path(value["socket_path"], label + ".socket_path")
    )
    sender = peer_guard(lambda: peer.runtime_service_claim(value["sender"], label + ".sender"))
    recipient = peer_guard(
        lambda: peer.runtime_service_claim(value["recipient"], label + ".recipient"))
    if (
        endpoint != bootstrap_endpoint["endpoint"]
        or socket_root != bootstrap_endpoint["socket_root"]
        or socket_path != bootstrap_endpoint["socket_path"]
        or os.path.dirname(socket_path) != socket_root
        or {key: sender[key] for key in ("role", "identity", "uid", "gid", "attestation_hash")}
        != bootstrap_endpoint["sender"]
        or {key: recipient[key] for key in ("role", "identity", "uid", "gid", "attestation_hash")}
        != bootstrap_endpoint["recipient"]
    ):
        fail(label + " does not match the frozen bootstrap endpoint")
    own = sender if endpoint["sender_role"] == bootstrap["role"] else recipient
    if (
        own["pid"] != os.getpid()
        or own["uid"] != bootstrap["uid"]
        or own["gid"] != bootstrap["gid"]
        or not peer.cgroup_v2_matches(own["pid"], own["cgroup_path"])
    ):
        fail(label + " does not match this service runtime identity and cgroup")
    return {
        "endpoint": endpoint,
        "socket_root": socket_root,
        "socket_path": socket_path,
        "sender": sender,
        "recipient": recipient,
    }


def read_peer_config(bootstrap):
    value = read_root_group_json(bootstrap["peer_config_path"], bootstrap["gid"], "peer config")
    value = peer_guard(
        lambda: peer.require_exact_keys(
            value,
            {
                "schema_version",
                "kind",
                "role",
                "install_binding_hash",
                "run_binding_hash",
                "substrate_abi_hash",
                "endpoints",
                "peer_config_hash",
            },
            "peer config",
        )
    )
    material = dict(value)
    peer_config_hash = material.pop("peer_config_hash")
    if sha256_value(material) != peer_guard(
        lambda: peer.require_sha256(peer_config_hash, "peer config.peer_config_hash")
    ):
        fail("peer config hash does not match content")
    schema_version = require_schema_version(value["schema_version"], "peer config.schema_version")
    if (
        schema_version != SCHEMA_VERSION
        or value["kind"] != "p36_phase2b_peer_config"
        or value["role"] != bootstrap["role"]
        or any(value[key] != bootstrap[key] for key in peer.require_bindings(
            {
                "install_binding_hash": value["install_binding_hash"],
                "run_binding_hash": value["run_binding_hash"],
                "substrate_abi_hash": value["substrate_abi_hash"],
            },
            "peer config bindings",
        ))
        or not isinstance(value["endpoints"], list)
        or len(value["endpoints"]) != len(bootstrap["endpoints"])
    ):
        fail("peer config does not match the frozen bootstrap")
    endpoints = []
    for index, item in enumerate(value["endpoints"]):
        endpoints.append(
            normalize_runtime_endpoint(
                item, bootstrap["endpoints"][index], bootstrap, "peer config endpoint"
            )
        )
    return {"endpoints": endpoints, "peer_config_hash": peer_config_hash}


def read_release_token(path, expected_token, expected_gid):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError as error:
        fail("release path cannot be inspected: " + str(error))
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != expected_gid
        or (info.st_mode & 0o777) != 0o440
    ):
        fail("release file does not have the expected root-owned mode")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        fail("release file cannot be opened safely: " + str(error))
    try:
        opened = os.fstat(descriptor)
        if (
            stat.S_ISLNK(opened.st_mode)
            or not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != 0
            or opened.st_gid != expected_gid
            or (opened.st_mode & 0o777) != 0o440
        ):
            fail("release file changed while opening")
        value = os.read(descriptor, 256).decode("ascii")
    except (OSError, UnicodeDecodeError) as error:
        fail("release file cannot be read safely: " + str(error))
    finally:
        os.close(descriptor)
    if value != expected_token + "\n":
        fail("release token does not match this service invocation")
    return True


def wait_for_release(bootstrap):
    deadline = time.monotonic() + bootstrap["release_timeout_seconds"]
    while True:
        if read_release_token(
            bootstrap["release_path"], bootstrap["release_token"], bootstrap["gid"]
        ):
            return
        if time.monotonic() >= deadline:
            fail("release_timeout")
        time.sleep(0.025)


def bind_listener(endpoint, bootstrap):
    if endpoint["endpoint"]["recipient_role"] != bootstrap["role"]:
        fail("service attempted to bind a sender-owned endpoint")
    socket_root = endpoint["socket_root"]
    socket_path = endpoint["socket_path"]
    sender = endpoint["sender"]
    require_exact_directory(
        socket_root,
        bootstrap["uid"],
        sender["gid"],
        SOCKET_ROOT_MODE,
        endpoint["endpoint"]["endpoint_id"] + " socket root",
    )
    if os.path.lexists(socket_path):
        fail(endpoint["endpoint"]["endpoint_id"] + " socket path already exists")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(socket_path)
        os.chmod(socket_path, SOCKET_MODE)
        require_exact_socket(
            socket_path,
            bootstrap["uid"],
            sender["gid"],
            SOCKET_MODE,
            endpoint["endpoint"]["endpoint_id"] + " listener socket",
        )
        listener.listen(8)
        return listener
    except BaseException:
        listener.close()
        raise


def make_peer_receipt(direction, endpoint, peer_claim, request, response):
    material = {
        "direction": direction,
        "endpoint_id": endpoint["endpoint"]["endpoint_id"],
        "route_operation": endpoint["endpoint"]["route_operation"],
        "peer": peer.public_claim_from_runtime(peer_claim, "peer receipt peer"),
        "request_hash": request["request_hash"],
        "response_hash": response["response_hash"],
    }
    value = dict(material)
    value["receipt_hash"] = sha256_value(material)
    return value


def serve_listener(listener, endpoint, bootstrap, result):
    deadline = time.monotonic() + peer.PEER_TIMEOUT_SECONDS
    connection = None
    try:
        while connection is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise peer.PeerProtocolError("peer listener did not receive its fixed sender before the deadline")
            listener.settimeout(remaining)
            try:
                candidate, _ = listener.accept()
            except socket.timeout:
                raise peer.PeerProtocolError("peer listener did not receive its fixed sender before the deadline")
            try:
                candidate.settimeout(peer.PEER_TIMEOUT_SECONDS)
                if peer.peer_credentials_match(candidate, endpoint["sender"]) is None:
                    candidate.close()
                    continue
                connection = candidate
            except BaseException:
                candidate.close()
                raise
        payload = peer.read_single_frame(connection, peer.PEER_TIMEOUT_SECONDS)
        request = peer.normalize_peer_probe_request(
            peer.decode_canonical_frame(payload, "peer probe request"),
            endpoint["endpoint"],
            endpoint["sender"],
            endpoint["recipient"],
            {
                "install_binding_hash": bootstrap["install_binding_hash"],
                "run_binding_hash": bootstrap["run_binding_hash"],
                "substrate_abi_hash": bootstrap["substrate_abi_hash"],
            },
        )
        response = peer.create_peer_probe_response(request)
        peer.send_frame(connection, peer.encode_canonical_frame(response))
        result["receipt"] = make_peer_receipt(
            "inbound", endpoint, endpoint["sender"], request, response
        )
    except BaseException as error:
        result["error"] = error
    finally:
        if connection is not None:
            connection.close()
        listener.close()


def send_outbound_probe(endpoint, bootstrap):
    if endpoint["endpoint"]["sender_role"] != bootstrap["role"]:
        fail("service attempted to send through a recipient-owned endpoint")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(peer.PEER_TIMEOUT_SECONDS)
        connection.connect(endpoint["socket_path"])
        if peer.peer_credentials_match(connection, endpoint["recipient"]) is None:
            raise peer.PeerProtocolError("outbound peer does not match the frozen recipient identity")
        request = peer.create_peer_probe_request(
            endpoint["endpoint"],
            endpoint["sender"],
            endpoint["recipient"],
            {
                "install_binding_hash": bootstrap["install_binding_hash"],
                "run_binding_hash": bootstrap["run_binding_hash"],
                "substrate_abi_hash": bootstrap["substrate_abi_hash"],
            },
        )
        peer.send_frame(connection, peer.encode_canonical_frame(request))
        response = peer.normalize_peer_probe_response(
            peer.decode_canonical_frame(
                peer.read_single_frame(connection, peer.PEER_TIMEOUT_SECONDS), "peer probe response"
            ),
            request,
        )
        return make_peer_receipt("outbound", endpoint, endpoint["recipient"], request, response)
    finally:
        connection.close()


def run_peer_probes(listeners, peer_config, bootstrap):
    listener_results = {}
    listener_threads = []
    outbound_receipts = {}
    for endpoint in peer_config["endpoints"]:
        endpoint_id = endpoint["endpoint"]["endpoint_id"]
        if endpoint["endpoint"]["recipient_role"] == bootstrap["role"]:
            result = {}
            listener_results[endpoint_id] = result
            thread = threading.Thread(
                target=serve_listener,
                args=(listeners[endpoint_id], endpoint, bootstrap, result),
                daemon=False,
            )
            listener_threads.append(thread)
            thread.start()
    for endpoint in peer_config["endpoints"]:
        endpoint_id = endpoint["endpoint"]["endpoint_id"]
        if endpoint["endpoint"]["sender_role"] == bootstrap["role"]:
            outbound_receipts[endpoint_id] = send_outbound_probe(endpoint, bootstrap)
    for thread in listener_threads:
        thread.join(peer.PEER_TIMEOUT_SECONDS * 3 + 1)
        if thread.is_alive():
            raise peer.PeerProtocolError("peer listener did not finish before the deadline")
    for result in listener_results.values():
        if "error" in result:
            raise result["error"]
        if "receipt" not in result:
            raise peer.PeerProtocolError("peer listener did not publish a receipt")
    receipts = []
    for endpoint in peer_config["endpoints"]:
        endpoint_id = endpoint["endpoint"]["endpoint_id"]
        if endpoint["endpoint"]["sender_role"] == bootstrap["role"]:
            receipts.append(outbound_receipts[endpoint_id])
        else:
            receipts.append(listener_results[endpoint_id]["receipt"])
    return receipts


def publish_owned_json(path, expected_uid, expected_gid, value, label):
    content = (canonical(value) + "\n").encode("utf-8")
    pending_path = path + ".pending"
    if os.path.lexists(path) or os.path.lexists(pending_path):
        fail(label + " publication path already exists")
    descriptor = None
    pending_exists = False
    try:
        descriptor = os.open(
            pending_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            ACK_MODE,
        )
        pending_exists = True
        os.fchmod(descriptor, ACK_MODE)
        total = 0
        while total < len(content):
            written = os.write(descriptor, content[total:])
            if written <= 0:
                fail(label + " pending path short write")
            total += written
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_gid != expected_gid
            or (info.st_mode & 0o777) != ACK_MODE
        ):
            fail(label + " pending file does not retain the expected identity and mode")
        os.link(pending_path, path, follow_symlinks=False)
        os.unlink(pending_path)
        pending_exists = False
    except OSError as error:
        fail(label + " cannot be atomically created and published: " + str(error))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if pending_exists:
            try:
                info = os.lstat(pending_path)
                if (
                    stat.S_ISREG(info.st_mode)
                    and info.st_uid == expected_uid
                    and info.st_gid == expected_gid
                    and (info.st_mode & 0o777) == ACK_MODE
                ):
                    os.unlink(pending_path)
            except OSError:
                pass
    try:
        directory_descriptor = os.open(
            os.path.dirname(path),
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
    except OSError as error:
        fail(label + " directory cannot be opened safely: " + str(error))
    try:
        os.fsync(directory_descriptor)
    except OSError as error:
        fail(label + " directory cannot be synchronized: " + str(error))
    finally:
        os.close(directory_descriptor)


def write_listener_ready(args, listener_endpoint_ids):
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2_listener_ready",
        "status": "fixed_listeners_ready",
        "role": args.role,
        "pid": os.getpid(),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "install_binding_hash": args.install_binding_hash,
        "run_binding_hash": args.run_binding_hash,
        "substrate_abi_hash": args.substrate_abi_hash,
        "listener_endpoint_ids": listener_endpoint_ids,
    }
    value = dict(material)
    value["ready_hash"] = sha256_value(material)
    publish_owned_json(
        args.ready_path,
        args.expected_uid,
        args.expected_gid,
        value,
        "listener readiness",
    )


def write_ack(args, ipc_receipts=None):
    if ipc_receipts is None:
        ipc_receipts = []
    material = {
        "schema_version": SCHEMA_VERSION,
        "kind": "p36_phase2_release_ack",
        "status": "released_peer_authenticated_no_effect",
        "role": args.role,
        "pid": os.getpid(),
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "install_binding_hash": args.install_binding_hash,
        "run_binding_hash": args.run_binding_hash,
        "substrate_abi_hash": args.substrate_abi_hash,
        "release_hash": sha256_value(args.release_token),
        "ipc_receipts": ipc_receipts,
    }
    value = dict(material)
    value["ack_hash"] = sha256_value(material)
    publish_owned_json(
        args.ack_path,
        args.expected_uid,
        args.expected_gid,
        value,
        "ack",
    )


def run(args):
    bootstrap_path = peer_guard(
        lambda: peer.require_absolute_path(args.bootstrap_config, "bootstrap_config")
    )
    bootstrap = read_bootstrap(bootstrap_path)
    listeners = {}
    try:
        for endpoint in bootstrap["endpoints"]:
            if endpoint["endpoint"]["recipient_role"] == bootstrap["role"]:
                listeners[endpoint["endpoint"]["endpoint_id"]] = bind_listener(endpoint, bootstrap)
        runner_args = SimpleNamespace(
            role=bootstrap["role"],
            ready_path=bootstrap["ready_path"],
            ack_path=bootstrap["ack_path"],
            release_token=bootstrap["release_token"],
            expected_uid=bootstrap["uid"],
            expected_gid=bootstrap["gid"],
            install_binding_hash=bootstrap["install_binding_hash"],
            run_binding_hash=bootstrap["run_binding_hash"],
            substrate_abi_hash=bootstrap["substrate_abi_hash"],
        )
        write_listener_ready(runner_args, list(listeners))
        wait_for_release(bootstrap)
        peer_config = read_peer_config(bootstrap)
        ipc_receipts = run_peer_probes(listeners, peer_config, bootstrap)
        write_ack(
            runner_args,
            ipc_receipts,
        )
        time.sleep(bootstrap["hold_seconds"])
    except peer.PeerProtocolError as error:
        fail(str(error))
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
