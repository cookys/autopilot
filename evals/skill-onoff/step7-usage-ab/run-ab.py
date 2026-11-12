#!/usr/bin/env python3
"""Prose A/B of finish-flow step 7. Same wrapper, cases, model, and repeat for both arms.

skill-onoff's runner flags are --runner cc|stub. cc is Claude. stub is not a
qualified seat. run-skill-opt.sh calls claude. The orchestration runner can
select agy, and it also git-commits the cell. This script does not invoke
those runners and does not commit. It calls grok, the cheapest qualified
non-Claude seat installed here (grok-4.7, reasoning effort low).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import grade  # noqa: E402

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
HOME_RE = re.compile(re.escape(os.sep + "home" + os.sep) + r"\S+")
HOST = socket.gethostname()
ARM_SKILL = {
    "a": ROOT / "skills/finish-flow/SKILL.md",
    "b": HERE / "arm-b/SKILL.md",
}


def sanitize(value):
    if not isinstance(value, str):
        return value
    value = HOME_RE.sub("<home-path>", value)
    value = EMAIL_RE.sub("<email>", value)
    if HOST:
        value = value.replace(HOST, "<host>")
    return value


def load_cases():
    spec = json.loads((HERE / "cases.json").read_text())
    cases = []
    triggers = json.loads((ROOT / "skill-creator-workspace/evals/finish-flow-evals.json").read_text())
    if len(triggers) != 10:
        raise SystemExit("finish-flow-evals.json no longer has 10 queries")
    for item in spec["existing"]:
        source = item["source"]
        if source.endswith("finish-flow-evals.json"):
            row = triggers[item["index"]]
            query = row["query"]
            should = bool(row["should_trigger"])
        else:
            query = (ROOT / source).read_text().strip("\n")
            prefix = item.get("prefix")
            if prefix:
                query = prefix + "\n\n" + query
            should = bool(item["should_trigger"])
        cases.append({
            "id": item["id"],
            "rubric": item["rubric"],
            "should_trigger": should,
            "query": query,
            "source": source,
        })
    synthetic = spec["synthetic"]
    cases.append({
        "id": synthetic["id"],
        "rubric": synthetic["rubric"],
        "should_trigger": bool(synthetic["should_trigger"]),
        "query": synthetic["query"],
        "source": "synthetic",
    })
    return spec, cases


def build_prompt(skill: str, query: str) -> str:
    wrapper = (HERE / "prompt-wrapper.md").read_text()
    if "@@SKILL@@" not in wrapper or "@@QUERY@@" not in wrapper:
        raise SystemExit("prompt wrapper placeholders missing")
    return wrapper.replace("@@SKILL@@", skill).replace("@@QUERY@@", query)


def grok_call(prompt: str, timeout_s: int):
    prompt_dir = Path("/tmp/step7-usage-ab")
    prompt_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = prompt_dir / "prompt.md"
    prompt_path.write_text(prompt)
    cmd = [
        "grok",
        "--model", "grok-4.7",
        "--reasoning-effort", "low",
        "--max-turns", "1",
        "--no-subagents",
        "--disable-web-search",
        "--output-format", "json",
        "--no-alt-screen",
        "--verbatim",
        "--permission-mode", "dontAsk",
        "--cwd", "/tmp",
        "--system-prompt-override", "Answer the user prompt with text only. Do not use tools.",
        "--prompt-file", str(prompt_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
    parsed = None
    raw = proc.stdout.strip()
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}")
            if start >= 0 and end > start:
                try:
                    parsed = json.loads(raw[start:end + 1])
                except json.JSONDecodeError:
                    parsed = None
    return proc.returncode, parsed, sanitize(proc.stderr)[-800:]


def keep_usage(parsed: dict) -> dict:
    usage = parsed.get("usage") if isinstance(parsed, dict) else None
    if not isinstance(usage, dict):
        return {}
    kept = {}
    for key in (
        "input_tokens",
        "output_tokens",
        "reasoning_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "total_tokens",
    ):
        if key in usage:
            kept[key] = usage[key]
    return kept


def run_all(timeout_s: int) -> int:
    if not grade.fixture_ok(ROOT):
        print("fixture check failed", file=sys.stderr)
        return 2
    spec, cases = load_cases()
    results_dir = HERE / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    version = subprocess.run(["grok", "--version"], capture_output=True, text=True).stdout.strip()
    engine = {
        "model": "grok-4.7",
        "reasoning_effort": "low",
        "repeat": spec["repeat"],
        "seed": spec["seed"],
        "runner": "grok",
        "runner_version": sanitize(version),
        "flags": [
            "--model grok-4.7",
            "--reasoning-effort low",
            "--max-turns 1",
            "--no-subagents",
            "--disable-web-search",
            "--output-format json",
            "--verbatim",
            "--permission-mode dontAsk",
            "--cwd /tmp",
        ],
        "skill_sha256": {
            "a": hashlib.sha256(ARM_SKILL["a"].read_bytes()).hexdigest(),
            "b": hashlib.sha256(ARM_SKILL["b"].read_bytes()).hexdigest(),
        },
    }
    (results_dir / "engine.json").write_text(json.dumps(engine, indent=2) + "\n")
    scores = []
    worst = 0
    for arm in ("a", "b"):
        skill = ARM_SKILL[arm].read_text()
        rows = []
        out = results_dir / f"arm-{arm}.jsonl"
        for case in cases:
            prompt = build_prompt(skill, case["query"])
            print(f"run arm={arm} case={case['id']}", file=sys.stderr, flush=True)
            try:
                code, parsed, err = grok_call(prompt, timeout_s)
            except subprocess.TimeoutExpired:
                code, parsed, err = 124, None, "timeout"
            text = ""
            stop = None
            usage = {}
            turns = None
            if isinstance(parsed, dict):
                text = sanitize(parsed.get("text") or "")
                stop = sanitize(parsed.get("stopReason")) if isinstance(parsed.get("stopReason"), str) else parsed.get("stopReason")
                usage = keep_usage(parsed)
                turns = parsed.get("num_turns")
            row = {
                "id": case["id"],
                "arm": arm,
                "rubric": case["rubric"],
                "should_trigger": case["should_trigger"],
                "source": case["source"],
                "query": case["query"],
                "exit_code": code,
                "stop_reason": stop,
                "num_turns": turns,
                "usage": usage,
                "text": text,
                "stderr_tail": err,
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
            }
            rows.append(row)
            scored = grade.score_row(row)
            scores.append(scored)
            print(
                f"done arm={arm} case={case['id']} exit={code} pass={scored['pass']}",
                file=sys.stderr,
                flush=True,
            )
            if code != 0:
                worst = code or 1
            out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    (results_dir / "scores.json").write_text(json.dumps(scores, indent=2) + "\n")
    summary = grade.compare(scores)
    (results_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    write_readme(engine, summary, scores)
    return worst


def write_readme(engine: dict, summary: dict, scores: list) -> None:
    lines = []
    lines.append("# finish-flow step 7 A/B: Staging verify vs Usage evidence")
    lines.append("")
    lines.append("Campaign: PM 01M78GBW, D8c part A. Eval evidence only. `skills/finish-flow/SKILL.md` is arm A and was not edited.")
    lines.append("")
    lines.append("## Instrument")
    lines.append("")
    lines.append("The existing finish-flow behavioral runner is `evals/skill-onoff/run-skill-onoff-eval.sh`. Its `--runner` flag accepts `cc` or `stub`. `cc` is Claude (`claude -p`). `stub` is a deterministic stand-in, not a qualified model seat. Its markers (`c_status_input`, `g7_close`) score tool order in a transcript. They do not read checklist item 7.")
    lines.append("")
    lines.append("The description-trigger pack is `skill-creator-workspace/evals/finish-flow-evals.json` (10 queries). `scripts/run-skill-opt.sh` runs it through `claude -p`.")
    lines.append("")
    lines.append("The scorecard harness `evals/orchestration/run-orchestration-eval.sh` accepts `--runner agy` and a qualified non-Claude model. Its tasks are coding oracles, and the agy branch commits the cell. Those tasks do not load finish-flow step 7. This pack does not call that runner.")
    lines.append("")
    lines.append("Both arms were run as the same prose compliance check. The model sees the full skill text. The only difference is step 7. `grok-4.7` at reasoning effort `low` is a qualified non-Claude implementer seat in `references/official-qualification-defaults.json`. It is the seat used here because skill-onoff has no qualified non-Claude runner flag. Engine: `grok-4.7`, reasoning effort `low`, runner `%s` (`%s`). Repeat: %s. Seed: none (the runner has no seed flag). This n=1 pass is not the prereg repeat count and is not a gate result." % (
        engine["runner"], engine["runner_version"], engine["repeat"],
    ))
    lines.append("")
    lines.append("Skill sha256: arm A `%s`, arm B `%s`. Arm B is `arm-b/SKILL.md`. The diff against the live skill is line 130 only." % (
        engine["skill_sha256"]["a"], engine["skill_sha256"]["b"],
    ))
    lines.append("")
    lines.append("## Frozen rubric")
    lines.append("")
    lines.append("Graded by `grade.py` before any model output was accepted. Existing cases: PASS iff the first non-empty line is `TRIGGER` or `NO-TRIGGER` and matches `should_trigger`. The usage line is not required, so arm A is not failed for still saying Staging verify.")
    lines.append("")
    lines.append("Synthetic case `ff-usage-green-unused` only: facts are merged, tests green, review PASS, no person used the result, no end-to-end run. PASS iff the trigger label matches and there is exactly one `Used: n/a <reason>` line. `Used: user` and `Used: e2e` fail. A reason that is only green tests or review PASS fails. The reason must state that nothing was used or that there was no end-to-end run.")
    lines.append("")
    lines.append("## Cases and results")
    lines.append("")
    lines.append("| case | rubric | should_trigger | arm A | arm B | A exit | B exit |")
    lines.append("|---|---|---|---|---|---|---|")
    by = {}
    for row in scores:
        by.setdefault(row["id"], {})[row["arm"]] = row
    order = [row["id"] for row in summary["existing"]]
    if summary.get("usage"):
        order.append(summary["usage"]["id"])
    for case_id in order:
        arms = by[case_id]
        lines.append("| `%s` | %s | %s | %s | %s | %s | %s |" % (
            case_id,
            arms["a"]["rubric"],
            "true" if arms["a"]["should_trigger"] else "false",
            "PASS" if arms["a"]["pass"] else "FAIL",
            "PASS" if arms["b"]["pass"] else "FAIL",
            arms["a"]["exit_code"],
            arms["b"]["exit_code"],
        ))
    lines.append("")
    lines.append("Per-case trigger expectation is the source file's `should_trigger` for `ff-trigger-*`, and true for `f1-ready-to-merge`, `f1b-ready-to-merge-docs`, and `g7-close`. `g7-close` uses the prereg prefix `Use finish-flow:` before `tasks/g7-close/task.md`. The other task prompts are the task.md text. The ten trigger queries are copied from `finish-flow-evals.json` in file order.")
    lines.append("")
    usage = summary.get("usage") or {}
    lines.append("Synthetic usage lines: arm A `%s`; arm B `%s`." % (
        "; ".join(usage.get("a_used_lines") or []) or "(none)",
        "; ".join(usage.get("b_used_lines") or []) or "(none)",
    ))
    lines.append("")
    lines.append("Arm B is no worse than A on every existing case: **%s**." % ("yes" if summary["b_no_worse_on_existing"] else "no"))
    lines.append("")
    lines.append("Arm B is better on the usage-evidence case: **%s**." % ("yes" if summary["b_better_on_usage"] else "no"))
    lines.append("")
    lines.append("Counts: %d existing cases, 1 synthetic case, 2 arms, 1 repeat, %d model calls." % (
        len(summary["existing"]), len(summary["existing"]) * 2 + 2,
    ))
    lines.append("")
    lines.append("Raw rows: `results/arm-a.jsonl`, `results/arm-b.jsonl`. Scores: `results/scores.json`, `results/summary.json`.")
    lines.append("")
    lines.append("## Out of scope")
    lines.append("")
    lines.append("No edit to `skills/finish-flow/SKILL.md`, frozen `packs/`, or the Codex plugin mirror. Session end (lite) item (3) still says staging. No commit in this run. Intended commit message, for the harness: `eval(finish-flow): A/B Staging verify vs Usage evidence for step 7 (PM 01M78GBW, D8c part A evidence)`.")
    lines.append("")
    text = "\n".join(lines)
    home_mark = os.sep + "home" + os.sep
    if HOST and HOST in text:
        raise SystemExit("readme contains hostname")
    if home_mark in text or EMAIL_RE.search(text):
        raise SystemExit("readme contains a home path or email")
    (HERE / "README.md").write_text(text)


def main(argv: list[str]) -> int:
    if "--check-fixture" in argv:
        print("fixture_ok", grade.fixture_ok(ROOT))
        return 0 if grade.fixture_ok(ROOT) else 1
    timeout_s = 180
    if "--timeout" in argv:
        timeout_s = int(argv[argv.index("--timeout") + 1])
    return run_all(timeout_s)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
