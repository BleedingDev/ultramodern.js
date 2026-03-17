#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TASKS_PATH = ROOT / "scripts/gskill/benchmark_tasks.json"
DEFAULT_SUITE_MANIFEST_PATH = ROOT / "scripts/gskill/benchmark_suites.json"
DEFAULT_SEED_SKILL_PATH = ROOT / "scripts/gskill/seed_skill.md"
DEFAULT_TEMPLATES_DIR = ROOT / "scripts/gskill/templates"
DEFAULT_ARTIFACTS_DIR = ROOT / "scripts/gskill/artifacts"
DEFAULT_SKILLS_DIR = ROOT / ".codex/skills"


def bootstrap_gepa_import() -> None:
    candidates: list[Path] = []

    env_path = os.getenv("GEPA_SRC")
    if env_path:
        candidates.append(Path(env_path))

    workspace_parent = ROOT.parent
    candidates.extend(
        [
            workspace_parent / "gepa-fresh/src",
            workspace_parent / "gepa/src",
        ],
    )

    for candidate in candidates:
        if candidate.exists():
            resolved = str(candidate.resolve())
            if resolved not in sys.path:
                sys.path.insert(0, resolved)


bootstrap_gepa_import()

try:
    import gepa.optimize_anything as oa
    from gepa.optimize_anything import (
        EngineConfig,
        GEPAConfig,
        MergeConfig,
        ReflectionConfig,
        optimize_anything,
    )
except ModuleNotFoundError as exc:
    raise SystemExit(
        "GEPA is not importable. Set GEPA_SRC to <path>/gepa/src or clone "
        "https://github.com/gepa-ai/gepa to ../gepa-fresh.",
    ) from exc


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def count_words(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9_./:-]+", text))


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    if value < low:
        return low
    if value > high:
        return high
    return value


def load_tasks(path: Path) -> list[dict[str, Any]]:
    content = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(content, list):
        raise ValueError(f"Tasks file must be a JSON array: {path}")
    for item in content:
        if not isinstance(item, dict):
            raise ValueError("Each task must be an object.")
        for key in ("id", "split", "category", "required_signals", "preferred_signals"):
            if key not in item:
                raise ValueError(f"Missing task key '{key}' in {item}")
    return content


def load_suites(manifest_path: Path) -> list[dict[str, Any]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, list):
        raise ValueError(f"Suite manifest must be a JSON array: {manifest_path}")

    suites: list[dict[str, Any]] = []
    for entry in manifest:
        if not isinstance(entry, dict):
            raise ValueError("Each suite manifest entry must be an object.")
        suite_id = str(entry["id"])
        description = str(entry.get("description", ""))
        tasks_file = manifest_path.parent / str(entry["tasks_file"])
        tasks = load_tasks(tasks_file)
        suites.append(
            {
                "id": suite_id,
                "description": description,
                "tasks_file": str(tasks_file),
                "tasks": tasks,
            },
        )
    return suites


def resolve_candidate_text(candidate: str | dict[str, str], category: str) -> str:
    if isinstance(candidate, str):
        return candidate

    if category in candidate:
        return candidate[category]

    if "default" in candidate:
        return candidate["default"]

    if candidate:
        return next(iter(candidate.values()))

    return ""


def target_words_for_category(category: str) -> int:
    if category in {
        "bff",
        "effect",
        "telemetry",
        "mf",
        "microfrontend",
        "contracts",
        "delivery",
        "governance",
        "typesafety",
    }:
        return 340
    if category in {"appdev", "init", "routing"}:
        return 420
    return 520


