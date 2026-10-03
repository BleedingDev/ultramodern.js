import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';

export interface NativeRouteDiscovery {
  routesDirectory: string;
  entryName: string;
  extensions: readonly string[];
}

function conventionalPath(directory: string): string | undefined {
  if (directory.startsWith('__')) return undefined;
  return directory
    .split('.')
    .map(segment => {
      const suffix = segment.endsWith('$');
      const value = suffix ? segment.slice(0, -1) : segment;
      const parameter = /^\[([^\]]+)\]$/u.exec(value);
      if (suffix && !parameter)
        throw new Error(
          `Optional native route segments require a bracketed parameter: ${segment}`,
        );
      const inline = parameter?.[1].endsWith('$') ?? false;
      const name = inline ? parameter?.[1].slice(0, -1) : parameter?.[1];
      return `${parameter ? `:${name}` : value}${suffix || inline ? '?' : ''}`;
    })
    .join('/');
}

/** Discover structure and source references; native routers own URL matching. */
export async function discoverNativeFileSystemRoutes(
  options: NativeRouteDiscovery,
): Promise<FileSystemRouteIR[]> {
  const root = path.resolve(options.routesDirectory);
  const idFor = (file: string): string => {
    const relative = path
      .relative(root, file)
      .split(path.sep)
      .join('/')
      .replace(/\.[^.]+$/u, '')
      .replace(/\[([^\]]+)\]/gu, '($1)');
    return options.entryName === 'main'
      ? relative
      : `${options.entryName}_${relative}`;
  };

  const walk = async (
    directory: string,
    isRoot: boolean,
  ): Promise<FileSystemRouteIR | undefined> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    const files = new Map(
      entries.filter(entry => entry.isFile()).map(entry => [entry.name, entry]),
    );
    const find = (basename: string): string | undefined => {
      const candidates = options.extensions
        .map(extension => `${basename}${extension}`)
        .filter(filename => files.has(filename));
      if (candidates.length > 1) {
        throw new Error(
          `Ambiguous native route module ${path.join(directory, basename)}: ${candidates.join(', ')}`,
        );
      }
      return candidates[0] && path.join(directory, candidates[0]);
    };
    const modules = (basename: string, boundaries: boolean) => {
      const references = {
        data: find(`${basename}.data`),
        clientData: find(`${basename}.data.client`),
        search: find(`${basename}.search`),
        head: find(`${basename}.head`),
        loading: boundaries ? find('loading') : undefined,
        error: boundaries ? find('error') : undefined,
        notFound: boundaries ? find('not-found') : undefined,
      };
      return Object.fromEntries(
        Object.entries(references).filter(([, reference]) => reference),
      );
    };
    const layout = find('layout');
    const folderPath = isRoot
      ? '/'
      : conventionalPath(path.basename(directory));
    const node: FileSystemRouteIR = {
      id: idFor(path.join(directory, 'layout.ts')),
      ...(layout ? { file: layout } : {}),
      ...(folderPath === undefined ? {} : { path: folderPath }),
      ...(isRoot ? { isRoot: true } : {}),
      modules: modules('layout', true),
      children: [],
    };
    const page = find('page');
    if (page) {
      node.children.push({
        id: idFor(page),
        file: page,
        index: true,
        modules: modules('page', false),
        children: [],
      });
    }
    const splat = find('$');
    if (splat) {
      node.children.push({
        id: idFor(splat),
        file: splat,
        path: '*',
        modules: modules('$', false),
        children: [],
      });
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = await walk(path.join(directory, entry.name), false);
      if (child) node.children.push(child);
    }
    if (
      !isRoot &&
      node.children.length === 0 &&
      !node.file &&
      Object.keys(node.modules ?? {}).length === 0
    )
      return undefined;
    return node;
  };
  const discovered = await walk(root, true);
  return discovered ? [discovered] : [];
}

export interface NativeRouteEmission {
  renderer: 'solid' | 'octane';
  routes: readonly FileSystemRouteIR[];
  mode: 'client' | 'server';
  basePath: string;
}

