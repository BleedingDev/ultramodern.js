author: codex
timestamp: 2026-04-19T09:18:18Z
ticket_id: modernjs-2ko
commit_sha: 974b6e95ce48-dirty
workflow_run_url: local://modernjs-2ko/release-contract-gates

# Architecture Evidence

- Scope: extend release-contract gates to cover stronger-default Modern.js positioning and starter baseline artifacts.
- Decision: treat public stronger-default docs, starter README/workflow surface, and sandpack starter sync as release-gated contract targets.
- Rationale: stricter defaults without auditable docs/starter gates read like an ungoverned fork instead of governed Modern.js defaults.
- Compatibility: defaults remain opt-out via baseline env switches, while React Router and Hono stay explicit compatibility lanes.
