import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type {
  NativeEntryGeneration,
  NativeEntryGenerator,
} from './native-infrastructure';
import {
  discoverNativeFileSystemRoutes,
  type NativeRouteEmissionOptions,
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

export interface NativeApplicationSourceOptions {
  source: string;
  routed: boolean;
  mode: 'client' | 'server';
}

export interface NativeApplicationEmission {
  applicationSource(options: NativeApplicationSourceOptions): string;
  routeSource(options: NativeRouteEmissionOptions): string;
}

export async function writeNativeEntryModules(
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

/** Discover and write output while the selected renderer owns executable source. */
export async function emitNativeEntryApplication(
  context: NativeEntryGeneration,
  mode: 'client' | 'server',
  emission: NativeApplicationEmission,
): Promise<{ routed: boolean; directory: string }> {
  const directory = entryDirectory(context);
  const source = context.entrypoint.entry;
  const routed = (await fs.stat(source)).isDirectory();
  const sources: Record<string, string> = {};
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
    sources[`routes.${mode}.ts`] = emission.routeSource({
      routes: await discovery,
      mode,
      basePath: context.basePath,
    });
  }
  sources[`application.${mode}.tsx`] = emission.applicationSource({
    source,
    routed,
    mode,
  });
  await writeNativeEntryModules(directory, sources);
  return { routed, directory };
}

/** Select the renderer-owned implementation of the existing entry contract. */
export function createNativeEntryGenerator(
  renderer: NativeEntryGeneration['renderer'],
): NativeEntryGenerator {
  return resolveNativeRendererAdapter(renderer).createEntryGenerator();
}
