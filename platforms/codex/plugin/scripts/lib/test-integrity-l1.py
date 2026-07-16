#!/usr/bin/env python3
# L0/L1 analysis engine invoked by check-test-integrity.sh.

import json
import hashlib
import os
import tempfile
import time
import xml.etree.ElementTree as ET
import re
import subprocess
import signal
import shutil
import sys


def emit(output, code):
    print(json.dumps(output, indent=2))
    raise SystemExit(code)


def emit_git_error(message, output_extra=None):
    output = {
        "ok": False,
        "mode": "block",
        "violations": [
            {
                "layer": "L0",
                "file": "",
                "kind": "git_error",
                "line": 1,
                "detail": message,
            }
        ],
        "surface_touches": [],
        "test_paths_matched": 0,
        "source": "internal",
    }
    if output_extra:
        output.update(output_extra)
    emit(output, 2)


def run_command(cmd, repo_dir, check=True, env=None, cwd=None, timeout=None):
    res = subprocess.run(
        cmd,
        cwd=cwd or repo_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if check and res.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed for {' '.join(cmd[1:])}: {res.stderr or res.stdout}")
    return res


def expand_braces(text):
    res = [text]
    while True:
        next_res = []
        expanded = False
        for value in res:
            match = re.search(r"\{([^}]+)\}", value)
            if match:
                expanded = True
                options = [opt.strip() for opt in match.group(1).split(",")]
                start = value[: match.start()]
                end = value[match.end() :]
                for option in options:
                    next_res.append(start + option + end)
            else:
                next_res.append(value)
        if not expanded:
            break
        res = next_res
    return res


def glob_to_regex(pattern):
    expanded = pattern
    if expanded.startswith("**/"):
        expanded = "___LEADING_DIR___" + expanded[3:]
    expanded = expanded.replace("/**/", "___ANY_DIR___")
    expanded = expanded.replace("/**", "___DIR_REST___")
    expanded = expanded.replace("**", ".*")
    expanded = expanded.replace("*", "___SINGLE_STAR___")
    expanded = expanded.replace("?", "___QUESTION___")
    expanded = re.escape(expanded)
    expanded = expanded.replace("___LEADING_DIR___", "(?:^|.*/)")
    expanded = expanded.replace("___ANY_DIR___", "/(?:.*/)?")
    expanded = expanded.replace("___DIR_REST___", "/.*")
    expanded = expanded.replace("___SINGLE_STAR___", "[^/]*")
    expanded = expanded.replace("___QUESTION___", "[^/]")
    if "/" not in pattern:
        expanded = "(?:^|.*/)" + expanded
    return re.compile("^" + expanded + "$")


def matches_patterns(path, regexes):
    if not path:
        return False
    return any(regex.match(path) for regex in regexes)


def parse_config(content):
    config = {"mode": "warn", "test_paths": [], "surface_paths": []}
    malformed = False
    malformed_detail = None
    section = None

    def strip_comment(value):
        return re.sub(r"\s*#.*$", "", value).strip()

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue

        if line.startswith("##"):
            heading = line[2:].strip().lower()
            if "mode" in heading:
                section = "mode"
            elif "test path" in heading or "test_path" in heading:
                section = "test_paths"
            elif "surface" in heading:
                section = "surface_paths"
            else:
                section = None
            continue

        mode_match = re.match(r"^mode\s*:\s*(\w+)\s*$", line, re.IGNORECASE)
        if mode_match:
            section = "mode"
            value = mode_match.group(1).lower()
            if value in ("block", "warn", "off"):
                config["mode"] = value
            else:
                malformed = True
                malformed_detail = f"Invalid mode value: {value}"
            continue

        if line.startswith("-"):
            value = strip_comment(line[1:]).strip()
            if not value:
                malformed = True
                malformed_detail = "Empty list item in config"
                continue
            if section == "mode":
                value = value.lower()
                if value in ("block", "warn", "off"):
                    config["mode"] = value
                else:
                    malformed = True
                    malformed_detail = f"Invalid mode value: {value}"
            elif section in ("test_paths", "surface_paths"):
                config[section].append(value.strip("'\""))
            else:
                malformed = True
                malformed_detail = f"Unrecognized config line: {line}"
            continue

        if section in ("test_paths", "surface_paths"):
            value = strip_comment(line).strip()
            if not value:
                malformed = True
                malformed_detail = f"Unrecognized config line: {line}"
            else:
                config[section].append(value.strip("'\""))
            continue

        malformed = True
        malformed_detail = f"Unrecognized config line: {line}"

    if config["mode"] not in ("block", "warn", "off"):
        malformed = True
        malformed_detail = f"Invalid mode value: {config['mode']}"

    return config, malformed, malformed_detail


def read_blob(path, ref, repo_dir):
    res = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        return None
    return res.stdout


def decode_git_token(token):
    token = token.strip()
    if token.startswith('"') and token.endswith('"'):
        token = token[1:-1]
        token = bytes(token, "utf-8").decode("unicode_escape")
    if token.startswith("a/") or token.startswith("b/"):
        token = token[2:]
    return token


def strip_trailing_comment(line, lang_key):
    if lang_key in ("python", "ruby"):
        line = re.sub(r"(?<=\S)\s*#.*$", "", line)
    if lang_key in ("js_ts", "go", "java_kotlin", "rust"):
        line = re.sub(r"//.*$", "", line)
    return line


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json(ids):
    return json.dumps(ids, ensure_ascii=True, separators=(",", ":"), sort_keys=False)


def canonical_sorted_json_sha256(ids):
    return sha256_hex(canonical_json(sorted(ids)).encode("utf-8"))


def compute_changeset_digest(repo_dir, base_sha, head_sha):
    env = os.environ.copy()
    env["LC_ALL"] = "C"
    raw = subprocess.run(
        ["git", "diff", "-M", "--raw", "--full-index", "-z", f"{base_sha}..{head_sha}"],
        cwd=repo_dir,
        env=env,
        capture_output=True,
        check=True,
        text=False,
    ).stdout
    return sha256_hex(raw)


def run_with_timeout(cmd, cwd, env, timeout_sec):
    pgrp = None
    timed_out = False
    start = time.time()
    try:
        preexec = None
        if hasattr(os, "setsid"):
            preexec = os.setsid
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            preexec_fn=preexec,
        )
        pgrp = proc.pid
        out, err = proc.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        timed_out = True
        if pgrp is not None:
            try:
                os.killpg(os.getpgid(pgrp), signal.SIGTERM)
            except Exception:
                pass
            time.sleep(5)
            try:
                os.killpg(os.getpgid(pgrp), signal.SIGKILL)
            except Exception:
                pass
        out, err = proc.communicate(timeout=5)
    return proc.returncode, out, err, timed_out, time.time() - start


def build_scrubbed_env():
    env = os.environ.copy()
    deny_exact = {"PYTEST_ADDOPTS", "PYTEST_PLUGINS", "GOFLAGS", "GOTAGS", "NODE_OPTIONS"}
    deny_prefix = ("JEST_", "VITEST_", "NPM_CONFIG_")
    deny_suffix = ("_ADDOPTS", "_OPTS")
    remove_keys = []
    for key in env.keys():
        if key in deny_exact:
            remove_keys.append(key)
            continue
        upper = key.upper()
        if upper.startswith(deny_prefix):
            remove_keys.append(key)
            continue
        if upper.endswith(deny_suffix):
            remove_keys.append(key)
            continue
    for key in remove_keys:
        env.pop(key, None)
    env["CI"] = "1"
    env["LC_ALL"] = "C"
    env["TZ"] = "UTC"
    return env


def is_path_within_root(root, path):
    norm_root = os.path.realpath(root) + os.sep
    norm_path = os.path.realpath(path)
    return norm_path == os.path.realpath(root) or norm_path.startswith(norm_root)


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def _find_all_files(root, name):
    for dirpath, _, filenames in os.walk(root):
        if name in filenames:
            return True
    return False


