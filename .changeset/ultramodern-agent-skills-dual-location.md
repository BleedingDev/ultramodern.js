---
'@modern-js/ultramodern-create': patch
---

Accept the agent skills lockfile and license under either `.agents/` (preferred) or `.codex/` (legacy) in generated workspaces: the postinstall bootstrap script and the generated validator now resolve both locations instead of hardcoding `.codex/skills-lock.json`, so consumers on the agents-standard `.agents/` layout no longer fail validation permanently.
