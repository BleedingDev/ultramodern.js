/** Module references remain build-time strings; adapters import their own views. */
export interface RouteModuleReferences {
  data?: string;
  clientData?: string;
  loading?: string;
  error?: string;
  search?: string;
  head?: string;
  notFound?: string;
}

/** Filesystem structure only. Matching and scheduling belong to native routers. */
export interface FileSystemRouteIR {
  id: string;
  file?: string;
  path?: string;
  index?: boolean;
  isRoot?: boolean;
  modules?: RouteModuleReferences;
  children: FileSystemRouteIR[];
}

const moduleFields = [
  'data',
  'clientData',
  'loading',
  'error',
  'search',
  'head',
  'notFound',
] as const;
const viewFields = ['file', '_component', 'component', 'filename'] as const;

function routeRecord(
  value: unknown,
  location: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${location} must be a plain route object`);
  }
  return value as Record<string, unknown>;
}

function routeField(
  record: Record<string, unknown>,
  key: string,
  location: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && !('value' in descriptor)) {
    throw new TypeError(`${location}.${key} must be a value, not an accessor`);
  }
  return descriptor?.value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  location: string,
  allowEmpty = false,
): string | undefined {
  const value = routeField(record, key, location);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(
      `${location}.${key} must be ${allowEmpty ? 'a' : 'a non-empty'} string`,
    );
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  location: string,
): boolean | undefined {
  const value = routeField(record, key, location);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new TypeError(`${location}.${key} must be a boolean`);
  }
  return value;
}

/**
 * Project the structural CLI route shape without retaining source objects,
 * executable handlers, component values, or arbitrary configuration.
 * Input order and conventional path syntax survive the projection unchanged.
 */
export function projectFileSystemRoutes(routes: unknown): FileSystemRouteIR[] {
  if (!Array.isArray(routes)) {
    throw new TypeError('routes must be an array');
  }

  const ids = new Set<string>();
  const ancestors = new Set<object>();

  const project = (
    value: unknown,
    coordinates: number[],
  ): FileSystemRouteIR => {
    const location = `routes[${coordinates.join('].children[')}]`;
    if (coordinates.length > 256) {
      throw new TypeError(`${location} exceeds the maximum route depth`);
    }
    const record = routeRecord(value, location);
    if (ancestors.has(record)) {
      throw new TypeError(`${location} contains a route cycle`);
    }

    let file: string | undefined;
    for (const key of viewFields) {
      // Validate every recognized reference even when an earlier one wins.
      const reference = optionalString(record, key, location);
      file ??= reference;
    }
    const id =
      optionalString(record, 'id', location) ??
      file ??
      `route-${coordinates.join('.')}`;
    if (ids.has(id)) {
      throw new TypeError(`${location} duplicates route id "${id}"`);
    }
    ids.add(id);

    const path = optionalString(record, 'path', location, true);
    const index = optionalBoolean(record, 'index', location);
    const isRoot = optionalBoolean(record, 'isRoot', location);
    const children = routeField(record, 'children', location);
    if (children !== undefined && !Array.isArray(children)) {
      throw new TypeError(`${location}.children must be an array`);
    }
    if (
      index === true &&
      ((children as unknown[] | undefined)?.length || isRoot === true)
    ) {
      throw new TypeError(
        `${location} index routes cannot have children or be root routes`,
      );
    }

    const modules: RouteModuleReferences = {};
    for (const key of moduleFields) {
      const reference = optionalString(record, key, location);
      if (reference !== undefined) {
        modules[key] = reference;
      }
    }

    ancestors.add(record);
    const projectedChildren = ((children as unknown[] | undefined) ?? []).map(
      (child, position) => project(child, [...coordinates, position]),
    );
    ancestors.delete(record);

    return {
      id,
      ...(file === undefined ? {} : { file }),
      ...(path === undefined ? {} : { path }),
      ...(index === undefined ? {} : { index }),
      ...(isRoot === undefined ? {} : { isRoot }),
      ...(Object.keys(modules).length === 0 ? {} : { modules }),
      children: projectedChildren,
    };
  };

  return routes.map((route, position) => project(route, [position]));
}

/** Convert conventional parameter spelling for TanStack without matching it. */
export function toTanstackPath(pathname: string): string {
  if (typeof pathname !== 'string') {
    throw new TypeError('route path must be a string');
  }
  return pathname
    .split('/')
    .map(segment => {
      if (segment === '*') {
        return '$';
      }
      if (segment.startsWith(':')) {
        const optional = segment.endsWith('?');
        const name = segment.slice(1, optional ? -1 : undefined);
        if (!name || /[:?*]/.test(name)) {
          throw new TypeError(`Invalid route parameter "${segment}"`);
        }
        return optional ? `{-$${name}}` : `$${name}`;
      }
      return segment;
    })
    .join('/');
}
