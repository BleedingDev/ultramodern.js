import { renderToString, ssr } from '@solidjs/web';
import { createComponent } from 'solid-js';
import { federatedComponent } from '../../src/federation';

describe('federated Solid components on the server', () => {
  test('render only the fallback and never load the remote', () => {
    const load = rstest.fn(() => Promise.resolve({ default: () => 'remote' }));
    const Widget = federatedComponent(load, {
      fallback: () => ssr(['<span data-fallback="">loading</span>']),
    });
    const html = renderToString(() => createComponent(Widget, {}));
    expect(html).toContain('data-fallback');
    expect(html).not.toContain('remote');
    expect(load).not.toHaveBeenCalled();
  });

  test('render nothing without a fallback', () => {
    const Widget = federatedComponent(() =>
      Promise.resolve({ default: () => 'remote' }),
    );
    expect(renderToString(() => createComponent(Widget, {}))).toBe('');
  });
});