def _has_pytest_test_file(root):
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if filename.startswith("test_") and filename.endswith(".py"):
                return True
            if filename.endswith("_test.py"):
                return True
    return False


def _read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            return handle.read()
    except Exception:
        return ""


def _parse_package_json(path):
    payload = _read_json(path)
    if not isinstance(payload, dict):
        return {}
    keys = set(payload.keys())
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        val = payload.get(section)
        if isinstance(val, dict):
            keys.update(val.keys())
    return keys


def _read_file_lines(path):
    return _read_text(path).splitlines()


def _has_file_pattern(root, predicate):
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if predicate(name):
                return True
    return False


def detect_runner_markers(side_dir):
    pytest_marker = False
    jest_marker = False
    vitest_marker = False
    go_marker = False

    pytest_ini = os.path.join(side_dir, "pytest.ini")
    tox_ini = os.path.join(side_dir, "tox.ini")
    setup_cfg = os.path.join(side_dir, "setup.cfg")
    pyproject_toml = os.path.join(side_dir, "pyproject.toml")
    package_json = os.path.join(side_dir, "package.json")

    if os.path.isfile(pytest_ini):
        pytest_marker = True
    elif os.path.isfile(tox_ini):
        content = _read_text(tox_ini).lower()
        if re.search(r"^\[pytest\]\s*$", content, flags=re.MULTILINE) or re.search(r"^\[tool:pytest\]\s*$", content, flags=re.MULTILINE):
            pytest_marker = True
    elif os.path.isfile(setup_cfg):
        content = _read_text(setup_cfg).lower()
        if re.search(r"^\[tool:pytest\]\s*$", content, flags=re.MULTILINE):
            pytest_marker = True
    elif os.path.isfile(pyproject_toml):
        content = _read_text(pyproject_toml)
        if re.search(r"^\[tool\\.pytest\\.ini_options\\]", content, flags=re.MULTILINE):
            pytest_marker = True
    if _find_all_files(side_dir, "conftest.py"):
        pytest_marker = True
    if _has_pytest_test_file(side_dir):
        pytest_marker = True

    if os.path.isfile(package_json):
        package_keys = _parse_package_json(package_json)
        if "jest" in package_keys:
            jest_marker = True
        if "vitest" in package_keys:
            vitest_marker = True
        if os.path.isfile(os.path.join(side_dir, "jest.config.js")) or os.path.isfile(os.path.join(side_dir, "jest.config.ts")) or os.path.isfile(os.path.join(side_dir, "jest.config.cjs")) or os.path.isfile(os.path.join(side_dir, "jest.config.mjs")) or os.path.isfile(os.path.join(side_dir, "jest.config.json")):
            jest_marker = True
        if os.path.isfile(os.path.join(side_dir, "vitest.config.js")) or os.path.isfile(os.path.join(side_dir, "vitest.config.ts")) or os.path.isfile(os.path.join(side_dir, "vitest.config.mjs")) or os.path.isfile(os.path.join(side_dir, "vitest.config.cjs")):
            vitest_marker = True
        if os.path.isfile(os.path.join(side_dir, "vite.config.js")) or os.path.isfile(os.path.join(side_dir, "vite.config.ts")) or os.path.isfile(os.path.join(side_dir, "vite.config.mjs")) or os.path.isfile(os.path.join(side_dir, "vite.config.cjs")):
            vite_config = _read_text(os.path.join(side_dir, "vite.config.js"))
            if "test:" in vite_config:
                vitest_marker = True
    go_mod = os.path.join(side_dir, "go.mod")
    if os.path.isfile(go_mod) and _has_file_pattern(side_dir, lambda name: name.endswith("_test.go")):
        go_marker = True

    return {
        "pytest": pytest_marker,
        "jest": jest_marker,
        "vitest": vitest_marker,
        "go": go_marker,
    }


def detect_pytest_tool(side_dir, env):
    result = {"available": False, "command": ["python3", "-m", "pytest"], "interp": None}
    try:
        rc = run_command(["python3", "-m", "pytest", "--version"], side_dir, env=env, check=False, timeout=5)
        if rc.returncode == 0:
            interp = shutil.which("python3")
            if interp is None:
                interp = "python3"
            result["available"] = True
            result["interp"] = f"{interp} ({rc.stdout.strip() or 'pytest'})"
            result["command"] = ["python3", "-m", "pytest"]
    except Exception:
        pass
    return result


def _node_tool_from_package(root, env, name):
    result = {"available": False, "command": []}
    local_bin = os.path.join(root, "node_modules", ".bin", name)
    if os.path.isfile(local_bin) and os.access(local_bin, os.X_OK):
        result["available"] = True
        result["command"] = [local_bin]
        return result
    try:
        rc = run_command(
            ["npx", "--no-install", name, "--version"],
            root,
            env=env,
            check=False,
            timeout=20,
        )
        if rc.returncode == 0:
            result["available"] = True
            result["command"] = ["npx", "--no-install", name]
    except Exception:
        pass
    return result


def detect_jest_tool(side_dir, env):
    return _node_tool_from_package(side_dir, env, "jest")


def detect_vitest_tool(side_dir, env):
    return _node_tool_from_package(side_dir, env, "vitest")


def detect_go_tool(side_dir, env):
    result = {"available": False, "command": ["go"]}
    try:
        # Detection must not trigger a toolchain download; collection pays that cost under its own timeout.
        probe_env = dict(env)
        probe_env["GOTOOLCHAIN"] = "local"
        rc = run_command(["go", "version"], side_dir, env=probe_env, check=False, timeout=5)
        if rc.returncode == 0:
            result["available"] = True
            result["command"] = ["go"]
    except Exception:
        pass
    return result


def detect_runners(side_dir, env):
    markers = detect_runner_markers(side_dir)
    tool_pytest = detect_pytest_tool(side_dir, env)
    tool_jest = detect_jest_tool(side_dir, env)
    tool_vitest = detect_vitest_tool(side_dir, env)
    tool_go = detect_go_tool(side_dir, env)
    return {
        "pytest": {
            "marker": bool(markers["pytest"]),
            "tool": bool(tool_pytest["available"]),
            "tool_command": tool_pytest["command"],
            "pytest_interp": tool_pytest["interp"],
        },
        "jest": {
            "marker": bool(markers["jest"]),
            "tool": bool(tool_jest["available"]),
            "tool_command": tool_jest["command"],
        },
        "vitest": {
            "marker": bool(markers["vitest"]),
            "tool": bool(tool_vitest["available"]),
            "tool_command": tool_vitest["command"],
        },
        "go": {
            "marker": bool(markers["go"]),
            "tool": bool(tool_go["available"]),
            "tool_command": tool_go["command"],
        },
    }


def _pytest_id_and_status(testcase, worktree_root):
    file_attr = testcase.attrib.get("file")
    classname = testcase.attrib.get("classname", "")
    name = testcase.attrib.get("name", "")
    if not file_attr or not name:
        return None, None, "unstable_ids"
    if os.path.isabs(file_attr):
        abs_file = os.path.realpath(file_attr)
    else:
        abs_file = os.path.realpath(os.path.join(worktree_root, file_attr))
    if not is_path_within_root(worktree_root, abs_file):
        return None, None, "unstable_ids"
    rel_file = os.path.relpath(abs_file, worktree_root).replace("\\", "/")
    module_prefix = rel_file[:-3].replace("/", ".")
    if classname.startswith(module_prefix + "."):
        remainder = classname[len(module_prefix) + 1 :]
        class_path = "::".join([segment for segment in remainder.split(".") if segment])
    elif classname == module_prefix:
        class_path = ""
    else:
        class_path = classname
    if class_path:
        test_id = f"{rel_file}::{class_path}::{name}"
    else:
        test_id = f"{rel_file}::{name}"
    if testcase.find("skipped") is not None:
        return test_id, False, None
    if testcase.find("failure") is not None:
        return test_id, True, None
    if testcase.find("error") is not None:
        return test_id, True, None
    return test_id, True, None


