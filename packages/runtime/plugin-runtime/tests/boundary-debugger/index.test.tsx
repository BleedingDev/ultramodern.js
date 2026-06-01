import React from 'react';
import ReactDomServer from 'react-dom/server';
import ultramodernBoundaryDebuggerPlugin from '../../src/boundary-debugger';

describe('ultramodern boundary debugger', () => {
  it('does not render debug controls during SSR', () => {
    let WrappedApp: React.ComponentType | undefined;
    const plugin = ultramodernBoundaryDebuggerPlugin({
      controlMode: 'hidden',
      enabledByDefault: true,
      legacySelector: '[data-mf-remote]',
      metadata: {
        appId: 'shell',
        boundaries: [
          {
            appId: 'catalog',
            mfName: 'catalog',
          },
        ],
        schemaVersion: 1,
      },
    });

    plugin.setup?.({
      wrapRoot: (
        factory: (App: React.ComponentType) => React.ComponentType,
      ) => {
        WrappedApp = factory(() => <main>app</main>);
      },
    } as any);

    expect(WrappedApp).toBeDefined();
    const App = WrappedApp!;
    expect(ReactDomServer.renderToString(<App />)).toBe('<main>app</main>');
  });
});
