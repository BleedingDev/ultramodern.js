import { createFederatedCssLinks } from '../../../src/core/server/federatedCss';

describe('createFederatedCssLinks', () => {
  it('does not dedupe a stylesheet against a longer href substring', () => {
    const html = createFederatedCssLinks(['/remote/theme.css'], {
      template: '<link href="/remote/theme.css?v=next" rel="stylesheet" />',
    });

    expect(html).toBe('<link href="/remote/theme.css" rel="stylesheet" />');
  });

  it('escapes federated css asset urls before interpolating href attributes', () => {
    const html = createFederatedCssLinks(
      ['/remote/theme" onload="alert(1)&x=<tag>.css'],
      {
        template: '',
      },
    );

    expect(html).toBe(
      '<link href="/remote/theme&quot; onload=&quot;alert(1)&amp;x=&lt;tag&gt;.css" rel="stylesheet" />',
    );
    expect(html).not.toContain('onload="alert(1)');
  });

  it('escapes extra attributes and prevents duplicate renderer-owned attributes', () => {
    const html = createFederatedCssLinks(['/remote/theme.css'], {
      template: '',
      attributes: {
        nonce: 'nonce"&<value>',
        href: 'https://attacker.example/override.css',
        rel: 'preload',
      },
    });

    expect(html).toBe(
      '<link nonce="nonce&quot;&amp;&lt;value&gt;" href="/remote/theme.css" rel="stylesheet" />',
    );
    expect(html.match(/\bhref=/g)).toHaveLength(1);
    expect(html.match(/\brel=/g)).toHaveLength(1);
  });
});
