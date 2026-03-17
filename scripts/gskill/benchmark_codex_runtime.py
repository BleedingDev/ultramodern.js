#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import shlex
import subprocess
import tempfile
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RUN_GSKILL_PATH = ROOT / "scripts/gskill/run_gskill.py"
DEFAULT_SUITE_MANIFEST = ROOT / "scripts/gskill/benchmark_suites.json"
DEFAULT_ARTIFACTS_DIR = ROOT / "scripts/gskill/artifacts"
DEFAULT_SEED_SKILL = ROOT / "scripts/gskill/seed_skill.md"
DEFAULT_TEMPLATES_DIR = ROOT / "scripts/gskill/templates"
DEFAULT_CODEX_SKILLS_DIR = ROOT / ".codex/skills"


@dataclass
class CodexExecResult:
    ok: bool
    content: str
    latency_s: float
    return_code: int
    error_message: str
    raw_events: list[dict[str, Any]]


def load_run_gskill_module():
    spec = importlib.util.spec_from_file_location("run_gskill", RUN_GSKILL_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module: {RUN_GSKILL_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_jsonl_events(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def extract_agent_content(events: list[dict[str, Any]]) -> str:
    messages: list[str] = []
    for event in events:
        if event.get("type") != "item.completed":
            continue
        item = event.get("item") or {}
        if item.get("type") != "agent_message":
            continue
        text = item.get("text")
        if isinstance(text, str):
            stripped = text.strip()
            if stripped:
                messages.append(stripped)
    if not messages:
        return ""
    return messages[-1]


def coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def extract_error(events: list[dict[str, Any]], stderr_text: str) -> str:
    for event in events:
        if event.get("type") == "turn.failed":
            err = event.get("error") or {}
            msg = err.get("message")
            if msg:
                return str(msg)
        if event.get("type") == "error":
            msg = event.get("message")
            if msg:
                return str(msg)
        if event.get("type") == "item.completed":
            item = event.get("item") or {}
            if item.get("type") == "error":
                msg = item.get("message")
                if msg:
                    return str(msg)
    if stderr_text.strip():
        return stderr_text.strip().splitlines()[-1]
    return "unknown codex runtime failure"


def build_codex_prompt(task: dict[str, Any], skill_text: str) -> str:
    skill_block = skill_text.strip()
    if not skill_block:
        skill_block = "(no skill provided)"

    return (
        "You are Codex in benchmark scoring mode.\n"
        "Respond with concise plain text only.\n"
        "Do not run tools, do not execute commands, and do not inspect the filesystem.\n"
        "Use only the task statement and SKILL context.\n"
        "Keep output compact and operational: concrete file paths, commands, and checks.\n"
        "Do not include markdown code fences.\n\n"
        f"TASK_ID: {task['id']}\n"
        f"TASK_CATEGORY: {task['category']}\n"
        f"TASK_PROMPT: {task['prompt']}\n\n"
        "SKILL_CONTEXT_START\n"
        f"{skill_block}\n"
        "SKILL_CONTEXT_END\n"
    )


def run_codex_exec(
    model: str,
    prompt: str,
    cwd: Path,
    runtime_bin: str,
    disable_unstable_features: bool,
    timeout_s: int,
) -> CodexExecResult:
    output_file: Path | None = None
    if runtime_bin == "codex":
        with tempfile.NamedTemporaryFile(prefix="codex-last-message-", suffix=".txt", delete=False) as tmp:
            output_file = Path(tmp.name)
        cmd = [
            "codex",
            "exec",
            "-m",
            model,
            "--skip-git-repo-check",
            "--json",
            "-o",
            str(output_file),
        ]
        if disable_unstable_features:
            cmd.extend(["--disable", "responses_websockets_v2", "--disable", "apply_patch_freeform"])
        cmd.append(prompt)
    elif runtime_bin == "codex-native":
        cmd = [
            "codex-native",
            "run",
            "-m",
            model,
            "-a",
            "never",
            "-s",
            "read-only",
            "--skip-git-repo-check",
            prompt,
        ]
    else:
        raise RuntimeError(f"unsupported runtime binary: {runtime_bin}")

    started = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        elapsed = time.perf_counter() - started
        stderr_text = coerce_text(exc.stderr).strip()
        stdout_text = coerce_text(exc.stdout).strip()
        combined = "\n".join(part for part in [stderr_text, stdout_text] if part).strip()
        return CodexExecResult(
            ok=False,
            content="",
            latency_s=elapsed,
            return_code=124,
            error_message=combined or f"runtime timeout after {timeout_s}s",
            raw_events=[],
        )

    elapsed = time.perf_counter() - started

    stdout_text = proc.stdout or ""
    events = parse_jsonl_events(stdout_text)
    content = extract_agent_content(events)
    if not content and output_file is not None and output_file.exists():
        try:
            content = output_file.read_text(encoding="utf-8").strip()
        except OSError:
            content = ""
        finally:
            try:
                output_file.unlink(missing_ok=True)
            except OSError:
                pass

    ok = proc.returncode == 0 and bool(content.strip())
    error_message = "" if ok else extract_error(events, proc.stderr or "")
    return CodexExecResult(
        ok=ok,
        content=content,
        latency_s=elapsed,
        return_code=proc.returncode,
        error_message=error_message,
        raw_events=events,
    )


def summarize_rows(module: Any, rows: list[dict[str, Any]]) -> dict[str, Any]:
    summary = module.summarize_rows(rows)
    if not rows:
        summary.update(
            {
                "avg_latency_s": 0.0,
                "avg_success_rate": 0.0,
                "error_count": 0,
            },
        )
        return summary

    summary.update(
        {
            "avg_latency_s": sum(float(row.get("latency_s", 0.0)) for row in rows) / len(rows),
            "avg_success_rate": sum(1.0 if row.get("success") else 0.0 for row in rows) / len(rows),
            "error_count": sum(1 for row in rows if not row.get("success")),
        },
    )
    return summary


def build_enterprise_split_pack(
    core: str,
    mf: str,
    bff: str,
    superapp: str,
    delivery: str,
) -> dict[str, str]:
    return {
        "default": "\n\n".join([core.strip(), mf.strip(), superapp.strip()]),
        "core": "\n\n".join([core.strip(), mf.strip()]),
        "init": superapp,
        "appdev": superapp,
        "routing": superapp,
        "typesafety": superapp,
        "mf": mf,
        "microfrontend": mf,
        "bff": bff,
        "effect": bff,
        "telemetry": bff,
        "contracts": "\n\n".join([mf.strip(), delivery.strip()]),
        "delivery": delivery,
        "governance": delivery,
    }


def build_default_candidates(module: Any) -> dict[str, str | dict[str, str]]:
    seed = DEFAULT_SEED_SKILL.read_text(encoding="utf-8")
    optimized_path = DEFAULT_ARTIFACTS_DIR / "optimized_skill.md"
    optimized = optimized_path.read_text(encoding="utf-8") if optimized_path.exists() else seed
    templates = module.load_template_skills(DEFAULT_TEMPLATES_DIR)
    codex_split = module.build_split_pack(optimized, templates)

    candidates: dict[str, str | dict[str, str]] = {
        "baseline_none": "",
        "baseline_seed": seed,
        "gepa_optimized_core": optimized,
        "codex_split_pack": codex_split,
    }

    try:
        enterprise_core = (DEFAULT_CODEX_SKILLS_DIR / "ultramodern-enterprise-core/SKILL.md").read_text(
            encoding="utf-8",
        )
        enterprise_bff = (
            DEFAULT_CODEX_SKILLS_DIR / "ultramodern-enterprise-bff-telemetry/SKILL.md"
        ).read_text(encoding="utf-8")
        enterprise_mf = (
            DEFAULT_CODEX_SKILLS_DIR / "ultramodern-enterprise-mf-contracts/SKILL.md"
        ).read_text(encoding="utf-8")
        enterprise_superapp = (
            DEFAULT_CODEX_SKILLS_DIR / "ultramodern-enterprise-superapp-dev/SKILL.md"
        ).read_text(encoding="utf-8")
        enterprise_delivery = (
            DEFAULT_CODEX_SKILLS_DIR / "ultramodern-enterprise-delivery/SKILL.md"
        ).read_text(encoding="utf-8")
        candidates["codex_enterprise_split_pack"] = build_enterprise_split_pack(
            core=enterprise_core,
            mf=enterprise_mf,
            bff=enterprise_bff,
            superapp=enterprise_superapp,
            delivery=enterprise_delivery,
        )
    except OSError:
        pass

    return candidates


def filter_tasks(tasks: list[dict[str, Any]], split: str, max_per_suite: int | None) -> list[dict[str, Any]]:
    selected = tasks if split == "all" else [task for task in tasks if task["split"] == split]
    if max_per_suite is not None:
        return selected[:max_per_suite]
    return selected


def score_suite(
    module: Any,
    suite_id: str,
    tasks: list[dict[str, Any]],
    candidates: dict[str, str | dict[str, str]],
    model: str,
    cwd: Path,
    runtime_bin: str,
    disable_unstable_features: bool,
    timeout_s: int,
    fail_fast: bool,
) -> dict[str, Any]:
    candidate_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for candidate_name, candidate_payload in candidates.items():
        for task in tasks:
            skill_text = module.resolve_candidate_text(candidate_payload, str(task["category"]))
            prompt = build_codex_prompt(task, skill_text)
            result = run_codex_exec(
                model=model,
                prompt=prompt,
                cwd=cwd,
                runtime_bin=runtime_bin,
                disable_unstable_features=disable_unstable_features,
                timeout_s=timeout_s,
            )

            if not result.ok:
                row = {
                    "task_id": task["id"],
                    "split": task["split"],
                    "category": task["category"],
                    "score": 0.0,
                    "required_cov": 0.0,
                    "preferred_cov": 0.0,
                    "token_efficiency": 0.0,
                    "latency_inv": 0.0,
                    "word_count": 0.0,
                    "token_proxy": 0.0,
                    "missing_required": [str(value) for value in task["required_signals"]],
                    "missing_preferred": [str(value) for value in task["preferred_signals"]],
                    "directives": [f"CODEX_ERROR::{result.error_message}"],
                    "feedback": result.error_message,
                    "success": False,
                    "latency_s": result.latency_s,
                    "runtime_error": result.error_message,
                    "runtime_return_code": result.return_code,
                    "runtime_bin": runtime_bin,
                    "runtime_model": model,
                    "runtime_prompt_chars": len(prompt),
                }
                candidate_rows[candidate_name].append(row)
                if fail_fast:
                    raise RuntimeError(
                        f"codex runtime failed on suite={suite_id} candidate={candidate_name} task={task['id']}: "
                        f"{result.error_message}",
                    )
                continue

            scored = module.evaluate_text_for_task(result.content, task)
            scored.update(
                {
                    "success": True,
                    "latency_s": result.latency_s,
                    "runtime_error": "",
                    "runtime_return_code": result.return_code,
                    "runtime_bin": runtime_bin,
                    "runtime_model": model,
                    "runtime_prompt_chars": len(prompt),
                },
            )
            candidate_rows[candidate_name].append(scored)

    report: dict[str, Any] = {"task_count": len(tasks), "candidates": {}}
    for candidate_name, rows in candidate_rows.items():
        splits: dict[str, Any] = {}
        for split_name in ("train", "val", "test"):
            split_rows = [row for row in rows if row["split"] == split_name]
            splits[split_name] = summarize_rows(module, split_rows)
        splits["overall"] = summarize_rows(module, rows)
        report["candidates"][candidate_name] = {
            "rows": rows,
            "splits": splits,
        }

    winner_by_split: dict[str, str | None] = {}
    for split_name in ("train", "val", "test", "overall"):
        best_name: str | None = None
        best_score = -1.0
        for candidate_name, payload in report["candidates"].items():
            score = float(payload["splits"][split_name]["avg_score"])
            if score > best_score:
                best_score = score
                best_name = candidate_name
        winner_by_split[split_name] = best_name
    report["winner_by_split"] = winner_by_split
    return report


def build_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Codex Runtime Skill Benchmark")
    lines.append("")
    lines.append(f"- Generated: {report['generated_at']}")
    lines.append(f"- Runtime: `{report['runtime_bin']}`")
    lines.append(f"- Model: `{report['model']}`")
    lines.append(f"- Split filter: `{report['split_filter']}`")
    if report.get("max_tasks_per_suite") is not None:
        lines.append(f"- Max tasks per suite: `{report['max_tasks_per_suite']}`")
    lines.append("")
    lines.append("| Suite | Candidate | Split | Avg Score | Req Cov | Pref Cov | Avg Latency (s) | Success |")
    lines.append("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |")
    for suite_id, suite_payload in report["suites"].items():
        for candidate_name, payload in suite_payload["candidates"].items():
            for split_name in ("train", "val", "test", "overall"):
                summary = payload["splits"][split_name]
                lines.append(
                    "| "
                    + f"{suite_id} | {candidate_name} | {split_name} | "
                    + f"{summary['avg_score']:.4f} | "
                    + f"{summary['avg_required_cov']:.4f} | "
                    + f"{summary['avg_preferred_cov']:.4f} | "
                    + f"{summary['avg_latency_s']:.3f} | "
                    + f"{summary['avg_success_rate']:.2f} |",
                )
    lines.append("")
    lines.append("## Winners (test split)")
    lines.append("")
    for suite_id, suite_payload in report["suites"].items():
        lines.append(f"- {suite_id}: {suite_payload['winner_by_split'].get('test')}")
    lines.append(f"- overall: {report['overall']['winner_by_split'].get('test')}")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark skills against codex runtime model")
    parser.add_argument("--runtime-bin", choices=["codex-native", "codex"], default="codex-native")
    parser.add_argument("--model", default="gpt-5.3-codex-spark")
    parser.add_argument("--runtime-timeout-s", type=int, default=180)
    parser.add_argument("--suite-manifest", type=Path, default=DEFAULT_SUITE_MANIFEST)
    parser.add_argument(
        "--split",
        choices=["train", "val", "test", "all"],
        default="test",
        help="evaluate only one split or all splits",
    )
    parser.add_argument(
        "--max-tasks-per-suite",
        type=int,
        default=None,
        help="optional cap per suite after split filtering",
    )
    parser.add_argument(
        "--disable-unstable-features",
        action="store_true",
        help="pass --disable responses_websockets_v2/apply_patch_freeform to codex exec",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="stop on first codex runtime failure",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=DEFAULT_ARTIFACTS_DIR,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    module = load_run_gskill_module()
    suites = module.load_suites(args.suite_manifest)
    candidates = build_default_candidates(module)

    suite_reports: dict[str, Any] = {}
    all_rows_by_candidate: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for suite in suites:
        selected_tasks = filter_tasks(suite["tasks"], args.split, args.max_tasks_per_suite)
        if not selected_tasks:
            continue
        suite_report = score_suite(
            module=module,
            suite_id=suite["id"],
            tasks=selected_tasks,
            candidates=candidates,
            model=args.model,
            cwd=ROOT,
            runtime_bin=args.runtime_bin,
            disable_unstable_features=args.disable_unstable_features,
            timeout_s=args.runtime_timeout_s,
            fail_fast=args.fail_fast,
        )
        suite_reports[suite["id"]] = {
            "description": suite["description"],
            "tasks_file": suite["tasks_file"],
            **suite_report,
        }
        for candidate_name, payload in suite_report["candidates"].items():
            all_rows_by_candidate[candidate_name].extend(payload["rows"])

    overall_candidates: dict[str, Any] = {}
    for candidate_name, rows in all_rows_by_candidate.items():
        splits: dict[str, Any] = {}
        for split_name in ("train", "val", "test"):
            split_rows = [row for row in rows if row["split"] == split_name]
            splits[split_name] = summarize_rows(module, split_rows)
        splits["overall"] = summarize_rows(module, rows)
        overall_candidates[candidate_name] = {"rows": rows, "splits": splits}

    overall_winner_by_split: dict[str, str | None] = {}
    for split_name in ("train", "val", "test", "overall"):
        best_name: str | None = None
        best_score = -1.0
        for candidate_name, payload in overall_candidates.items():
            score = float(payload["splits"][split_name]["avg_score"])
            if score > best_score:
                best_score = score
                best_name = candidate_name
        overall_winner_by_split[split_name] = best_name

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "runtime_bin": args.runtime_bin,
        "model": args.model,
        "split_filter": args.split,
        "max_tasks_per_suite": args.max_tasks_per_suite,
        "suites": suite_reports,
        "overall": {
            "candidates": overall_candidates,
            "winner_by_split": overall_winner_by_split,
        },
    }

    safe_model_name = args.model.replace("/", "-")
    args.artifacts_dir.mkdir(parents=True, exist_ok=True)
    runtime_tag = args.runtime_bin.replace("/", "-")
    split_tag = args.split
    if args.max_tasks_per_suite is not None:
        split_tag = f"{args.split}_max{args.max_tasks_per_suite}"
    json_path = args.artifacts_dir / f"benchmark_codex_runtime_{runtime_tag}_{safe_model_name}_{split_tag}.json"
    md_path = args.artifacts_dir / f"benchmark_codex_runtime_{runtime_tag}_{safe_model_name}_{split_tag}.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(build_markdown(report), encoding="utf-8")

    overall_test_scores = {
        name: payload["splits"]["test"]["avg_score"]
        for name, payload in overall_candidates.items()
    }
    overall_test_winner = (
        max(overall_test_scores.items(), key=lambda item: item[1])[0] if overall_test_scores else "n/a"
    )

    print("codex runtime benchmark complete")
    print(f"runtime: {args.runtime_bin}")
    print(f"model: {args.model}")
    print(f"overall test winner: {overall_test_winner}")
    for name, score in sorted(overall_test_scores.items(), key=lambda item: item[1], reverse=True):
        print(f"- {name}: overall_test_avg_score={score:.4f}")
    for suite_id, suite_payload in suite_reports.items():
        print(f"- suite={suite_id} test_winner={suite_payload['winner_by_split'].get('test')}")
    print(f"artifacts_json: {json_path}")
    print(f"artifacts_md: {md_path}")


if __name__ == "__main__":
    main()
