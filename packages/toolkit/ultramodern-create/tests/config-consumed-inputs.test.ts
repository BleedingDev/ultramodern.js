import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  captureConfigSourceSnapshot,
  type ObservedConfigSourceInput,
  type ObservedConfigSourceInputs,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { assertConsumedConfigInputsUnchanged } from '../src/ultramodern-workspace/config-consumed-inputs';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';

const consumedInputError = /changed a source input consumed by modern\.config/u;
const shellDirectory = 'apps/shell-super-app';

function write(root: string, relative: string, content: string) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}

function guardFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-consumed-inputs-'),
  );
  const root = path.join(directory, 'original');
  const stagedRoot = path.join(directory, 'staged');
  write(root, 'app/modern.config.ts', "export default {renderer: 'solid'};\n");
  write(root, 'topology/reference-topology.json', '{"verticals":[]}\n');
  const observe = (
    relative: string,
    operation: ObservedConfigSourceInput['operation'],
    existed = true,
  ): ObservedConfigSourceInput => ({
    path: path.join(root, relative),
    canonicalPath: existed
      ? fs.realpathSync.native(path.join(root, relative))
      : path.join(fs.realpathSync.native(root), relative),
    operation,
    existed,
  });
  const captureInputs = (
    consumedSourceInputs: ObservedConfigSourceInputs,
    extraInputs: readonly string[] = [],
  ) => {
    const sourceSnapshot = captureConfigSourceSnapshot({
      sourceRoots: [root],
      extraInputs,
    });
    fs.cpSync(root, stagedRoot, {
      recursive: true,
      verbatimSymlinks: true,
    });
    return () =>
      assertConsumedConfigInputsUnchanged({
        workspaceRoot: root,
        stagedWorkspaceRoot: stagedRoot,
        captures: [{ sourceSnapshot, consumedSourceInputs }],
      });
  };
  const capture = (
    observations: readonly ObservedConfigSourceInput[],
    extraInputs: readonly string[] = [],
    packageMetadata: ObservedConfigSourceInputs['packageMetadata'] = [],
  ) =>
    captureInputs(
      {
        kind: 'observed-config-source-inputs',
        version: 1,
        observations,
        packageMetadata,
      },
      extraInputs,
    );
  return {
    root,
    stagedRoot,
    observe,
    capture,
    captureInputs,
    packageMetadata: (
      relative: string,
      field: 'name' | 'type',
      value: string,
    ): ObservedConfigSourceInputs['packageMetadata'][number] => ({
      path: path.join(root, relative),
      canonicalPath: fs.realpathSync.native(path.join(root, relative)),
      field,
      value,
    }),
    clean: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function workspaceBytes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, entry);
      const relative = path.relative(root, filename);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) {
        result[relative] = `symlink:${fs.readlinkSync(filename)}`;
      } else if (stat.isDirectory()) {
        result[`${relative}/`] = `directory:${stat.mode}`;
        visit(filename);
      } else {
        result[relative] =
          `file:${stat.mode}:${fs.readFileSync(filename).toString('base64')}`;
      }
    }
  };
  visit(root);
  return result;
}

async function solidWorkspace(directory: string) {
  const root = path.join(directory, 'workspace');
  await generateUltramodernWorkspace({
    targetDir: root,
    packageName: 'consumed-inputs',
    modernVersion: '3.8.3',
    renderer: 'solid',
    enableTailwind: false,
    generateAgentFiles: false,
    packageSource: { strategy: 'workspace' },
  });
  return root;
}

test('an unchanged consumed input survives copying to a distinct stage', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([
      f.observe('topology/reference-topology.json', 'content'),
    ]);
    assert.notEqual(
      fs.statSync(path.join(f.root, 'topology/reference-topology.json')).ino,
      fs.statSync(path.join(f.stagedRoot, 'topology/reference-topology.json'))
        .ino,
    );
    assert.doesNotThrow(guard);
  } finally {
    f.clean();
  }
});

