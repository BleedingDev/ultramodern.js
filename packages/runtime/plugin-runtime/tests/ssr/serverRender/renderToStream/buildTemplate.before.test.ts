import { CHUNK_CSS_PLACEHOLDER } from '../../../../src/core/server/constants';
import { buildShellBeforeTemplate } from '../../../../src/core/server/stream/beforeTemplate';
import { buildShellBeforeTemplate as buildWorkerShellBeforeTemplate } from '../../../../src/core/server/stream/beforeTemplate.worker';

describe('buildShellBeforeTemplate', () => {
  it('should inject entry css when route matching context is unavailable', async () => {
    const html = await buildShellBeforeTemplate(
      `<html><head>${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
      {
        entryName: 'index',
        runtimeContext: {
          routeManifest: {
            routeAssets: {
              'async-index': {
                referenceCssAssets: ['/assets/async-index.css'],
              },
            },
          },
        } as any,
        config: {} as any,
      },
    );

    expect(html).toContain('/assets/async-index.css');
  });

  it.each([
    ['unrelated text', '<meta content="/assets/async-index.css" />'],
    [
      'the exact stylesheet link',
      '<link href="/assets/async-index.css" rel="stylesheet" />',
    ],
  ])(
    'should preserve exactly one worker stylesheet when the template contains %s',
    async (_description, existingMarkup) => {
      const stylesheet =
        '<link href="/assets/async-index.css" rel="stylesheet" />';
      const html = await buildWorkerShellBeforeTemplate(
        `<html><head>${existingMarkup}${CHUNK_CSS_PLACEHOLDER}</head><body></body></html>`,
        {
          entryName: 'index',
          runtimeContext: {
            routeManifest: {
              routeAssets: {
                'async-index': {
                  referenceCssAssets: ['/assets/async-index.css'],
                },
              },
            },
          } as any,
          config: {} as any,
        },
      );

      expect(html).toContain(stylesheet);
      expect(html.indexOf(stylesheet)).toBe(html.lastIndexOf(stylesheet));
    },
  );
});
