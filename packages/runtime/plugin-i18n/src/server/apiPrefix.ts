type ApiPrefixInput = string | string[] | undefined;

const normalizeApiPrefix = (prefix: string): string | null => {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return null;
  }

  const prefixedPath = trimmedPrefix.startsWith('/')
    ? trimmedPrefix
    : `/${trimmedPrefix}`;
  const withoutWildcard = prefixedPath.replace(/\/\*$/, '');
  const normalizedPrefix =
    withoutWildcard.length > 1
      ? withoutWildcard.replace(/\/+$/, '')
      : withoutWildcard;

  return normalizedPrefix === '/' ? null : normalizedPrefix;
};

export const collectApiPrefixes = (
  routes: Array<{ isApi?: boolean; urlPath?: string }>,
  bffPrefix?: ApiPrefixInput,
): string[] => {
  const prefixes = new Set<string>();

  for (const route of routes) {
    if (!route.isApi || !route.urlPath) {
      continue;
    }

    const normalizedPrefix = normalizeApiPrefix(route.urlPath);
    if (normalizedPrefix) {
      prefixes.add(normalizedPrefix);
    }
  }

  const bffPrefixes = Array.isArray(bffPrefix)
    ? bffPrefix
    : bffPrefix
      ? [bffPrefix]
      : [];

  for (const prefix of bffPrefixes) {
    const normalizedPrefix = normalizeApiPrefix(prefix);
    if (normalizedPrefix) {
      prefixes.add(normalizedPrefix);
    }
  }

  return [...prefixes];
};

export const matchesApiPrefix = (
  pathname: string,
  apiPrefixes: string[],
): boolean => {
  const normalizedPathname = pathname.startsWith('/')
    ? pathname
    : `/${pathname}`;

  return apiPrefixes.some(
    prefix =>
      normalizedPathname === prefix ||
      normalizedPathname.startsWith(`${prefix}/`),
  );
};
