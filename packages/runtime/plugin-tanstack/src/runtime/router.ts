/**
 * Entry-injected router module for entrypoints that are NOT TanStack
 * file-route entrypoints (e.g. apps configuring
 * `router: { framework: 'tanstack', createRoutes }` in modern.runtime.ts).
 *
 * The CLI plugin injects `{ name: 'router', path: '<pkg>/runtime/router' }`
 * for those entries, so the generated entry code value-imports `routerPlugin`
 * from here. That single import both installs the framework-resolving router
 * plugin of @modern-js/runtime AND registers the TanStack router provider
 * (the './register' side effect) — the registration can therefore never be
 * tree-shaken away from the entry that needs it.
 */
import './register';

export { routerPlugin } from '@modern-js/runtime/router/internal';
