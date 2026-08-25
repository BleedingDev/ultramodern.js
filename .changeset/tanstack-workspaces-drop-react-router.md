---
'@modern-js/create': patch
---

Default generated TanStack workspaces no longer depend on `react-router`. Module Federation now runs `@module-federation/bridge-react`'s router-free base entry via `bridge.enableBridgeRouter: false`, with TanStack Router as the application router. React Router support remains dependency-driven: declaring `react-router` (or `react-router-dom`) as a direct dependency of an app marks it a React Router consumer, so the generator/migration emit `enableBridgeRouter: true` for that app's federation config and the workspace validator accepts it. Existing generated workspaces migrate via the generated-tooling migration, and the generated workspace validator now requires the correct value for each app instead of rejecting the opt-in.
