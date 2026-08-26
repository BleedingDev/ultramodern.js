// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import path from 'path';
import { toPosixPath } from './files';

// `generateClient` emits `export default createRequest(...)` only when the
// handler declares a default export, so the generated client `.js` is an exact
// signal for whether the facade needs a `default` re-export.
export const DEFAULT_EXPORT_RE = /(^|[\s;])export\s+default\b/;

const missingClientDeclarationCause = Symbol('MissingClientDeclarationError');

export function createMissingClientDeclarationError(
  resourcePath: string,
  expectedDeclaration: string,
) {
  const error = new Error(
    `[plugin-bff] No declaration was emitted for "${resourcePath}", so the published client type for it cannot be generated (expected "${expectedDeclaration}"). Enable "declaration": true in the server tsconfig used by this app.`,
    { cause: missingClientDeclarationCause },
  );
  error.name = 'MissingClientDeclarationError';
  return error;
}

export const isMissingClientDeclarationError = (error: unknown) =>
  error instanceof Error && error.cause === missingClientDeclarationCause;

/**
 * Build the `.d.ts` that sits next to a generated client module.
 *
 * The published client re-exports the handler's own declaration instead of
 * copying it. A verbatim copy landed the `.d.ts` one directory shallower than
 * the compiler emitted it (`dist/client/*` vs `dist/<lambda>/*`), breaking
 * every relative specifier inside. A facade leaves the original declarations in
 * place (relative refs intact, and published via `**\/*.d.ts`) and only points
 * at them.
 */
export function buildClientTypeFacade(
  clientTypesFile: string,
  originTypesFile: string,
  hasDefaultExport: boolean,
  esm = false,
): string {
  const originNoExt = originTypesFile.replace(/\.d\.ts$/, '');
  let specifier = toPosixPath(
    path.relative(path.dirname(clientTypesFile), originNoExt),
  );
  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }
  // Native ESM (`node16`/`nodenext`) requires an explicit extension in the
  // re-export specifier, matching the `.js` the declaration emit produces; TS
  // resolves `./x.js` back to `./x.d.ts`.
  if (esm) {
    specifier = `${specifier}.js`;
  }

  const lines: string[] = [];
  // `export *` never carries the default binding, so re-export it explicitly.
  if (hasDefaultExport) {
    lines.push(`export { default } from '${specifier}';`);
  }
  lines.push(`export * from '${specifier}';`);
  return `${lines.join('\n')}\n`;
}
