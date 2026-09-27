import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findOverrideViolations,
  parseOverrideKey,
  readImporterNames,
} from '../check-overrides.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

test('workspace lockfile has only live, honoured overrides', () => {
  const lockfileText = readFileSync(
    path.join(repoRoot, 'pnpm-lock.yaml'),
    'utf8',
  );
  assert.deepEqual(
    findOverrideViolations(
      lockfileText,
      readImporterNames(lockfileText, repoRoot),
    ),
    [],
  );
});

test('override keys split on the parent separator, not on range operators', () => {
  assert.deepEqual(parseOverrideKey('react-router@>=7.0.0 <7.18.2'), {
    target: { name: 'react-router', range: '>=7.0.0 <7.18.2' },
  });
  assert.deepEqual(parseOverrideKey('minimatch@3>brace-expansion'), {
    parent: { name: 'minimatch', range: '3' },
    target: { name: 'brace-expansion', range: undefined },
  });
  assert.deepEqual(parseOverrideKey('@modern-js/runtime-utils>react-router'), {
    parent: { name: '@modern-js/runtime-utils', range: undefined },
    target: { name: 'react-router', range: undefined },
  });
});

// Shape of the lockfile before the dead overrides were removed: nx@23.2.1
// kept brace-expansion 5.0.9 because pnpm never matched `brace-expansion@`.
const preFixLockfile = `
lockfileVersion: '9.0'
overrides:
  '@remix-run/router': '>=1.23.4'
  '@modern-js/runtime-utils>react-router': 7.18.2
  '@isaacs/brace-expansion': '>=5.0.1'
  minimatch@3>brace-expansion: 1.1.18
  brace-expansion@: 5.0.12
importers:
  packages/toolkit/runtime-utils:
    dependencies:
      react-router:
        specifier: 7.18.4
        version: 7.18.2
packages:
  brace-expansion@1.1.18: {}
  brace-expansion@5.0.9: {}
  minimatch@3.1.5: {}
  nx@23.2.1: {}
  react-router@7.18.2: {}
snapshots:
  brace-expansion@1.1.18: {}
  brace-expansion@5.0.9: {}
  minimatch@3.1.5:
    dependencies:
      brace-expansion: 1.1.18
  nx@23.2.1:
    dependencies:
      brace-expansion: 5.0.9
  react-router@7.18.2: {}
`;

const importerNames = new Map([
  [
    '@modern-js/runtime-utils',
    { path: 'packages/toolkit/runtime-utils', version: '3.0.0' },
  ],
]);

test('dead, inverted and unmatched overrides each name their fix', () => {
  const violations = findOverrideViolations(preFixLockfile, importerNames);
  assert.equal(violations.length, 4);
  assert.match(
    violations[0],
    /^'@remix-run\/router': nothing in the lockfile resolves @remix-run\/router\. Delete/,
  );
  assert.match(
    violations[1],
    /workspace package.*set react-router in packages\/toolkit\/runtime-utils\/package\.json/,
  );
  assert.match(violations[2], /resolves @isaacs\/brace-expansion\. Delete/);
  assert.match(
    violations[3],
    /'brace-expansion@' has an empty version selector/,
  );
});

test('a resolution left inside a closed range fails', () => {
  const lockfile = preFixLockfile.replace(
    /overrides:[\s\S]*?importers:/,
    'overrides:\n  brace-expansion@>=5.0.0 <5.0.12: 5.0.12\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
  );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'brace-expansion@>=5.0.0 <5.0.12': the lockfile still resolves brace-expansion@5.0.9, which this override should replace with 5.0.12. " +
      'Run pnpm install, or fix the selector if pnpm does not match it.',
  ]);
});

test('a parent snapshot that ignores its override fails', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
    )
    .replace(
      'minimatch@3.1.5:\n    dependencies:\n      brace-expansion: 1.1.18',
      'minimatch@3.1.5:\n    dependencies:\n      brace-expansion: 5.0.9',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'minimatch@3>brace-expansion': minimatch@3.1.5 still resolves brace-expansion@5.0.9, not 1.1.18. " +
      'Run pnpm install so the lockfile picks up the override.',
  ]);
});

