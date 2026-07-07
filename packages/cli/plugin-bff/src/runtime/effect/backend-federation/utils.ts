export function normalizeExpose(expose: string) {
  return expose.replace(/^\.\//u, '');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