def _is_pytest_collection_failure(testcase):
    for error in testcase.findall("error"):
        msg = (error.attrib.get("message") or "").strip().lower()
        text = (error.text or "").strip().lower()
        if "collection failure" in msg or "collection failure" in text:
            return True
    return False


def collect_pytest(side_dir, command, timeout_sec, env):
    report_file = os.path.join(side_dir, "pytest-l1.xml")
    cmd = command + [
        "-p",
        "no:cacheprovider",
        "-o",
        "junit_family=legacy",
        "-o",
        "addopts=",
        f"--junit-xml={report_file}",
        "-rN",
        "-q",
        "--no-header",
        "--rootdir=.",
    ]
    rc, out, err, timed_out, duration = run_with_timeout(cmd, side_dir, env, timeout_sec)
    if timed_out:
        return {"ok": False, "reason": "timeout", "ids": set(), "count": 0, "duration": duration}
    if rc != 0 and (not os.path.exists(report_file) or os.path.getsize(report_file) == 0):
        return {"ok": False, "reason": "build_failed", "ids": set(), "count": 0, "duration": duration}

    if not os.path.exists(report_file) or os.path.getsize(report_file) == 0:
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}

    try:
        root = ET.parse(report_file).getroot()
    except Exception:
        return {"ok": False, "reason": "malformed_report", "ids": set(), "count": 0, "duration": duration}

    ids = []
    counts = {}
    collection_failed = False
    for suite in root.findall(".//testsuite"):
        suite_errors = suite.attrib.get("errors", "0")
        try:
            suite_errors = int(suite_errors)
        except Exception:
            suite_errors = 0

        suite_has_testcase = False
        for tc in suite.findall("testcase"):
            suite_has_testcase = True
            test_id, executed, reason = _pytest_id_and_status(tc, side_dir)
            if reason == "unstable_ids":
                return {"ok": False, "reason": "unstable_ids", "ids": set(), "count": 0, "duration": duration}
            if not test_id:
                continue
            if executed is True and _is_pytest_collection_failure(tc):
                collection_failed = True
                continue
            ids.append((test_id, executed))

        if suite_errors > 0 and (suite_has_testcase is False):
            collection_failed = True

    if collection_failed:
        return {"ok": False, "reason": "build_failed", "ids": set(), "count": 0, "duration": duration}

    id_counts = {}
    for test_id, _ in ids:
        id_counts[test_id] = id_counts.get(test_id, 0) + 1
    if any(count > 1 for count in id_counts.values()):
        return {"ok": False, "reason": "ambiguous_ids", "ids": set(), "count": 0, "duration": duration}

    executed_ids = set(tid for tid, executed in ids if executed)
    return {"ok": True, "reason": None, "ids": executed_ids, "count": len(executed_ids), "duration": duration}


def _normalize_test_path(file_path, worktree_dir):
    if not file_path:
        return None
    if not os.path.isabs(file_path):
        file_path = os.path.join(worktree_dir, file_path)
    abs_file = os.path.realpath(file_path)
    if not is_path_within_root(worktree_dir, abs_file):
        return None
    return os.path.relpath(abs_file, worktree_dir).replace("\\", "/")


def _id_and_status_jest(assertion, file_path, worktree_dir):
    rel_file = _normalize_test_path(file_path, worktree_dir)
    if rel_file is None:
        return None, None, "unstable_ids"
    ancestors = assertion.get("ancestorTitles", []) or []
    title = assertion.get("title", "")
    base = f"{rel_file} > " + " > ".join(ancestors + [title]) if ancestors else f"{rel_file} > {title}"
    location = assertion.get("location") or {}
    line = location.get("line") if isinstance(location, dict) else None
    column = location.get("column") if isinstance(location, dict) else None
    status = assertion.get("status")
    executed = status in {"passed", "failed"}
    return base, executed, {"line": line, "column": column}


def collect_jest(side_dir, command, timeout_sec, env, require_location):
    report_file = os.path.join(side_dir, "jest-l1.json")
    cmd = command + [
        "--json",
        "--testLocationInResults",
        f"--outputFile={report_file}",
        "--ci",
        "--runInBand",
        "--silent",
        "--reporters=default",
    ]
    rc, out, err, timed_out, duration = run_with_timeout(cmd, side_dir, env, timeout_sec)
    if timed_out:
        return {"ok": False, "reason": "timeout", "ids": set(), "count": 0, "duration": duration}
    if not os.path.exists(report_file):
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}
    if os.path.getsize(report_file) == 0:
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}
    payload = _read_json(report_file)
    if not isinstance(payload, dict):
        reason = "reporter_failed" if rc != 0 else "malformed_report"
        return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
    test_results = payload.get("testResults")
    if not isinstance(test_results, list):
        reason = "reporter_failed" if rc != 0 else "malformed_report"
        return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
    items = []
    parseable_assertions = False
    for tr in test_results or []:
        if not isinstance(tr, dict):
            reason = "reporter_failed" if rc != 0 else "malformed_report"
            return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
        file_path = tr.get("testFilePath") or tr.get("name")
        assertions = tr.get("assertionResults")
        if not isinstance(assertions, list):
            reason = "reporter_failed" if rc != 0 else "malformed_report"
            return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
        for assertion in tr.get("assertionResults", []) or []:
            if not isinstance(assertion, dict):
                reason = "reporter_failed" if rc != 0 else "malformed_report"
                return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
            parseable_assertions = True
            test_id, executed, loc = _id_and_status_jest(assertion, file_path, side_dir)
            if loc is None and require_location:
                continue
            if test_id is None:
                return {"ok": False, "reason": "unstable_ids", "ids": set(), "count": 0, "duration": duration}
            status = assertion.get("status")
            if status not in {"passed", "failed", "pending", "skipped", "todo", "disabled"}:
                status = str(status or "")
            items.append((test_id, executed, status, loc))
    if not parseable_assertions and rc != 0:
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}
    if require_location:
        duplicates = {}
        for test_id, _, _, loc in items:
            duplicates[test_id] = duplicates.get(test_id, 0) + 1
        if any(value > 1 for value in duplicates.values()):
            remapped = []
            for test_id, executed, status, loc in items:
                line = loc.get("line") if isinstance(loc, dict) else None
                column = loc.get("column") if isinstance(loc, dict) else None
                if line is None or column is None:
                    return {"ok": False, "reason": "ambiguous_ids", "ids": set(), "count": 0, "duration": duration}
                remapped.append((f"{test_id}::{line}:{column}", executed, status, loc))
            second = {}
            for test_id, _, _, _ in remapped:
                second[test_id] = second.get(test_id, 0) + 1
            if any(value > 1 for value in second.values()):
                return {"ok": False, "reason": "ambiguous_ids", "ids": set(), "count": 0, "duration": duration}
            items = [(it[0], it[1], it[2], it[3]) for it in remapped]
    ids = []
    for test_id, executed, status, _ in items:
        if status not in {"passed", "failed"}:
            continue
        ids.append(test_id)
    return {"ok": True, "reason": None, "ids": set(ids), "count": len(ids), "duration": duration}


def _id_and_status_vitest(assertion, file_path, worktree_dir):
    rel_file = _normalize_test_path(file_path, worktree_dir)
    if rel_file is None:
        return None, None, None
    ancestors = assertion.get("ancestorTitles", []) or []
    title = assertion.get("title", "")
    base = f"{rel_file} > " + " > ".join(ancestors + [title]) if ancestors else f"{rel_file} > {title}"
    status = assertion.get("status")
    location = assertion.get("location") or {}
    line = location.get("line") if isinstance(location, dict) else None
    column = location.get("column") if isinstance(location, dict) else None
    executed = status in {"passed", "failed"}
    return base, executed, {"line": line, "column": column}


