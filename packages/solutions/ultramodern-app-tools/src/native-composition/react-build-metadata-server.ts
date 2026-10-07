import {
  identityCacheKey,
  RENDERER_IDENTITY_HEADER,
  type RendererIdentity,
  serializeRendererIdentityHeader,
} from '@modern-js/renderer-core/identity';
import type {
  Middleware,
  ServerEnv,
  ServerPlugin,
} from '@modern-js/server-core';
import { MAIN_ENTRY_NAME } from '@modern-js/utils/universal/constants';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  readRendererBuildManifest,
} from './native-build-manifest';
import {
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';

export const REACT_RENDERER_IDENTITY_HEADER = RENDERER_IDENTITY_HEADER;

export interface ReactBuildMetadataServerOptions {
  readonly entries?: Readonly<Record<string, RendererIdentity>>;
  /** Serializable deployments load the owning committed build manifest. */
  readonly manifestFile?: typeof RENDERER_BUILD_MANIFEST_FILE;
}

function serializeEntries(
  entries: Readonly<Record<string, RendererIdentity>> | undefined,
): Readonly<Record<string, string>> {
  if (!entries || Array.isArray(entries) || !Object.keys(entries).length)
    throw new Error(
      'React server metadata requires application entry identities',
    );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([entryName, identity]) => {
        identityCacheKey(identity);
        if (
          identity.renderer !== 'react' ||
          identity.entryName !== entryName ||
          !/^[a-f0-9]{64}$/u.test(identity.buildId)
        )
          throw new Error(
            'React server entry identity conflicts with its build',
          );
        return [entryName, serializeRendererIdentityHeader(identity)];
      }),
    ),
  );
}

/** Add identity to the existing React response without consuming its body. */
export default function reactBuildMetadataServerPlugin(
  options: ReactBuildMetadataServerOptions,
): ServerPlugin {
  const late = options?.manifestFile === RENDERER_BUILD_MANIFEST_FILE;
  if (
    (options?.manifestFile !== undefined && !late) ||
    (late && options.entries)
  )
    throw new Error(
      'React server metadata has conflicting identity lifecycle options',
    );
  let entries = late ? undefined : serializeEntries(options?.entries);
  const manifestValidation = {
    routerFrameworks: resolveRendererRouterFrameworks('react'),
  };

  return {
    name: '@modern-js/react-renderer-build-metadata',
    setup(api) {
      api.onPrepare(async () => {
        const { middlewares, routes, distDirectory, pwd } =
          api.getServerContext();
        if (late) {
          const manifest = await readRendererBuildManifest(
            distDirectory || pwd,
            resolveRendererProfile('react'),
            manifestValidation,
          );
          entries = serializeEntries(manifest.identities);
        }
        if (
          middlewares.some(
            middleware => middleware.name === 'react-renderer-identity',
          )
        )
          throw new Error('Duplicate React server renderer identity plugin');
        for (const route of routes ?? []) {
          if (
            !route.isApi &&
            route.entryName &&
            entries &&
            !Object.hasOwn(entries, route.entryName)
          )
            throw new Error(
              `React server route has no renderer identity for ${route.entryName}`,
            );
        }
        const handler: Middleware<ServerEnv> = async (context, next) => {
          const current = entries!;
          await next();
          const route = context.get('renderRoute');
          const entryName = route && (route.entryName || MAIN_ENTRY_NAME);
          if (!entryName) return;
          if (late && !Object.hasOwn(current, entryName))
            throw new Error(
              `React server route has no finalized renderer identity for ${entryName}`,
            );
          if (Object.hasOwn(current, entryName))
            context.header(REACT_RENDERER_IDENTITY_HEADER, current[entryName]);
        };
        middlewares.push({
          name: 'react-renderer-identity',
          // Native assets and APIs must remain available while the compiler
          // finalizes the identity consumed by document rendering.
          order: 'post',
          before: ['render'],
          handler,
        });
      });
    },
  };
}
