import { createFederatedCssLinks } from '../../../src/core/server/federatedCss';

describe('createFederatedCssLinks', () => {
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
});