def evaluate_text_for_task(skill_text: str, task: dict[str, Any]) -> dict[str, Any]:
    normalized_skill = normalize(skill_text)

    required = [str(value) for value in task["required_signals"]]
    preferred = [str(value) for value in task["preferred_signals"]]

    required_hits = [signal for signal in required if normalize(signal) in normalized_skill]
    preferred_hits = [signal for signal in preferred if normalize(signal) in normalized_skill]

    required_cov = len(required_hits) / max(len(required), 1)
    preferred_cov = len(preferred_hits) / max(len(preferred), 1)

    word_count = count_words(skill_text)
    target_words = target_words_for_category(str(task["category"]))
    token_proxy = int(word_count * 1.35)
    token_efficiency = min(1.0, target_words / max(word_count, 1))
    latency_inv = min(1.0, (target_words * 1.5) / max(word_count, 1))

    score = (
        0.64 * required_cov
        + 0.20 * preferred_cov
        + 0.10 * token_efficiency
        + 0.06 * latency_inv
    )
    if word_count > 1300:
        score -= 0.05
    score = clamp(score)

    missing_required = [signal for signal in required if signal not in required_hits]
    missing_preferred = [signal for signal in preferred if signal not in preferred_hits]

    directives: list[str] = [f"TASK::{task['id']}"]
    for signal in missing_required[:8]:
        directives.append(f"ADD_SIGNAL::{signal}")
    for signal in missing_preferred[:4]:
        directives.append(f"ADD_OPTIONAL::{signal}")
    if word_count > target_words:
        directives.append(f"TRIM_WORDS::{target_words}")
    if "pnpm test:ut" not in skill_text:
        directives.append("ADD_COMMAND::proto run pnpm -- test:ut")
    if task["category"] in {"contracts", "delivery"} and "validate:rc-gates" not in skill_text:
        directives.append("ADD_COMMAND::proto run pnpm -- validate:rc-gates")

    feedback = (
        f"Task={task['id']} "
        f"required_cov={required_cov:.3f} preferred_cov={preferred_cov:.3f} "
        f"words={word_count} token_proxy={token_proxy} missing_required={len(missing_required)}"
    )

    return {
        "task_id": task["id"],
        "split": task["split"],
        "category": task["category"],
        "score": score,
        "required_cov": required_cov,
        "preferred_cov": preferred_cov,
        "token_efficiency": token_efficiency,
        "latency_inv": latency_inv,
        "word_count": word_count,
        "token_proxy": token_proxy,
        "missing_required": missing_required,
        "missing_preferred": missing_preferred,
        "directives": directives,
        "feedback": feedback,
    }


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "count": 0,
            "avg_score": 0.0,
            "avg_required_cov": 0.0,
            "avg_preferred_cov": 0.0,
            "avg_token_efficiency": 0.0,
            "avg_latency_inv": 0.0,
            "avg_word_count": 0.0,
            "avg_token_proxy": 0.0,
            "top_missing_required": [],
        }

    missing_counter: Counter[str] = Counter()
    for row in rows:
        for signal in row["missing_required"]:
            missing_counter[signal] += 1

    return {
        "count": len(rows),
        "avg_score": sum(row["score"] for row in rows) / len(rows),
        "avg_required_cov": sum(row["required_cov"] for row in rows) / len(rows),
        "avg_preferred_cov": sum(row["preferred_cov"] for row in rows) / len(rows),
        "avg_token_efficiency": sum(row["token_efficiency"] for row in rows) / len(rows),
        "avg_latency_inv": sum(row["latency_inv"] for row in rows) / len(rows),
        "avg_word_count": sum(row["word_count"] for row in rows) / len(rows),
        "avg_token_proxy": sum(row["token_proxy"] for row in rows) / len(rows),
        "top_missing_required": [
            {"signal": signal, "count": count}
            for signal, count in missing_counter.most_common(8)
        ],
    }


