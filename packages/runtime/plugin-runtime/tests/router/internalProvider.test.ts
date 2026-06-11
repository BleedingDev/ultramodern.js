/**
 * Loading the built-in router runtime plugin module must register
 * react-router as the default router provider (module-scope side effect).
 * Kept in its own test file so the registry state is untouched by other
 * suites.
 */
describe('built-in router provider registration', () => {
  it('registers react-router as the default provider on module load', async () => {
    // The react-router runtime plugin references webpack globals when its
    // module graph is evaluated outside a bundle.
    (
      globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: unknown) => string };
      }
    ).__webpack_require__ = {
      u: chunkId => String(chunkId),
    };

    const { resolveRouterProvider } = await import(
      '../../src/router/runtime/internal'
    );
    const { routerPlugin: reactRouterPlugin } = await import(
      '../../src/router/runtime/plugin'
    );

    expect(resolveRouterProvider(undefined)).toBe(reactRouterPlugin);
    expect(resolveRouterProvider('react-router')).toBe(reactRouterPlugin);
  });
});
