export function createRouteStaticData<const T extends Record<string, unknown>>(
  opts: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(opts).filter(([, value]) => Boolean(value)),
  ) as Partial<T>;
}
