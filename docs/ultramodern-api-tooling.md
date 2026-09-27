# Packaged MicroVertical API tooling

Generated shared API contracts import their common readiness and error definitions
from `@modern-js/bff-effect/microvertical-api`. The dependency belongs to the
generated workspace and API packages. Business endpoints and API metadata remain
in the application. Existing CRUD and cart operation IDs keep their public values.

`@modern-js/code-tools` supplies two commands:

| Command | Validation |
| --- | --- |
| `modern-api-check` | Consumer API files and the workspace runtime topology |
| `modern-api-check-files` | Consumer API files, for a pipeline that already validates runtime topology |

Both commands accept `--workspace-root <directory>`. Exit status is `0` for valid
input, `1` for consumer diagnostics and `2` for a tooling failure. The checker
resolves the installed BFF owner and public exports, then checks the consumer's
reachable endpoint composition using bounded analysis in the current process.
It does not start the TypeScript native compiler.

Workspace-specific contract policy plugs in with `--rules <module>` (repeatable).
The module default-exports an array of rules. Each rule runs once per API app and
receives `{ appPath, protocol, graph }`; every string it returns is a consumer
diagnostic. `graph.root` is the parsed shared contract, and
`graph.resolve(module, name, 'local' | 'export')` follows imports, re-exports and
public workspace package exports to a `declaration`, or to an `external` package
binding. Each result's `chain` lists every module and name it passed through.
Private package subpaths, cycles and mutated bindings stay unresolved.

```js
// api-rules.mjs
export default [
  ({ graph }) =>
    graph.resolve(graph.root, 'Schema', 'local')?.kind === 'external'
      ? []
      : ['Schema must come from a package, not a local shadow'],
];
```

Generated `api:check` uses the full command. The aggregate generated pipeline uses
the files command after its existing topology validation. Run `pnpm check` once for aggregate static validation; its API-file and contract
stages already cover that pipeline. Use `pnpm api:check` separately to diagnose
API failures. Running ordinary lint alone does not replace the full API check.
