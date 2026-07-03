import { render } from '@testing-library/react';
import React from 'react';
import { Link, NavLink } from '../../src/runtime/prefetchLink';

type CapturedOptions = {
  preload?: unknown;
};

type MockLinkAnchorProps = Record<string, unknown> & {
  href?: string;
  ref?: unknown;
};

let capturedOptions: CapturedOptions[] = [];
let mockReturnProps: MockLinkAnchorProps = { href: '/settings' };

rstest.mock('@tanstack/react-router', () => ({
  useLinkProps: (options: CapturedOptions) => {
    capturedOptions.push(options);
    return mockReturnProps;
  },
}));

describe('tanstack prefetch link adapter - preload mapping', () => {
  beforeEach(() => {
    capturedOptions = [];
    mockReturnProps = { href: '/settings' };
  });

  it('defaults TanStack preload to viewport', () => {
    render(<Link to="/settings">Settings</Link>);

    expect(capturedOptions.map(o => o.preload)).toEqual(['viewport']);
  });

  it('preserves explicit preload', () => {
    render(
      <Link to="/settings" prefetch="render" preload="intent">
        Settings
      </Link>,
    );

    expect(capturedOptions.map(o => o.preload)).toEqual(['intent']);
  });

  it('preserves explicit disabled preload', () => {
    render(
      <Link to="/settings" prefetch="render" preload={false}>
        Settings
      </Link>,
    );

    expect(capturedOptions.map(o => o.preload)).toEqual([false]);
  });

  it('maps none prefetch to disabled TanStack preload', () => {
    render(
      <Link to="/settings" prefetch="none">
        Settings
      </Link>,
    );

    expect(capturedOptions.map(o => o.preload)).toEqual([false]);
  });

  it.each([
    'intent',
    'render',
    'viewport',
  ] as const)('maps %s prefetch to TanStack preload', prefetch => {
    render(
      <Link to="/settings" prefetch={prefetch}>
        Settings
      </Link>,
    );

    expect(capturedOptions.map(o => o.preload)).toEqual([prefetch]);
  });

  it('defaults NavLink preload to viewport', () => {
    render(<NavLink to="/settings">Settings</NavLink>);

    expect(capturedOptions.map(o => o.preload)).toEqual(['viewport']);
  });
});
