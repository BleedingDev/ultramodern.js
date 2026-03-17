# UltraModern gskill

This folder contains a local GEPA-powered `gskill` workflow for UltraModern.js, focused on Codex agent skills.

## Commands

- Ensure proto-managed tools are installed:
  - `proto install`
- Optimize + benchmark + sync skill pack:
  - `proto run pnpm -- gskill:codex`
- Re-run benchmarks from saved artifacts:
  - `proto run pnpm -- gskill:benchmark:codex`
- Run runtime model-in-the-loop benchmark via Codex CLI:
  - `proto run pnpm -- gskill:benchmark:codex-runtime`

Direct Python usage:

- `python3 scripts/gskill/run_gskill.py optimize --sync-skills --skills-dir .codex/skills`
- `python3 scripts/gskill/run_gskill.py benchmark`
- `python3 scripts/gskill/benchmark_codex_runtime.py --runtime-bin codex-native --model gpt-5.3-codex-spark --split test`

Benchmark suite manifest:

- `scripts/gskill/benchmark_suites.json`
- Codex bootstrap focus: `scripts/gskill/benchmark_tasks_codex_bootstrap.json`
- Foundation contracts: `scripts/gskill/benchmark_tasks.json`
- Super-app development: `scripts/gskill/benchmark_tasks_superapp_dev.json`
- Enterprise delivery: `scripts/gskill/benchmark_tasks_enterprise_delivery.json`

## Outputs

- `scripts/gskill/artifacts/optimized_skill.md`
- `scripts/gskill/artifacts/benchmark_report.json`
- `scripts/gskill/artifacts/benchmark_report.md`
- `scripts/gskill/artifacts/benchmark_codex_runtime_<runtime>_<model>_<split>.json`
- `scripts/gskill/artifacts/benchmark_codex_runtime_<runtime>_<model>_<split>.md`
- `.codex/skills/ultramodern-core/SKILL.md`
- `.codex/skills/ultramodern-project-init/SKILL.md`
- `.codex/skills/ultramodern-mf-microfrontends/SKILL.md`
- `.codex/skills/ultramodern-bff-effect/SKILL.md`
- `.codex/skills/ultramodern-tanstack-routing-types/SKILL.md`
- `.codex/skills/ultramodern-enterprise-delivery/SKILL.md`
