import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';

const ssrArtifactPath = path.resolve(__dirname, '../../dist/esm/ssr.mjs');
const hasArtifact = fs.existsSync(ssrArtifactPath);

describe('ssr build artifact', () => {
  test.skipIf(!hasArtifact)(
    'renders through the published ESM SSR entry under a bundler runtime',
    async () => {
      const bundlerGlobal = globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: string | number) => string };
      };
      const previousBundlerRuntime = bundlerGlobal.__webpack_require__;
      bundlerGlobal.__webpack_require__ = {
        u: chunkId => String(chunkId),
      };

      try {
        const runtime = await import(pathToFileURL(ssrArtifactPath).href);
        const stream = await runtime.renderSSRStream(
          React.createElement('main', null, 'published SSR artifact'),
          {
            request: new Request('https://example.com/'),
            rscRoot: React.createElement(
              'main',
              null,
              'published SSR artifact',
            ),
          },
        );
        const html = await new Response(stream).text();

        expect(html).toContain('<main>published SSR artifact</main>');
      } finally {
        if (previousBundlerRuntime === undefined) {
          delete bundlerGlobal.__webpack_require__;
        } else {
          bundlerGlobal.__webpack_require__ = previousBundlerRuntime;
        }
      }
    },
  );
});
