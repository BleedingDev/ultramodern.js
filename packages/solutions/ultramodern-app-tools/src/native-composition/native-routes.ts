import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { Renderer } from '@modern-js/renderer-core/identity';
import { resolveNativeRendererAdapter } from './renderer-registration';

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

export interface NativeRouteEmissionOptions {
  routes: readonly FileSystemRouteIR[];
  mode: 'client' | 'server';
  basePath: string;
  /** Accept the i18n location rewrite that keeps matching on canonical paths. */
  i18n?: boolean;
}

export interface NativeRouteEmission extends NativeRouteEmissionOptions {
  renderer: Renderer;
}

export interface NativeRouteModuleBindings {
  id: string;
  component?: string;
  loading?: string;
  error?: string;
  notFound?: string;
  head?: string;
  search?: string;
}

export interface NativeRouteEmissionPreparation {
  imports: readonly { file: string; binding: string }[];
  routeIR: readonly FileSystemRouteIR[];
  routeModules: readonly NativeRouteModuleBindings[];
  dataModules: readonly { id: string; binding: string }[];
  serverDataRoutes: readonly string[];
}

/** Project structure and imports without exposing server-only data to the client. */
export function prepareNativeRouteEmission(
  options: NativeRouteEmissionOptions,
): NativeRouteEmissionPreparation {
  if (
    typeof options.basePath !== 'string' ||
    !options.basePath.startsWith('/')
  ) {
    throw new Error(
      'Native route emission requires its analyzed public base path',
    );
  }
  const imports: { file: string; binding: string }[] = [];
  const bindings = new Map<string, string>();
  const moduleImport = (file: string): string => {
    const existing = bindings.get(file);
    if (existing) return existing;
    const binding = `routeModule${bindings.size}`;
    bindings.set(file, binding);
    imports.push({ file, binding });
    return binding;
  };
  const routeModules: NativeRouteModuleBindings[] = [];
  const dataModules: { id: string; binding: string }[] = [];
  const serverDataRoutes: string[] = [];
  const visit = (route: FileSystemRouteIR) => {
    const modules: NativeRouteModuleBindings = { id: route.id };
    if (route.file) modules.component = moduleImport(route.file);
    if (route.modules?.loading)
      modules.loading = moduleImport(route.modules.loading);
    if (route.modules?.error) modules.error = moduleImport(route.modules.error);
    if (route.modules?.notFound)
      modules.notFound = moduleImport(route.modules.notFound);
    if (route.modules?.head) modules.head = moduleImport(route.modules.head);
    if (route.modules?.search)
      modules.search = moduleImport(route.modules.search);
    routeModules.push(modules);
    const dataFile =
      options.mode === 'server'
        ? route.modules?.data
        : route.modules?.clientData;
    if (dataFile)
      dataModules.push({ id: route.id, binding: moduleImport(dataFile) });
    if (route.modules?.data) serverDataRoutes.push(route.id);
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
  return { imports, routeIR, routeModules, dataModules, serverDataRoutes };
}

/** Select the renderer that owns the native route source contract. */
export function emitNativeRouteModule(options: NativeRouteEmission): string {
  return resolveNativeRendererAdapter(options.renderer).emitRouteModule(
    options,
  );
}
