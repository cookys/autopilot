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
#   - .qc/** (verdict files)
#   - scripts/check-test-integrity.sh (this script)
#   - .claude/test-integrity-config.md (project configuration)

set -euo pipefail

CMD=""
RANGE=""
REPO=""

if [[ $# -eq 0 ]]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2
fi

CMD="$1"
shift

if [[ "$CMD" == "-h" || "$CMD" == "--help" ]]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi

if [[ "$CMD" != "validate" ]]; then
  echo "Unknown command: $CMD" >&2
  echo "Usage: $0 validate --range <base>..<head> [--repo <dir>]" >&2
  exit 2
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      RANGE="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$RANGE" ]]; then
  echo "Error: --range <base>..<head> is required." >&2
  exit 2
fi

# Resolve repo root
REPO_DIR="${REPO:-}"
if [[ -z "$REPO_DIR" ]]; then
  REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Verify it's a git repo
if ! git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: $REPO_DIR is not a git repository." >&2
  exit 2
fi

# Split range to get head ref
if [[ "$RANGE" != *".."* ]]; then
  echo "Error: Range must be in <base>..<head> format." >&2
  exit 2
fi

HEAD_REF="${RANGE#*..}"
if [[ -z "$HEAD_REF" ]]; then
  HEAD_REF="HEAD"
fi

if ! git -C "$REPO_DIR" rev-parse --verify "$HEAD_REF" >/dev/null 2>&1; then
  echo "Error: Head ref '$HEAD_REF' not found in git repository." >&2
  exit 2
fi

# Configuration resolution order
CONFIG_FILE=""
SOURCE="defaults"

if [[ -n "${TEST_INTEGRITY_CONFIG_OVERRIDE:-}" ]]; then
  if [[ -f "$TEST_INTEGRITY_CONFIG_OVERRIDE" ]]; then
    CONFIG_FILE="$TEST_INTEGRITY_CONFIG_OVERRIDE"
    SOURCE="env"
  fi
fi

if [[ -z "$CONFIG_FILE" ]]; then
  if [[ -f ".claude/test-integrity-config.md" ]]; then
    CONFIG_FILE=".claude/test-integrity-config.md"
    SOURCE="cwd"
  fi
fi

if [[ -z "$CONFIG_FILE" ]]; then
  if [[ -f "$REPO_DIR/.claude/test-integrity-config.md" ]]; then
    CONFIG_FILE="$REPO_DIR/.claude/test-integrity-config.md"
    SOURCE="repo"
  fi
fi

if [[ -z "$CONFIG_FILE" ]]; then
  if [[ -f "$REPO_DIR/project-config-template/test-integrity-config.md" ]]; then
    CONFIG_FILE="$REPO_DIR/project-config-template/test-integrity-config.md"
    SOURCE="template"
  fi
fi

python3 - "$REPO_DIR" "$RANGE" "$HEAD_REF" "$SOURCE" "${CONFIG_FILE:-}" <<'EOF'
import sys, os, re, subprocess, json

def expand_braces(text):
    res = [text]
    while True:
        next_res = []
        expanded = False
        for r in res:
            m = re.search(r'\{([^}]+)\}', r)
            if m:
                expanded = True
                options = m.group(1).split(',')
                start = r[:m.start()]
                end = r[m.end():]
                for opt in options:
                    next_res.append(start + opt + end)
            else:
                next_res.append(r)
        if not expanded:
            break
        res = next_res
    return res

def glob_to_regex(pattern):
    p = pattern
    if p.startswith('**/'):
        p = '___LEADING_DIR___' + p[3:]
    p = p.replace('/**/', '___ANY_DIR___')
    p = p.replace('/**', '___DIR_REST___')
    p = p.replace('**', '.*')
    p = p.replace('*', '___SINGLE_STAR___')
    p = p.replace('?', '___QUESTION___')
    p = re.escape(p)
    p = p.replace('___LEADING_DIR___', '(?:^|.*/)')
    p = p.replace('___ANY_DIR___', '/(?:.*/)?')
    p = p.replace('___DIR_REST___', '/.*')
    p = p.replace('___SINGLE_STAR___', '[^/]*')
    p = p.replace('___QUESTION___', '[^/]')
    if '/' not in pattern:
        p = '(?:^|.*/)' + p
    return re.compile('^' + p + '$')