def collect_vitest(side_dir, command, timeout_sec, env, require_location):
    report_file = os.path.join(side_dir, "vitest-l1.json")
    cmd = command + ["run", "--reporter=json", f"--outputFile={report_file}"]
    rc, out, err, timed_out, duration = run_with_timeout(cmd, side_dir, env, timeout_sec)
    if timed_out:
        return {"ok": False, "reason": "timeout", "ids": set(), "count": 0, "duration": duration}
    if not os.path.exists(report_file):
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}
    if os.path.getsize(report_file) == 0:
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}
    payload = _read_json(report_file)
    if not isinstance(payload, dict):
        reason = "reporter_failed" if rc != 0 else "malformed_report"
        return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}

    test_results = payload.get("testResults")
    if not isinstance(test_results, list):
        reason = "reporter_failed" if rc != 0 else "malformed_report"
        return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}

    items = []
    parseable_assertions = False
    for tr in test_results:
        if not isinstance(tr, dict):
            reason = "reporter_failed" if rc != 0 else "malformed_report"
            return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
        file_path = tr.get("name")
        assertions = tr.get("assertionResults")
        if not isinstance(assertions, list):
            reason = "reporter_failed" if rc != 0 else "malformed_report"
            return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
        for assertion in assertions:
            if not isinstance(assertion, dict):
                reason = "reporter_failed" if rc != 0 else "malformed_report"
                return {"ok": False, "reason": reason, "ids": set(), "count": 0, "duration": duration}
            parseable_assertions = True
            test_id, executed, loc = _id_and_status_vitest(assertion, file_path, side_dir)
            if test_id is None:
                return {"ok": False, "reason": "unstable_ids", "ids": set(), "count": 0, "duration": duration}
            status = assertion.get("status")
            if status not in {"passed", "failed", "pending", "skipped", "todo", "disabled"}:
                status = str(status or "")
            items.append((test_id, executed, status, loc))
    if not parseable_assertions and rc != 0:
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}

    if require_location:
        duplicates = {}
        for test_id, _, _, loc in items:
            duplicates[test_id] = duplicates.get(test_id, 0) + 1
        if any(value > 1 for value in duplicates.values()):
            remapped = []
            for test_id, executed, status, loc in items:
                line = loc.get("line") if isinstance(loc, dict) else None
                column = loc.get("column") if isinstance(loc, dict) else None
                if line is None or column is None:
                    return {"ok": False, "reason": "ambiguous_ids", "ids": set(), "count": 0, "duration": duration}
                remapped.append((f"{test_id}::{line}:{column}", executed, status, loc))
            second = {}
            for test_id, _, _, _ in remapped:
                second[test_id] = second.get(test_id, 0) + 1
            if any(value > 1 for value in second.values()):
                return {"ok": False, "reason": "ambiguous_ids", "ids": set(), "count": 0, "duration": duration}
            items = [(it[0], it[1], it[2], it[3]) for it in remapped]

    ids = []
    for test_id, executed, status, _ in items:
        if status in {"passed", "failed"}:
            ids.append(test_id)
    return {"ok": True, "reason": None, "ids": set(ids), "count": len(ids), "duration": duration}


def _parse_go_module_path(side_dir):
    go_mod = os.path.join(side_dir, "go.mod")
    if not os.path.isfile(go_mod):
        return None
    for line in _read_file_lines(go_mod):
        stripped = line.strip()
        if stripped.startswith("module "):
            return stripped.split(None, 1)[1].strip()
    return None


def collect_go(side_dir, timeout_sec, env):
    report_file = os.path.join(side_dir, "go-l1.ndjson")
    cmd = ["go", "test", "-json", "-count=1", "-run", ".*", "./..."]
    rc, out, err, timed_out, duration = run_with_timeout(cmd, side_dir, env, timeout_sec)
    if timed_out:
        return {"ok": False, "reason": "timeout", "ids": set(), "count": 0, "duration": duration}
    if os.path.exists(report_file):
        os.remove(report_file)
    try:
        with open(report_file, "w", encoding="utf-8") as handle:
            if out:
                handle.write(out)
    except Exception:
        pass
    # go writes JSON to stdout in JSON-line protocol.
    if not os.path.exists(report_file) or os.path.getsize(report_file) == 0:
        if rc != 0:
            return {"ok": False, "reason": "build_failed", "ids": set(), "count": 0, "duration": duration}
        return {"ok": False, "reason": "reporter_failed", "ids": set(), "count": 0, "duration": duration}

    try:
        lines = open(report_file, "r", encoding="utf-8").read().splitlines()
    except Exception:
        return {"ok": False, "reason": "malformed_report", "ids": set(), "count": 0, "duration": duration}

    terminal = {}
    package_test_events = set()
    package_build_failed = set()
    package_build_output = set()
    for entry in lines:
        entry = entry.strip()
        if not entry:
            continue
        try:
            payload = json.loads(entry)
        except Exception:
            continue
        package = payload.get("Package") or payload.get("ImportPath")
        test = payload.get("Test")
        action = payload.get("Action")
        if not package:
            continue
        if not test:
            if action == "build-fail":
                package_build_failed.add(package)
                continue
            if action == "build-output":
                if isinstance(payload.get("Output"), str) and payload.get("Output").strip():
                    package_build_output.add(package)
                continue
            if action == "fail":
                output_text = payload.get("Output", "")
                failed_build = False
                if isinstance(output_text, str) and output_text.strip():
                    failed_build = True
                elif payload.get("FailedBuild"):
                    failed_build = True
                elif package in package_build_output:
                    package_build_failed.add(package)
                    continue
                if failed_build:
                    package_build_failed.add(package)
                continue
            continue
        if action in {"pass", "fail", "skip"}:
            package_test_events.add(package)
            terminal[(package, test)] = action

    failed_packages = sorted({pkg for pkg in package_build_failed if pkg not in package_test_events})
    if failed_packages:
        return {
            "ok": False,
            "reason": "build_failed: " + ",".join(failed_packages),
            "ids": set(),
            "count": 0,
            "duration": duration,
        }

    executed_ids = set()
    for (package, test), action in terminal.items():
        if action in {"pass", "fail"}:
            executed_ids.add(f"{package}::{test}")
        elif action in {"skip", "output"}:
            continue
    return {"ok": True, "reason": None, "ids": executed_ids, "count": len(executed_ids), "duration": duration}


def create_worktree_parent(parent_dir, repo_dir):
    if parent_dir:
        resolved = os.path.realpath(parent_dir)
        repo_real = os.path.realpath(repo_dir)
        if resolved == repo_real or resolved.startswith(repo_real + os.sep):
            raise RuntimeError(f"--l1-worktree-dir resolves inside the repo: {parent_dir}")
        os.makedirs(resolved, mode=0o700, exist_ok=True)
        if (os.stat(resolved).st_mode & 0o777) != 0o700:
            os.chmod(resolved, 0o700)
        return resolved, False
    worktree_root = tempfile.mkdtemp(prefix="autopilot-l1-")
    if (os.stat(worktree_root).st_mode & 0o777) != 0o700:
        os.chmod(worktree_root, 0o700)
    return worktree_root, True


def add_worktree(repo_dir, worktree_root, commit_sha):
    path = tempfile.mkdtemp(prefix="l1-", dir=worktree_root)
    os.chmod(path, 0o700)
    run_command(["git", "-C", repo_dir, "worktree", "add", "--detach", path, commit_sha], repo_dir)
    return path


def remove_worktrees(repo_dir, paths):
    for path in paths:
        run_command(["git", "-C", repo_dir, "worktree", "remove", "--force", path], repo_dir, check=False)
    run_command(["git", "-C", repo_dir, "worktree", "prune"], repo_dir, check=False)


