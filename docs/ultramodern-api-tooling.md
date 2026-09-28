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

Workspace-specific source policy plugs in with `--rules <module>` (repeatable).
The module default-exports an array of rules. Each rule runs once per TypeScript
or JavaScript file under `apps/`, `verticals/` and `packages/`, and receives
`{ file, module, graph }`; every string it returns is a consumer diagnostic. A
file that does not parse is a diagnostic too. `module.file` is the Babel AST and
`graph` is shared by every rule and file, so each module is parsed once.

- `graph.resolve(module, name, 'local' | 'export')` follows imports, re-exports
  and public workspace package exports to an unmutated `const` `declaration`,
  or to an `external` package binding. Each result's `chain` lists every module
  and name it passed through. Private package subpaths, cycles and mutated
  bindings stay unresolved.
- `graph.evaluate(module, expression)` returns every value an expression can
  have. It follows any binding kind, destructuring, member access into object
  literals, member writes (`obj.key = value`), reassignments, conditionals and
  calls into workspace functions through their returns. A value is an
  `external` package binding with the member path read from it, a workspace
  `node`, or `unresolved`. Within a module, writes count whether they go through an alias, a
  destructured or returned value, or a literal or call that holds the value.
  A value that reaches an unknown function is `unresolved` if the module
  writes through any name the analysis does not track. Writes are tracked
  per module: writes made by importing modules, or by an imported workspace
  function through a value passed to it, are not tracked.
- `graph.reachable(module, expression)` evaluates every reference inside an
  expression and walks each workspace node it reaches, across modules. It
  returns the `external` and `unresolved` values it finds.

```js
// api-rules.mjs
import { traverseFast, isCallExpression } from '@babel/types';

const isUnknown = value =>
  value.kind === 'external' &&
  value.specifier === 'effect' &&
  value.name === 'Schema' &&
  value.members[0] === 'Unknown';

export default [
  ({ module, graph }) => {
    const messages = [];
    traverseFast(module.file, node => {
      if (
        isCallExpression(node) &&
        node.arguments.some(argument =>
          graph.reachable(module, argument).some(isUnknown),
        )
      )
        messages.push(`Schema.Unknown reaches line ${node.loc.start.line}`);
    });
    return messages;
  },
];
```

Generated `api:check` uses the full command. The aggregate generated pipeline uses
the files command after its existing topology validation. Run `pnpm check` once for aggregate static validation; its API-file and contract
stages already cover that pipeline. Use `pnpm api:check` separately to diagnose
API failures. Running ordinary lint alone does not replace the full API check.
