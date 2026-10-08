import type { JSX } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Link,
  RouterContextProvider,
} from '../../src/router-binding/index';

type TestRouter = ReturnType<typeof createRouter>;

async function renderLink(
  view: () => JSX.Element,
  options: { rewrite?: Parameters<typeof createRouter>[0]['rewrite'] } = {},
) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
    ...options,
  });
  await router.load();
  const navigate = rstest
    .spyOn(router as TestRouter, 'navigate')
    .mockResolvedValue(undefined);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = mountApplication(
    () => <RouterContextProvider router={router}>{view}</RouterContextProvider>,
    root,
  );
  flush();
  return {
    navigate,
    anchor: () => root.querySelector('a') as HTMLAnchorElement,
    cleanup: () => {
      dispose();
      root.remove();
      flush();
      navigate.mockRestore();
    },
  };
}

function click(anchor: HTMLAnchorElement) {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  anchor.dispatchEvent(event);
  return event;
}

describe('native Link href safety', () => {
  beforeEach(() => {
    rstest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    rstest.restoreAllMocks();
  });

  test.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('a dangerous `to` (%s) renders no href and never navigates', async to => {
    const view = await renderLink(() => (
      <Link to={to as any} target="_blank">
        Blocked
      </Link>
    ));
    try {
      const anchor = view.anchor();
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      expect(anchor.getAttribute('role')).toBe('link');
      click(anchor);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  test('a rewrite to a dangerous external URL renders no href', async () => {
    const view = await renderLink(
      () => (
        <Link to="/" target="_blank">
          Rewritten
        </Link>
      ),
      {
        rewrite: {
          output: () => new URL('javascript:alert(1)'),
        },
      },
    );
    try {
      const anchor = view.anchor();
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      click(anchor);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  test('a disabled external URL renders without an href', async () => {
    const view = await renderLink(() => (
      <Link to={'https://example.com/docs' as any} disabled>
        External
      </Link>
    ));
    try {
      const anchor = view.anchor();
      expect(anchor.hasAttribute('href')).toBe(false);
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      click(anchor);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  test('an allowed external URL renders as a plain anchor', async () => {
    const view = await renderLink(() => (
      <Link to={'https://example.com/docs' as any}>External</Link>
    ));
    try {
      const anchor = view.anchor();
      expect(anchor.getAttribute('href')).toBe('https://example.com/docs');
      expect(anchor.hasAttribute('aria-disabled')).toBe(false);
      const event = click(anchor);
      expect(event.defaultPrevented).toBe(false);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });
});

describe('native Link reactive target', () => {
  test('a reactive `to` moves from external to internal', async () => {
    const [to, setTo] = createSignal<string>('https://example.com/docs');
    const view = await renderLink(() => <Link to={to() as any}>Target</Link>);
    try {
      expect(view.anchor().getAttribute('href')).toBe(
        'https://example.com/docs',
      );

      setTo('/about');
      flush();
      const anchor = view.anchor();
      expect(anchor.getAttribute('href')).toBe('/about');
      const event = click(anchor);
      expect(event.defaultPrevented).toBe(true);
      expect(view.navigate).toHaveBeenCalledTimes(1);
      expect(view.navigate.mock.calls[0][0]).toMatchObject({ to: '/about' });
    } finally {
      view.cleanup();
    }
  });

  test('a reactive `to` moves from internal to external', async () => {
    const [to, setTo] = createSignal<string>('/about');
    const view = await renderLink(() => <Link to={to() as any}>Target</Link>);
    try {
      expect(view.anchor().getAttribute('href')).toBe('/about');

      setTo('https://example.com/docs');
      flush();
      const anchor = view.anchor();
      expect(anchor.getAttribute('href')).toBe('https://example.com/docs');
      const event = click(anchor);
      expect(event.defaultPrevented).toBe(false);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  test('a reactive `to` moves between two external URLs', async () => {
    const [to, setTo] = createSignal<string>('https://example.com/a');
    const view = await renderLink(() => <Link to={to() as any}>Target</Link>);
    try {
      setTo('https://example.com/b');
      flush();
      expect(view.anchor().getAttribute('href')).toBe('https://example.com/b');
    } finally {
      view.cleanup();
    }
  });

  test('a reactive `to` that becomes dangerous drops its href', async () => {
    const warn = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    const [to, setTo] = createSignal<string>('/about');
    const view = await renderLink(() => <Link to={to() as any}>Target</Link>);
    try {
      setTo('javascript:alert(1)');
      flush();
      const anchor = view.anchor();
      expect(anchor.hasAttribute('href')).toBe(false);
      click(anchor);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
      warn.mockRestore();
    }
  });

  test('a download link leaves the click to the browser', async () => {
    const view = await renderLink(() => (
      <Link to="/report" download="report.csv">
        Report
      </Link>
    ));
    try {
      const event = click(view.anchor());
      expect(event.defaultPrevented).toBe(false);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  test('reloadDocument reaches the router, which performs a full page load', async () => {
    const view = await renderLink(() => (
      <Link to="/fresh" reloadDocument>
        Fresh
      </Link>
    ));
    try {
      click(view.anchor());
      expect(view.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/fresh', reloadDocument: true }),
      );
    } finally {
      view.cleanup();
    }
  });
});
