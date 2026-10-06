import { rstest } from '@rstest/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React, { act } from 'react';
import ultramodernBoundaryDebuggerPlugin from '../../src/boundary-debugger';

let resizeObservers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly elements = new Set<Element>();

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }

  disconnect() {
    this.elements.clear();
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe('ultramodern boundary debugger browser overlay', () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;
  const rects = new Map<string, DOMRect>();

  beforeEach(() => {
    resizeObservers = [];
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
    rects.clear();
    rects.set('primary-control', new DOMRect(72, 96, 180, 44));
    rects.set('decide-surface', new DOMRect(64, 180, 720, 260));
    rects.set('checkout-control', new DOMRect(116, 284, 220, 48));
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        const testId = this.getAttribute('data-testid');
        return (
          (testId ? rects.get(testId) : undefined) ?? new DOMRect(0, 0, 0, 0)
        );
      },
    });
  });

  afterEach(() => {
    cleanup();
    rstest.restoreAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    if (originalResizeObserver === undefined) {
      delete (
        globalThis as typeof globalThis & {
          ResizeObserver?: typeof ResizeObserver;
        }
      ).ResizeObserver;
    } else {
      globalThis.ResizeObserver = originalResizeObserver;
    }
    document.body.innerHTML = '';
    document.documentElement.lang = '';
    window.history.replaceState(null, '', '/');
    window.localStorage?.clear();
  });

  test('keeps controls usable when localStorage reads and writes are blocked', async () => {
    const getItem = rstest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('Storage is blocked');
      });
    const setItem = rstest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Storage is blocked');
      });
    let WrappedApp: React.ComponentType | undefined;
    ultramodernBoundaryDebuggerPlugin({
      enabledByDefault: true,
      metadata: { appId: 'shell', boundaries: [], schemaVersion: 1 },
    }).setup?.({
      wrapRoot(factory: (App: React.ComponentType) => React.ComponentType) {
        WrappedApp = factory(() => <main>app</main>);
      },
    } as any);
    const App = WrappedApp!;
    render(<App />);

    const toggle = (await screen.findByLabelText(
      'show team boundaries',
    )) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledWith(
      'modernjs:boundary-debugger:enabled',
      'true',
    );
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(setItem).toHaveBeenLastCalledWith(
      'modernjs:boundary-debugger:enabled',
      'false',
    );
    getItem.mockRestore();
    setItem.mockRestore();
  });

  test.each([
    ['visible', '0', true, true, false],
    ['hidden-when-off', '0', true, false, false],
    ['hidden-when-off', '1', false, true, true],
    ['hidden', '1', false, false, true],
  ] as const)(
    'preserves %s control visibility with query override %s',
    async (controlMode, query, stored, visible, enabled) => {
      window.localStorage.setItem(
        'modernjs:boundary-debugger:enabled',
        String(stored),
      );
      window.history.replaceState(null, '', `/?modern-boundaries=${query}`);
      document.documentElement.lang = 'cs-CZ';
      let WrappedApp: React.ComponentType | undefined;
      ultramodernBoundaryDebuggerPlugin({
        controlMode,
        metadata: {
          appId: 'shell',
          boundaries: [{ appId: 'checkout', mfName: 'verticalCheckout' }],
          schemaVersion: 1,
        },
      }).setup?.({
        wrapRoot(factory: (App: React.ComponentType) => React.ComponentType) {
          WrappedApp = factory(() => (
            <main
              data-modern-boundary-id="verticalCheckout"
              data-testid="checkout-control"
            />
          ));
        },
      } as any);
      const App = WrappedApp!;
      render(<App />);

      await waitFor(() => {
        expect(
          window.localStorage.getItem('modernjs:boundary-debugger:enabled'),
        ).toBe(String(enabled));
        expect(screen.queryByLabelText('zobrazit hranice týmů') !== null).toBe(
          visible,
        );
        expect(
          document.querySelectorAll('[data-modern-boundary-overlay]'),
        ).toHaveLength(enabled ? 1 : 0);
      });
    },
  );

  test('disconnects observers and removes the original resize and scroll listeners on unmount', async () => {
    const addListener = rstest.spyOn(window, 'addEventListener');
    const removeListener = rstest.spyOn(window, 'removeEventListener');
    const disconnectMutation = rstest.spyOn(
      MutationObserver.prototype,
      'disconnect',
    );
    let WrappedApp: React.ComponentType | undefined;
    ultramodernBoundaryDebuggerPlugin({
      enabledByDefault: true,
      metadata: { appId: 'shell', boundaries: [], schemaVersion: 1 },
    }).setup?.({
      wrapRoot(factory: (App: React.ComponentType) => React.ComponentType) {
        WrappedApp = factory(() => (
          <main
            data-modern-boundary-id="verticalCheckout"
            data-testid="checkout-control"
          />
        ));
      },
    } as any);
    const App = WrappedApp!;
    const view = render(<App />);
    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-modern-boundary-overlay]'),
      ).toHaveLength(1);
    });
    const resizeListener = addListener.mock.calls.find(
      ([event]) => event === 'resize',
    )?.[1];
    const scrollListener = addListener.mock.calls.find(
      ([event]) => event === 'scroll',
    )?.[1];
    expect(resizeListener).toBeDefined();
    expect(scrollListener).toBeDefined();
    expect(resizeObservers.some(observer => observer.elements.size > 0)).toBe(
      true,
    );
    view.unmount();

    expect(disconnectMutation).toHaveBeenCalled();
    expect(
      resizeObservers.every(observer => observer.elements.size === 0),
    ).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('resize', resizeListener);
    expect(removeListener).toHaveBeenCalledWith('scroll', scrollListener, true);
  });

  test('updates overlays when a boundary added after mount resizes', async () => {
    let WrappedApp: React.ComponentType | undefined;
    const plugin = ultramodernBoundaryDebuggerPlugin({
      enabledByDefault: true,
      metadata: {
        appId: 'shell',
        boundaries: [
          {
            appId: 'Checkout',
            mfName: 'verticalCheckout',
          },
        ],
        schemaVersion: 1,
      },
    });

    plugin.setup?.({
      wrapRoot(factory: (App: React.ComponentType) => React.ComponentType) {
        WrappedApp = factory(() => (
          <main>
            <div data-testid="dynamic-root" />
          </main>
        ));
      },
    } as any);

    expect(WrappedApp).toBeDefined();
    const App = WrappedApp!;
    render(<App />);

    const boundary = document.createElement('section');
    boundary.dataset.modernBoundaryId = 'verticalCheckout';
    boundary.dataset.modernMfExpose = './LateCheckout';
    boundary.setAttribute('data-testid', 'late-checkout');
    rects.set('late-checkout', new DOMRect(24, 48, 160, 40));

    act(() => {
      screen.getByTestId('dynamic-root').appendChild(boundary);
    });

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-modern-boundary-overlay-label="Checkout"]',
        ),
      ).not.toBeNull();
    });

    rects.set('late-checkout', new DOMRect(24, 48, 220, 56));
    const boundaryObserver = resizeObservers.find(observer =>
      observer.elements.has(boundary),
    );
    expect(boundaryObserver).toBeDefined();
    act(() => {
      boundaryObserver?.trigger();
    });

    await waitFor(() => {
      const resizedOverlay = document.querySelector(
        '[data-modern-boundary-overlay-label="Checkout"]',
      ) as HTMLElement | null;
      expect(resizedOverlay?.style.width).toBe('220px');
      expect(resizedOverlay?.style.height).toBe('56px');
    });
  });
  test('renders non-intrusive overlays naming the boundary owner and exposed module', async () => {
    let WrappedApp: React.ComponentType | undefined;
    ultramodernBoundaryDebuggerPlugin({
      enabledByDefault: true,
      metadata: {
        appId: 'shell',
        boundaries: [
          { appId: 'checkout', label: 'Checkout', mfName: 'verticalCheckout' },
        ],
        schemaVersion: 1,
      },
    }).setup?.({
      wrapRoot(factory: (App: React.ComponentType) => React.ComponentType) {
        WrappedApp = factory(() => (
          <main>
            <section
              data-modern-boundary-id="verticalCheckout"
              data-modern-mf-expose="./Controls"
              data-testid="checkout-control"
            />
          </main>
        ));
      },
    } as any);
    const App = WrappedApp!;
    render(<App />);

    await waitFor(() => {
      const overlay = document.querySelector(
        '[data-modern-boundary-overlay-label="Checkout"]',
      ) as HTMLElement | null;
      expect(overlay?.style.position).toBe('fixed');
      expect(overlay?.style.pointerEvents).toBe('none');
      expect(overlay?.textContent).toContain('Checkout');
      expect(overlay?.textContent).toContain('./Controls');
    });
  });
});
