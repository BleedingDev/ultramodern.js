const calls: Record<string, unknown[]> = {
  useChildMatches: [],
  useMatch: [],
  useMatches: [],
  useParentMatches: [],
  useRouterState: [],
};

rstest.mock('@tanstack/react-router', () => ({
  useChildMatches: (options: unknown) => {
    calls.useChildMatches.push(options);
    return options;
  },
  useMatch: (options: unknown) => {
    calls.useMatch.push(options);
    return options;
  },
  useMatches: (options: unknown) => {
    calls.useMatches.push(options);
    return options;
  },
  useParentMatches: (options: unknown) => {
    calls.useParentMatches.push(options);
    return options;
  },
  useRouterState: (options: unknown) => {
    calls.useRouterState.push(options);
    return options;
  },
}));

import {
  useChildMatches,
  useMatch,
  useMatches,
  useParentMatches,
  useRouterState,
} from '../../src/runtime/routeHooks';

const getLastCall = (hookName: keyof typeof calls) => {
  const callList = calls[hookName];
  return callList[callList.length - 1];
};

describe('tanstack route hook structural sharing guards', () => {
  beforeEach(() => {
    for (const hookName of Object.keys(calls)) {
      calls[hookName] = [];
    }
  });

  test('disables structural sharing for full internal router objects', () => {
    useMatch({ from: '/' } as never);
    useMatches();
    useParentMatches();
    useChildMatches();
    useRouterState();

    expect(getLastCall('useMatch')).toEqual({
      from: '/',
      structuralSharing: false,
    });
    expect(getLastCall('useMatches')).toEqual({
      structuralSharing: false,
    });
    expect(getLastCall('useParentMatches')).toEqual({
      structuralSharing: false,
    });
    expect(getLastCall('useChildMatches')).toEqual({
      structuralSharing: false,
    });
    expect(getLastCall('useRouterState')).toEqual({
      structuralSharing: false,
    });
  });

  test('keeps selected data on the router default', () => {
    const select = (value: unknown) => value;
    const matchOptions = { from: '/', select };
    const matchesOptions = { select };
    const stateOptions = { select };

    useMatch(matchOptions as never);
    useMatches(matchesOptions as never);
    useParentMatches(matchesOptions as never);
    useChildMatches(matchesOptions as never);
    useRouterState(stateOptions as never);

    expect(getLastCall('useMatch')).toBe(matchOptions);
    expect(getLastCall('useMatches')).toBe(matchesOptions);
    expect(getLastCall('useParentMatches')).toBe(matchesOptions);
    expect(getLastCall('useChildMatches')).toBe(matchesOptions);
    expect(getLastCall('useRouterState')).toBe(stateOptions);
  });

  test('honors explicit structural sharing choices', () => {
    const enabled = { structuralSharing: true };
    const disabled = { structuralSharing: false };
    const matchEnabled = { from: '/', structuralSharing: true };

    useMatch(matchEnabled as never);
    useMatches(enabled as never);
    useParentMatches(disabled as never);
    useChildMatches(enabled as never);
    useRouterState(disabled as never);

    expect(getLastCall('useMatch')).toBe(matchEnabled);
    expect(getLastCall('useMatches')).toBe(enabled);
    expect(getLastCall('useParentMatches')).toBe(disabled);
    expect(getLastCall('useChildMatches')).toBe(enabled);
    expect(getLastCall('useRouterState')).toBe(disabled);
  });
});