def check_worker_pgid(pgid):
    if not pgid:
        return False
    try:
        pgrep_res = run_command(["pgrep", "-g", str(pgid)], os.getcwd(), check=False, cwd=os.getcwd())
        if pgrep_res.returncode == 0 and (pgrep_res.stdout or "").strip():
            return True
    except Exception:
        pass
    try:
        kill_res = run_command(["kill", "-0", f"-{pgid}"], os.getcwd(), check=False, cwd=os.getcwd())
        if kill_res.returncode == 0:
            return True
    except Exception:
        pass
    return False


def load_l1_verdict(repo_dir, head_sha, head_tree, base_sha, base_tree, changeset_digest, verdict_file_path):
    status = "No L1 verdict checked"
    payload = None
    if verdict_file_path:
        path = os.path.abspath(verdict_file_path)
        if path.startswith(os.path.realpath(repo_dir) + os.sep):
            status = (
                f"Warning: l1 verdict path {path} resolves under repo dir {repo_dir}; worker-reachable"
            )
        if os.path.isfile(path):
            try:
                payload = _read_json(path)
                status = f"Loaded l1 verdict file at {path}"
            except Exception as exc:
                payload = None
                status = f"Invalid l1 verdict JSON at {path}: {exc}"
        else:
            status = f"Specified l1 verdict file not found: {path}"
    else:
        ref = f"refs/qc/test-integrity/{head_sha}"
        ref_res = run_command(["git", "cat-file", "-p", ref], repo_dir, check=False)
        if ref_res.returncode == 0:
            try:
                payload = json.loads(ref_res.stdout or "{}")
                status = f"Loaded L1 verdict from {ref}"
            except Exception as exc:
                payload = None
                status = f"Invalid L1 verdict JSON in {ref}: {exc}"
        else:
            status = f"No committed verdict file at .qc/{head_sha}.verdict.json"

    if payload is None or not isinstance(payload, dict):
        return None, status

    if payload.get("base_sha") != base_sha:
        return None, "Rejected L1 verdict: base_sha mismatch"
    if payload.get("head_sha") != head_sha:
        return None, "Rejected L1 verdict: head_sha mismatch"
    if payload.get("base_tree") != base_tree:
        return None, "Rejected L1 verdict: base_tree mismatch"
    if payload.get("head_tree") != head_tree:
        return None, "Rejected L1 verdict: head_tree mismatch"
    if payload.get("changeset_digest") != changeset_digest:
        return None, "Rejected L1 verdict: changeset_digest mismatch"

    return payload, status


def apply_l1_verdict_overrides(l1_runners, l1_violations, verdict_payload, defer_override, base_status):
    if verdict_payload is None:
        return l1_runners, l1_violations, base_status

    if defer_override:
        return l1_runners, l1_violations, "block-mode override deferred (no local-only containment is malicious-proof against a same-user worker — sibling-scope escape + worker-reachable verdict path; needs stronger isolation, see BACKLOG / spec §8.3)"

    waives = verdict_payload.get("waives", [])
    if not isinstance(waives, list):
        return l1_runners, l1_violations, "L1 verdict has no waives list"

    waiver_map = {}
    for item in waives:
        if not isinstance(item, dict):
            continue
        file_name = item.get("file")
        kind = item.get("kind")
        dropped_digest = item.get("dropped_digest")
        if file_name and kind:
            waiver_map[(file_name, kind)] = dropped_digest

    accepted = 0
    filtered_violations = []
    for violation in l1_violations:
        key = (violation["file"], violation["kind"])
        waiver = waiver_map.get(key)
        if not waiver:
            filtered_violations.append(violation)
            continue
        if violation["kind"] == "executed_set_shrink":
            if violation.get("dropped_digest") and violation["dropped_digest"] == waiver:
                accepted += 1
                continue
            filtered_violations.append(violation)
            continue
        filtered_violations.append(violation)
        continue

    for idx, runner in enumerate(l1_runners):
        waiver = waiver_map.get((runner["runner"], "executed_set_shrink"))
        if runner["status"] == "shrink" and waiver and waiver == runner.get("dropped_digest"):
            l1_runners[idx]["waived"] = True

    return l1_runners, filtered_violations, f"Override accepted for {accepted} L1 waiver entries"


