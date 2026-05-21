---
name: Ultramodern Readiness 03 Request Operation Context
overview: Design neutral request and operation context primitives for generated SuperApps so trace, locale, operation id, session claims, and application-defined scope can flow safely across shell, remotes, BFF handlers, and Effect services without implementing app-specific auth or ERP permissions.
todos:
  - id: audit-existing-request-context
    content: Audit existing Modern.js request context utilities, BFF runtime context handling, and generated workspace behavior to identify reusable primitives before adding new surface.
    status: pending
  - id: define-neutral-operation-context
    content: Define a minimal domain-neutral OperationContext shape covering trace id, operation id, locale, request source, optional session claims, and app-defined scope.
    status: pending
  - id: design-effect-layer-access
    content: Design how Effect BFF handlers and services access operation context through an Effect service or Layer without passing loose ids through every function.
    status: pending
  - id: define-propagation-rules
    content: Specify which context fields are server-derived, which may be propagated by clients, and which must never be trusted from arbitrary request body or query parameters.
    status: pending
  - id: plan-context-tests
    content: Plan tests proving generated handlers receive context, logs/spans include context, and unsafe client-supplied scope does not override server-derived context.
    status: pending
isProject: true
---

# Ultramodern Readiness 03 Request Operation Context

## Execution Notes

This is a primitive layer, not an auth system. The goal is to stop generated SuperApps from passing `tenantId`, `companyId`, `userId`, `locale`, and `traceId` as random loose parameters. UltraModern should provide a safe pipe for context, while the application decides what auth, tenant, role, account, or company means.

## Constraints

- Do not implement login, RBAC, ABAC, user management, or ERP permissions.
- Do not define company hierarchy, accounting scope, or business roles.
- Keep authoritative scope server-derived.
- Keep the client propagation surface limited to correlation and safe metadata.

## Operator Guidance

Start by reusing existing Modern.js request context and BFF primitives. Add only the minimum generated pattern needed for Effect services and remotes to preserve operation context consistently.
