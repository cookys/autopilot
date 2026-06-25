#!/usr/bin/env bash
# check-test-integrity.sh — L0 static layer test-integrity gate.
# Prevents implementers from gaming tests by deleting assertions,
# skipping tests, or escaping test directories.
#
# Usage:
#   scripts/check-test-integrity.sh validate --range <base>..<head> [--repo <dir>]
#
# Options:
#   validate                     Run L0 static checks on the git diff.
#   --range <base>..<head>       The commit range to validate (required).
#   --repo <dir>                 Repository directory to check (default: git root).
#   --base <base>                Sets the <base> side for this run.
#   --allow-env-config           Allow TEST_INTEGRITY_CONFIG_OVERRIDE for config.
#   -h, --help                   Show this help message.
#
# Exit codes:
#   0  ok (or warn/off mode with violations)
#   1  block-violation (gate fails in block mode)
#   2  usage / internal error
#
# Output: JSON to stdout.
#
# Candidate-Denied Paths:
#   The following paths are protected and must not be modified by delegated tasks:
#   - .qc/**
#   - scripts/check-test-integrity.sh (this script)
#   - .claude/test-integrity-config.md (project configuration)
#   - .gitattributes

set -euo pipefail

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ $# -eq 0 ]]; then
  usage
  exit 2
fi

CMD="$1"
shift

if [[ "$CMD" == "-h" || "$CMD" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$CMD" != "validate" ]]; then
  echo "Unknown command: $CMD" >&2
  echo "Usage: $0 validate --range <base>..<head> [--repo <dir>]" >&2
  exit 2
fi

RANGE=""
REPO_DIR=""
ALLOW_ENV_CONFIG="0"
BASE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      if [[ $# -lt 2 ]]; then
        echo "Error: --range expects <base>..<head>." >&2
        exit 2
      fi
      RANGE="$2"
      shift 2
      ;;
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "Error: --repo expects a directory." >&2
        exit 2
      fi
      REPO_DIR="$2"
      shift 2
      ;;
    --base)
      if [[ $# -lt 2 ]]; then
        echo "Error: --base expects a ref." >&2
        exit 2
      fi
      BASE_OVERRIDE="$2"
      shift 2
      ;;
    --allow-env-config)
      ALLOW_ENV_CONFIG="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$RANGE" ]]; then
  if [[ -n "$BASE_OVERRIDE" ]]; then
    RANGE="${BASE_OVERRIDE}..HEAD"
  else
    echo "Error: --range <base>..<head> is required." >&2
    exit 2
  fi
fi

if [[ "$RANGE" != *".."* ]]; then
  echo "Error: Range must be in <base>..<head> format." >&2
  exit 2
fi

BASE_REF="${RANGE%%..*}"
HEAD_REF="${RANGE#*..}"
if [[ -z "$HEAD_REF" ]]; then
  HEAD_REF="HEAD"
fi

if [[ -z "$REPO_DIR" ]]; then
  REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if ! git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: $REPO_DIR is not a git repository." >&2
  exit 2
fi

python3 - "$REPO_DIR" "$RANGE" "$BASE_REF" "$HEAD_REF" "$ALLOW_ENV_CONFIG" <<'PY'
import json
import os
import re
import subprocess
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


def run_command(cmd, repo_dir, check=True):
    res = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True)
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


def is_protected_path(path):
    return (
        path == "scripts/check-test-integrity.sh"
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

    active_violations = []
    for violation in violations:
        key = (violation["file"], violation["kind"])
        if violation["kind"] in {"git_error", "malformed_config"}:
            active_violations.append(violation)
            continue
        if key in waiver_set:
            continue
        active_violations.append(violation)

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
        "override_status": override_status,
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
PY