def run_l1_analysis(
    repo_dir,
    base_sha,
    head_sha,
    base_tree,
    head_tree,
    timeout_sec,
    runner_filter,
    l1_worktree_dir,
    verdict_file_path,
    assert_worker_dead,
    override_status_hint,
    rename_pairs,
    config_mode,
    containment="none",
):
    if runner_filter:
        runner_order = [runner_filter]
    else:
        runner_order = ["pytest", "jest", "vitest", "go"]

    scrubbed_env = build_scrubbed_env()
    changeset_digest = compute_changeset_digest(repo_dir, base_sha, head_sha)
    l1_summary = {"l1": "unavailable", "l1_runners": [], "override_status": override_status_hint or "No L1 verdict checked"}
    l1_violations = []
    verdict_payload = None

    if assert_worker_dead:
        try:
            if check_worker_pgid(assert_worker_dead):
                l1_summary["override_status"] = f"refused: worker pgroup {assert_worker_dead} still alive"
            else:
                l1_summary["override_status"] = "ok"
        except Exception:
            l1_summary["override_status"] = f"Invalid pgroup hint: {assert_worker_dead}"

    verdict_payload, verdict_status = load_l1_verdict(
        repo_dir,
        head_sha,
        head_tree,
        base_sha,
        base_tree,
        changeset_digest,
        verdict_file_path,
    )
    if "Loaded" in verdict_status or "override" in verdict_status or "Rejected" in verdict_status:
        l1_summary["override_status"] = verdict_status

    if timeout_sec <= 0:
        l1_summary["l1"] = "skipped"
        return l1_summary

    worktree_root, remove_worktree_parent = create_worktree_parent(l1_worktree_dir, repo_dir)
    created = []
    try:
        base_dir = add_worktree(repo_dir, worktree_root, base_sha)
        created.append(base_dir)
        head_dir = add_worktree(repo_dir, worktree_root, head_sha)
        created.append(head_dir)

        base_detect = detect_runners(base_dir, scrubbed_env)
        head_detect = detect_runners(head_dir, scrubbed_env)

        any_collected = False
        any_shrink = False
        any_head_failed = False

        for runner in runner_order:
            marker_base = base_detect[runner]["marker"]
            marker_head = head_detect[runner]["marker"]
            if not marker_base and not marker_head:
                continue

            tool_base = base_detect[runner]["tool"]
            tool_head = head_detect[runner]["tool"]
            result = {
                "runner": runner,
                "status": "ok",
                "marker_base": bool(marker_base),
                "marker_head": bool(marker_head),
                "tool_base": bool(tool_base),
                "tool_head": bool(tool_head),
                "env_scrubbed": True,
                "base_count": 0,
                "head_count": 0,
                "dropped": [],
                "dropped_digest": "",
                "reason": None,
                "base_failed": False,
                "head_failed": False,
            }
            if runner == "pytest" and base_detect[runner].get("pytest_interp"):
                result["pytest_interp"] = base_detect[runner]["pytest_interp"]

            if marker_base and not marker_head:
                result["status"] = "runner_disappeared"
                result["reason"] = "runner_disappeared"
                result["head_failed"] = True
                any_head_failed = True
                l1_summary["l1_runners"].append(result)
                l1_violations.append(
                    {
                        "layer": "L1",
                        "file": runner,
                        "kind": "collection_failed",
                        "line": 1,
                        "detail": f"{runner}: collection failed: runner_disappeared",
                    }
                )
                continue

            if not marker_base and marker_head:
                l1_summary["l1_runners"].append(result)
                any_collected = True
                continue

            if not tool_base and not tool_head:
                result["status"] = "collection_failed"
                result["reason"] = "runner_missing"
                result["head_failed"] = True
                any_head_failed = True
                l1_summary["l1_runners"].append(result)
                l1_violations.append(
                    {
                        "layer": "L1",
                        "file": runner,
                        "kind": "collection_failed",
                        "line": 1,
                        "detail": f"{runner}: collection failed: runner_missing",
                    }
                )
                continue

            if not tool_base:
                result["status"] = "ok"
                result["base_failed"] = True
                result["reason"] = "runner_missing"
                any_collected = True
                l1_summary["l1_runners"].append(result)
                continue

            if not tool_head:
                result["status"] = "collection_failed"
                result["reason"] = "runner_missing"
                result["head_failed"] = True
                any_head_failed = True
                l1_summary["l1_runners"].append(result)
                l1_violations.append(
                    {
                        "layer": "L1",
                        "file": runner,
                        "kind": "collection_failed",
                        "line": 1,
                        "detail": f"{runner}: collection failed: runner_missing",
                    }
                )
                continue

            if runner == "go":
                base_module = _parse_go_module_path(base_dir)
                head_module = _parse_go_module_path(head_dir)
                if base_module != head_module:
                    result["status"] = "collection_failed"
                    result["reason"] = "module_path_changed"
                    result["head_failed"] = True
                    any_head_failed = True
                    l1_summary["l1_runners"].append(result)
                    l1_violations.append(
                        {
                            "layer": "L1",
                            "file": runner,
                            "kind": "collection_failed",
                            "line": 1,
                            "detail": f"{runner}: collection failed: module_path_changed",
                        }
                    )
                    continue

            if runner == "pytest":
                base_collect = collect_pytest(base_dir, base_detect[runner]["tool_command"], timeout_sec, scrubbed_env)
                head_collect = collect_pytest(head_dir, head_detect[runner]["tool_command"], timeout_sec, scrubbed_env)
            elif runner == "jest":
                base_collect = collect_jest(base_dir, base_detect[runner]["tool_command"], timeout_sec, scrubbed_env, True)
                head_collect = collect_jest(head_dir, head_detect[runner]["tool_command"], timeout_sec, scrubbed_env, True)
            elif runner == "vitest":
                base_collect = collect_vitest(base_dir, base_detect[runner]["tool_command"], timeout_sec, scrubbed_env, True)
                head_collect = collect_vitest(head_dir, head_detect[runner]["tool_command"], timeout_sec, scrubbed_env, True)
            else:
                base_collect = collect_go(base_dir, timeout_sec, scrubbed_env)
                head_collect = collect_go(head_dir, timeout_sec, scrubbed_env)

            if base_collect.get("ok"):
                result["base_count"] = base_collect.get("count", 0)
            if head_collect.get("ok"):
                result["head_count"] = head_collect.get("count", 0)

            if head_collect.get("ok") is False:
                result["status"] = "collection_failed"
                result["reason"] = head_collect.get("reason")
                result["head_failed"] = True
                any_head_failed = True
                l1_summary["l1_runners"].append(result)
                l1_violations.append(
                    {
                        "layer": "L1",
                        "file": runner,
                        "kind": "collection_failed",
                        "line": 1,
                        "detail": f"{runner}: collection failed: {head_collect.get('reason') or 'build_failed'}",
                    }
                )
                continue

            if not base_collect.get("ok") and head_collect.get("ok"):
                result["base_failed"] = True
                result["reason"] = base_collect.get("reason")
                any_collected = True
                l1_summary["l1_runners"].append(result)
                continue

            base_set = set(base_collect.get("ids") or set())
            head_set = set(head_collect.get("ids") or set())
            dropped = sorted(base_set - head_set)
            result["base_count"] = len(base_set)
            result["head_count"] = len(head_set)
            if dropped:
                result["status"] = "shrink"
                result["dropped"] = dropped
                result["dropped_digest"] = canonical_sorted_json_sha256(dropped)
                any_shrink = True
                l1_violations.append(
                    {
                        "layer": "L1",
                        "file": runner,
                        "kind": "executed_set_shrink",
                        "line": 1,
                        "detail": f"{runner}: executed set dropped {len(dropped)} tests",
                        "dropped_digest": result["dropped_digest"],
                    }
                )
            l1_summary["l1_runners"].append(result)
            any_collected = True

        if not l1_summary["l1_runners"]:
            l1_summary["l1"] = "unavailable"
        elif any_shrink:
            l1_summary["l1"] = "shrink"
        elif any_head_failed:
            l1_summary["l1"] = "collection_failed"
        else:
            l1_summary["l1"] = "ok"

        l1_summary["l1"] = "ok" if l1_summary["l1"] == "ok" and any_collected else l1_summary["l1"]
        l1_summary["l1"] = "unavailable" if not any_collected and not any_head_failed else l1_summary["l1"]

        l1_summary["l1_violations"] = l1_violations
        l1_summary["changeset_digest"] = changeset_digest

        # Block-mode ALWAYS defers override honoring. An attempt to unlock it on a
        # `--containment cgroup-verified` attestation was REVERTED (gpt-5.5 review
        # 2026-06-26, ruling UNSAFE, two verified escapes): (1) a same-user worker can
        # `systemd-run --user --scope` a SIBLING cgroup outside the dispatcher's scope,
        # so the cgroup reap+verify is NOT malicious-proof — `contained:true` can be a
        # false attestation; (2) the `--l1-verdict-file` path was honored even when
        # worker-reachable (only warned). Closing this needs a STRONGER isolation
        # boundary (separate UID / real sandbox / no user systemd bus), tracked in
        # BACKLOG. Until then, refusing a forgeable waiver is the only safe posture.
        # `--containment` is accepted (telemetry/forward-compat) but does NOT unlock.
        defer_override = (config_mode == "block")
        l1_summary["l1_runners"], l1_summary["l1_violations"], verdict_msg = apply_l1_verdict_overrides(
            l1_summary["l1_runners"],
            l1_summary["l1_violations"],
            verdict_payload,
            defer_override,
            l1_summary.get("override_status", "No L1 verdict checked"),
        )
        if verdict_msg:
            l1_summary["override_status"] = verdict_msg
        return l1_summary
    finally:
        remove_worktrees(repo_dir, created)
        if remove_worktree_parent:
            shutil.rmtree(worktree_root, ignore_errors=True)


def is_protected_path(path):
    return (
        path == "scripts/check-test-integrity.sh"
        or path == "scripts/lib/test-integrity-l1.py"
        or path == ".claude/test-integrity-config.md"
        or path == ".gitattributes"
        or path == ".qc"
        or path.startswith(".qc/")
    )