test('a parent that no longer depends on the target fails', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
    )
    .replace(
      'minimatch@3.1.5:\n    dependencies:\n      brace-expansion: 1.1.18',
      'minimatch@3.1.5: {}',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'minimatch@3>brace-expansion': no minimatch@3 in the lockfile depends on brace-expansion. Delete the override.",
  ]);
});

test('a removal override passes once the edge is gone and fails while it stays', () => {
  const withOverride = override =>
    preFixLockfile.replace(
      /overrides:[\s\S]*?importers:/,
      `overrides:\n  ${override}\nimporters:`,
    );
  assert.deepEqual(
    findOverrideViolations(
      withOverride("nx>brace-expansion: '-'").replace(
        'nx@23.2.1:\n    dependencies:\n      brace-expansion: 5.0.9',
        'nx@23.2.1: {}',
      ),
      importerNames,
    ),
    [],
  );
  assert.deepEqual(
    findOverrideViolations(
      withOverride("nx>brace-expansion: '-'"),
      importerNames,
    ),
    [
      "'nx>brace-expansion': nx@23.2.1 still depends on brace-expansion, which this override removes. " +
        'Run pnpm install so the lockfile picks up the override.',
    ],
  );
});

test('a removal override whose parent resolves nowhere fails', () => {
  const lockfile = preFixLockfile.replace(
    /overrides:[\s\S]*?importers:/,
    "overrides:\n  old-parent>brace-expansion: '-'\nimporters:",
  );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'old-parent>brace-expansion': nothing in the lockfile resolves old-parent. Delete the override.",
  ]);
});

test('a prerelease outside the selector is not flagged', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  brace-expansion@>=5.0.0 <5.0.12: 5.0.12\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
    )
    .replaceAll('brace-expansion@5.0.9', 'brace-expansion@5.0.9-beta.1')
    .replace('brace-expansion: 5.0.9', 'brace-expansion: 5.0.9-beta.1');
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), []);
});

test('a prerelease left under a range override fails', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      "overrides:\n  react-router: '>=7.18.0'\nimporters:",
    )
    .replaceAll('7.18.2', '7.19.0-beta.1');
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'react-router': the lockfile still resolves react-router@7.19.0-beta.1, which this override should replace with >=7.18.0. " +
      'Run pnpm install, or fix the selector if pnpm does not match it.',
  ]);
});

test('a global removal override still fails while a workspace project keeps the edge', () => {
  const lockfile = preFixLockfile.replace(
    /overrides:[\s\S]*?importers:/,
    "overrides:\n  react-router: '-'\nimporters:",
  );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'react-router': packages/toolkit/runtime-utils still depends on react-router, which this override removes. " +
      'Run pnpm install so the lockfile picks up the override.',
  ]);
});

test('an npm: alias override is live through its edge name', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  left-pad: npm:pad-left@1.0.0\nimporters:',
    )
    .replace(
      'nx@23.2.1:\n    dependencies:',
      'nx@23.2.1:\n    dependencies:\n      left-pad: pad-left@1.0.0',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), []);
});

test('an npm: alias override fails while the edge keeps another version', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  nx>left-pad: npm:pad-left@1.2.3\nimporters:',
    )
    .replace(
      'nx@23.2.1:\n    dependencies:',
      'nx@23.2.1:\n    dependencies:\n      left-pad: pad-left@1.0.0',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'nx>left-pad': nx@23.2.1 still resolves left-pad@pad-left@1.0.0, not npm:pad-left@1.2.3. " +
      'Run pnpm install so the lockfile picks up the override.',
  ]);
  assert.deepEqual(
    findOverrideViolations(
      lockfile.replace('left-pad: pad-left@1.0.0', 'left-pad: pad-left@1.2.3'),
      importerNames,
    ),
    [],
  );
});

