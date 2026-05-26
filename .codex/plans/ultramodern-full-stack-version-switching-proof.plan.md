---
name: Ultramodern Full Stack Version Switching Proof
overview: Prove with live or tightly simulated evidence that changing a full-stack micro-vertical version or environment switches its UI and owned Effect/BFF behavior together on Zephyr, then define the later Zerops long-running Node deployment proof.
todos:
  - id: define-proof-matrix
    content: "Define the exact version-switching matrix for v1 and v2 vertical packages, covering UI marker, Effect/BFF response marker, MF manifest URL, Zephyr dependency selector, and environment override behavior."
    status: completed
  - id: build-local-simulation-first
    content: "Create a local deterministic proof using generated workspaces or fixtures where shell switches between two vertical manifests and verifies both UI and API behavior move together."
    status: completed
  - id: capture-zephyr-live-build-evidence
    content: "Run the authenticated Zephyr proof with shell plus full-stack vertical v1 and v2, capturing build logs, application UIDs, version IDs, environment labels, manifests, and deployment URLs."
    status: pending
  - id: verify-runtime-switching
    content: "Use browser or HTTP assertions to verify the host environment loads the selected vertical UI and calls the matching owned Effect/BFF endpoint for each selected version."
    status: completed
  - id: document-switching-operations
    content: "Document how to switch versions through zephyr:dependencies selectors, environment overrides, Zephyr dashboard/API, and any CLI path that Zephyr supports."
    status: completed
  - id: define-zerops-node-proof
    content: "Add a Zerops proof design for a long-running Node deployment of the same full-stack vertical package using zerops.yaml, start command, readiness check, artifact rollback, and scaling semantics."
    status: completed
  - id: archive-evidence-and-add-regression-hook
    content: "Store sanitized evidence and add an opt-in regression command or CI job that can rerun local simulation and live Zephyr proof when credentials are present."
    status: pending
isProject: true
---

# Ultramodern Full Stack Version Switching Proof

## Execution Notes

Source Bead: `modernjs-hjgv`.

This proof depends on the full-stack package implementation. The proof must demonstrate the actual goal: changing a micro-vertical version changes both frontend and backend-owned behavior. A UI-only remote switch is not sufficient.

Required proof matrix:

| Selector | Expected UI marker | Expected API marker | Evidence |
| --- | --- | --- | --- |
| `workspace:*` on matching branch/context | vertical build from same workspace context | Effect/BFF response from same package build | Zephyr resolved dependency manifest and runtime assertion |
| `@latest` or equivalent moving tag | latest tagged vertical UI | latest tagged vertical API behavior | Zephyr version/tag metadata and runtime assertion |
| exact version, for example `@1.2.3` | exact vertical UI | exact vertical API behavior | Zephyr version ID and runtime assertion |
| environment override, for example staging vs production | environment-selected UI | environment-selected API behavior | environment override config and runtime assertion |

External API and docs evidence:

- Zephyr remote dependencies docs define `zephyr:dependencies`, local alias mapping, Application UID shape, selectors, workspace resolution, build context, and platform-specific resolution.
- Zephyr environment overrides docs state remote dependency overrides can select different versions, tags, or environments at runtime without rebuilding the host.
- Zephyr SSR Worker docs currently say SSR Worker is beta and Cloudflare-only. That constrains the immediate Cloudflare/Zephyr proof.
- Zerops Node deploy docs say a built artifact is stored and reused for new containers, scaling, and automatic restarts; deployments start the app with a configured start command and can use readiness checks.
- Zerops build pipeline docs define `zerops.yaml`, Node bases including `nodejs@24`, `nodejs@22`, `nodejs@20`, build commands, deploy files, runtime ports, and start command.

Repo evidence to use:

- Shell remote references are generated from environment variables such as `REMOTE_*_MF_MANIFEST` with local fallbacks in `packages/toolkit/create/src/ultramodern-workspace.ts:1147`.
- Shell `zephyr:dependencies` is generated in `packages/toolkit/create/src/ultramodern-workspace.ts:807`.
- Current development overlays separate remote manifests and service URLs; this must become a full-stack vertical overlay in the implementation plan.

## Constraints

- Do not claim live proof from local-only simulation. Local simulation is a prerequisite, not the final Zephyr proof.
- Do not depend only on Zephyr GUI screenshots. Capture machine-readable data where possible: package JSON, build logs, manifest URLs, environment selector values, HTTP responses, and browser assertions.
- Do not bake Cloudflare Worker-only code paths into the vertical package. Zerops needs long-running Node compatibility later.
- If Zephyr has no public CLI/API for one operation, document the browser or dashboard step explicitly and capture before/after machine-readable runtime evidence.

## Operator Guidance

The local proof should be executable by anyone. The live proof can be opt-in because it needs Zephyr credentials. Use clear markers:

- UI v1 marker: `commerce-ui-version:v1`
- API v1 marker: `commerce-api-version:v1`
- UI v2 marker: `commerce-ui-version:v2`
- API v2 marker: `commerce-api-version:v2`

The runtime assertion should fail if the UI is v2 but the API still returns v1, or vice versa. That is the regression this architecture is meant to prevent.

Suggested commands and APIs:

```bash
pnpm --dir <generated-workspace> build
curl -fsS "$VERTICAL_ORIGIN/mf-manifest.json"
curl -fsS "$SHELL_ORIGIN/<route-that-calls-vertical-api>"
gh api repos/module-federation/core/releases/latest --jq '{tag_name,published_at,html_url}'
```

For Zerops, the proof design should include a `zerops.yaml` shape with `buildCommands`, `deployFiles`, `run.ports`, `run.start`, and readiness check behavior, then validate it against current Zerops Node docs before implementation.