def benchmark_single_suite(
    candidates: dict[str, str | dict[str, str]],
    tasks: list[dict[str, Any]],
) -> dict[str, Any]:
    report: dict[str, Any] = {"candidates": {}}

    for name, candidate in candidates.items():
        rows: list[dict[str, Any]] = []
        for task in tasks:
            selected_text = resolve_candidate_text(candidate, str(task["category"]))
            row = evaluate_text_for_task(selected_text, task)
            rows.append(row)

        splits: dict[str, Any] = {}
        for split_name in ("train", "val", "test"):
            split_rows = [row for row in rows if row["split"] == split_name]
            splits[split_name] = summarize_rows(split_rows)

        splits["overall"] = summarize_rows(rows)
        report["candidates"][name] = {"splits": splits, "rows": rows}

    winner_by_split: dict[str, str | None] = {}
    for split_name in ("train", "val", "test", "overall"):
        best_name: str | None = None
        best_score = -1.0
        for name, payload in report["candidates"].items():
            score = payload["splits"][split_name]["avg_score"]
            if score > best_score:
                best_score = score
                best_name = name
        winner_by_split[split_name] = best_name

    report["winner_by_split"] = winner_by_split
    report["task_count"] = len(tasks)
    return report


def benchmark_across_suites(
    candidates: dict[str, str | dict[str, str]],
    suites: list[dict[str, Any]],
) -> dict[str, Any]:
    suite_reports: dict[str, Any] = {}
    all_tasks: list[dict[str, Any]] = []

    for suite in suites:
        suite_report = benchmark_single_suite(candidates, suite["tasks"])
        suite_reports[suite["id"]] = {
            "description": suite["description"],
            "tasks_file": suite["tasks_file"],
            **suite_report,
        }
        all_tasks.extend(suite["tasks"])

    overall = benchmark_single_suite(candidates, all_tasks)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "suites": suite_reports,
        "overall": overall,
    }


def prompt_to_text(prompt: str | list[dict[str, Any]]) -> str:
    if isinstance(prompt, str):
        return prompt

    parts: list[str] = []
    for message in prompt:
        content = message.get("content", "")
        if isinstance(content, list):
            for chunk in content:
                if isinstance(chunk, dict):
                    if chunk.get("type") == "text":
                        parts.append(str(chunk.get("text", "")))
                else:
                    parts.append(str(chunk))
        else:
            parts.append(str(content))
    return "\n".join(parts)


def extract_code_blocks(text: str) -> list[str]:
    return re.findall(r"```(?:[^\n]*)\n?(.*?)```", text, flags=re.DOTALL)


def split_frontmatter(candidate: str) -> tuple[str, str]:
    if not candidate.startswith("---\n"):
        return "", candidate

    closing = candidate.find("\n---\n", 4)
    if closing == -1:
        return "", candidate

    frontmatter = candidate[: closing + 5]
    body = candidate[closing + 5 :]
    return frontmatter, body


def collapse_blank_lines(lines: list[str]) -> list[str]:
    collapsed: list[str] = []
    previous_blank = False
    for line in lines:
        is_blank = line.strip() == ""
        if is_blank and previous_blank:
            continue
        collapsed.append(line.rstrip())
        previous_blank = is_blank
    return collapsed


def add_signals_to_section(
    body_lines: list[str],
    heading: str,
    signals: list[str],
    prefix: str = "- ",
) -> list[str]:
    if not signals:
        return body_lines

    working = list(body_lines)
    heading_index = -1
    for index, line in enumerate(working):
        if line.strip().lower() == heading.lower():
            heading_index = index
            break

    if heading_index == -1:
        if working and working[-1].strip():
            working.append("")
        working.append(heading)
        working.append("")
        heading_index = len(working) - 2

    section_end = len(working)
    for index in range(heading_index + 1, len(working)):
        if working[index].startswith("## "):
            section_end = index
            break

    section_text = normalize("\n".join(working[heading_index:section_end]))
    additions: list[str] = []
    for signal in signals:
        normalized_signal = normalize(signal)
        if not normalized_signal:
            continue
        if normalized_signal in section_text:
            continue
        additions.append(f"{prefix}`{signal}`")

    if not additions:
        return working

    insertion = additions + [""]
    working[section_end:section_end] = insertion
    return working