def main():
    repo_dir = sys.argv[1]
    range_str = sys.argv[2]
    head_ref = sys.argv[3]
    source = sys.argv[4]
    config_file = sys.argv[5]

    DEFAULT_TEST_PATHS = [
        "**/*_test.go", "**/*_test.py", "**/test_*.py",
        "**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,mts,cts}",
        "**/__tests__/**", "tests/**", "test/**", "spec/**",
        "**/*_spec.rb", "**/*Test.java", "src/test/**",
        "**/*.feature", "**/*.bats"
    ]

    DEFAULT_SURFACE_PATHS = [
        "**/conftest.py", "**/fixtures/**", "**/factories/**",
        "**/__mocks__/**", "**/__snapshots__/**", "**/*.snap",
        "**/setupTests.*", "**/jest.setup.*", "**/vitest.setup.*",
        "**/*.matchers.*", "pytest.ini", "tox.ini", "jest.config.*",
        "vitest.config.*", "playwright.config.*", "cypress.config.*",
        "package.json", ".github/workflows/**"
    ]

    config = {"mode": "warn", "test_paths": [], "surface_paths": []}
    malformed_error = None

    if config_file:
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                content = f.read()
            current_section = None
            for line in content.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith("##"):
                    hdr = stripped[2:].strip().lower()
                    if "mode" in hdr:
                        current_section = "mode"
                    elif "test path" in hdr or "test_path" in hdr:
                        current_section = "test_paths"
                    elif "surface" in hdr:
                        current_section = "surface_paths"
                    else:
                        current_section = None
                    continue
                match = re.match(r'^mode\s*:\s*(\w+)', stripped, re.IGNORECASE)
                if match:
                    config["mode"] = match.group(1).lower()
                    continue
                if current_section == "mode":
                    match = re.match(r'^-\s*mode\s*:\s*(\w+)', stripped, re.IGNORECASE)
                    if match:
                        config["mode"] = match.group(1).lower()
                    elif not stripped.startswith("#") and not stripped.startswith("-"):
                        val = stripped.lower()
                        if val in ["block", "warn", "off"]:
                            config["mode"] = val
                elif current_section in ["test_paths", "surface_paths"]:
                    if stripped.startswith("-") and not stripped.startswith("- #"):
                        val = stripped[1:].strip()
                        val = re.sub(r'\s*#.*$', '', val).strip().strip('"\'')
                        if val:
                            config[current_section].append(val)
                    elif not stripped.startswith("#") and not stripped.startswith("-"):
                        val = re.sub(r'\s*#.*$', '', stripped).strip().strip('"\'')
                        if val:
                            config[current_section].append(val)
            if config["mode"] not in ["block", "warn", "off"]:
                raise ValueError(f"Invalid mode: {config['mode']}")
        except Exception as e:
            malformed_error = str(e)
            config["mode"] = "block"

    raw_test_paths = config["test_paths"] if config["test_paths"] else DEFAULT_TEST_PATHS
    raw_surface_paths = config["surface_paths"] if config["surface_paths"] else DEFAULT_SURFACE_PATHS

    test_paths_patterns = []
    for pat in raw_test_paths:
        test_paths_patterns.extend(expand_braces(pat))
    surface_paths_patterns = []
    for pat in raw_surface_paths:
        surface_paths_patterns.extend(expand_braces(pat))

    test_path_regexes = [glob_to_regex(p) for p in test_paths_patterns]
    surface_path_regexes = [glob_to_regex(p) for p in surface_paths_patterns]

    def matches_patterns(path, regex_list):
        if not path:
            return False
        return any(rx.match(path) for rx in regex_list)

    # 1. Check override verdict
    override_ok = False
    head_sha = None
    override_msg = "No override verdict file checked"
    try:
        head_sha = subprocess.check_output(["git", "rev-parse", head_ref], cwd=repo_dir, text=True).strip()
        head_tree = subprocess.check_output(["git", "rev-parse", f"{head_sha}^{{tree}}"], cwd=repo_dir, text=True).strip()
        verdict_path = os.path.join(repo_dir, ".qc", f"{head_sha}.verdict.json")
        if os.path.exists(verdict_path):
            with open(verdict_path, "r", encoding="utf-8") as vf:
                vdata = json.load(vf)
            vtree = vdata.get("tree") or vdata.get("tree_digest") or vdata.get("digest")
            if vtree == head_tree:
                override_ok = True
                override_msg = "Override accepted: matching tree digest"
            else:
                override_msg = f"Override rejected: mismatched tree digest (expected {head_tree}, got {vtree})"
        else:
            override_msg = f"No verdict file at .qc/{head_sha}.verdict.json"
    except Exception as e:
        override_msg = f"Failed to verify override verdict: {e}"

    violations = []
    surface_touches = []
    test_paths_matched = 0

    if malformed_error:
        violations.append({
            "layer": "L0",
            "file": config_file or ".claude/test-integrity-config.md",
            "kind": "malformed_config",
            "line": 1,
            "detail": f"Config parsing failed: {malformed_error}"
        })

    files_diff = {}
    try:
        cmd = ["git", "diff", "-M", "-U0", range_str]
        diff_res = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, check=True)
        
        cmd_raw = ["git", "diff", "-M", "--raw", range_str]
        raw_res = subprocess.run(cmd_raw, cwd=repo_dir, capture_output=True, text=True, check=True)
        
        raw_files = {}
        for line in raw_res.stdout.splitlines():
            if not line.startswith(':'):
                continue
            parts = line.split('\t')
            meta = parts[0].split()
            status = meta[4]
            if status.startswith('R') or status.startswith('C'):
                old_path = parts[1]
                new_path = parts[2]
                raw_files[new_path] = {"status": status, "old_path": old_path}
            else:
                path = parts[1]
                raw_files[path] = {"status": status, "old_path": path}

        lines = diff_res.stdout.splitlines()
        i = 0
        current_file = None
        while i < len(lines):
            line = lines[i]
            if line.startswith('diff --git '):
                header_parts = line[11:]
                old_path = None
                new_path = None
                i += 1
                while i < len(lines) and not lines[i].startswith('diff --git ') and not lines[i].startswith('@@ '):
                    sub = lines[i]
                    if sub.startswith('rename from '):
                        old_path = sub[12:]
                    elif sub.startswith('rename to '):
                        new_path = sub[10:]
                    elif sub.startswith('--- a/'):
                        old_path = sub[6:]
                    elif sub.startswith('+++ b/'):
                        new_path = sub[6:]
                    i += 1
                
                if not old_path or not new_path:
                    split_idx = header_parts.find(' b/')
                    if split_idx != -1:
                        old_path = header_parts[:split_idx]
                        new_path = header_parts[split_idx+3:]
                        if old_path.startswith('a/'): old_path = old_path[2:]
                        if new_path.startswith('b/'): new_path = new_path[2:]
                
                if old_path and old_path.startswith('"') and old_path.endswith('"'):
                    old_path = bytes(old_path[1:-1], "utf-8").decode("unicode_escape")
                if new_path and new_path.startswith('"') and new_path.endswith('"'):
                    new_path = bytes(new_path[1:-1], "utf-8").decode("unicode_escape")
                
                current_file = new_path
                if current_file:
                    files_diff[current_file] = {
                        "old_path": old_path,
                        "hunks": []
                    }
                continue
                
            if line.startswith('@@ ') and current_file:
                match = re.match(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@', line)
                if match:
                    old_start = int(match.group(1))
                    new_start = int(match.group(2))
                    hunk = {
                        "old_start": old_start,
                        "new_start": new_start,
                        "lines": []
                    }
                    files_diff[current_file]["hunks"].append(hunk)
                    i += 1
                    while i < len(lines) and not lines[i].startswith('diff --git ') and not lines[i].startswith('@@ '):
                        hunk["lines"].append(lines[i])
                        i += 1
                    continue
            i += 1

        for path, info in raw_files.items():
            if path not in files_diff:
                files_diff[path] = {
                    "old_path": info["old_path"],
                    "hunks": []
                }

        marker_regexes = {
            "js_ts": {
                "skip": [
                    re.compile(r'xit|xdescribe|xtest'),
                    re.compile(r'\b(it|test|describe)\.(skip|todo|failing)\b')
                ],
                "solo": [
                    re.compile(r'\b(it|test|describe)\.only\b'),
                    re.compile(r'\bfdescribe\b|\bfit\b')
                ]
            },
            "python": {
                "skip": [
                    re.compile(r'@(pytest\.mark\.(skip|xfail))'),
                    re.compile(r'unittest\.skip\w*'),
                    re.compile(r'pytest\.(skip|importorskip)'),
                    re.compile(r'^\s*pytestmark\s*=')
                ],
                "solo": []
            },
            "go": {
                "skip": [
                    re.compile(r'\bt\.Skip(Now)?\s*\(')
                ],
                "solo": []
            },
            "rust": {
                "skip": [
                    re.compile(r'#\[ignore\]')
                ],
                "solo": []
            },
            "java_kotlin": {
                "skip": [
                    re.compile(r'@(Ignore|Disabled)\b')
                ],
                "solo": []
            },
            "ruby": {
                "skip": [
                    re.compile(r'^\s*xit\b'),
                    re.compile(r'^\s*(pending|skip)\b')
                ],
                "solo": []
            }
        }
        
        def get_lang_key(file_path):
            ext = file_path.split('.')[-1].lower() if '.' in file_path else ""
            if ext in ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']: return "js_ts"
            if ext == 'py': return "python"
            if ext == 'go': return "go"
            if ext == 'rs': return "rust"
            if ext in ['java', 'kt']: return "java_kotlin"
            if ext == 'rb': return "ruby"
            return None

        # Check path matches
        for new_path, info in raw_files.items():
            old_path = info["old_path"]
            status = info["status"]
            
            is_old_test = matches_patterns(old_path, test_path_regexes)
            is_new_test = matches_patterns(new_path, test_path_regexes)
            
            if is_new_test:
                test_paths_matched += 1

            if status.startswith('R'):
                if is_old_test and not is_new_test:
                    violations.append({
                        "layer": "L0",
                        "file": new_path,
                        "kind": "rename_escape",
                        "line": 1,
                        "detail": f"Test file {old_path} renamed to non-test path {new_path}"
                    })

            if not is_new_test and matches_patterns(new_path, surface_path_regexes):
                surface_touches.append(new_path)
                if config["mode"] == "block":
                    violations.append({
                        "layer": "L0",
                        "file": new_path,
                        "kind": "surface_touch",
                        "line": 1,
                        "detail": f"Integrity surface file {new_path} touched"
                    })

        # Scan hunks
        for new_path, file_info in files_diff.items():
            is_new_test = matches_patterns(new_path, test_path_regexes)
            if not is_new_test:
                continue
            lang_key = get_lang_key(new_path)
            for hunk in file_info["hunks"]:
                old_current = hunk["old_start"]
                new_current = hunk["new_start"]
                for line in hunk["lines"]:
                    if line.startswith('\\'):
                        continue
                    if line.startswith('-'):
                        content = line[1:]
                        violations.append({
                            "layer": "L0",
                            "file": new_path,
                            "kind": "deleted_line",
                            "line": old_current,
                            "detail": content
                        })
                        old_current += 1
                    elif line.startswith('+'):
                        content = line[1:]
                        if lang_key:
                            rules = marker_regexes[lang_key]
                            for rx in rules["solo"]:
                                if rx.search(content):
                                    violations.append({
                                        "layer": "L0",
                                        "file": new_path,
                                        "kind": "solo_marker",
                                        "line": new_current,
                                        "detail": content.strip()
                                    })
                                    break
                            for rx in rules["skip"]:
                                if rx.search(content):
                                    violations.append({
                                        "layer": "L0",
                                        "file": new_path,
                                        "kind": "skip_marker",
                                        "line": new_current,
                                        "detail": content.strip()
                                    })
                                    break
                        new_current += 1

    except Exception as e:
        violations.append({
            "layer": "L0",
            "file": "",
            "kind": "git_error",
            "line": 1,
            "detail": f"Git command failed: {e}"
        })

    if config["mode"] in ["warn", "off"]:
        ok = True
    elif not violations:
        ok = True
    elif override_ok:
        ok = True
    else:
        ok = False

    output = {
        "ok": ok,
        "mode": config["mode"],
        "violations": violations,
        "surface_touches": sorted(list(set(surface_touches))),
        "test_paths_matched": test_paths_matched,
        "source": source
    }
    
    if test_paths_matched == 0 and len(files_diff) > 0:
        output["warning"] = "possible misconfiguration: zero test paths matched the diff"

    if head_sha:
        output["override_status"] = override_msg
        output["head_sha"] = head_sha

    print(json.dumps(output, indent=2))
    
    if not ok:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
EOF