test('digit-leading package names parse and validate', () => {
  assert.deepEqual(parseOverrideKey('parent>2-decode'), {
    parent: { name: 'parent', range: undefined },
    target: { name: '2-decode', range: undefined },
  });
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  left-pad: npm:2-decode@1.2.3\nimporters:',
    )
    .replace(
      'nx@23.2.1:\n    dependencies:',
      'nx@23.2.1:\n    dependencies:\n      left-pad: 2-decode@1.0.0',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'left-pad': the lockfile still resolves left-pad@2-decode@1.0.0, which this override should replace with npm:2-decode@1.2.3. " +
      'Run pnpm install, or fix the selector if pnpm does not match it.',
  ]);
});

test('a parent override takes precedence over a generic one', () => {
  const lockfile = preFixLockfile.replace(
    /overrides:[\s\S]*?importers:/,
    'overrides:\n  brace-expansion: 5.0.9\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
  );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), []);
});

test('a parent selector that excludes the workspace version targets registry copies', () => {
  const lockfile = preFixLockfile.replace(
    /overrides:[\s\S]*?importers:/,
    'overrides:\n  minimatch@3>brace-expansion: 1.1.18\nimporters:',
  );
  const workspaceMinimatch = new Map([
    ['minimatch', { path: 'packages/minimatch', version: '10.0.0' }],
  ]);
  assert.deepEqual(findOverrideViolations(lockfile, workspaceMinimatch), []);
  assert.match(
    findOverrideViolations(
      lockfile,
      new Map([
        ['minimatch', { path: 'packages/minimatch', version: '3.0.0' }],
      ]),
    )[0],
    /workspace package.*set brace-expansion in packages\/minimatch\/package\.json/,
  );
});

test('a parent override of a peer without a snapshot edge is live', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      "overrides:\n  nx>react: '19.3.0'\nimporters:",
    )
    .replace(
      '  nx@23.2.1: {}\n',
      "  nx@23.2.1:\n    peerDependencies:\n      react: '19.3.0'\n",
    )
    .replace(
      'nx@23.2.1:\n    dependencies:',
      'nx@23.2.1:\n    dependencies:\n      react-dom: 19.3.0',
    );
  // react resolves only through another package's edge name.
  const withEdge = lockfile.replace(
    'minimatch@3.1.5:\n    dependencies:',
    'minimatch@3.1.5:\n    dependencies:\n      react: 19.3.0',
  );
  assert.deepEqual(findOverrideViolations(withEdge, importerNames), []);
  assert.match(
    findOverrideViolations(
      withEdge.replace("    peerDependencies:\n      react: '19.3.0'\n", ''),
      importerNames,
    )[0],
    /no nx in the lockfile depends on react\. Delete/,
  );
});

test('an unranged override judges git and file edges too', () => {
  const lockfile = preFixLockfile
    .replace(
      /overrides:[\s\S]*?importers:/,
      'overrides:\n  left-pad: 2.0.0\nimporters:',
    )
    .replace(
      'nx@23.2.1:\n    dependencies:',
      'nx@23.2.1:\n    dependencies:\n      left-pad: https://codeload.github.com/a/left-pad/tar.gz/abc',
    );
  assert.deepEqual(findOverrideViolations(lockfile, importerNames), [
    "'left-pad': the lockfile still resolves left-pad@https://codeload.github.com/a/left-pad/tar.gz/abc, which this override should replace with 2.0.0. " +
      'Run pnpm install, or fix the selector if pnpm does not match it.',
  ]);
});

test('peer ranges prove liveness but are not judged', () => {
  // The lockfile keeps a peer range as published even after an override
  // applies: follow-redirects keeps peer `debug: '*'` under
  // `debug: '>=4.4.3'`.
  const lockfile = preFixLockfile.replace(
    '  nx@23.2.1: {}\n',
    '  nx@23.2.1:\n    peerDependencies:\n      react: ^18\n',
  );
  for (const override of [
    "  react: '^19'",
    "  nx>react: '^19'",
    "  nx>react@^18: '^19'",
  ]) {
    assert.deepEqual(
      findOverrideViolations(
        lockfile.replace(
          /overrides:[\s\S]*?importers:/,
          `overrides:\n${override}\nimporters:`,
        ),
        importerNames,
      ),
      [],
    );
  }
});
