# ADR-0013: Micro Vertical Design-System Platform Contract

- Status: Proposed
- Date: 2026-04-28
- Depends on:
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`

## 1. Context

Micro Verticals need a stable design-system contract without turning the app shell into a design-system dependency or baking one vendor's component model into framework core.

The delivery model separates shell, remote vertical, and service boundaries. Design-system ownership must follow the same rule:

1. framework core exposes neutral platform contracts.
2. internal monorepo design systems can provide first-party packages.
3. horizontal design-system remotes can be composed through Module Federation when independent deployment is required.
4. third-party design systems are adapters, not framework primitives.

## 2. Decision

Adopt a vendor-neutral design-system platform contract for Micro Verticals.

The contract defines required behavior and integration surfaces, not a specific component library. A design-system provider is compliant when it can supply tokens, theme hooks, accessibility defaults, and SSR-safe rendering behavior through one of the approved provider models.

Approved provider models:

1. internal monorepo design-system package.
2. horizontal design-system remote exposed through Module Federation.
3. third-party adapter package that maps an external design system into the platform contract.

The shell owns brand, layout frame, and cross-vertical interaction grammar. Remotes own feature composites. Shared design-system packages expose tokens, primitives, and neutral interaction patterns only.

## 3. Contract Surface

### 3.1 Tokens

Every provider must expose a typed token surface with:

1. color roles for foreground, background, border, focus, status, and data visualization.
2. typography roles for body, heading, label, code, and numeric text.
3. spacing, radius, elevation, motion, and z-index scales.
4. density and viewport breakpoints.
5. semantic aliases that can be themed without changing component imports.

Tokens must be serializable for build-time extraction and runtime hydration. Providers must not require app code to import raw vendor theme internals.

### 3.2 Theme Hooks

Every provider must expose hooks or equivalent runtime APIs for:

1. current theme identity.
2. color mode.
3. density mode.
4. locale and text direction.
5. high-contrast or reduced-motion preferences.
6. scoped theme overrides for remote verticals.

Theme APIs must degrade when shell context is unavailable. A remote must render with its declared default theme rather than fail because the shell provider is missing.

### 3.3 Accessibility Baseline

Every provider must meet the platform accessibility baseline:

1. focus-visible treatment for all interactive primitives.
2. keyboard operation for menus, dialogs, tabs, disclosure, and navigation primitives.
3. ARIA naming and relationship support where native HTML is insufficient.
4. reduced-motion behavior for animated primitives.
5. contrast-safe token defaults for text, focus, status, and destructive actions.
6. SSR-stable ids for components that require generated ids.

Feature composites remain owned by the vertical that ships them, but they must compose compliant primitives or document equivalent accessibility evidence.

### 3.4 SSR and Hydration

Every provider must support Modern.js SSR and hydration boundaries:

1. deterministic token serialization from server to client.
2. no hydration-visible theme mismatch for color mode, density, direction, or locale.
3. no reliance on browser-only APIs during server render.
4. stable CSS insertion order across shell and remote renders.
5. compatibility with remote fallback UI when a design-system remote is unavailable.

Module Federation remotes must declare the design-system contract version they were built against. The shell may reject or degrade a remote that requires an incompatible design-system contract.

## 4. Provider Models

### 4.1 Internal Monorepo Design System

Use this model when teams share one release train or when the design system is a repository-local platform package.

Rules:

1. expose tokens and primitives through versioned packages.
2. keep business workflow components out of shared design-system packages.
3. publish compatibility notes when token names or component behavior change.

### 4.2 Horizontal Design-System Remote

Use this model when the design system needs independent deployment or when multiple shells consume the same runtime provider.

Rules:

1. expose only platform primitives, providers, token runtime, and neutral assets.
2. include remote trust metadata and compatibility digest.
3. provide fallback tokens and primitives for shell-side degradation.
4. avoid coupling shell route ownership to the design-system remote.

### 4.3 Third-Party Adapters

Use this model when adopting a vendor or open-source design system.

Rules:

1. wrap vendor tokens into the platform token surface.
2. adapt theme APIs into the required hook contract.
3. document accessibility gaps and compensating controls.
4. prevent vendor package semantics from becoming framework-core behavior.

## 5. Boundary Rules

1. Framework core may define contracts, validation hooks, SSR safety requirements, and compatibility metadata.
2. Framework core must not depend on a concrete vendor component package.
3. Module layer may build domain composites on top of compliant primitives.
4. External integration layer may contain vendor-specific adapters.
5. Remotes must not expose feature composites as shared platform primitives.

## 6. Validation Expectations

Certification evidence for a design-system provider should include:

1. token export snapshot.
2. SSR and hydration proof for shell and remote render paths.
3. accessibility baseline evidence for primitives.
4. contract version and compatibility metadata.
5. fallback behavior for missing shell context or unavailable horizontal remote.

## 7. Consequences

Positive:

1. Micro Verticals can share a design language without sharing a full shell dependency.
2. teams can adopt internal, remote, or third-party design systems behind one contract.
3. framework core remains domain-neutral and vendor-neutral.

Tradeoff:

1. adapters add maintenance overhead.
2. horizontal design-system remotes need the same trust and compatibility discipline as feature remotes.
3. token and accessibility evidence must be kept current as providers evolve.

## 8. Acceptance Criteria

1. the design system platform contract is vendor-neutral.
2. the contract covers token surfaces, theme hooks, accessibility baseline, SSR behavior, and hydration behavior.
3. the contract supports internal monorepo design systems, horizontal Module Federation design-system remotes, and third-party adapters.
4. provider validation expectations include token, accessibility, SSR, hydration, compatibility, and fallback evidence.