def trim_to_budget(body: str, budget_words: int, protected_signals: list[str]) -> str:
    lines = collapse_blank_lines(body.splitlines())
    protected = [normalize(value) for value in protected_signals if value.strip()]

    def is_protected(line: str) -> bool:
        normalized_line = normalize(line)
        return any(signal and signal in normalized_line for signal in protected)

    while count_words("\n".join(lines)) > budget_words:
        removable: list[tuple[int, int]] = []
        for index, line in enumerate(lines):
            stripped = line.strip()
            if not stripped.startswith("-"):
                continue
            if is_protected(line):
                continue
            removable.append((index, len(line)))

        if not removable:
            break

        removable.sort(key=lambda item: item[1], reverse=True)
        del lines[removable[0][0]]
        lines = collapse_blank_lines(lines)

    return "\n".join(lines).strip() + "\n"


def mutate_skill(
    candidate: str,
    add_signals: list[str],
    add_optional: list[str],
    add_commands: list[str],
    trim_budget: int,
) -> str:
    if not candidate.strip():
        candidate = DEFAULT_SEED_SKILL_PATH.read_text(encoding="utf-8")

    frontmatter, body = split_frontmatter(candidate)
    lines = body.splitlines()

    lines = add_signals_to_section(lines, "## Repository Contracts", add_signals[:16], prefix="- ")
    lines = add_signals_to_section(lines, "## Fast Triage", add_optional[:8], prefix="- ")
    lines = add_signals_to_section(lines, "## Command Playbook", add_commands[:6], prefix="- ")
    lines = collapse_blank_lines(lines)

    merged_body = "\n".join(lines).strip() + "\n"
    trimmed_body = trim_to_budget(merged_body, trim_budget, add_signals + add_commands)

    if frontmatter:
        return frontmatter + trimmed_body
    return trimmed_body


def build_rule_based_reflection_lm(default_budget: int = 520):
    def reflection_lm(prompt: str | list[dict[str, Any]]) -> str:
        prompt_text = prompt_to_text(prompt)
        code_blocks = extract_code_blocks(prompt_text)
        current_candidate = code_blocks[0] if code_blocks else ""

        add_signals = list(dict.fromkeys(re.findall(r"ADD_SIGNAL::([^\n]+)", prompt_text)))
        add_optional = list(dict.fromkeys(re.findall(r"ADD_OPTIONAL::([^\n]+)", prompt_text)))
        add_commands = list(dict.fromkeys(re.findall(r"ADD_COMMAND::([^\n]+)", prompt_text)))

        trim_budget = default_budget
        trim_matches = re.findall(r"TRIM_WORDS::(\d+)", prompt_text)
        if trim_matches:
            trim_budget = min(trim_budget, int(trim_matches[-1]))

        mutated = mutate_skill(
            candidate=current_candidate.strip(),
            add_signals=add_signals,
            add_optional=add_optional,
            add_commands=add_commands,
            trim_budget=trim_budget,
        )
        return f"```\n{mutated.strip()}\n```"

    return reflection_lm


