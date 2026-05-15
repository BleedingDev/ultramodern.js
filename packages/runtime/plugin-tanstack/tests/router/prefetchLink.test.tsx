import { render } from '@testing-library/react';
import React from 'react';
import { Link } from '../../src/runtime/prefetchLink';

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

  it('maps viewport prefetch to TanStack preload', () => {
    render(
      <Link to="/settings" prefetch="viewport">
        Settings
      </Link>,
    );

    expect(capturedPreloads).toEqual(['viewport']);
  });

  it('does not override explicit preload', () => {
    render(
      <Link to="/settings" prefetch="viewport" preload="intent">
        Settings
      </Link>,
    );

    expect(capturedPreloads).toEqual(['intent']);
  });
});