for (const operation of ['content', 'module'] as const) {
  test(`a changed ${operation} input rejects the staged projection`, () => {
    const f = guardFixture();
    try {
      const guard = f.capture([
        f.observe('topology/reference-topology.json', operation),
      ]);
      write(
        f.stagedRoot,
        'topology/reference-topology.json',
        '{"verticals":[{"id":"added"}]}\n',
      );
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('a changed topology remains allowed when the config did not consume it', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([f.observe('app/modern.config.ts', 'module')]);
    write(
      f.stagedRoot,
      'topology/reference-topology.json',
      '{"verticals":[{"id":"added"}]}\n',
    );
    assert.doesNotThrow(guard);
  } finally {
    f.clean();
  }
});

test('a missing consumed path rejects creation of the projected file', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([
      f.observe('app/shared/ultramodern-build.json', 'metadata', false),
    ]);
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'app/shared/ultramodern-build.json', '{}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native package discovery permits content updates at the same found manifest', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    const guard = f.capture([f.observe('app/package.json', 'existence')]);
    write(
      f.stagedRoot,
      'app/package.json',
      '{"name":"@test/shell","dependencies":{"@test/api":"workspace:*"}}\n',
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'app/package.json'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native package discovery rejects creation of a previously missing nearer manifest', () => {
  const f = guardFixture();
  try {
    write(f.root, 'package.json', '{"name":"@test/workspace"}\n');
    const guard = f.capture([
      f.observe('app/package.json', 'existence', false),
      f.observe('package.json', 'existence'),
    ]);
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'app/package.json', '{"name":"@test/new-app"}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

for (const operation of ['metadata', 'content', 'module'] as const) {
  test(`authored ${operation} remains protected alongside native package discovery`, () => {
    const f = guardFixture();
    try {
      write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
      const guard = f.capture([
        f.observe('app/package.json', 'existence'),
        f.observe('app/package.json', operation),
      ]);
      write(
        f.stagedRoot,
        'app/package.json',
        '{"name":"@test/shell","exports":{"./api":"./api/index.ts"}}\n',
      );
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('native package discovery preserves the found manifest mode', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    fs.chmodSync(path.join(f.root, 'app/package.json'), 0o600);
    const guard = f.capture([f.observe('app/package.json', 'existence')]);
    fs.chmodSync(path.join(f.stagedRoot, 'app/package.json'), 0o644);
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native package discovery preserves the lexical link to the found manifest', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/one.json', '{"name":"@test/shell"}\n');
    write(f.root, 'app/two.json', '{"name":"@test/shell"}\n');
    fs.symlinkSync('one.json', path.join(f.root, 'app/package.json'));
    const guard = f.capture([f.observe('app/package.json', 'existence')]);
    fs.unlinkSync(path.join(f.stagedRoot, 'app/package.json'));
    fs.symlinkSync('two.json', path.join(f.stagedRoot, 'app/package.json'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native entry kind checks permit updates beneath the same source directory', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/src/routes/page.tsx', 'export default () => null;\n');
    const guard = f.capture([
      f.observe('app/src', 'entry-kind'),
      f.observe('app/src/routes', 'entry-kind'),
    ]);
    write(f.stagedRoot, 'app/src/api/client.ts', 'export const api = {};\n');
    write(
      f.stagedRoot,
      'app/src/routes/page.tsx',
      'export default () => "updated";\n',
    );
    assert.doesNotThrow(guard);
  } finally {
    f.clean();
  }
});

for (const operation of ['metadata', 'directory'] as const) {
  test(`authored ${operation} remains protected alongside native entry kind checks`, () => {
    const f = guardFixture();
    try {
      write(f.root, 'app/src/routes/page.tsx', 'export default () => null;\n');
      const guard = f.capture([
        f.observe('app/src', 'entry-kind'),
        f.observe('app/src', operation),
      ]);
      write(f.stagedRoot, 'app/src/api/client.ts', 'export const api = {};\n');
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('authored content remains protected alongside native entry kind checks', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/src/routes/page.tsx', 'export default () => null;\n');
    const guard = f.capture([
      f.observe('app/src', 'entry-kind'),
      f.observe('app/src/routes/page.tsx', 'content'),
    ]);
    write(
      f.stagedRoot,
      'app/src/routes/page.tsx',
      'export default () => "updated";\n',
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native entry kind checks reject a source directory replaced by a file', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/src/routes/page.tsx', 'export default () => null;\n');
    const guard = f.capture([f.observe('app/src', 'entry-kind')]);
    fs.rmSync(path.join(f.stagedRoot, 'app/src'), { recursive: true });
    write(f.stagedRoot, 'app/src', 'replaced directory\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native entry kind checks reject creation of a previously missing source path', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([f.observe('app/src', 'entry-kind', false)]);
    assert.doesNotThrow(guard);
    write(
      f.stagedRoot,
      'app/src/routes/page.tsx',
      'export default () => null;\n',
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native entry kind checks retain source directory modes', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/src/routes/page.tsx', 'export default () => null;\n');
    fs.chmodSync(path.join(f.root, 'app/src'), 0o700);
    const guard = f.capture([f.observe('app/src', 'entry-kind')]);
    fs.chmodSync(path.join(f.stagedRoot, 'app/src'), 0o755);
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('native entry kind checks retain the lexical link to the source directory', () => {
  const f = guardFixture();
  try {
    write(
      f.root,
      'app/source-one/routes/page.tsx',
      'export default () => null;\n',
    );
    write(
      f.root,
      'app/source-two/routes/page.tsx',
      'export default () => null;\n',
    );
    fs.symlinkSync('source-one', path.join(f.root, 'app/src'));
    const guard = f.capture([f.observe('app/src', 'entry-kind')]);
    fs.unlinkSync(path.join(f.stagedRoot, 'app/src'));
    fs.symlinkSync('source-two', path.join(f.stagedRoot, 'app/src'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal package-metadata observation permits API dependency and export updates', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    const guard = f.capture(
      [],
      [],
      [
        f.packageMetadata('app/package.json', 'name', '@test/shell'),
        f.packageMetadata('app/package.json', 'type', 'commonjs'),
      ],
    );
    assert.doesNotThrow(guard);
    write(
      f.stagedRoot,
      'app/package.json',
      '{"name":"@test/shell","dependencies":{"@test/api":"workspace:*"},"exports":{"./api/clients":"./src/api/vertical-clients.ts"}}\n',
    );
    assert.doesNotThrow(guard);
  } finally {
    f.clean();
  }
});

for (const type of [undefined, null, false, 0, '', 'commonjs', 'module']) {
  test(`an effective package-metadata type ${JSON.stringify(type)} permits dependency updates`, () => {
    const f = guardFixture();
    try {
      write(
        f.root,
        'app/package.json',
        JSON.stringify({ name: '@test/shell', type }),
      );
      const effectiveType =
        typeof type === 'string' && type ? type : 'commonjs';
      const guard = f.capture(
        [],
        [],
        [
          f.packageMetadata('app/package.json', 'name', '@test/shell'),
          f.packageMetadata('app/package.json', 'type', effectiveType),
        ],
      );
      assert.doesNotThrow(guard);
      write(
        f.stagedRoot,
        'app/package.json',
        JSON.stringify({
          name: '@test/shell',
          type: effectiveType,
          dependencies: { '@test/api': 'workspace:*' },
          exports: { './api/clients': './src/api/vertical-clients.ts' },
        }),
      );
      assert.doesNotThrow(guard);
    } finally {
      f.clean();
    }
  });
}

for (const type of [undefined, 'commonjs', '', true, 7, {}]) {
  test(`a changed package-metadata type rejects ${JSON.stringify(type)}`, () => {
    const f = guardFixture();
    try {
      write(
        f.root,
        'app/package.json',
        '{"name":"@test/shell","type":"module"}\n',
      );
      const guard = f.capture(
        [],
        [],
        [f.packageMetadata('app/package.json', 'type', 'module')],
      );
      write(
        f.stagedRoot,
        'app/package.json',
        JSON.stringify({ name: '@test/shell', type }),
      );
      assert.throws(guard, /The staged consumed package type changed/u);
    } finally {
      f.clean();
    }
  });
}

for (const field of ['name', 'type'] as const) {
  test(`a package-metadata ${field} claim must match the original manifest`, () => {
    const f = guardFixture();
    try {
      write(
        f.root,
        'app/package.json',
        '{"name":"@test/shell","type":"module"}\n',
      );
      const value = field === 'name' ? '@test/other' : 'commonjs';
      const guard = f.capture(
        [],
        [],
        [f.packageMetadata('app/package.json', field, value)],
      );
      write(
        f.stagedRoot,
        'app/package.json',
        JSON.stringify({ name: '@test/shell', type: 'module', [field]: value }),
      );
      assert.throws(
        guard,
        new RegExp(`The original consumed package ${field} changed`, 'u'),
      );
    } finally {
      f.clean();
    }
  });
}

test('a package-metadata type projection remains protected when the stage is the original root', () => {
  const f = guardFixture();
  try {
    write(
      f.root,
      'app/package.json',
      '{"name":"@test/shell","type":"module"}\n',
    );
    const sourceSnapshot = captureConfigSourceSnapshot({
      sourceRoots: [f.root],
    });
    const consumedSourceInputs: ObservedConfigSourceInputs = {
      kind: 'observed-config-source-inputs',
      version: 1,
      observations: [],
      packageMetadata: [
        f.packageMetadata('app/package.json', 'name', '@test/shell'),
        f.packageMetadata('app/package.json', 'type', 'module'),
      ],
    };
    const guard = () =>
      assertConsumedConfigInputsUnchanged({
        workspaceRoot: f.root,
        stagedWorkspaceRoot: f.root,
        captures: [{ sourceSnapshot, consumedSourceInputs }],
      });
    write(
      f.root,
      'app/package.json',
      '{"name":"@test/shell","type":"module","dependencies":{"@test/api":"workspace:*"}}\n',
    );
    assert.doesNotThrow(guard);
    write(
      f.root,
      'app/package.json',
      '{"name":"@test/shell","type":"commonjs"}\n',
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

for (const manifest of [
  '{"name":"@test/other"}',
  '{"dependencies":{"@test/api":"workspace:*"}}',
  '{"name":17}',
  'null',
  '[]',
  '{',
]) {
  test(`a changed package-metadata manifest rejects ${manifest}`, () => {
    const f = guardFixture();
    try {
      write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
      const guard = f.capture(
        [],
        [],
        [
          f.packageMetadata('app/package.json', 'name', '@test/shell'),
          f.packageMetadata('app/package.json', 'type', 'commonjs'),
        ],
      );
      write(f.stagedRoot, 'app/package.json', `${manifest}\n`);
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

for (const operation of ['content', 'module'] as const) {
  test(`an authored ${operation} read retains full protection beside package-metadata evidence`, () => {
    const f = guardFixture();
    try {
      write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
      fs.symlinkSync(
        'package.json',
        path.join(f.root, 'app/authored-manifest.json'),
      );
      const guard = f.capture(
        [f.observe('app/authored-manifest.json', operation)],
        [],
        [
          f.packageMetadata('app/package.json', 'name', '@test/shell'),
          f.packageMetadata('app/package.json', 'type', 'commonjs'),
        ],
      );
      write(
        f.stagedRoot,
        'app/package.json',
        '{"name":"@test/shell","dependencies":{"@test/api":"workspace:*"}}\n',
      );
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('a changed package-metadata file mode rejects the staged projection', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    fs.chmodSync(path.join(f.root, 'app/package.json'), 0o644);
    const guard = f.capture(
      [],
      [],
      [f.packageMetadata('app/package.json', 'name', '@test/shell')],
    );
    fs.chmodSync(path.join(f.stagedRoot, 'app/package.json'), 0o600);
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a changed package-metadata link rejects another file with the same name', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/first.json', '{"name":"@test/shell"}\n');
    write(f.root, 'app/second.json', '{"name":"@test/shell"}\n');
    fs.symlinkSync('first.json', path.join(f.root, 'app/package.json'));
    const guard = f.capture(
      [],
      [],
      [f.packageMetadata('app/package.json', 'name', '@test/shell')],
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'app/package.json'));
    fs.symlinkSync('second.json', path.join(f.stagedRoot, 'app/package.json'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal package-metadata alias retains its own captured link route', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    fs.symlinkSync('package.json', path.join(f.root, 'app/alias.json'));
    const guard = f.capture(
      [],
      [],
      [
        f.packageMetadata('app/package.json', 'name', '@test/shell'),
        f.packageMetadata('app/alias.json', 'name', '@test/shell'),
      ],
    );
    write(
      f.stagedRoot,
      'app/package.json',
      '{"name":"@test/shell","dependencies":{"@test/api":"workspace:*"}}\n',
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'app/alias.json'));
    write(f.stagedRoot, 'app/alias.json', '{"name":"@test/shell"}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a changed package-metadata canonical claim rejects a different captured file', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    write(f.root, 'app/other.json', '{"name":"@test/shell"}\n');
    const guard = f.capture(
      [],
      [],
      [
        {
          ...f.packageMetadata('app/package.json', 'name', '@test/shell'),
          canonicalPath: fs.realpathSync.native(
            path.join(f.root, 'app/other.json'),
          ),
        },
      ],
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a malformed package-metadata canonical path cannot use the workspace symlink spelling', () => {
  const f = guardFixture();
  try {
    write(f.root, 'app/package.json', '{"name":"@test/shell"}\n');
    const aliasRoot = `${f.root}-alias`;
    fs.symlinkSync(f.root, aliasRoot);
    const lexicalPath = path.join(aliasRoot, 'app/package.json');
    const sourceSnapshot = captureConfigSourceSnapshot({
      sourceRoots: [aliasRoot],
    });
    fs.cpSync(f.root, f.stagedRoot, {
      recursive: true,
      verbatimSymlinks: true,
    });
    assert.throws(
      () =>
        assertConsumedConfigInputsUnchanged({
          workspaceRoot: aliasRoot,
          stagedWorkspaceRoot: f.stagedRoot,
          captures: [
            {
              sourceSnapshot,
              consumedSourceInputs: {
                kind: 'observed-config-source-inputs',
                version: 1,
                observations: [],
                packageMetadata: [
                  {
                    path: lexicalPath,
                    canonicalPath: lexicalPath,
                    field: 'name',
                    value: '@test/shell',
                  },
                ],
              },
            },
          ],
        }),
      consumedInputError,
    );
  } finally {
    f.clean();
  }
});

test('a missing package-metadata file cannot grant content changes', () => {
  const f = guardFixture();
  try {
    const filename = path.join(f.root, 'app/package.json');
    const guard = f.capture(
      [],
      [],
      [
        {
          path: filename,
          canonicalPath: filename,
          field: 'name',
          value: '@test/shell',
        },
      ],
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal package-metadata file beneath an excluded directory needs explicit coverage', () => {
  const f = guardFixture();
  try {
    write(f.root, 'dist/package.json', '{"name":"@test/shell"}\n');
    const evidence = f.packageMetadata(
      'dist/package.json',
      'name',
      '@test/shell',
    );
    const guard = f.capture([], [], [evidence]);
    assert.throws(guard, consumedInputError);
    const covered = f.capture(
      [],
      [path.join(f.root, 'dist/package.json')],
      [evidence],
    );
    write(
      f.stagedRoot,
      'dist/package.json',
      '{"name":"@test/shell","exports":{"./api":"./api.ts"}}\n',
    );
    assert.doesNotThrow(covered);
  } finally {
    f.clean();
  }
});

for (const invalid of [
  null,
  {},
  [
    {
      path: 'app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/shell',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: 'app/package.json',
      field: 'name',
      value: '@test/shell',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/../app/package.json',
      field: 'name',
      value: '@test/shell',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: 7,
    },
  ],
  [{ path: '/app/package.json', canonicalPath: '/app/package.json' }],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/shell',
      ignored: true,
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/shell',
    },
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/shell',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/shell',
    },
    {
      path: '/app/alias.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '@test/other',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'exports',
      value: 'commonjs',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'type',
      value: '',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'name',
      value: '   ',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'type',
      value: 'commonjs',
    },
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'type',
      value: 'commonjs',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      field: 'type',
      value: 'module',
    },
    {
      path: '/app/alias.json',
      canonicalPath: '/app/package.json',
      field: 'type',
      value: 'commonjs',
    },
  ],
  [
    {
      path: '/app/package.json',
      canonicalPath: '/app/package.json',
      name: '@test/shell',
    },
  ],
]) {
  test(`a malformed package-metadata evidence array rejects ${JSON.stringify(invalid)}`, () => {
    const f = guardFixture();
    try {
      const guard = f.capture([], [], JSON.parse(JSON.stringify(invalid)));
      assert.throws(guard, /Invalid consumed package-metadata evidence/u);
    } finally {
      f.clean();
    }
  });
}

test('a missing package-metadata evidence array is rejected', () => {
  const f = guardFixture();
  try {
    const guard = f.captureInputs(
      JSON.parse(
        JSON.stringify({
          kind: 'observed-config-source-inputs',
          version: 1,
          observations: [],
        }),
      ),
    );
    assert.throws(guard, /Invalid consumed package-metadata evidence/u);
  } finally {
    f.clean();
  }
});

test('a legacy package-name evidence alias is rejected beside package-metadata', () => {
  const f = guardFixture();
  try {
    const guard = f.captureInputs(
      JSON.parse(
        JSON.stringify({
          kind: 'observed-config-source-inputs',
          version: 1,
          observations: [],
          packageMetadata: [],
          packageNames: [],
        }),
      ),
    );
    assert.throws(guard, /Invalid consumed package-metadata evidence/u);
  } finally {
    f.clean();
  }
});

test('a directory observation rejects a newly projected descendant', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([f.observe('topology', 'directory')]);
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'topology/local-overlays/development.json', '{}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a directory metadata observation rejects a newly projected descendant', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([f.observe('topology', 'metadata')]);
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'topology/local-overlays/development.json', '{}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a symlink observation compares its canonical file across stage relocation', () => {
  const f = guardFixture();
  try {
    fs.symlinkSync(
      'topology/reference-topology.json',
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture([f.observe('membership.json', 'content')]);
    assert.doesNotThrow(guard);
    write(
      f.stagedRoot,
      'topology/reference-topology.json',
      '{"verticals":[{"id":"added"}]}\n',
    );
    assert.equal(
      fs.readlinkSync(path.join(f.stagedRoot, 'membership.json')),
      'topology/reference-topology.json',
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an absolute consumed link permits the transaction rewrite and rejects a target edit', () => {
  const f = guardFixture();
  try {
    const target = 'topology/reference-topology.json';
    fs.symlinkSync(
      path.join(f.root, target),
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture([f.observe('membership.json', 'content')]);
    // Match copyWorkspaceToStage: internal absolute targets point into the stage.
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, target),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    write(f.stagedRoot, target, '{"verticals":[{"id":"added"}]}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

for (const change of ['canonical target', 'link target'] as const) {
  test(`a lexical descendant beneath a directory symlink rejects a changed ${change}`, () => {
    const f = guardFixture();
    try {
      write(
        f.root,
        'alternate-topology/reference-topology.json',
        '{"verticals":[]}\n',
      );
      fs.symlinkSync('topology', path.join(f.root, 'membership'));
      const guard = f.capture([
        f.observe('membership/reference-topology.json', 'content'),
      ]);
      assert.doesNotThrow(guard);
      if (change === 'canonical target') {
        write(
          f.stagedRoot,
          'topology/reference-topology.json',
          '{"verticals":[{"id":"added"}]}\n',
        );
      } else {
        fs.unlinkSync(path.join(f.stagedRoot, 'membership'));
        fs.symlinkSync(
          'alternate-topology',
          path.join(f.stagedRoot, 'membership'),
        );
      }
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('a lexical missing input rejects a directory link retarget to an existing file', () => {
  const f = guardFixture();
  try {
    write(f.root, 'alternate-topology/new.json', '{}\n');
    fs.symlinkSync('topology', path.join(f.root, 'membership'));
    const guard = f.capture([
      {
        ...f.observe('membership/new.json', 'metadata', false),
        canonicalPath: path.join(
          fs.realpathSync.native(f.root),
          'topology/new.json',
        ),
      },
    ]);
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'membership'));
    fs.symlinkSync('alternate-topology', path.join(f.stagedRoot, 'membership'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal absolute link preserves checks of the captured target link chain', () => {
  const f = guardFixture();
  try {
    write(f.root, 'topology/alternate.json', '{"verticals":[]}\n');
    fs.symlinkSync(
      'topology/reference-topology.json',
      path.join(f.root, 'target-link.json'),
    );
    fs.symlinkSync(
      path.join(f.root, 'target-link.json'),
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture([f.observe('membership.json', 'content')]);
    // Absolute links are rewritten to the canonical internal target by the transaction.
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, 'topology/reference-topology.json'),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'target-link.json'));
    fs.symlinkSync(
      'topology/alternate.json',
      path.join(f.stagedRoot, 'target-link.json'),
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal absolute link retains traversal through a symlink before parent segments', () => {
  const f = guardFixture();
  try {
    write(f.root, 'deep/nested/placeholder.json', '{}\n');
    write(f.root, 'deep/entry.json', '{"entry":"owned"}\n');
    fs.symlinkSync('deep/nested', path.join(f.root, 'ancestor'));
    fs.symlinkSync(
      `${f.root}/ancestor/../entry.json`,
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture([f.observe('membership.json', 'content')]);
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, 'deep/entry.json'),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'deep/entry.json', '{"entry":"changed"}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a lexical observed path retains traversal through a symlink before parent segments', () => {
  const f = guardFixture();
  try {
    write(f.root, 'deep/nested/placeholder.json', '{}\n');
    write(f.root, 'deep/entry.json', '{"entry":"owned"}\n');
    fs.symlinkSync('deep/nested', path.join(f.root, 'ancestor'));
    const input = `${f.root}/ancestor/../entry.json`;
    const guard = f.capture([
      {
        path: input,
        canonicalPath: fs.realpathSync.native(input),
        operation: 'content',
        existed: true,
      },
    ]);
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'deep/entry.json', '{"entry":"changed"}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal absolute target through another root alias survives the stage rewrite', () => {
  const f = guardFixture();
  const aliasRoot = `${f.root}-alias`;
  try {
    fs.symlinkSync(f.root, aliasRoot);
    fs.symlinkSync(
      path.join(aliasRoot, 'topology/reference-topology.json'),
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture(
      [f.observe('membership.json', 'content')],
      [aliasRoot],
    );
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, 'topology/reference-topology.json'),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    write(
      f.stagedRoot,
      'topology/reference-topology.json',
      '{"verticals":[{"id":"added"}]}\n',
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal absolute target may leave and reenter the root before its captured file', () => {
  const f = guardFixture();
  try {
    const target = 'topology/reference-topology.json';
    fs.symlinkSync(
      `${f.root}/../${path.basename(f.root)}/${target}`,
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture([f.observe('membership.json', 'content')]);
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, target),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    write(f.stagedRoot, target, '{"verticals":[{"id":"added"}]}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

for (const position of ['before exit', 'after reentry'] as const) {
  test(`an internal absolute root reentry retains captured link checks ${position}`, () => {
    const f = guardFixture();
    try {
      write(f.root, 'deep/nested/placeholder.json', '{}\n');
      write(f.root, 'deep/alternate/placeholder.json', '{}\n');
      write(f.root, 'topology/alternate.json', '{"verticals":[]}\n');
      fs.symlinkSync('deep/nested', path.join(f.root, 'ancestor'));
      fs.symlinkSync(
        'topology/reference-topology.json',
        path.join(f.root, 'target-link.json'),
      );
      const target =
        position === 'before exit'
          ? `${f.root}/ancestor/../../../${path.basename(f.root)}/topology/reference-topology.json`
          : `${f.root}/../${path.basename(f.root)}/target-link.json`;
      fs.symlinkSync(target, path.join(f.root, 'membership.json'));
      const guard = f.capture([f.observe('membership.json', 'content')]);
      fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
      fs.symlinkSync(
        path.join(f.stagedRoot, 'topology/reference-topology.json'),
        path.join(f.stagedRoot, 'membership.json'),
      );
      assert.doesNotThrow(guard);
      const changedLink =
        position === 'before exit' ? 'ancestor' : 'target-link.json';
      fs.unlinkSync(path.join(f.stagedRoot, changedLink));
      fs.symlinkSync(
        position === 'before exit'
          ? 'deep/alternate'
          : 'topology/alternate.json',
        path.join(f.stagedRoot, changedLink),
      );
      assert.throws(guard, consumedInputError);
    } finally {
      f.clean();
    }
  });
}

test('an internal link reached through an external reentry shortcut remains checked', () => {
  const f = guardFixture();
  try {
    write(f.root, 'topology/alternate.json', '{"verticals":[]}\n');
    fs.symlinkSync(
      'topology/reference-topology.json',
      path.join(f.root, 'target-link.json'),
    );
    const shortcut = path.join(path.dirname(f.root), 'shortcut');
    fs.symlinkSync(path.join(f.root, 'target-link.json'), shortcut);
    fs.symlinkSync(
      `${f.root}/../shortcut`,
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture(
      [f.observe('membership.json', 'content')],
      [shortcut],
    );
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, 'topology/reference-topology.json'),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'target-link.json'));
    fs.symlinkSync(
      'topology/alternate.json',
      path.join(f.stagedRoot, 'target-link.json'),
    );
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal alternate root alias preserves the captured route used by its target', () => {
  const f = guardFixture();
  try {
    write(f.root, 'deep/nested/placeholder.json', '{}\n');
    write(f.root, 'deep/alternate/placeholder.json', '{}\n');
    fs.symlinkSync('deep/nested', path.join(f.root, 'ancestor'));
    const aliasRoot = `${f.root}-alias`;
    fs.symlinkSync(`${f.root}/ancestor/../..`, aliasRoot);
    fs.symlinkSync(
      path.join(aliasRoot, 'topology/reference-topology.json'),
      path.join(f.root, 'membership.json'),
    );
    const guard = f.capture(
      [f.observe('membership.json', 'content')],
      [aliasRoot],
    );
    fs.unlinkSync(path.join(f.stagedRoot, 'membership.json'));
    fs.symlinkSync(
      path.join(f.stagedRoot, 'topology/reference-topology.json'),
      path.join(f.stagedRoot, 'membership.json'),
    );
    assert.doesNotThrow(guard);
    fs.unlinkSync(path.join(f.stagedRoot, 'ancestor'));
    fs.symlinkSync('deep/alternate', path.join(f.stagedRoot, 'ancestor'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal route observed through another root alias rejects a new ancestor link', () => {
  const f = guardFixture();
  try {
    write(f.root, 'deep/nested/placeholder.json', '{}\n');
    write(f.root, 'deep/alternate/placeholder.json', '{}\n');
    const aliasRoot = `${f.root}-alias`;
    fs.symlinkSync(`${f.root}/deep/nested/../..`, aliasRoot);
    const input = path.join(aliasRoot, 'topology/reference-topology.json');
    const guard = f.capture(
      [
        {
          path: input,
          canonicalPath: fs.realpathSync.native(input),
          operation: 'content',
          existed: true,
        },
      ],
      [aliasRoot],
    );
    assert.doesNotThrow(guard);
    fs.rmSync(path.join(f.stagedRoot, 'deep/nested'), { recursive: true });
    fs.symlinkSync('alternate', path.join(f.stagedRoot, 'deep/nested'));
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('an internal declared extra input beneath an excluded directory remains captured', () => {
  const f = guardFixture();
  try {
    write(f.root, 'dist/owned-input.json', '{"entry":"owned"}\n');
    const guard = f.capture(
      [f.observe('dist/owned-input.json', 'content')],
      [path.join(f.root, 'dist/owned-input.json')],
    );
    assert.doesNotThrow(guard);
    write(f.stagedRoot, 'dist/owned-input.json', '{"entry":"changed"}\n');
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a missing untracked input beneath an excluded directory rejects absent coverage', () => {
  const f = guardFixture();
  try {
    const guard = f.capture([
      f.observe('dist/untracked.json', 'metadata', false),
    ]);
    assert.throws(guard, consumedInputError);
  } finally {
    f.clean();
  }
});

test('a topology-dependent original callback runs once and an API-only add rolls back', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-consumed-topology-add-'),
  );
  try {
    const root = await solidWorkspace(directory);
    const observations = path.join(directory, 'callbacks.jsonl');
    write(
      root,
      `${shellDirectory}/modern.config.ts`,
      `import fs from 'node:fs';
import { defineConfig } from '@modern-js/ultramodern-app-tools';

export default defineConfig(async ({env, command}) => {
  const topology = JSON.parse(fs.readFileSync(new URL('../../topology/reference-topology.json', import.meta.url), 'utf8'));
  const entryName = topology.verticals.length === 0 ? 'before' : 'after';
  fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({entryName, verticalCount: topology.verticals.length, env, command}) + '\\n');
  return { renderer: 'solid', server: {port: 3000, ssr: true}, source: {mainEntryName: entryName} };
});
`,
    );
    const before = workspaceBytes(root);
    await assert.rejects(
      addUltramodernVertical({
        workspaceRoot: root,
        name: 'api-only-member',
        modernVersion: '3.8.3',
        preset: 'api-only',
        enableTailwind: false,
        packageSource: { strategy: 'workspace' },
      }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, consumedInputError);
        assert.match(error.message, /topology[\\/]reference-topology\.json/u);
        return true;
      },
    );
    assert.deepEqual(workspaceBytes(root), before);
    assert.deepEqual(
      fs
        .readFileSync(observations, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
      [
        {
          entryName: 'before',
          verticalCount: 0,
          env: 'development',
          command: 'dev',
        },
      ],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('direct generated composition permits an API-only add and repeated sync', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-unconsumed-topology-add-'),
  );
  try {
    const root = await solidWorkspace(directory);
    const configPath = path.join(root, shellDirectory, 'modern.config.ts');
    const configSource = fs.readFileSync(configPath, 'utf8');
    const result = await addUltramodernVertical({
      workspaceRoot: root,
      name: 'api-only-member',
      modernVersion: '3.8.3',
      preset: 'api-only',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    assert.equal(result.createdApps[0]?.renderer, 'none');
    assert.equal(fs.readFileSync(configPath, 'utf8'), configSource);
    const shellPackage = JSON.parse(
      fs.readFileSync(path.join(root, shellDirectory, 'package.json'), 'utf8'),
    );
    assert.equal(Object.hasOwn(shellPackage, 'zephyr:dependencies'), false);
    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          result.createdApps[0]!.directory,
          'shared/ultramodern-build.json',
        ),
        'utf8',
      ),
    );
    assert.equal(Object.hasOwn(artifact.surfaces, 'ui'), false);
    const context = { workspaceRoot: root, invocationCwd: root };
    assert.equal(await runSyncDeliveryUnit([], context), 0);
    const afterSync = workspaceBytes(root);
    assert.equal(await runSyncDeliveryUnit([], context), 0);
    assert.deepEqual(workspaceBytes(root), afterSync);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
