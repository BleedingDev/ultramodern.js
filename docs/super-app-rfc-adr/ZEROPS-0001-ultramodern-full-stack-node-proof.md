# ZEROPS-0001: UltraModern Full-Stack Node Proof Design

- Status: Proposed
- Date: 2026-05-26
- Related Plan: `.codex/plans/ultramodern-full-stack-version-switching-proof.plan.md`
- Related:
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`
  - `PREFLIGHT-0001-ultramodern-superapp-readiness.md`

## 1. Purpose

This document defines the later Zerops proof for deploying the same generated full-stack Micro Vertical package as a long-running Node service.

The proof is not a replacement for the current Zephyr version-switching proof. Zephyr remains responsible for Module Federation remote version resolution in this phase. Zerops proves that the selected full-stack vertical package can also run as a durable Node deployment where the package-owned UI build outputs and Effect BFF behavior come from one built artifact.

## 2. Boundary Under Test

The full-stack package boundary is the generated vertical package, for example `apps/remotes/remote-commerce`.

That package owns:

1. the Modern.js Module Federation remote build, including `mf-manifest.json` and browser-safe exposed modules.
2. the Effect BFF implementation under the same package.
3. the package-local Effect contract and typed client.
4. one version marker emitted by both the UI route/widget and the BFF response.

The Zerops proof must treat that package as one deployable unit. It must not split the default vertical-owned API into `services/*`, and it must not let the shell hardcode a backend URL that can drift from the selected remote version.

## 3. `zerops.yaml` Shape

Generated full-stack workspaces should emit one Node service for the shell and one Node service for each full-stack vertical that needs long-running server behavior. The service names below are placeholders; each `setup` value must match an existing Zerops runtime service hostname.

```yaml
zerops:
  - setup: shell-super-app
    build:
      base: nodejs@22
      buildCommands:
        - |
          curl https://mise.run | sh
          ~/.local/bin/mise install
          ~/.local/bin/mise exec -- pnpm install --frozen-lockfile
          ~/.local/bin/mise exec -- pnpm --filter @acme/shell-super-app build
          ~/.local/bin/mise exec -- pnpm --filter @acme/shell-super-app deploy --prod .zerops/runtime/shell-super-app
          cp topology/zephyr-version-boundary.json .zerops/runtime/shell-super-app/topology.json
      deployFiles:
        - .zerops/runtime/shell-super-app
    deploy:
      temporaryShutdown: false
      readinessCheck:
        httpGet:
          port: 8080
          path: /healthz
        failureTimeout: 120
        retryPeriod: 10
    run:
      base: nodejs@22
      ports:
        - port: 8080
          protocol: TCP
          httpSupport: true
      envVariables:
        NODE_ENV: production
        SHELL_SUPER_APP_PORT: '8080'
      start: cd .zerops/runtime/shell-super-app && npm run serve

  - setup: remote-commerce
    build:
      base: nodejs@22
      buildCommands:
        - |
          curl https://mise.run | sh
          ~/.local/bin/mise install
          ~/.local/bin/mise exec -- pnpm install --frozen-lockfile
          ~/.local/bin/mise exec -- pnpm --filter @acme/remote-commerce build
          ~/.local/bin/mise exec -- pnpm --filter @acme/remote-commerce deploy --prod .zerops/runtime/remote-commerce
          cp topology/zephyr-version-boundary.json .zerops/runtime/remote-commerce/version-boundary.json
      deployFiles:
        - .zerops/runtime/remote-commerce
    deploy:
      temporaryShutdown: false
      readinessCheck:
        httpGet:
          port: 8081
          path: /commerce-api/healthz
        failureTimeout: 120
        retryPeriod: 10
    run:
      base: nodejs@22
      ports:
        - port: 8081
          protocol: TCP
          httpSupport: true
      envVariables:
        NODE_ENV: production
        REMOTE_COMMERCE_PORT: '8081'
      start: cd .zerops/runtime/remote-commerce && npm run serve
```

Required generator semantics:

1. `build.buildCommands` run the workspace install, package build, and a package-pruned runtime materialization step in one shell block.
2. `build.deployFiles` includes only the runtime directory produced for the target package, not the entire monorepo checkout.
3. `run.start` starts the generated Modern.js server from the deployed runtime directory.
4. `run.ports` exposes the exact internal port used by the generated Modern.js server.
5. `deploy.readinessCheck` is an HTTP deployment readiness probe. It gates traffic for a new deployment; it is not the continuous runtime health check.
6. `temporaryShutdown: false` keeps the default replacement behavior where new containers become ready before old containers are drained.

The generated vertical must provide the readiness path used above. For `remote-commerce`, `/commerce-api/healthz` should return `2xx` only after the server can serve the current package's Effect BFF route and static/MF assets. The response body should include the package name, package version, git SHA, Zephyr version selector or version ID, and Zerops application version ID when available.

## 4. Version Boundary

The same full-stack package version boundary is preserved by producing one signed version-boundary record per vertical build:

```json
{
  "packageName": "@acme/remote-commerce",
  "packageVersion": "1.4.0",
  "gitSha": "0123456789abcdef",
  "zephyr": {
    "applicationUid": "remote-commerce.super-app.acme",
    "selector": "remote-commerce@1.4.0",
    "versionId": "zephyr-version-id"
  },
  "zerops": {
    "service": "remote-commerce",
    "applicationVersionId": "zerops-application-version-id"
  },
  "markers": {
    "ui": "commerce-v1.4.0",
    "effectBff": "commerce-v1.4.0"
  }
}
```

The shell may select a vertical through `workspace:*`, a moving tag, an exact version, or an environment override, but the selected record must always map the UI marker and Effect BFF marker to the same generated package build.

For the current Zephyr phase:

1. Zephyr resolves the shell's Module Federation remotes through `zephyr:dependencies`, Zephyr version selectors, and environment-level overrides.
2. The shell loads MF manifests from Zephyr-published remote versions; runtime-computed remote URLs remain outside the profile.
3. The Zerops service origin is selected through topology/environment metadata keyed by the same vertical selector or version-boundary record.
4. The live assertion must compare the Zephyr-loaded UI marker with the Zerops-served Effect BFF marker for the same vertical selector.

Zerops does not own MF remote resolution in this phase. Its role is long-running Node execution, artifact retention, restart behavior, readiness-gated replacement, archived-version restore, and scaling of the built full-stack package.

## 5. Rollback And Scaling Semantics

Zerops stores a built application artifact after the build phase. New runtime containers download that artifact when a new version is deployed, when the service scales horizontally, or when a failed container is replaced automatically.

The proof should capture:

1. the `zerops.yaml` used for the selected version.
2. the build log and deployed runtime artifact file list.
3. the active Zerops application version for the vertical service.
4. readiness probe success for `/commerce-api/healthz`.
5. HTTP evidence that the BFF marker matches the selected Zephyr remote marker.
6. restore evidence showing an archived Zerops version can be reactivated and still reports the matching package marker.
7. scaling evidence showing each active container reports the same package marker and does not use local filesystem state for sessions or cross-container workflow state.

Production-like multi-container proof requires the generated full-stack vertical to be stateless or to use external stores for state that must survive container replacement. Local files inside a runtime container are not a valid cross-container coordination mechanism.

## 6. Acceptance Criteria

The Zerops Node proof is complete when all are true:

1. the generated `zerops.yaml` contains `build.buildCommands`, `build.deployFiles`, `run.start`, `run.ports`, and `deploy.readinessCheck` for shell and full-stack vertical services.
2. each full-stack vertical service starts as a Node runtime and serves both Modern.js UI/MF assets and its owned Effect BFF endpoints from the same deployed runtime artifact.
3. the shell's Zephyr-selected UI marker and the vertical's Zerops-served BFF marker match for each tested selector.
4. archived-version restore and horizontal replacement evidence show the same built artifact is reused for restarted or scaled containers.
5. the proof records that Zephyr still owns MF remote resolution and Zerops owns only the long-running Node deployment of the generated package artifact.

## 7. References

- Zerops YAML specification: https://docs.zerops.io/zerops-yaml/specification
- Zerops Node.js build and deploy pipeline: https://docs.zerops.io/nodejs/how-to/build-pipeline
- Zerops Node.js deploy process: https://docs.zerops.io/nodejs/how-to/deploy-process
- Zerops Node.js scaling: https://docs.zerops.io/nodejs/how-to/scaling
- Zephyr remote dependencies: https://docs.zephyr-cloud.io/features/remote-dependencies
- Zephyr environment-level overrides: https://docs.zephyr-cloud.io/features/environment-overrides
- Zephyr versions: https://docs.zephyr-cloud.io/features/versions
