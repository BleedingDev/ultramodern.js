# UltraModern native app tools

`ultramodernAppTools()` composes UltraModern features through Modern.js CLI,
runtime and server plugins. Modern.js configuration fields, plugin APIs, route
objects and lifecycle hooks remain available to applications.

Generated workspace applications declare their identity and authored options:

```ts
import { defineConfig } from '@modern-js/app-tools';
import {
  presetUltramodernWorkspace,
  ultramodernAppTools,
} from '@modern-js/ultramodern-app-tools';

export default defineConfig(
  presetUltramodernWorkspace(
    {
      html: { title: 'Catalog' },
      plugins: [ultramodernAppTools()],
    },
    { appId: 'catalog', from: import.meta.url },
  ),
);
```

The workspace preset reads `topology/reference-topology.json` and
`topology/local-overlays/development.json` relative to that config. Those records
provide app identity, development ports, composed remote references and delivery
unit identity. Adding a shell or vertical changes the records; existing
application configs keep their authored contents.

The native package resolves build output and cache directories, remote asset
origins, canonical site origins, local CORS and Cloudflare service bindings and
fragment routes. Deploy target selection uses Modern.js's native resolver.
`deployTarget` and `environment` options allow explicit programmatic build inputs.
`createPresetUltramodernWorkspaceConfig(options)` exposes the resolved config for
inspection.

Cloudflare fragment bindings use the expose names from each remote's authored
Module Federation config. The shared config inspector accepts literal objects
and string arrays. Dynamic declarations use Modern.js's native config loader
during config resolution, including async functions, environment and command
arguments. Authored worker settings and services remain part of the merged
config; dynamic bindings use the loaded exposes.

The old generated `performance.rsdoctor` setting was not part of Modern.js's
supported config and had no effect. The native preset omits it.

Zephyr registers only for browser applications. It loads the application's
declared `zephyr-rspack-plugin` only when `ZE_CI_TOKEN` is present, and requires
`ZE_FAIL_BUILD=true` in that deploy environment. Ordinary builds require no
Zephyr account. The preset does not mutate environment variables.
The Zephyr SDK reads credentials and its fail-build flag from `process.env`.
When supplying `environment` explicitly, enabled Zephyr inputs must match those
process values; a mismatch fails during plugin setup before registration.

Authored config merges after native policy. Scalars and `false` override defaults;
nested records are preserved; arrays and hooks compose in preset-first order.
The existing typed preset options, including `enableTelemetry`,
`enableTelemetryExporters`, `enableBffRequestId` and
`enableModuleFederationSSR`, also apply to workspace presets.

Standalone applications can continue using `presetUltramodern(config, options)`.
Both `appTools()` and `ultramodernAppTools()` keep the fork's default renderer and
server behavior. Pass `rendererExtensions: false` or `serverExtensions: false`
to the plugin factory to opt out of either policy.