def optimize_core_skill(
    seed_skill: str,
    tasks: list[dict[str, Any]],
    max_metric_calls: int,
    seed: int,
) -> tuple[str, dict[str, Any]]:
    train_tasks = [task for task in tasks if task["split"] == "train"]
    val_tasks = [task for task in tasks if task["split"] == "val"]
    if not train_tasks or not val_tasks:
        raise ValueError("Need both train and val tasks for GEPA generalization mode.")

    reflection_lm = build_rule_based_reflection_lm(default_budget=520)

    def evaluator(candidate: str, example: dict[str, Any]):
        evaluated = evaluate_text_for_task(candidate, example)
        for directive in evaluated["directives"]:
            oa.log(directive)

        side_info = {
            "scores": {
                "quality": evaluated["required_cov"],
                "latency_inv": evaluated["latency_inv"],
                "token_efficiency": evaluated["token_efficiency"],
            },
            "task_id": evaluated["task_id"],
            "category": evaluated["category"],
            "word_count": evaluated["word_count"],
            "missing_required": evaluated["missing_required"],
            "missing_preferred": evaluated["missing_preferred"],
            "feedback": evaluated["feedback"],
        }
        return evaluated["score"], side_info

    objective = (
        "Evolve compact Codex skill packs for UltraModern.js that maximize super-app implementation quality "
        "for project initialization, MF/MFE architecture, Effect BFF flows, TanStack routing, and type safety "
        "while reducing token and latency proxies."
    )
    background = (
        "Prioritize concrete file paths and proto-managed commands with Codex-oriented checklists for "
        "project bootstrap, module federation host/remote contracts, Effect tracing and requestId-scoped BFF "
        "behavior, TanStack route scaffolding, and strong type contract gates."
    )

    result = optimize_anything(
        seed_candidate=seed_skill,
        evaluator=evaluator,
        dataset=train_tasks,
        valset=val_tasks,
        objective=objective,
        background=background,
        config=GEPAConfig(
            engine=EngineConfig(
                max_metric_calls=max_metric_calls,
                seed=seed,
                display_progress_bar=False,
                raise_on_exception=False,
            ),
            reflection=ReflectionConfig(
                reflection_lm=reflection_lm,
                reflection_minibatch_size=3,
            ),
            merge=MergeConfig(
                max_merge_invocations=2,
                merge_val_overlap_floor=2,
            ),
            refiner=None,
        ),
    )

    best_candidate = result.best_candidate
    if isinstance(best_candidate, dict):
        if "current_candidate" in best_candidate:
            best_text = str(best_candidate["current_candidate"])
        elif best_candidate:
            best_text = str(next(iter(best_candidate.values())))
        else:
            best_text = seed_skill
    else:
        best_text = str(best_candidate)

    meta = {
        "best_score": getattr(result, "best_score", None),
        "max_metric_calls": max_metric_calls,
        "seed": seed,
        "train_tasks": len(train_tasks),
        "val_tasks": len(val_tasks),
    }
    return best_text, meta


def load_template_skills(templates_dir: Path) -> dict[str, str]:
    return {
        "init": (templates_dir / "ultramodern-project-init.SKILL.md").read_text(
            encoding="utf-8",
        ),
        "mf": (templates_dir / "ultramodern-mf-microfrontends.SKILL.md").read_text(
            encoding="utf-8",
        ),
        "bff_effect": (templates_dir / "ultramodern-bff-effect.SKILL.md").read_text(
            encoding="utf-8",
        ),
        "routing_types": (
            templates_dir / "ultramodern-tanstack-routing-types.SKILL.md"
        ).read_text(encoding="utf-8"),
        "delivery": (
            templates_dir / "ultramodern-enterprise-delivery.SKILL.md"
        ).read_text(encoding="utf-8"),
    }


def build_split_pack(core_skill: str, templates: dict[str, str]) -> dict[str, str]:
    core_foundation = "\n\n".join(
        [
            core_skill.strip(),
            templates["init"].strip(),
            templates["mf"].strip(),
            templates["routing_types"].strip(),
        ],
    )
    contracts_bundle = "\n\n".join(
        [
            templates["mf"].strip(),
            templates["routing_types"].strip(),
            templates["delivery"].strip(),
        ],
    )
    appdev_bundle = "\n\n".join(
        [
            templates["init"].strip(),
            templates["mf"].strip(),
            templates["routing_types"].strip(),
            templates["bff_effect"].strip(),
        ],
    )
    return {
        "default": core_foundation,
        "core": core_foundation,
        "init": templates["init"],
        "appdev": appdev_bundle,
        "mf": templates["mf"],
        "microfrontend": templates["mf"],
        "bff": templates["bff_effect"],
        "effect": templates["bff_effect"],
        "telemetry": templates["bff_effect"],
        "routing": templates["routing_types"],
        "typesafety": templates["routing_types"],
        "contracts": contracts_bundle,
        "delivery": templates["delivery"],
        "governance": templates["delivery"],
    }


