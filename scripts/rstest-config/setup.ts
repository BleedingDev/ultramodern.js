import { expect } from '@rstest/core';
import { Console } from 'console';
import path from 'path';
import { createSnapshotSerializer } from 'path-serializer';

global.console.Console = Console;

// Disable chalk in test
process.env.FORCE_COLOR = '0';

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    workspace: path.join(__dirname, '..', '..'),
    afterSerialize: serialized =>
      serialized.replaceAll(
        '<PNPM_INNER>',
        '<WORKSPACE>/node_modules/<PNPM_INNER>',
      ),
    replace: [
      {
        mark: 'fragment',
        match: /(?<=\/)modern-js\/stub-builder\/[^/]+\/[^/]+/,
      },
    ],
  }),
);
