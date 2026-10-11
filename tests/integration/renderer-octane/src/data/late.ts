/** Resolves after a delay, so the deferred fallback is visible first. */
export function later(value: string, ms = 1500): Promise<string> {
  return new Promise(resolve => setTimeout(resolve, ms, value));
}
