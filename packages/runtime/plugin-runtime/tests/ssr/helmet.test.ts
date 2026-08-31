import { helmetReplace } from '../../src/core/server/helmet';

const helmetData = {
  bodyAttributes: '',
  htmlAttributes: '',
  base: '',
  priority: '',
  link: '',
  meta: '',
  noscript: '',
  script: '',
  style: '',
  title: '',
};

describe('helmet', () => {
  it('should replace title', () => {
    const result = helmetReplace('<title>foo</title>', {
      ...helmetData,
      title: '<title>baz</title>',
    } as any);

    expect(result).toMatch('baz');
  });

  it('emits prioritized SEO tags once before ordinary tags', () => {
    const priority =
      '<meta name="description" content="priority"><link rel="canonical" href="/page"><script type="application/ld+json">{}</script>';
    const result = helmetReplace('<html><head></head><body></body></html>', {
      ...helmetData,
      priority,
      meta: '<meta name="keywords" content="ordinary">',
    } as any);

    expect(result.split(priority).length - 1).toBe(1);
    expect(result.indexOf('content="priority"')).toBeLessThan(
      result.indexOf('content="ordinary"'),
    );
  });
});
