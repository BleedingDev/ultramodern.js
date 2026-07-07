function normalizeBase(b: string) {
  if (b.length > 1 && b.endsWith('/')) {
    return b.slice(0, -1);
  }
  return b || '/';
}

export function isSegmentPrefix(pathname: string, base: string) {
  const b = normalizeBase(base);
  const p = pathname || '/';
  return p === b || p.startsWith(`${b}/`);
}