def write_skill_pack(core_skill: str, templates: dict[str, str], skills_dir: Path) -> None:
    targets = {
        "ultramodern-core": core_skill,
        "ultramodern-project-init": templates["init"],
        "ultramodern-mf-microfrontends": templates["mf"],
        "ultramodern-bff-effect": templates["bff_effect"],
        "ultramodern-tanstack-routing-types": templates["routing_types"],
        "ultramodern-enterprise-delivery": templates["delivery"],
    }

    for name, content in targets.items():
        path = skills_dir / name / "SKILL.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content.strip() + "\n", encoding="utf-8")


def report_to_markdown(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# UltraModern gskill Benchmark")
    lines.append("")
    lines.append(f"Generated at: {report['generated_at']}")
    lines.append("")
    lines.append("| Suite | Candidate | Split | Avg Score | Req Cov | Pref Cov | Avg Token Proxy | Avg Words |")
    lines.append("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |")

    for suite_id, suite_payload in report["suites"].items():
        for candidate_name, payload in suite_payload["candidates"].items():
            splits = payload["splits"]
            for split_name in ("train", "val", "test", "overall"):
                summary = splits[split_name]
                lines.append(
                    "| "
                    + f"{suite_id} | {candidate_name} | {split_name} | "
                    + f"{summary['avg_score']:.4f} | "
                    + f"{summary['avg_required_cov']:.4f} | "
                    + f"{summary['avg_preferred_cov']:.4f} | "
                    + f"{summary['avg_token_proxy']:.1f} | "
                    + f"{summary['avg_word_count']:.1f} |",
                )

    lines.append("")
    lines.append("## Overall Across All Suites")
    lines.append("")
    lines.append("| Candidate | Split | Avg Score | Req Cov | Pref Cov | Avg Token Proxy | Avg Words |")
    lines.append("| --- | --- | ---: | ---: | ---: | ---: | ---: |")
    for candidate_name, payload in report["overall"]["candidates"].items():
        splits = payload["splits"]
        for split_name in ("train", "val", "test", "overall"):
            summary = splits[split_name]
            lines.append(
                "| "
                + f"{candidate_name} | {split_name} | "
                + f"{summary['avg_score']:.4f} | "
                + f"{summary['avg_required_cov']:.4f} | "
                + f"{summary['avg_preferred_cov']:.4f} | "
                + f"{summary['avg_token_proxy']:.1f} | "
                + f"{summary['avg_word_count']:.1f} |",
            )

    lines.append("")
    lines.append("## Winners")
    lines.append("")
    for suite_id, suite_payload in report["suites"].items():
        for split_name, winner in suite_payload["winner_by_split"].items():
            lines.append(f"- {suite_id}:{split_name}: {winner}")
    for split_name, winner in report["overall"]["winner_by_split"].items():
        lines.append(f"- overall:{split_name}: {winner}")

    lines.append("")
    return "\n".join(lines)


def write_artifacts(
    artifacts_dir: Path,
    optimized_skill: str,
    optimization_meta: dict[str, Any],
    benchmark_report: dict[str, Any],
) -> None:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "optimized_skill.md").write_text(
        optimized_skill.strip() + "\n",
        encoding="utf-8",
    )
    (artifacts_dir / "optimization_meta.json").write_text(
        json.dumps(optimization_meta, indent=2) + "\n",
        encoding="utf-8",
    )
    (artifacts_dir / "benchmark_report.json").write_text(
        json.dumps(benchmark_report, indent=2) + "\n",
        encoding="utf-8",
    )
    (artifacts_dir / "benchmark_report.md").write_text(
        report_to_markdown(benchmark_report),
        encoding="utf-8",
    )


