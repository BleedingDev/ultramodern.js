const callableLoadable = Object.assign(rstest.fn(), {
  lazy: rstest.fn(),
  loadableReady: rstest.fn(),
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
    Context: 'loadable-context',
  },
});

rstest.mock('@loadable/component', () => ({
  default: {
    default: callableLoadable,
    lazy: callableLoadable.lazy,
    loadableReady: callableLoadable.loadableReady,
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
      callableLoadable.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  },
}));

describe('runtime loadable export', () => {
  test('unwraps nested CommonJS default exports to the callable loadable function', async () => {
    const loadable = await import('../../src/exports/loadable');

    expect(loadable.default).toBe(callableLoadable);
    expect(loadable.lazy).toBe(callableLoadable.lazy);
    expect(loadable.loadableReady).toBe(callableLoadable.loadableReady);
    expect(loadable.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBe(
      callableLoadable.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
    );
  });
});
