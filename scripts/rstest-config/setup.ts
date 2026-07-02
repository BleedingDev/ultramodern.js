import { expect } from '@rstest/core';
import { Console } from 'console';
import { readFileSync } from 'fs';
import Module, { register } from 'module';
import path from 'path';
import { createSnapshotSerializer } from 'path-serializer';
import { pathToFileURL } from 'url';

global.console.Console = Console;

// Tests load `.ts` files at runtime via `require()` or `await import()`.
// Node only strips TypeScript types from v22.18 onward, so older versions need
// fallback hooks backed by Node's own type-stripper.
const nodeModule = Module as unknown as {
  _extensions: Record<string, (m: any, filename: string) => void>;
  stripTypeScriptTypes?: (code: string, options?: { mode?: string }) => string;
};

if (
  !process.features.typescript &&
  typeof nodeModule.stripTypeScriptTypes === 'function'
) {
  if (!nodeModule._extensions['.ts']) {
    nodeModule._extensions['.ts'] = (m, filename) => {
      const source = readFileSync(filename, 'utf8');
      const js = nodeModule.stripTypeScriptTypes!(source, {
        mode: 'transform',
      });

      (
        m as unknown as { _compile: (code: string, fn: string) => void }
      )._compile(js, filename);
    };
  }

  const registered = globalThis as unknown as { __tsStripLoader?: boolean };

  if (!registered.__tsStripLoader) {
    register(pathToFileURL(path.join(__dirname, 'ts-strip-loader.mjs')).href);
    registered.__tsStripLoader = true;
  }
}

// Disable chalk in test
process.env.FORCE_COLOR = '0';

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    workspace: path.join(__dirname, '..', '..'),
    afterSerialize: serialized =>
      serialized
        .replace(
          /(?<=\.modern-js\/tsgo\/tsconfig\.)[a-f0-9]{10}(?=\.json)/gu,
          '<hash>',
        )
        .replaceAll('<PNPM_INNER>', '<WORKSPACE>/node_modules/<PNPM_INNER>'),
    replace: [
      {
        mark: 'fragment',
        match: /(?<=\/)modern-js\/stub-builder\/[^/]+\/[^/]+/,
      },
    ],
  }),
);
