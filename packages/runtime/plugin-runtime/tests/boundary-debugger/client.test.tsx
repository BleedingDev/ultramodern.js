import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import ultramodernBoundaryDebuggerPlugin from '../../src/boundary-debugger';

const snapshotRect = (rect: DOMRect) => ({
  height: rect.height,
  left: rect.left,
  top: rect.top,
  width: rect.width,
});

describe('ultramodern boundary debugger browser overlay', () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const rects = new Map<string, DOMRect>();

  beforeEach(() => {
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
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    document.body.innerHTML = '';
    window.localStorage?.clear();
  });

  test('toggles fixed overlays without moving controls and labels Checkout ownership inside Decide', async () => {
    let WrappedApp: React.ComponentType | undefined;
    const plugin = ultramodernBoundaryDebuggerPlugin({
      enabledByDefault: false,
      metadata: {
        appId: 'shell',
        boundaries: [
          {
            appId: 'shell',
            label: 'Decide',
            mfName: 'shellSuperApp',
            role: 'host',
          },
          {
            appId: 'checkout',
            label: 'Checkout',
            mfName: 'verticalCheckout',
            ownerTeam: 'checkout-platform',
            role: 'vertical',
          },
        ],
        schemaVersion: 1,
      },
    });

    plugin.setup?.({
      wrapRoot: (
        factory: (App: React.ComponentType) => React.ComponentType,
      ) => {
        WrappedApp = factory(() => (
          <main>
            <button data-testid="primary-control" type="button">
              Decide
            </button>
            <section
              data-modern-boundary-id="shellSuperApp"
              data-modern-mf-expose="./Decide"
              data-testid="decide-surface"
            >
              <button
                data-modern-boundary-id="verticalCheckout"
                data-modern-mf-expose="./Controls"
                data-testid="checkout-control"
                type="button"
              >
                Pay now
              </button>
            </section>
          </main>
        ));
      },
    } as any);

    expect(WrappedApp).toBeDefined();
    const App = WrappedApp!;
    render(<App />);

    const primary = screen.getByTestId('primary-control');
    const beforeScrollHeight = document.documentElement.scrollHeight;
    const beforePrimaryRect = snapshotRect(primary.getBoundingClientRect());

    await screen.findByLabelText('show team boundaries');
    fireEvent.click(screen.getByLabelText('show team boundaries'));

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-modern-boundary-overlay]'),
      ).toHaveLength(2);
    });

    const checkoutOverlay = document.querySelector(
      '[data-modern-boundary-overlay-label="Checkout"]',
    ) as HTMLElement | null;

    expect(checkoutOverlay).not.toBeNull();
    expect(checkoutOverlay?.style.position).toBe('fixed');
    expect(checkoutOverlay?.style.pointerEvents).toBe('none');
    expect(checkoutOverlay?.style.boxSizing).toBe('border-box');
    expect(checkoutOverlay?.textContent).toContain('Checkout');
    expect(checkoutOverlay?.textContent).toContain('./Controls');
    expect(document.documentElement.scrollHeight).toBe(beforeScrollHeight);
    expect(snapshotRect(primary.getBoundingClientRect())).toEqual(
      beforePrimaryRect,
    );
  });
});
