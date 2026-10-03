import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import {
  captureExistingWorkspaceOverlayGuard,
  replaceRendererIdentityProjections,
} from '../src/ultramodern-workspace/renderer-identity-projections';

const topologyPath = 'topology/reference-topology.json';
const uiArtifactPath = 'apps/demo/shared/ultramodern-build.json';

function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-identity-projections-')),
  );
  fs.writeFileSync(path.join(root, 'modern.config.ts'), 'renderer: solid');
  fs.mkdirSync(path.join(root, 'topology'));
  fs.writeFileSync(path.join(root, topologyPath), 'initial');
  return root;
}

test('identity projection replaces only its captured file and retains a final source guard', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    const updated = replaceRendererIdentityProjections(
      root,
      snapshot,
      new Map([[topologyPath, 'actual ssr identity']]),
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'actual ssr identity',
    );
    assertConfigSourceSnapshotUnchanged(updated);
    fs.writeFileSync(path.join(root, 'modern.config.ts'), 'renderer: octane');
    assert.throws(() => assertConfigSourceSnapshotUnchanged(updated));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a source change rejects identity projection before any replacement', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    fs.writeFileSync(path.join(root, 'modern.config.ts'), 'renderer: octane');
    assert.throws(() =>
      replaceRendererIdentityProjections(
        root,
        snapshot,
        new Map([[topologyPath, 'must not be written']]),
      ),
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('all projection targets are validated before a captured file is replaced', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [uiArtifactPath, 'uncaptured'],
          ]),
        ),
      /captured regular file/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a captured symlink cannot authorize a projection replacement', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, uiArtifactPath)), {
      recursive: true,
    });
    fs.symlinkSync(
      '../../../topology/reference-topology.json',
      path.join(root, uiArtifactPath),
    );
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([[uiArtifactPath, 'must not be written']]),
        ),
      /captured regular file/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an existing captured UI artifact is replaced without deferred authorization', () => {
  const root = fixture();
  try {
    const artifact = path.join(root, uiArtifactPath);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, 'previous UI identity');
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    const updated = replaceRendererIdentityProjections(
      root,
      snapshot,
      new Map([
        [topologyPath, 'resolved topology'],
        [uiArtifactPath, 'resolved UI identity'],
      ]),
    );
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'resolved UI identity');
    assert.equal(updated.states.length, snapshot.states.length);
    assertConfigSourceSnapshotUnchanged(updated);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an exact deferred UI artifact is created in its captured parent and joins the final source guard', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, uiArtifactPath)), {
      recursive: true,
    });
    const helperPath = path.join(root, 'apps/demo/config-helper.ts');
    fs.writeFileSync(helperPath, 'export const renderer = "solid";');
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
    const deferredTargets: ReadonlySet<string> = new Set([uiArtifactPath]);
    const updated = replaceRendererIdentityProjections(
      root,
      snapshot,
      new Map([
        [topologyPath, 'resolved topology'],
        [uiArtifactPath, 'resolved UI identity'],
      ]),
      deferredTargets,
    );

    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'resolved topology',
    );
    assert.equal(
      fs.readFileSync(path.join(root, uiArtifactPath), 'utf8'),
      'resolved UI identity',
    );
    assert.equal(fs.lstatSync(path.join(root, uiArtifactPath)).isFile(), true);
    assert.equal(updated.states.length, snapshot.states.length + 1);
    assertConfigSourceSnapshotUnchanged(updated);

    fs.writeFileSync(helperPath, 'export const renderer = "octane";');
    assert.throws(() => assertConfigSourceSnapshotUnchanged(updated));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the final snapshot rejects unrelated authored source changed during an authorized write', () => {
  const root = fixture();
  try {
    const artifact = path.join(root, uiArtifactPath);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    const originalWrite = fs.writeFileSync;
    const writeSpy = rstest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation((...args) => {
        originalWrite(...args);
        if (args[0] === artifact) {
          originalWrite(
            path.join(root, 'modern.config.ts'),
            'renderer: octane',
          );
        }
      });
    try {
      assert.throws(
        () =>
          replaceRendererIdentityProjections(
            root,
            snapshot,
            new Map([
              [topologyPath, 'resolved topology'],
              [uiArtifactPath, 'resolved UI identity'],
            ]),
            new Set([uiArtifactPath]),
          ),
        /Config source changed during renderer identity projection/u,
      );
    } finally {
      writeSpy.mockRestore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a new UI artifact requires exact deferred authorization before any projection is written', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, uiArtifactPath)), {
      recursive: true,
    });
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [uiArtifactPath, 'unauthorized new file'],
          ]),
        ),
      /captured regular file/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a deferred UI artifact cannot create an uncaptured parent directory', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [uiArtifactPath, 'new UI identity'],
          ]),
          new Set([uiArtifactPath]),
        ),
      /absent file in a captured directory/u,
    );
    assert.equal(fs.existsSync(path.join(root, 'apps')), false);
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a later invalid target prevents both an authorized creation and a captured replacement', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, uiArtifactPath)), {
      recursive: true,
    });
    const uncapturedArtifact =
      'verticals/catalog/shared/ultramodern-build.json';
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [uiArtifactPath, 'must not be created'],
            [topologyPath, 'must not be replaced'],
            [uncapturedArtifact, 'must not create a new directory'],
          ]),
          new Set([uiArtifactPath, uncapturedArtifact]),
        ),
      /absent file in a captured directory/u,
    );
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
    assert.equal(fs.existsSync(path.join(root, 'verticals')), false);
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each([
  'file',
  'directory',
  'symlink',
] as const)('deferred authorization cannot replace a captured %s', kind => {
  const root = fixture();
  try {
    const artifact = path.join(root, uiArtifactPath);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    if (kind === 'file') fs.writeFileSync(artifact, 'existing identity');
    else if (kind === 'directory') fs.mkdirSync(artifact);
    else {
      fs.symlinkSync('../../../topology/reference-topology.json', artifact);
    }
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [uiArtifactPath, 'must not replace an existing target'],
          ]),
          new Set([uiArtifactPath]),
        ),
      /absent file in a captured directory/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a captured symlink parent cannot authorize deferred UI artifact creation', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'apps/demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'other-shared'));
    fs.symlinkSync('../../other-shared', path.join(root, 'apps/demo/shared'));
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [uiArtifactPath, 'must not be created through a symlink'],
          ]),
          new Set([uiArtifactPath]),
        ),
      /absent file in a captured directory/u,
    );
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'other-shared')), []);
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each([
  'topology/identity.json',
  'apps/demo/shared/config-helper.ts',
])('deferred authorization cannot create an arbitrary projection at %s', relativePath => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), {
      recursive: true,
    });
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            [relativePath, 'must not create an arbitrary file'],
          ]),
          new Set([relativePath]),
        ),
      /Unsupported renderer identity projection/u,
    );
    assert.equal(fs.existsSync(path.join(root, relativePath)), false);
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a captured authored file is not an identity projection', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([
            [topologyPath, 'must not be written'],
            ['modern.config.ts', 'must not replace authored source'],
          ]),
        ),
      /Unsupported renderer identity projection/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'modern.config.ts'), 'utf8'),
      'renderer: solid',
    );
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every deferred target needs a resolved projection before any writes', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.dirname(path.join(root, uiArtifactPath)), {
      recursive: true,
    });
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([[topologyPath, 'must not be written']]),
          new Set([uiArtifactPath]),
        ),
      /Deferred UI artifact has no resolved projection/u,
    );
    assert.equal(fs.existsSync(path.join(root, uiArtifactPath)), false);
    assert.equal(
      fs.readFileSync(path.join(root, topologyPath), 'utf8'),
      'initial',
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('topology is replaced from its captured file and cannot be declared deferred', () => {
  const root = fixture();
  try {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    assert.throws(
      () =>
        replaceRendererIdentityProjections(
          root,
          snapshot,
          new Map([[topologyPath, 'must not be written']]),
          new Set([topologyPath]),
        ),
      /absent file in a captured directory/u,
    );
    assertConfigSourceSnapshotUnchanged(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an overlay may author the new app while original source retains its evaluation', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'apps/new'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/new/modern.config.ts'), 'initial');
    const assertOriginalUnchanged = captureExistingWorkspaceOverlayGuard(
      root,
      'apps/new',
    );
    fs.writeFileSync(
      path.join(root, 'apps/new/modern.config.ts'),
      'actual ssr and csr entries',
    );
    fs.mkdirSync(path.join(root, 'apps/new/src'));
    fs.writeFileSync(path.join(root, 'apps/new/src/page.tsx'), 'authored page');
    assertOriginalUnchanged();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an overlay cannot change an original imported source file and restore its bytes', () => {
  const root = fixture();
  try {
    const helper = path.join(root, 'config-helper.ts');
    fs.writeFileSync(helper, 'export const renderer = "solid";');
    const assertOriginalUnchanged = captureExistingWorkspaceOverlayGuard(
      root,
      'apps/new',
    );
    fs.writeFileSync(helper, 'export const renderer = "octane";');
    fs.writeFileSync(helper, 'export const renderer = "solid";');
    assert.throws(assertOriginalUnchanged, /Edit original source before add/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an overlay cannot add a source input outside the new app', () => {
  const root = fixture();
  try {
    const assertOriginalUnchanged = captureExistingWorkspaceOverlayGuard(
      root,
      'apps/new',
    );
    fs.writeFileSync(path.join(root, 'new-config-helper.ts'), 'new source');
    assert.throws(assertOriginalUnchanged, /Edit original source before add/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an overlay cannot delete an original source input', () => {
  const root = fixture();
  try {
    const assertOriginalUnchanged = captureExistingWorkspaceOverlayGuard(
      root,
      'apps/new',
    );
    fs.rmSync(path.join(root, 'modern.config.ts'));
    assert.throws(assertOriginalUnchanged, /Edit original source before add/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