def main():
    repo_dir = sys.argv[1]
    range_str = sys.argv[2]
    base_ref = sys.argv[3]
    head_ref = sys.argv[4]
    allow_env_config = sys.argv[5] == "1"
    no_l1 = sys.argv[5 + 1] == "1"
    l1_timeout_arg = sys.argv[7]
    l1_runner = sys.argv[8]
    l1_worktree_dir = sys.argv[9]
    l1_verdict_file = sys.argv[10]
    assert_worker_dead = sys.argv[11] if len(sys.argv) > 11 else ""
    containment = sys.argv[12] if len(sys.argv) > 12 else "none"
    try:
        l1_timeout = int(l1_timeout_arg)
    except Exception:
        emit_git_error(f"Invalid --l1-timeout value: {l1_timeout_arg}")

    DEFAULT_TEST_PATHS = [
        "**/*_test.go",
        "**/*_test.py",
        "**/test_*.py",
        "**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,mts,cts}",
        "**/__tests__/**",
        "tests/**",
        "test/**",
        "spec/**",
        "**/*_spec.rb",
        "**/*Test.java",
        "src/test/**",
        "**/*.feature",
        "**/*.bats",
    ]
    DEFAULT_SURFACE_PATHS = [
        "**/conftest.py",
        "**/fixtures/**",
        "**/factories/**",
        "**/__mocks__/**",
        "**/__snapshots__/**",
        "**/*.snap",
        "**/setupTests.*",
        "**/jest.setup.*",
        "**/vitest.setup.*",
        "**/*.matchers.*",
        "pytest.ini",
        "tox.ini",
        "jest.config.*",
        "vitest.config.*",
        "playwright.config.*",
        "cypress.config.*",
        "package.json",
        ".github/workflows/**",
    ]

    template_path = os.path.join(repo_dir, "project-config-template/test-integrity-config.md")

    try:
        base_sha = run_command(["git", "rev-parse", f"{base_ref}^{{commit}}"], repo_dir).stdout.strip()
        head_sha = run_command(["git", "rev-parse", f"{head_ref}^{{commit}}"], repo_dir).stdout.strip()
        base_tree = run_command(["git", "rev-parse", f"{base_sha}^{{tree}}"], repo_dir).stdout.strip()
        head_tree = run_command(["git", "rev-parse", f"{head_sha}^{{tree}}"], repo_dir).stdout.strip()
    except Exception as exc:
        emit_git_error(f"Invalid range refs: {exc}")

    config_text = None
    config_source = "defaults"
    config_file = ".claude/test-integrity-config.md"
    warnings = []

    if allow_env_config:
        override_path = os.environ.get("TEST_INTEGRITY_CONFIG_OVERRIDE", "")
        if override_path:
            if not os.path.isabs(override_path):
                override_path = os.path.join(repo_dir, override_path)
            if os.path.isfile(override_path):
                with open(override_path, "r", encoding="utf-8") as handle:
                    config_text = handle.read()
                config_source = "env"
                config_file = override_path
            else:
                warnings.append(f"Ignoring invalid env config override path: {os.path.basename(override_path)}")

    if config_text is None:
        base_blob = read_blob(config_file, base_ref, repo_dir)
        if base_blob is not None:
            config_text = base_blob
            config_source = "base"
            config_file = ".claude/test-integrity-config.md"
        elif os.path.exists(template_path):
            with open(template_path, "r", encoding="utf-8") as handle:
                config_text = handle.read()
            config_source = "template"
            config_file = template_path
        else:
            warnings.append("Config missing in base commit and template; using built-in defaults")

    if config_text is None:
        config = {
            "mode": "warn",
            "test_paths": DEFAULT_TEST_PATHS,
            "surface_paths": DEFAULT_SURFACE_PATHS,
        }
        malformed_error = None
    else:
        config, malformed, malformed_error = parse_config(config_text)
        if malformed:
            config["mode"] = "block"
            if not config["test_paths"]:
                config["test_paths"] = DEFAULT_TEST_PATHS
            if not config["surface_paths"]:
                config["surface_paths"] = DEFAULT_SURFACE_PATHS

    test_paths = config["test_paths"] if config["test_paths"] else DEFAULT_TEST_PATHS
    surface_paths = config["surface_paths"] if config["surface_paths"] else DEFAULT_SURFACE_PATHS

    test_path_patterns = []
    for pat in test_paths:
        test_path_patterns.extend(expand_braces(pat))
    surface_path_patterns = []
    for pat in surface_paths:
        surface_path_patterns.extend(expand_braces(pat))

    test_path_regexes = [glob_to_regex(pattern) for pattern in test_path_patterns]
    surface_path_regexes = [glob_to_regex(pattern) for pattern in surface_path_patterns]

    # 1) Parse changed files from authoritative -z name-status output.
    try:
        raw = run_command(["git", "diff", "-M", "--name-status", "-z", range_str], repo_dir).stdout
    except Exception as exc:
        emit_git_error(f"Unable to enumerate changed files: {exc}")

    raw_files = []
    tokens = raw.split("\0")
    idx = 0
    while idx < len(tokens):
        token = tokens[idx]
        idx += 1
        if not token:
            continue
        status = token
        if not status:
            break
        if status[0] in ("R", "C"):
            if idx + 1 >= len(tokens):
                break
            old_path = tokens[idx]
            new_path = tokens[idx + 1]
            idx += 2
            raw_files.append(
                {
                    "status": status,
                    "old_path": old_path,
                    "new_path": new_path,
                }
            )
        else:
            if idx >= len(tokens):
                break
            path = tokens[idx]
            idx += 1
            raw_files.append({"status": status, "old_path": path, "new_path": path})

    entry_by_new = {entry["new_path"]: entry for entry in raw_files}
    entry_by_old = {entry["old_path"]: entry for entry in raw_files}
    rename_pairs = [
        (entry["old_path"], entry["new_path"])
        for entry in raw_files
        if isinstance(entry.get("status"), str) and entry["status"].startswith("R")
    ]
    raw_file_queue = list(raw_files)

    # 2) Parse hunks from patch output for line-level checks.
    files_diff = {}
    try:
        diff_lines = run_command(["git", "diff", "-M", "-U0", range_str], repo_dir).stdout.splitlines()
    except Exception as exc:
        emit_git_error(f"Failed to run diff: {exc}")

    i = 0
    current_file = None
    while i < len(diff_lines):
        line = diff_lines[i]
        if line.startswith("diff --git "):
            header = line[len("diff --git ") :]
            if raw_file_queue:
                entry = raw_file_queue.pop(0)
                current_file = entry["new_path"]
                files_diff[current_file] = {
                    "old_path": entry["old_path"],
                    "new_path": entry["new_path"],
                    "hunks": [],
                }
                i += 1
                continue

            parts = header.split(maxsplit=1)
            if len(parts) >= 2:
                m = re.match(r'^("(?:[^"\\]|\\.)*"|\S+)\s+("(?:[^"\\]|\\.)*"|\S+)$', header)
                if m:
                    old_token, new_token = m.groups()
                    old_path = decode_git_token(old_token)
                    new_path = decode_git_token(new_token)
                else:
                    old_token, new_token = parts[0], parts[1]
                    old_path = decode_git_token(old_token)
                    new_path = decode_git_token(new_token)

                files_diff[new_path] = {
                    "old_path": old_path,
                    "new_path": new_path,
                    "hunks": [],
                }
                current_file = new_path
            i += 1
            continue

        if line.startswith("@@ ") and current_file:
            match = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
            if match:
                old_start = int(match.group(1))
                new_start = int(match.group(2))
                hunk = {"old_start": old_start, "new_start": new_start, "lines": []}
                files_diff[current_file]["hunks"].append(hunk)
                i += 1
                while i < len(diff_lines) and not diff_lines[i].startswith(("diff --git ", "@@ ")):
                    hunk["lines"].append(diff_lines[i])
                    i += 1
                continue
        i += 1

    marker_patterns = {
        "js_ts": {
            "skip": [
                re.compile(r"\b(xit|xdescribe|xtest)\b"),
                re.compile(r"\b(it|test|describe)\.(skip|todo|failing)\b"),
                re.compile(r"\b(it|test|describe)\.skip(If|Unless)?\b"),
                re.compile(r"\b(it|test|describe)\.concurrent\.only\b"),
                re.compile(r"\bit\.each\([^)]*\)\.skip\b"),
            ],
            "solo": [
                re.compile(r"\b(it|test|describe)\.only\b"),
                re.compile(r"\b(it|test|describe)\.concurrent\.only\b"),
                re.compile(r"\bfit\s*\("),
                re.compile(r"\bfdescribe\s*\("),
            ],
        },
        "python": {
            "skip": [
                re.compile(r"@(pytest\.mark\.(skip|xfail))\b"),
                re.compile(r"pytestmark\s*=.*\b(skip|xfail)\b"),
                re.compile(r"\.skipTest\s*\("),
                re.compile(r"@unittest\.skip(If|Unless)?\b"),
            ],
            "solo": [],
        },
        "go": {
            "skip": [
                re.compile(r"\bt\.Skipf?\s*\("),
                re.compile(r"\bt\.SkipNow\b"),
            ],
            "solo": [],
        },
        "rust": {
            "skip": [re.compile(r"#\[ignore(?:\s*=\s*\"[^\"]*\")?\]")],
            "solo": [],
        },
        "java_kotlin": {
            "skip": [re.compile(r"@(Ignore|Disabled)\b")],
            "solo": [],
        },
        "ruby": {
            "skip": [
                re.compile(r"^\s*xit\b"),
                re.compile(r"^\s*(pending|skip)\b"),
            ],
            "solo": [re.compile(r"\bfit\b"), re.compile(r"\bfdescribe\b")],
        },
    }

    def get_lang_key(file_path):
        extension = file_path.split(".")[-1].lower() if "." in file_path else ""
        if extension in ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"]:
            return "js_ts"
        if extension == "py":
            return "python"
        if extension == "go":
            return "go"
        if extension == "rs":
            return "rust"
        if extension in ["java", "kt"]:
            return "java_kotlin"
        if extension == "rb":
            return "ruby"
        return None

    violations = []
    surface_touches = []
    test_paths_matched = 0

    if config_text is not None and malformed:
        violations.append(
            {
                "layer": "L0",
                "file": config_file,
                "kind": "malformed_config",
                "line": 1,
                "detail": malformed_error or "Malformed config",
            }
        )

    for entry in raw_files:
        old_path = entry["old_path"]
        new_path = entry["new_path"]
        status = entry["status"]

        if is_protected_path(new_path):
            violations.append(
                {
                    "layer": "L0",
                    "file": new_path,
                    "kind": "protected_path_touch",
                    "line": 1,
                    "detail": f"Protected path touched: {new_path}",
                }
            )
        if old_path != new_path and is_protected_path(old_path):
            violations.append(
                {
                    "layer": "L0",
                    "file": old_path,
                    "kind": "protected_path_touch",
                    "line": 1,
                    "detail": f"Protected path touched: {old_path}",
                }
            )

        is_old_test = matches_patterns(old_path, test_path_regexes)
        is_new_test = matches_patterns(new_path, test_path_regexes)
        if is_new_test:
            test_paths_matched += 1

        if matches_patterns(new_path, surface_path_regexes):
            if new_path not in surface_touches:
                surface_touches.append(new_path)
            if config["mode"] == "block":
                violations.append(
                    {
                        "layer": "L0",
                        "file": new_path,
                        "kind": "surface_touch",
                        "line": 1,
                        "detail": f"Integrity surface file {new_path} touched",
                    }
                )

        if status.startswith("R") and is_old_test and not is_new_test:
            violations.append(
                {
                    "layer": "L0",
                    "file": new_path,
                    "kind": "rename_escape",
                    "line": 1,
                    "detail": f"Test file {old_path} renamed to non-test path {new_path}",
                }
            )

    for file_path, info in files_diff.items():
        if not matches_patterns(file_path, test_path_regexes):
            continue

        lang_key = get_lang_key(file_path)
        for hunk in info.get("hunks", []):
            old_current = hunk["old_start"]
            new_current = hunk["new_start"]
            for line in hunk["lines"]:
                if not line:
                    continue
                if line.startswith("\\"):
                    continue
                if line.startswith("-"):
                    violations.append(
                        {
                            "layer": "L0",
                            "file": file_path,
                            "kind": "deleted_line",
                            "line": old_current,
                            "detail": line[1:],
                        }
                    )
                    old_current += 1
                    continue

                if line.startswith("+") and lang_key:
                    content = line[1:]
                    checked = strip_trailing_comment(content, lang_key)
                    rules = marker_patterns.get(lang_key, {})
                    for rx in rules.get("solo", []):
                        if rx.search(checked):
                            violations.append(
                                {
                                    "layer": "L0",
                                    "file": file_path,
                                    "kind": "solo_marker",
                                    "line": new_current,
                                    "detail": checked.strip(),
                                }
                            )
                            break
                    for rx in rules.get("skip", []):
                        if rx.search(checked):
                            violations.append(
                                {
                                    "layer": "L0",
                                    "file": file_path,
                                    "kind": "skip_marker",
                                    "line": new_current,
                                    "detail": checked.strip(),
                                }
                            )
                            break
                    new_current += 1

    # 3) Check override verdict from committed tree only.
    waiver_set = set()
    override_status = "No committed verdict file checked"
    try:
        verdict_ref = f"{head_ref}:.qc/{head_sha}.verdict.json"
        verdict_res = run_command(["git", "show", verdict_ref], repo_dir, check=False)
        if verdict_res.returncode == 0:
            try:
                payload = json.loads(verdict_res.stdout or "{}")
            except Exception as exc:
                payload = {}
                override_status = f"Invalid committed verdict JSON: {exc}"
            else:
                verdict_tree = payload.get("tree")
                waives = payload.get("waives")
                if verdict_tree == head_tree and isinstance(waives, list):
                    for item in waives:
                        if not isinstance(item, dict):
                            continue
                        violation_file = item.get("file")
                        kind = item.get("kind")
                        if violation_file and kind:
                            waiver_set.add((violation_file, kind))
                    override_status = (
                        f"Override accepted for {len(waiver_set)} waiver entries at tree {head_tree}"
                    )
                else:
                    override_status = (
                        f"Override rejected: verdict tree {verdict_tree or 'none'} does not match {head_tree}"
                    )
        else:
            override_status = f"No committed verdict file at .qc/{head_sha}.verdict.json"
    except Exception as exc:
        override_status = f"Failed to evaluate override verdict: {exc}"

    l1_summary = {
        "l1": "skipped" if no_l1 or l1_timeout == 0 else "unavailable",
        "l1_runners": [],
        "l1_violations": [],
        "override_status": override_status,
        "changeset_digest": compute_changeset_digest(repo_dir, base_sha, head_sha),
    }
    if not no_l1:
        l1_summary = run_l1_analysis(
            repo_dir,
            base_sha,
            head_sha,
            base_tree,
            head_tree,
            l1_timeout,
            l1_runner,
            l1_worktree_dir,
            l1_verdict_file,
            assert_worker_dead,
            override_status,
            rename_pairs,
            config["mode"],
            containment,
        )
    if l1_summary.get("l1_runners") is None:
        l1_summary["l1_runners"] = []

    active_violations = []
    for violation in violations:
        key = (violation["file"], violation["kind"])
        # Non-waivable kinds: hard structural / integrity violations that an
        # override verdict must NEVER be able to suppress (defends against a
        # future-functional override waiving protected-path edits — gpt-5.5 re-review).
        if violation["kind"] in {"git_error", "malformed_config", "protected_path_touch"}:
            active_violations.append(violation)
            continue
        if key in waiver_set:
            continue
        active_violations.append(violation)

    active_violations.extend(l1_summary.get("l1_violations", []))

    protected_violation = any(v["kind"] == "protected_path_touch" for v in active_violations)

    if config["mode"] == "block":
        ok = len(active_violations) == 0
    else:
        ok = True
    if protected_violation:
        ok = False

    output = {
        "ok": ok,
        "mode": config["mode"],
        "violations": active_violations,
        "surface_touches": sorted(set(surface_touches)),
        "test_paths_matched": test_paths_matched,
        "source": config_source,
        "head_sha": head_sha,
        "base_sha": base_sha,
        "override_status": l1_summary.get("override_status", override_status),
        "l1": l1_summary.get("l1", "unavailable"),
        "l1_runners": l1_summary.get("l1_runners", []),
    }

    if test_paths_matched == 0 and len(raw_files) > 0:
        output["warning"] = "possible misconfiguration: zero test paths matched the diff"
    elif warnings:
        output["warning"] = warnings[0]

    print(json.dumps(output, indent=2))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        emit_git_error(f"Unhandled failure: {exc}")

