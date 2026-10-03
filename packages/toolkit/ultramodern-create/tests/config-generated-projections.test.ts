import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { observeConfigSourceInputs } from '../../../solutions/ultramodern-app-tools/src/native-composition/config-evaluator/observed-inputs';
import { shellAppArtifacts } from '../src/ultramodern-workspace/add-vertical/shell-files';
import { createAppRuntimeConfig } from '../src/ultramodern-workspace/app-files';
import { assertConsumedConfigInputsUnchanged } from '../src/ultramodern-workspace/config-consumed-inputs';
import {
  createGeneratedConfigProjections,
  type GeneratedConfigProjection,
} from '../src/ultramodern-workspace/config-generated-projections';
import { createDevelopmentOverlay } from '../src/ultramodern-workspace/contracts';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import { projectAddedVerticalDevelopmentOverlay } from '../src/ultramodern-workspace/development-overlay-projection';
import {
  createAppModernConfig,
  createShellModuleFederationConfig,
} from '../src/ultramodern-workspace/module-federation';
import { createAppPackage } from '../src/ultramodern-workspace/package-json';
import { createPublicWebAppArtifacts } from '../src/ultramodern-workspace/public-surface';
import { initializeGeneratedRendererIdentity } from '../src/ultramodern-workspace/renderer-initial-identity';
import type {
  ResolvedPackageSource,
  WorkspaceApp,
} from '../src/ultramodern-workspace/types';

const scope = 'generated-projection-fixture';
const packageSource: ResolvedPackageSource = {
  strategy: 'workspace',
  modernPackageVersion: '3.8.3',
};
const shellDirectory = shellApp.directory;
const configPath = `${shellDirectory}/modern.config.ts`;
const mfPath = `${shellDirectory}/module-federation.config.ts`;
const packagePath = `${shellDirectory}/package.json`;
const overlayPath = 'topology/local-overlays/development.json';
const projectedPaths = [configPath, mfPath, packagePath, overlayPath];
const consumedInputError = /changed a source input consumed by modern\.config/u;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function sources(shell: WorkspaceApp, verticals: WorkspaceApp[]) {
  const publicWeb = createPublicWebAppArtifacts(shell);
  return new Map([
    [configPath, createAppModernConfig(scope, shell, verticals, false)],
    [mfPath, createShellModuleFederationConfig(scope, shell, verticals)],
    [
      packagePath,
      json(createAppPackage(scope, shell, packageSource, false, verticals)),
    ],
    [overlayPath, json(createDevelopmentOverlay(scope, verticals))],
    [publicWeb.routeMetadataFile.path, publicWeb.routeMetadataFile.content],
    [publicWeb.jsonLdHelperFile.path, publicWeb.jsonLdHelperFile.content],
    [publicWeb.routeHeadFile.path, publicWeb.routeHeadFile.content],
    ...publicWeb.routeMetaFiles.map(file => [file.path, file.content] as const),
    [
      `${shellDirectory}/src/modern.runtime.ts`,
      createAppRuntimeConfig(shell, scope, verticals),
    ],
  ]);
}

function write(root: string, relative: string, content: string) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}

