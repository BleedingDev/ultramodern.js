import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { findNativeFederationConfig } from './native-federation-files';
import { emitNativeI18nModule } from './native-i18n';
import type {
  NativeEntryGeneration,
  NativeEntryGenerator,
} from './native-infrastructure';
import {
  discoverNativeFileSystemRoutes,
  emitNativeApplicationModule,
} from './native-routes';
import { resolveNativeRendererAdapter } from './renderer-registration';

const entryRoutes = new WeakMap<
  NativeEntryGeneration,
  Promise<FileSystemRouteIR[]>
>();

export function resolveNativeEntryIdentity(
  context: NativeEntryGeneration,
  renderer: NativeEntryGeneration['renderer'],
): RendererIdentity {
  if (context.renderer !== renderer)
    throw new Error('Native generator renderer conflict');
  const identity = context.rendererIdentity;
  if (
    !identity ||
    identity.renderer !== context.renderer ||
    identity.entryName !== context.entrypoint.entryName ||
    identity.protocolVersion !== 1 ||
    !identity.appId?.trim() ||
    !identity.buildId?.trim()
  ) {
    throw new Error(
      'Native entry emission requires its resolved immutable build identity',
    );
  }
  return identity;
}

function entryDirectory(context: NativeEntryGeneration): string {
  return context.entrypoint.internalEntry
    ? path.dirname(context.entrypoint.internalEntry)
    : path.join(
        context.internalDirectory,
        context.renderer,
        context.entrypoint.entryName,
      );
}

async function writeNativeEntryModules(
  directory: string,
  sources: Readonly<Record<string, string>>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(sources).map(([filename, source]) =>
      fs.writeFile(path.join(directory, filename), source),
    ),
  );
}

/**
 * Discover routes and write the entry's generated application module,
 * `app.<mode>.ts`, and its `i18n.ts`: route source imports and data only.
 */
export async function emitNativeEntryApplication(
  context: NativeEntryGeneration,
  mode: 'client' | 'server',
): Promise<{ routed: boolean; directory: string }> {
  const directory = entryDirectory(context);
  const source = context.entrypoint.entry;
  const routed = (await fs.stat(source)).isDirectory();
  const sources: Record<string, string> = {};
  if (context.i18n) {
    if (!routed)
      throw new Error(
        `i18nPlugin() localizes file-system routes; entry ${context.entrypoint.entryName} has no routes directory`,
      );
    sources['i18n.ts'] = emitNativeI18nModule(context.i18n);
  }
  if (routed) {
    let discovery = entryRoutes.get(context);
    if (!discovery) {
      discovery = discoverNativeFileSystemRoutes({
        routesDirectory: source,
        entryName: context.entrypoint.entryName,
        extensions: context.profile.sourceExtensions,
      }).then(routes => context.modifyRoutes(routes));
      entryRoutes.set(context, discovery);
    }
    sources[`app.${mode}.ts`] = emitNativeApplicationModule({
      routes: await discovery,
      mode,
      basePath: context.basePath,
    });
  } else {
    sources[`app.${mode}.ts`] =
      `export { default } from ${JSON.stringify(source)};\n`;
  }
  await writeNativeEntryModules(directory, sources);
  return { routed, directory };
}

/**
 * The request a generated client entry passes to import() to load the
 * application: the routes, layouts and their styles. Every document needs it,
 * so its stylesheets belong in the server document head.
 */
export const NATIVE_APPLICATION_CLIENT_REQUEST = './app.client';

export interface NativeEntryStubOptions {
  /** Extra client entry options: source declarations and option fields. */
  readonly client?: {
    readonly declarations: string;
    readonly fields: Readonly<Record<string, string>>;
  };
}

/**
 * The renderer runtime owns the entry lifecycle. Generated entries are stubs
 * that pass identity, the application importer and the bundler's HMR object.
 */
export function createNativeEntryStubGenerator(
  renderer: NativeEntryGeneration['renderer'],
  options: NativeEntryStubOptions = {},
): NativeEntryGenerator {
  const runtime = `@modern-js/renderer-${renderer}`;
  return {
    async client(context) {
      const identity = resolveNativeEntryIdentity(context, renderer);
      await emitNativeEntryApplication(context, 'client');
      const fields = {
        identity: JSON.stringify(identity),
        load: `() => import(${JSON.stringify(NATIVE_APPLICATION_CLIENT_REQUEST)})`,
        ...(context.i18n ? { i18n: 'i18n' } : {}),
        hot: 'import.meta.webpackHot',
        ...options.client?.fields,
      };
      return `import { startNativeClient } from ${JSON.stringify(`${runtime}/entry-client`)};
${context.i18n ? 'import { i18n } from "./i18n";\n' : ''}${options.client?.declarations ?? ''}
startNativeClient({
${Object.entries(fields)
  .map(([name, value]) => `  ${name === value ? name : `${name}: ${value}`},`)
  .join('\n')}
});
`;
    },
    async server(context) {
      const identity = resolveNativeEntryIdentity(context, renderer);
      const { directory } = await emitNativeEntryApplication(context, 'server');
      const server = `import { createNativeServerEntry } from ${JSON.stringify(`${runtime}/entry-server`)};
${context.i18n ? 'import { i18n } from "./i18n";\n' : ''}
export const { ${nativeServerHandlers.join(', ')} } = createNativeServerEntry({
  identity: ${JSON.stringify(identity)},
  app: () => import("./app.server"),${context.i18n ? '\n  i18n,' : ''}
});
`;
      if (!findNativeFederationConfig(context.appDirectory)) return server;
      await writeNativeEntryModules(directory, {
        'handlers.server.ts': server,
      });
      return federatedServerSource(identity);
    },
  };
}

const nativeServerHandlers = [
  'rendererIdentity',
  'nativeRequestHandler',
  'nativeCSRRequestHandler',
  'nativeMatchRouteIds',
] as const;

/**
 * A federated server entry reaches the renderer through an import() boundary,
 * like the federated client entry: the Module Federation share scope must
 * initialize before the entry consumes the shared renderer singletons.
 */
function federatedServerSource(identity: RendererIdentity): string {
  return `import type { NativeRequestContext } from '@modern-js/renderer-core/server';
export const rendererIdentity = Object.freeze(${JSON.stringify(identity)});
const handlers = () => import('./handlers.server');
${nativeServerHandlers
  .slice(1)
  .map(
    name =>
      `export async function ${name}(request: Request, context: NativeRequestContext) {
  return (await handlers()).${name}(request, context);
}`,
  )
  .join('\n')}
`;
}

/** Select the renderer-owned implementation of the existing entry contract. */
export function createNativeEntryGenerator(
  renderer: NativeEntryGeneration['renderer'],
): NativeEntryGenerator {
  return resolveNativeRendererAdapter(renderer).createEntryGenerator();
}
