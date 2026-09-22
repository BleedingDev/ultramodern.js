import {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  cleanupRouterRuntimeState,
  getRouterHydrationScripts,
  getRouterMatchedRouteIds,
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from '../src/routerState';

describe('router state primitives', () => {
  it('preserves snapshot precedence and a captured snapshot across client state updates', () => {
    const context = { requestId: 'one' };
    expect(
      applyRouterServerPrepareResult(context, {
        state: { framework: 'custom', basename: '/client' },
        snapshot: {
          framework: 'custom',
          basename: '/server',
          hydrationScripts: ['server'],
          matchedRouteIds: ['server-route'],
        },
      }),
    ).toBe(context);
    const snapshot = getRouterServerSnapshot(context);
    expect(snapshot).toMatchObject({
      framework: 'custom',
      basename: '/server',
      hydrationScripts: ['server'],
      matchedRouteIds: ['server-route'],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.hydrationScripts)).toBe(true);
    expect(getRouterHydrationScripts(context)).toEqual(['server']);
    expect(getRouterMatchedRouteIds(context)).toEqual(['server-route']);

    applyRouterRuntimeState(context, {
      framework: 'custom',
      instance: { client: true },
    });
    expect(getRouterRuntimeState(context)).not.toHaveProperty('serverSnapshot');
    expect(getRouterServerSnapshot(context)).toBe(snapshot);
    expect(getRouterHydrationScripts(context)).toEqual(['server']);
    expect(getRouterMatchedRouteIds(context)).toEqual(['server-route']);
  });

  it('applies server prepare overrides and awaits cleanup without propagating failures', async () => {
    const context = {};
    const stateCleanup = rstest.fn();
    const cleanup = rstest.fn(async () => {
      await Promise.resolve();
    });
    expect(
      applyRouterServerPrepareResult(context, {
        state: {
          framework: 'custom',
          cleanup: stateCleanup,
        },
        snapshot: { statusCode: 299 },
        cleanup,
      }),
    ).toBe(context);
    expect(getRouterServerSnapshot(context)?.statusCode).toBe(299);
    await cleanupRouterRuntimeState(context);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(stateCleanup).not.toHaveBeenCalled();

    applyRouterRuntimeState(context, {
      framework: 'custom',
      cleanup: async () => {
        throw new Error('cleanup failed');
      },
    });
    await expect(cleanupRouterRuntimeState(context)).resolves.toBeUndefined();
    await expect(cleanupRouterRuntimeState({})).resolves.toBeUndefined();
  });
});