function fixture() {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-generated-projections-',
      ),
    ),
  );
  const root = path.join(directory, 'original');
  const stage = path.join(directory, 'stage');
  const beforeShell = initializeGeneratedRendererIdentity(scope, {
    ...shellApp,
    verticalRefs: [],
  });
  const vertical = initializeGeneratedRendererIdentity(
    scope,
    createVerticalDescriptor('catalog', 4101),
  );
  const afterShell = { ...beforeShell, verticalRefs: [vertical.id] };
  const originalSources = sources(beforeShell, []);
  const nextSources = sources(afterShell, [vertical]);
  for (const [relative, content] of originalSources)
    write(root, relative, content);
  for (const artifact of shellAppArtifacts(
    scope,
    packageSource,
    false,
    [],
    undefined,
    beforeShell,
  ).artifacts)
    write(root, artifact.relativePath, artifact.content);
  const nextShellArtifacts = shellAppArtifacts(
    scope,
    packageSource,
    false,
    [vertical],
    undefined,
    afterShell,
  ).artifacts;
  const prove = (afterApp: WorkspaceApp = afterShell) =>
    createGeneratedConfigProjections({
      workspaceRoot: root,
      scope,
      beforeApps: [beforeShell],
      afterApps: [afterApp, vertical],
      packageSource,
      beforeTailwind: false,
      afterTailwind: false,
    });
  const capture = async (
    extraConsumed: string[] = [],
    consumedDirectories: string[] = [],
  ) => {
    const sourceSnapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    const observed = await observeConfigSourceInputs(
      sourceSnapshot,
      async () => {
        const contents = [...originalSources.keys(), ...extraConsumed].map(
          relative => fs.readFileSync(path.join(root, relative), 'utf8'),
        );
        for (const relative of consumedDirectories)
          fs.readdirSync(path.join(root, relative));
        return contents;
      },
    );
    fs.cpSync(root, stage, { recursive: true, verbatimSymlinks: true });
    return {
      sourceSnapshot,
      guard: (generatedProjections: readonly GeneratedConfigProjection[]) =>
        assertConsumedConfigInputsUnchanged({
          workspaceRoot: root,
          stagedWorkspaceRoot: stage,
          captures: [
            {
              sourceSnapshot,
              consumedSourceInputs: observed.consumedSourceInputs,
            },
          ],
          generatedProjections,
        }),
      assertOriginalUnchanged: () =>
        assertConfigSourceSnapshotUnchanged(sourceSnapshot),
    };
  };
  const project = () => {
    for (const relative of projectedPaths)
      write(stage, relative, nextSources.get(relative)!);
  };
  return {
    root,
    stage,
    beforeShell,
    afterShell,
    vertical,
    originalSources,
    nextSources,
    nextShellArtifacts,
    prove,
    capture,
    project,
    clean: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test('exact generated UI and API composition permits only its four canonical projections', async () => {
  const f = fixture();
  try {
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture();
    assert.notEqual(f.root, f.stage);
    f.project();
    for (const relative of projectedPaths) {
      assert.notEqual(
        f.nextSources.get(relative),
        f.originalSources.get(relative),
      );
      assert.equal(
        fs.readFileSync(path.join(f.stage, relative), 'utf8'),
        f.nextSources.get(relative),
      );
    }
    assert.doesNotThrow(() => captured.guard(proof));
    assert.throws(() => captured.guard([]), consumedInputError);
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

for (const customization of ['callback', 'import'] as const) {
  test(`an authored config ${customization} removes generated projection authority`, async () => {
    const f = fixture();
    try {
      const original = f.originalSources.get(configPath)!;
      const authored =
        customization === 'callback'
          ? `${original.replace('export default defineConfig(', 'const generatedConfig = defineConfig(')}\nexport default async () => generatedConfig;\n`
          : `import './consumer-policy';\n${original}`;
      write(f.root, configPath, authored);
      if (customization === 'import')
        write(
          f.root,
          `${shellDirectory}/consumer-policy.ts`,
          'export const allowed = true;\n',
        );
      const proof = f.prove();
      assert.equal(proof.length, 0);
      const captured = await f.capture(
        customization === 'import'
          ? [`${shellDirectory}/consumer-policy.ts`]
          : [],
      );
      write(f.stage, mfPath, f.nextSources.get(mfPath)!);
      assert.throws(() => captured.guard(proof), consumedInputError);
      assert.equal(
        fs.readFileSync(path.join(f.root, configPath), 'utf8'),
        authored,
      );
      assert.equal(
        fs.readFileSync(path.join(f.root, mfPath), 'utf8'),
        f.originalSources.get(mfPath),
      );
      captured.assertOriginalUnchanged();
    } finally {
      f.clean();
    }
  });
}

test('a changed next federation artifact cannot reuse an exact generated projection', async () => {
  const f = fixture();
  try {
    const proof = f.prove();
    const captured = await f.capture();
    f.project();
    write(
      f.stage,
      mfPath,
      `${f.nextSources.get(mfPath)}\nconsole.log('authored side effect');\n`,
    );
    assert.throws(() => captured.guard(proof), consumedInputError);
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

test('a finalized owning overlay receipt remains reachable after its authoring receipt', async () => {
  const f = fixture();
  try {
    const authoring = f.prove();
    const finalizedVertical = {
      ...f.vertical,
      deliveryUnit: { ...f.vertical.deliveryUnit, version: '0.2.0' },
    };
    const finalized = createGeneratedConfigProjections({
      workspaceRoot: f.root,
      scope,
      beforeApps: [f.beforeShell],
      afterApps: [f.afterShell, finalizedVertical],
      packageSource,
      beforeTailwind: false,
      afterTailwind: false,
    });
    assert.equal(authoring.length, 1);
    assert.equal(finalized.length, 1);
    const captured = await f.capture();
    f.project();
    const overlay = projectAddedVerticalDevelopmentOverlay(
      scope,
      JSON.parse(f.originalSources.get(overlayPath)!),
      [],
      finalizedVertical,
    );
    write(f.stage, overlayPath, json(overlay));
    assert.throws(() => captured.guard(authoring), consumedInputError);
    assert.doesNotThrow(() => captured.guard([...authoring, ...finalized]));
    overlay.serverExecution.catalog.node.expected.buildMarker =
      'deadbeefdeadbeef';
    write(f.stage, overlayPath, json(overlay));
    assert.throws(
      () => captured.guard([...authoring, ...finalized]),
      consumedInputError,
    );
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

for (const input of ['port', 'renderer', 'entry identity'] as const) {
  test(`a changed ${input} prevents membership projection authority`, async () => {
    const f = fixture();
    try {
      const changed: WorkspaceApp =
        input === 'port'
          ? { ...f.afterShell, port: f.afterShell.port + 1 }
          : input === 'renderer'
            ? { ...f.afterShell, renderer: 'solid' }
            : {
                ...f.afterShell,
                rendererIdentity: {
                  ...f.afterShell.rendererIdentity!,
                  entryName: 'renamed',
                },
              };
      const proof = f.prove(changed);
      assert.equal(proof.length, 0);
      const captured = await f.capture();
      f.project();
      assert.throws(() => captured.guard(proof), consumedInputError);
      captured.assertOriginalUnchanged();
    } finally {
      f.clean();
    }
  });
}

test('an extra consumed authored helper prevents otherwise canonical projection authority', async () => {
  const f = fixture();
  try {
    const helper = `${shellDirectory}/consumer-policy.ts`;
    write(f.root, helper, 'export const compositionPolicy = "authored";\n');
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture([helper]);
    f.project();
    assert.throws(() => captured.guard(proof), consumedInputError);
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

test('a changed authored route metadata module remains protected during generated projection', async () => {
  const f = fixture();
  try {
    const routeMeta = createPublicWebAppArtifacts(f.beforeShell)
      .routeMetaFiles[0];
    assert.ok(routeMeta);
    write(
      f.root,
      routeMeta.path,
      `${routeMeta.content}\nexport const consumerPolicy = true;\n`,
    );
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture();
    f.project();
    write(
      f.stage,
      routeMeta.path,
      `${routeMeta.content}\nexport const consumerPolicy = false;\n`,
    );
    assert.throws(() => captured.guard(proof), consumedInputError);
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

test('an unchanged authored route metadata module permits exact generated composition', async () => {
  const f = fixture();
  try {
    const routeMeta = createPublicWebAppArtifacts(f.beforeShell)
      .routeMetaFiles[0];
    assert.ok(routeMeta);
    const authored = `${routeMeta.content}\nexport const consumerPolicy = true;\n`;
    write(f.root, routeMeta.path, authored);
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture();
    f.project();
    assert.doesNotThrow(() => captured.guard(proof));
    assert.equal(
      fs.readFileSync(path.join(f.stage, routeMeta.path), 'utf8'),
      authored,
    );
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

test('the owning overlay recipe preserves authored ports, URLs and unknown fields', async () => {
  const f = fixture();
  try {
    const original = JSON.parse(f.originalSources.get(overlayPath)!);
    original.ports.reserved = 4999;
    original.manifests.external = 'https://example.test/mf-manifest.json';
    original.apis.external = 'https://example.test/api';
    original.consumerPolicy = { delivery: 'authored' };
    write(f.root, overlayPath, json(original));
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture();
    const projected = projectAddedVerticalDevelopmentOverlay(
      scope,
      original,
      [],
      f.vertical,
    );
    assert.deepEqual(original.consumerPolicy, { delivery: 'authored' });
    assert.equal(projected.ports.reserved, 4999);
    assert.equal(projected.manifests.external, original.manifests.external);
    assert.equal(projected.apis.external, original.apis.external);
    assert.deepEqual(projected.consumerPolicy, original.consumerPolicy);
    assert.equal(projected.ports.catalog, f.vertical.port);
    f.project();
    write(f.stage, overlayPath, json(projected));
    assert.doesNotThrow(() => captured.guard(proof));
    projected.consumerPolicy.delivery = 'changed';
    write(f.stage, overlayPath, json(projected));
    assert.throws(() => captured.guard(proof), consumedInputError);
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

test('a scanned routes directory permits only exact owning shell artifact changes', async () => {
  const f = fixture();
  try {
    const proof = f.prove();
    assert.equal(proof.length, 1);
    const captured = await f.capture([], [`${shellDirectory}/src/routes`]);
    f.project();
    for (const artifact of f.nextShellArtifacts)
      write(f.stage, artifact.relativePath, artifact.content);
    assert.doesNotThrow(() => captured.guard(proof));
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});

for (const change of ['custom descendant', 'new path', 'mode'] as const) {
  test(`a scanned routes directory rejects a changed ${change}`, async () => {
    const f = fixture();
    try {
      const custom = `${shellDirectory}/src/routes/consumer-policy.ts`;
      if (change === 'custom descendant')
        write(f.root, custom, 'export const policy = "original";\n');
      const proof = f.prove();
      assert.equal(proof.length, 1);
      const captured = await f.capture([], [`${shellDirectory}/src/routes`]);
      f.project();
      for (const artifact of f.nextShellArtifacts)
        write(f.stage, artifact.relativePath, artifact.content);
      if (change === 'mode') {
        const page = path.join(
          f.stage,
          shellDirectory,
          'src/routes/[lang]/page.tsx',
        );
        fs.chmodSync(page, fs.statSync(page).mode ^ 0o100);
      } else {
        write(f.stage, custom, 'export const policy = "changed";\n');
      }
      assert.throws(() => captured.guard(proof), consumedInputError);
      captured.assertOriginalUnchanged();
    } finally {
      f.clean();
    }
  });
}

test('a forged or copied projection object cannot authorize changed consumed inputs', async () => {
  const f = fixture();
  try {
    const proof = f.prove();
    const captured = await f.capture();
    f.project();
    for (const forged of [
      Object.freeze({ kind: 'canonical-generated-config-projection' as const }),
      { ...proof[0] },
    ]) {
      assert.throws(
        () => captured.guard([forged]),
        /Unverified generated config projection/,
      );
    }
    captured.assertOriginalUnchanged();
  } finally {
    f.clean();
  }
});
