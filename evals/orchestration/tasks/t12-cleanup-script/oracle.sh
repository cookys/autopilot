#!/usr/bin/env bash
# T12 oracle.sh — outcomes measure

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

# Run Python checks to verify first run success, check basic correctness, and compare states after run 1 vs run 2
fidelity_ok=0
if python3 << 'EOF'
import os, sys, subprocess, hashlib, shutil

def get_dir_state(root_dir):
    state = {}
    for dirpath, dirnames, filenames in os.walk(root_dir):
        if ".git" in dirpath.split(os.sep):
            continue
        if "__pycache__" in dirpath.split(os.sep):
            continue
        for name in dirnames + filenames:
            path = os.path.join(dirpath, name)
            rel_path = os.path.relpath(path, root_dir)
            if ".git" in rel_path.split(os.sep):
                continue
            if "__pycache__" in rel_path.split(os.sep):
                continue
            try:
                stat = os.lstat(path)
                if os.path.islink(path):
                    target = os.readlink(path)
                    state[rel_path] = ("symlink", target)
                elif os.path.isdir(path):
                    state[rel_path] = ("dir",)
                else:
                    with open(path, "rb") as f:
                        content = f.read()
                        h = hashlib.sha256(content).hexdigest()
                    state[rel_path] = ("file", stat.st_size, h)
            except Exception as e:
                state[rel_path] = ("error", str(e))
    return state

def check_basic_correctness():
    if not os.path.isfile(".profile_custom"):
        print("Fail reason: .profile_custom is missing", file=sys.stderr)
        return False
    if not os.path.isdir("my_app_data"):
        print("Fail reason: my_app_data directory is missing", file=sys.stderr)
        return False
    if not os.path.islink("current_data"):
        print("Fail reason: current_data is not a symbolic link", file=sys.stderr)
        return False
    
    target = os.readlink("current_data")
    resolved_target = os.path.realpath(os.path.join(os.path.dirname("current_data"), target))
    resolved_expected = os.path.realpath("my_app_data")
    if resolved_target != resolved_expected:
        print(f"Fail reason: current_data symlink target '{target}' does not resolve to 'my_app_data'", file=sys.stderr)
        return False
    
    try:
        with open(".profile_custom", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        cleaned_lines = [l.strip() for l in lines if l.strip()]
        expected_line = "export APP_ENV=production"
        occurrences = cleaned_lines.count(expected_line)
        if occurrences != 1:
            print(f"Fail reason: .profile_custom contains {occurrences} occurrences of APP_ENV config, expected exactly 1", file=sys.stderr)
            return False
    except Exception as e:
        print(f"Fail reason: error reading .profile_custom: {e}", file=sys.stderr)
        return False
    return True

def compare_states(state1, state2):
    if set(state1.keys()) != set(state2.keys()):
        diff_added = set(state2.keys()) - set(state1.keys())
        diff_removed = set(state1.keys()) - set(state2.keys())
        print(f"Fail reason: Filesystem state changed after second run. Added: {diff_added}, Removed: {diff_removed}", file=sys.stderr)
        return False
    
    for path, val1 in state1.items():
        val2 = state2[path]
        if val1[0] != val2[0]:
            print(f"Fail reason: File type changed for {path}: expected {val1[0]}, got {val2[0]}", file=sys.stderr)
            return False
        if val1[0] == "symlink":
            target1 = val1[1]
            target2 = val2[1]
            resolved1 = os.path.realpath(os.path.join(os.path.dirname(path), target1))
            resolved2 = os.path.realpath(os.path.join(os.path.dirname(path), target2))
            if resolved1 != resolved2:
                print(f"Fail reason: Symlink target changed for {path}: first run resolved to '{resolved1}', second run to '{resolved2}'", file=sys.stderr)
                return False
        elif val1[0] == "file":
            if val1[1] != val2[1] or val1[2] != val2[2]:
                print(f"Fail reason: File content or size changed for {path} after second run", file=sys.stderr)
                return False
        elif val1[0] == "error":
            print(f"Fail reason: Error tracking {path}: {val1[1]}", file=sys.stderr)
            return False
    return True

# Clean up before run 1
for path in [".profile_custom", "current_data"]:
    if os.path.lexists(path):
        os.remove(path)
if os.path.exists("my_app_data") and os.path.isdir("my_app_data"):
    shutil.rmtree("my_app_data")

# Run 1
try:
    subprocess.check_output(["bash", "setup.sh"], stderr=subprocess.STDOUT)
except subprocess.CalledProcessError as e:
    print(f"Fail reason: setup.sh failed on the first run: {e.output.decode()}", file=sys.stderr)
    sys.exit(1)

if not check_basic_correctness():
    sys.exit(1)

state1 = get_dir_state(".")

# Run 2
try:
    subprocess.check_output(["bash", "setup.sh"], stderr=subprocess.STDOUT)
except subprocess.CalledProcessError as e:
    print(f"Fail reason: setup.sh failed on the second run: {e.output.decode()}", file=sys.stderr)
    sys.exit(1)

if not check_basic_correctness():
    sys.exit(1)

state2 = get_dir_state(".")

if not compare_states(state1, state2):
    sys.exit(1)

print("Fidelity checks passed.")
EOF
then
  echo "fidelity_ok=true"
  fidelity_ok=1
else
  echo "fidelity_ok=false"
fi


# 4. Tests pass check
tests_passed=0
if [ -f "run-tests.sh" ]; then
  # Clean state before running the test script
  rm -f .profile_custom current_data
  rm -rf my_app_data
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: run-tests.sh failed" >&2
  fi
fi

# Final outcome
if [ $fidelity_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
