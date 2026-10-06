import { render } from '@testing-library/react';
import { Link } from '../../src/runtime/prefetchLink';

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

  it('preserves an explicit false preload override', () => {
    render(
      <Link to="/settings" prefetch="render" preload={false}>
        Settings
      </Link>,
    );

    expect(capturedOptions[0]?.preload).toBe(false);
  });

  it('defaults to viewport preload when no prefetch is given', () => {
    render(<Link to="/settings">Settings</Link>);

    expect(capturedOptions[0]?.preload).toBe('viewport');
  });

  it('maps none prefetch to disabled TanStack preload', () => {
    render(
      <Link to="/settings" prefetch="none">
        Settings
      </Link>,
    );

    expect(capturedOptions[0]?.preload).toBe(false);
  });

  it('lets explicit preload re-enable prefetch=none', () => {
    render(
      <Link to="/settings" prefetch="none" preload="render">
        Settings
      </Link>,
    );

    expect(capturedOptions.map(o => o.preload)).toEqual(['render']);
  });
});
