import { createRequire } from 'node:module';
import type { PluginTypeCheckerOptions } from '@rsbuild/plugin-type-check';

type TsCheckerChain = NonNullable<PluginTypeCheckerOptions['tsCheckerOptions']>;
type TsCheckerFn = Extract<TsCheckerChain, (config: never) => unknown>;
export type TsCheckerOptions = Parameters<TsCheckerFn>[0];

const builderRequire = createRequire(import.meta.url);

const TSGO_PACKAGE = '@typescript/native-preview/package.json';

const tryResolve = (request: string, rootPath: string): string | undefined => {
  try {
    return builderRequire.resolve(request, { paths: [rootPath] });
  } catch {
    return undefined;
  }
};

/**
 * Type checking runs on TypeScript Go (`tsgo`) by default. The checker
 * prefers the project's own `@typescript/native-preview` and falls back to
 * the copy bundled with the builder, so it works without an extra install.
 * Set `tools.tsChecker.typescript.tsgo: false` to use the classic checker.
 */
export const withTsgoDefaults = (
  userOptions: TsCheckerChain | undefined,
  rootPath: string,
): TsCheckerChain => {
  const tsgoPath =
    tryResolve(TSGO_PACKAGE, rootPath) ?? builderRequire.resolve(TSGO_PACKAGE);
  const userChain = userOptions
    ? Array.isArray(userOptions)
      ? userOptions
      : [userOptions]
    : [];
  return [
    { typescript: { tsgo: true, typescriptPath: tsgoPath } },
    ...userChain,
    (config: TsCheckerOptions) => {
      const { typescript } = config;
      // A user opting out of tsgo gets the classic checker on the project's
      // own `typescript` install instead of the injected tsgo path.
      if (
        typescript?.tsgo === false &&
        typescript.typescriptPath === tsgoPath
      ) {
        typescript.typescriptPath = tryResolve('typescript', rootPath);
      }
      return config;
    },
  ];
};
