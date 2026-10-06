import {
  type RendererRouterBinding,
  type RendererRouterBindings,
  type RouterPackageBinding,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import {
  getEntrypointRoutesDir,
  getEntrypointRoutesOwner,
} from '@modern-js/runtime/cli';
import type { Entrypoint } from '@modern-js/types/cli/base';

const BUILT_IN_OWNER = '@modern-js/plugin-router';
const TANSTACK_OWNER = '@modern-js/plugin-tanstack';

const REACT_ROUTER = Object.freeze<RouterPackageBinding>({
  framework: 'react-router',
  name: 'react-router',
  version: '7.18.4',
  coreName: 'react-router',
  coreVersion: '7.18.4',
});
const TANSTACK_ROUTER = Object.freeze<RouterPackageBinding>({
  framework: 'tanstack',
  name: '@tanstack/react-router',
  version: '1.170.41',
  coreName: '@tanstack/router-core',
  coreVersion: '1.171.34',
});

function ownedBinding(
  owner: string,
  evidence: 'owned-default' | 'file-routes',
  provider: RouterPackageBinding,
): RendererRouterBinding {
  return Object.freeze({
    owner,
    evidence,
    defaultProvider: provider,
    providers: Object.freeze([provider] as const),
  });
}

/** Capture registered owners and provider availability without selecting app code. */
export function resolveReactRouterBindings({
  entrypoints,
  pluginNames,
}: {
  entrypoints: readonly Entrypoint[];
  pluginNames: readonly string[];
}): RendererRouterBindings {
  const owners = new Set(pluginNames);
  if (!owners.has(BUILT_IN_OWNER)) {
    throw new Error(
      'React router bindings require the registered @modern-js/plugin-router default owner.',
    );
  }
  const hasTanstack = owners.has(TANSTACK_OWNER);
  const bindings = Object.fromEntries(
    entrypoints.map(entrypoint => {
      // Runtime's canonical metadata is attached by entrypoint modifiers and
      // is intentionally absent from the shared framework-neutral entry type.
      const routesOwner: unknown = Reflect.get(
        entrypoint,
        '__modernRoutesOwner',
      );
      const routesDirectory: unknown = Reflect.get(
        entrypoint,
        '__modernRoutesDir',
      );
      if (routesOwner !== undefined && typeof routesOwner !== 'string') {
        throw new Error(
          `Entry ${entrypoint.entryName} has invalid __modernRoutesOwner metadata; expected a string.`,
        );
      }
      if (
        routesDirectory !== undefined &&
        typeof routesDirectory !== 'string'
      ) {
        throw new Error(
          `Entry ${entrypoint.entryName} has invalid __modernRoutesDir metadata; expected a string.`,
        );
      }
      const routesMetadata = {
        __modernRoutesOwner: routesOwner,
        __modernRoutesDir: routesDirectory,
        nestedRoutesEntry: entrypoint.nestedRoutesEntry,
      };
      const owner = getEntrypointRoutesOwner(routesMetadata);
      const routesDir = getEntrypointRoutesDir(routesMetadata);
      let binding: RendererRouterBinding;

      if (owner === TANSTACK_OWNER) {
        if (!hasTanstack) {
          throw new Error(
            `Entry ${entrypoint.entryName} declares ${TANSTACK_OWNER} without its registered CLI owner.`,
          );
        }
        binding = ownedBinding(TANSTACK_OWNER, 'file-routes', TANSTACK_ROUTER);
      } else if (owner && owner !== BUILT_IN_OWNER) {
        throw new Error(
          `Entry ${entrypoint.entryName} has unsupported React router owner ${owner}.`,
        );
      } else if (
        owner === BUILT_IN_OWNER ||
        entrypoint.pageRoutesEntry ||
        routesDir === 'routes'
      ) {
        binding = ownedBinding(BUILT_IN_OWNER, 'owned-default', REACT_ROUTER);
      } else if (routesDir !== null) {
        throw new Error(
          `Entry ${entrypoint.entryName} has route convention ${routesDir} without a supported owner.`,
        );
      } else if (hasTanstack) {
        binding = Object.freeze({
          owner: TANSTACK_OWNER,
          evidence: 'provider-registry',
          defaultProvider: REACT_ROUTER,
          providers: Object.freeze([REACT_ROUTER, TANSTACK_ROUTER]),
        });
      } else {
        binding = ownedBinding(BUILT_IN_OWNER, 'owned-default', REACT_ROUTER);
      }
      return [entrypoint.entryName, binding];
    }),
  );
  const validation = validateRendererRouterBindings(
    bindings,
    entrypoints.map(entrypoint => entrypoint.entryName),
  );
  if (!validation.ok) {
    throw new Error(
      `Invalid React router bindings: ${validation.errors
        .map(error => `${error.path}: ${error.message}`)
        .join('; ')}`,
    );
  }
  return Object.freeze(bindings);
}