/** Emit separate native view graphs so server-only data never enters client imports. */
export function emitNativeRouteModule(options: NativeRouteEmission): string {
  if (
    typeof options.basePath !== 'string' ||
    !options.basePath.startsWith('/')
  ) {
    throw new Error(
      'Native route emission requires its analyzed public base path',
    );
  }
  const imports: string[] = [];
  const bindings = new Map<string, string>();
  const moduleImport = (file: string): string => {
    const existing = bindings.get(file);
    if (existing) return existing;
    const binding = `routeModule${bindings.size}`;
    bindings.set(file, binding);
    imports.push(`import * as ${binding} from ${JSON.stringify(file)};`);
    return binding;
  };
  const configurations: string[] = [];
  const data: string[] = [];
  let hasHead = false;
  let hasSearch = false;
  const visit = (route: FileSystemRouteIR) => {
    const fields: string[] = [];
    if (route.file)
      fields.push(`component: ${moduleImport(route.file)}.default`);
    if (route.modules?.loading) {
      fields.push(
        `pendingComponent: ${moduleImport(route.modules.loading)}.default`,
      );
    }
    if (route.modules?.error) {
      fields.push(
        `errorComponent: ${moduleImport(route.modules.error)}.default`,
      );
    }
    if (route.modules?.notFound) {
      fields.push(
        `notFoundComponent: ${moduleImport(route.modules.notFound)}.default`,
      );
    }
    if (route.modules?.head) {
      const head = moduleImport(route.modules.head);
      hasHead = true;
      fields.push(`head: resolveNativeHeadModule(${head})`);
    }
    if (route.modules?.search) {
      const search = moduleImport(route.modules.search);
      hasSearch = true;
      fields.push(`validateSearch: resolveNativeSearchModule(${search})`);
    }
    configurations.push(
      `${JSON.stringify(route.id)}: { ${fields.join(', ')} }`,
    );
    const dataFile =
      options.mode === 'server'
        ? route.modules?.data
        : route.modules?.clientData;
    if (dataFile)
      data.push(`${JSON.stringify(route.id)}: ${moduleImport(dataFile)}`);
    for (const child of route.children) visit(child);
  };
  for (const route of options.routes) visit(route);
  // Only structural source metadata is shared. It contains no executable loader.
  const clientIR = (
    routes: readonly FileSystemRouteIR[],
  ): FileSystemRouteIR[] =>
    routes.map(route => ({
      ...route,
      modules: route.modules
        ? {
            ...route.modules,
            ...(route.modules.data ? { data: `server-data:${route.id}` } : {}),
          }
        : undefined,
      children: clientIR(route.children),
    }));
  const routeIR =
    options.mode === 'client' ? clientIR(options.routes) : options.routes;
  const runtime =
    options.renderer === 'solid'
      ? '@modern-js/renderer-solid/router'
      : '@modern-js/renderer-octane/router';
  const loader =
    options.mode === 'server'
      ? `const module = dataModules[route.id];
      if (!module?.loader) return { kind: 'success', value: undefined, status: 200 };
      return invokeRouteData(module.loader, input);`
      : `const module = dataModules[route.id];
      if (module?.loader) return invokeRouteData(module.loader, input, { production: process.env.NODE_ENV === 'production' });
      if (!serverDataRoutes.has(route.id)) return { kind: 'success', value: undefined, status: 200 };
      return createDataClient(route.id, identity).loader({ request: input.request });`;
  const serverDataRoutes: string[] = [];
  const collectData = (route: FileSystemRouteIR) => {
    if (route.modules?.data) serverDataRoutes.push(route.id);
    route.children.forEach(collectData);
  };
  options.routes.forEach(collectData);
  return `${imports.join('\n')}
import { createFileSystemRouteTree, createApplicationRouter, createMemoryHistory } from ${JSON.stringify(runtime)};
import { ${options.mode === 'client' ? 'createDataClient, ' : ''}invokeRouteData } from '@modern-js/renderer-core/data';
import type { AnyRouter, FileSystemRouteModule } from ${JSON.stringify(runtime)};
import type { DataHandler, DataOutcome, DecodedDataOutcome, FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
${options.renderer === 'solid' ? "import type { RequestSession } from '@modern-js/renderer-core/session';" : ''}
${options.mode === 'client' ? 'declare const process: { env: { NODE_ENV?: string } };' : ''}
${hasHead ? `function resolveNativeHeadModule(module: { head?: FileSystemRouteModule['head']; default?: FileSystemRouteModule['head'] }): FileSystemRouteModule['head'] { return module.head ?? module.default; }` : ''}
${hasSearch ? `function resolveNativeSearchModule(module: { validateSearch?: FileSystemRouteModule['validateSearch']; default?: FileSystemRouteModule['validateSearch'] }): NonNullable<FileSystemRouteModule['validateSearch']> { const validateSearch = module.validateSearch ?? module.default; if (typeof validateSearch !== 'function') throw new Error('A native search module must export validateSearch or a default validator'); return validateSearch; }` : ''}
export const routeIR: FileSystemRouteIR[] = ${JSON.stringify(routeIR, null, 2)};
export const routeModules: Record<string, FileSystemRouteModule> = { ${configurations.join(',\n')} };
export const dataModules: Record<string, { loader?: DataHandler; action?: DataHandler }> = { ${data.join(',\n')} };
${options.mode === 'client' ? `const serverDataRoutes = new Set<string>(${JSON.stringify(serverDataRoutes)});` : ''}
export function createNativeRouter(identity: RendererIdentity, request?: Request, context: object = {}, onOutcome?: (routeId: string, outcome: DataOutcome | DecodedDataOutcome) => void${options.renderer === 'solid' ? ', session?: RequestSession' : ''}): AnyRouter {
  if (Object.hasOwn(context, 'ultramodern')) throw new Error('The native router context reserves ultramodern metadata');
  const nativeContext = { ultramodern: Object.freeze({ rendererIdentity: Object.freeze({ ...identity }) }) };
  const routeTree = createFileSystemRouteTree(routeIR, routeModules, {
    ...(request ? { request } : {}),
    context,
    ...(onOutcome ? { onOutcome } : {}),
    ${options.renderer === 'solid' ? '...(session ? { session } : {}),' : ''}
    ${options.renderer === 'octane' ? 'getRouter: () => router,' : ''}
    async loadRoute(route, input) {
      ${loader}
    },
  });
  const url = request ? new URL(request.url) : undefined;
  const router: AnyRouter = createApplicationRouter({
    routeTree,
    basepath: ${JSON.stringify(options.basePath)},
    context: nativeContext,
    ...(url ? { origin: url.origin, history: createMemoryHistory({ initialEntries: [url.pathname + url.search + url.hash] }) } : {}),
  });
  return router;
}
`;
}
