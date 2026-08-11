export function disabledRscRuntime(): never {
  throw new Error('React Server Components are disabled for this build.');
}
