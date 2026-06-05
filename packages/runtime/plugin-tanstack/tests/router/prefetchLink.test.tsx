import { render } from '@testing-library/react';
import React from 'react';
import { Link, NavLink } from '../../src/runtime/prefetchLink';

type MockLinkProps = {
  children?: React.ReactNode;
  preload?: unknown;
};

let capturedPreloads: unknown[] = [];

rstest.mock('@tanstack/react-router', () => ({
  Link: (props: MockLinkProps) => {
    capturedPreloads.push(props.preload);
    return <a href="/settings">{props.children}</a>;
  },
}));

describe('tanstack prefetch link adapter', () => {
  beforeEach(() => {
    capturedPreloads = [];
  });

  it('defaults TanStack preload to viewport', () => {
    render(<Link to="/settings">Settings</Link>);

    expect(capturedPreloads).toEqual(['viewport']);
  });

  it('preserves explicit preload', () => {
    render(
      <Link to="/settings" prefetch="render" preload="intent">
        Settings
      </Link>,
    );

    expect(capturedPreloads).toEqual(['intent']);
  });

  it('preserves explicit disabled preload', () => {
    render(
      <Link to="/settings" prefetch="render" preload={false}>
        Settings
      </Link>,
    );

    expect(capturedPreloads).toEqual([false]);
  });

  it('maps none prefetch to disabled TanStack preload', () => {
    render(
      <Link to="/settings" prefetch="none">
        Settings
      </Link>,
    );

    expect(capturedPreloads).toEqual([false]);
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

    expect(capturedPreloads).toEqual([prefetch]);
  });

  it('defaults NavLink preload to viewport', () => {
    render(<NavLink to="/settings">Settings</NavLink>);

    expect(capturedPreloads).toEqual(['viewport']);
  });
});