def print_summary(benchmark_report: dict[str, Any], artifacts_dir: Path) -> None:
    overall = benchmark_report["overall"]
    test_scores = {
        candidate_name: payload["splits"]["test"]["avg_score"]
        for candidate_name, payload in overall["candidates"].items()
    }
    winner = max(test_scores.items(), key=lambda item: item[1])[0] if test_scores else "n/a"

    print("gskill benchmark complete")
    print(f"overall test winner: {winner}")
    for candidate_name, score in sorted(test_scores.items(), key=lambda item: item[1], reverse=True):
        print(f"- {candidate_name}: overall_test_avg_score={score:.4f}")

    for suite_id, suite_payload in benchmark_report["suites"].items():
        suite_scores = {
            candidate_name: payload["splits"]["test"]["avg_score"]
            for candidate_name, payload in suite_payload["candidates"].items()
        }
        suite_winner = max(suite_scores.items(), key=lambda item: item[1])[0] if suite_scores else "n/a"
        print(f"- suite={suite_id} test_winner={suite_winner}")

    print(f"artifacts: {artifacts_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local GEPA gskill for UltraModern.js")
    parser.add_argument(
        "command",
        choices=["optimize", "benchmark"],
        nargs="?",
        default="optimize",
        help="optimize skill then benchmark, or benchmark existing artifacts",
    )
    parser.add_argument(
        "--suite-manifest",
        type=Path,
        default=DEFAULT_SUITE_MANIFEST_PATH,
        help="benchmark suite manifest file",
    )
    parser.add_argument(
        "--tasks",
        type=Path,
        default=None,
        help="optional single benchmark task file override",
    )
    parser.add_argument("--seed-skill", type=Path, default=DEFAULT_SEED_SKILL_PATH)
    parser.add_argument("--templates-dir", type=Path, default=DEFAULT_TEMPLATES_DIR)
    parser.add_argument("--artifacts-dir", type=Path, default=DEFAULT_ARTIFACTS_DIR)
    parser.add_argument("--skills-dir", type=Path, default=DEFAULT_SKILLS_DIR)
    parser.add_argument("--max-metric-calls", type=int, default=120)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--sync-skills", action="store_true")
    parser.add_argument("--no-split-pack", action="store_true")
    return parser.parse_args()


def resolve_benchmark_suites(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.tasks:
        return [
            {
                "id": "custom",
                "description": "custom task file",
                "tasks_file": str(args.tasks),
                "tasks": load_tasks(args.tasks),
            },
        ]
    return load_suites(args.suite_manifest)


def main() -> None:
    args = parse_args()
    suites = resolve_benchmark_suites(args)
    all_tasks = [task for suite in suites for task in suite["tasks"]]
    seed_skill = args.seed_skill.read_text(encoding="utf-8")
    templates = load_template_skills(args.templates_dir)

    optimization_meta: dict[str, Any] = {"mode": args.command, "suite_count": len(suites)}
    optimized_skill: str

    if args.command == "optimize":
        optimized_skill, optimize_meta = optimize_core_skill(
            seed_skill=seed_skill,
            tasks=all_tasks,
            max_metric_calls=args.max_metric_calls,
            seed=args.seed,
        )
        optimization_meta.update(optimize_meta)
    else:
        optimized_path = args.artifacts_dir / "optimized_skill.md"
        if optimized_path.exists():
            optimized_skill = optimized_path.read_text(encoding="utf-8")
        else:
            optimized_skill = seed_skill
            optimization_meta["note"] = "optimized artifact missing; falling back to seed skill"

    candidates: dict[str, str | dict[str, str]] = {
        "baseline_none": "",
        "baseline_seed": seed_skill,
        "gepa_optimized_core": optimized_skill,
    }
    if not args.no_split_pack:
        candidates["gepa_optimized_split_pack"] = build_split_pack(
            optimized_skill,
            templates,
        )

    benchmark_report = benchmark_across_suites(candidates, suites)
    write_artifacts(
        artifacts_dir=args.artifacts_dir,
        optimized_skill=optimized_skill,
        optimization_meta=optimization_meta,
        benchmark_report=benchmark_report,
    )

    if args.sync_skills:
        write_skill_pack(
            core_skill=optimized_skill,
            templates=templates,
            skills_dir=args.skills_dir,
        )

    print_summary(benchmark_report, args.artifacts_dir)


if __name__ == "__main__":
    main()
