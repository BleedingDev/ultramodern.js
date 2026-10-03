import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type ApplicationRenderer,
  addUltramodernShell,
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernShell,
  planUltramodernVertical,
  type UltramodernGenerationResult,
} from '../src/ultramodern-workspace';
import { snapshotWorkspace } from './helpers/workspace-kit';

type Observation = {
  kind: string;
  id: string;
  env?: string;
  command?: string;
  configFile?: string;
};

const overlayVersion = '2.4.7';

function authoredConfig(
  trace: string,
  renderer: ApplicationRenderer = 'react',
  id = 'catalog',
): string {
  const extension = renderer === 'react' ? 'ts' : 'tsx';
  return `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { appendFileSync } from 'node:fs';

export default defineConfig(async ({ env, command }) => {
  appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'new-config', id: ${JSON.stringify(id)}, env, command }) + '\\n');
  await Promise.resolve();
  return {
    renderer: '${renderer}',
    source: {
      disableDefaultEntries: true,
      mainEntryName: 'dashboard',
      entries: {
        preview: './src/renderer-preview.${extension}',
        dashboard: './src/renderer-dashboard.${extension}',
      },
    },
    plugins: [{
      name: 'test:final-authored-primary',
      setup(api) {
        api.modifyEntrypoints(({ entrypoints }) => {
          appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'new-entry-hook', id: ${JSON.stringify(id)} }) + '\\n');
          return { entrypoints: entrypoints.map(entry => ({ ...entry, isMainEntry: entry.entryName === 'dashboard' })) };
        });
      },
    }],
  };
});
`;
}

async function fixture(renderer: ApplicationRenderer = 'react') {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-add-renderer-finalization-'),
  );
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const trace = path.join(tempRoot, 'observations.jsonl');
  try {
    const generated = await generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'renderer-finalization',
      modernVersion: '3.8.3',
      renderer,
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    for (const app of generated.createdApps) {
      const directory = path.join(workspaceRoot, app.directory);
      fs.writeFileSync(
        path.join(directory, 'renderer-selection.ts'),
        `export const renderer = '${renderer}';\n`,
      );
      fs.writeFileSync(
        path.join(directory, 'src/metadata-entry.ts'),
        'export default () => "original metadata entry";\n',
      );
      fs.writeFileSync(
        path.join(directory, 'modern.config.ts'),
        `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { appendFileSync } from 'node:fs';
import { renderer } from './renderer-selection';

export default defineConfig(async ({ env, command }) => {
  appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'original-config', id: ${JSON.stringify(app.id)}, env, command }) + '\\n');
  await Promise.resolve();
  return {
    renderer,
    source: { disableDefaultEntries: true, entries: { index: { entry: './src/metadata-entry.ts', disableMount: true } } },
    plugins: [{
      name: 'test:original-config-location',
      setup(api) {
        api.modifyEntrypoints(({ entrypoints }) => {
          appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ kind: 'original-entry-hook', id: ${JSON.stringify(app.id)}, configFile: api.getAppContext().configFile }) + '\\n');
          return { entrypoints };
        });
      },
    }],
  };
});
`,
      );
    }
    const generator = path.join(tempRoot, 'author-new-app-overlay');
    fs.mkdirSync(generator);
    fs.writeFileSync(
      path.join(generator, 'package.json'),
      JSON.stringify({
        name: 'test-add-command-renderer-finalization-overlay',
        version: '0.0.0',
        main: './index.cjs',
      }),
    );
    fs.writeFileSync(
      path.join(generator, 'index.cjs'),
      `const fs = require('node:fs');
const path = require('node:path');

module.exports = async context => {
  const { outputWorkspaceRoot, generatedApp, authoredConfig, trace, outsideSource, renderer } = context.config;
  const directory = path.join(outputWorkspaceRoot, generatedApp.directory);
  fs.appendFileSync(trace, JSON.stringify({ kind: 'overlay', id: generatedApp.id }) + '\\n');
  fs.writeFileSync(path.join(directory, 'modern.config.ts'), authoredConfig);
  for (const entry of ['preview', 'dashboard']) {
    const extension = renderer === 'react' ? 'ts' : 'tsx';
    const source = renderer === 'react'
      ? 'export default () => "' + entry + ' metadata entry";\\n'
      : 'export default function Entry() { return <main>' + entry + ' native entry</main>; }\\n';
    fs.writeFileSync(path.join(directory, 'src', 'renderer-' + entry + '.' + extension), source);
  }
  const packagePath = path.join(directory, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  manifest.version = ${JSON.stringify(overlayVersion)};
  fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\\n');
  if (outsideSource) {
    fs.writeFileSync(path.join(outputWorkspaceRoot, outsideSource), "export const renderer = 'solid';\\n");
  }
};
`,
    );
    const overlays = (
      selectedRenderer: ApplicationRenderer,
      id: string,
      outsideSource?: string,
    ) => [
      {
        generator,
        config: {
          authoredConfig: authoredConfig(trace, selectedRenderer, id),
          trace,
          renderer: selectedRenderer,
          ...(outsideSource ? { outsideSource } : {}),
        },
      },
    ];
    return {
      tempRoot,
      workspaceRoot,
      trace,
      originalApps: generated.createdApps,
      options(selectedRenderer = renderer, outsideSource?: string) {
        return {
          workspaceRoot,
          name: 'catalog',
          modernVersion: '3.8.3',
          preset: 'ui-only' as const,
          overlays: overlays(selectedRenderer, 'catalog', outsideSource),
        };
      },
      shellOptions() {
        return {
          workspaceRoot,
          name: 'analytics',
          modernVersion: '3.8.3',
          verticals: [],
          overlays: overlays(renderer, 'shell-analytics'),
        };
      },
      observations(): Observation[] {
        return fs.existsSync(trace)
          ? fs
              .readFileSync(trace, 'utf8')
              .trim()
              .split('\n')
              .map(line => JSON.parse(line))
          : [];
      },
      clean() {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertOnceOnlyEvaluations(
  f: Awaited<ReturnType<typeof fixture>>,
  observations: Observation[],
  newAppId = 'catalog',
): void {
  for (const app of f.originalApps) {
    assert.deepEqual(
      observations.filter(
        event => event.kind === 'original-config' && event.id === app.id,
      ),
      [
        {
          kind: 'original-config',
          id: app.id,
          env: 'development',
          command: 'dev',
        },
      ],
    );
    assert.deepEqual(
      observations.filter(
        event => event.kind === 'original-entry-hook' && event.id === app.id,
      ),
      [
        {
          kind: 'original-entry-hook',
          id: app.id,
          configFile: path.join(
            f.workspaceRoot,
            app.directory,
            'modern.config.ts',
          ),
        },
      ],
    );
  }
  assert.deepEqual(
    observations.filter(event => event.kind === 'new-config'),
    [
      {
        kind: 'new-config',
        id: newAppId,
        env: 'development',
        command: 'generate',
      },
    ],
  );
  assert.deepEqual(
    observations.filter(event => event.kind === 'new-entry-hook'),
    [{ kind: 'new-entry-hook', id: newAppId }],
  );
  assert.ok(
    observations.findIndex(event => event.kind === 'overlay') <
      observations.findIndex(event => event.kind === 'new-config'),
    'the new application config must run after its overlay',
  );
}

function assertPublishedIdentity(
  workspaceRoot: string,
  result: UltramodernGenerationResult,
  renderer: ApplicationRenderer = 'react',
): void {
  const app = result.createdApps[0]!;
  const topology = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, 'topology/reference-topology.json'),
      'utf8',
    ),
  );
  const entry = (
    app.kind === 'shell' ? topology.shells : topology.verticals
  ).find((candidate: { id: string }) => candidate.id === app.id);
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, app.directory, 'shared/ultramodern-build.json'),
      'utf8',
    ),
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, app.directory, 'package.json'),
      'utf8',
    ),
  );
  assert.equal(app.renderer, renderer);
  assert.deepEqual(Object.keys(app.rendererIdentities!).sort(), [
    'dashboard',
    'preview',
  ]);
  assert.equal(app.rendererIdentity!.entryName, 'dashboard');
  assert.deepEqual(app.rendererIdentity, app.rendererIdentities!.dashboard);
  assert.notEqual(
    app.rendererIdentities!.dashboard.buildId,
    app.rendererIdentities!.preview.buildId,
  );
  assert.deepEqual(entry.rendererIdentity, app.rendererIdentity);
  assert.deepEqual(entry.rendererIdentities, app.rendererIdentities);
  assert.deepEqual(entry.rendererProfile, app.rendererProfile);
  assert.deepEqual(artifact.surfaces.ui.rendererIdentity, app.rendererIdentity);
  assert.deepEqual(artifact.surfaces.ui.rendererProfile, app.rendererProfile);
  assert.equal(manifest.version, overlayVersion);
  assert.equal(entry.deliveryUnit.version, overlayVersion);
  assert.equal(artifact.deliveryUnit.version, overlayVersion);
  assert.equal(entry.deliveryUnit.buildMarker, app.rendererIdentity!.buildId);
  assert.equal(
    artifact.deliveryUnit.buildMarker,
    app.rendererIdentity!.buildId,
  );
  assert.equal(
    result.deliveryUnits![0]!.buildMarker,
    app.rendererIdentity!.buildId,
  );
}

function assertExistingShellIdentity(workspaceRoot: string): void {
  const topology = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, 'topology/reference-topology.json'),
      'utf8',
    ),
  );
  const shell = topology.shell;
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, shell.path, 'shared/ultramodern-build.json'),
      'utf8',
    ),
  );
  assert.equal(shell.rendererIdentity.entryName, 'index');
  assert.deepEqual(shell.rendererIdentities, {
    index: shell.rendererIdentity,
  });
  assert.deepEqual(
    artifact.surfaces.ui.rendererIdentity,
    shell.rendererIdentity,
  );
  assert.deepEqual(artifact.surfaces.ui.rendererProfile, shell.rendererProfile);
  assert.equal(
    artifact.deliveryUnit.buildMarker,
    shell.deliveryUnit.buildMarker,
  );
}

test('add resolves original callbacks once and publishes the new post-overlay entries and manifest version', async () => {
  const f = await fixture();
  try {
    const result = await addUltramodernVertical(f.options());
    assertOnceOnlyEvaluations(f, f.observations());
    assertPublishedIdentity(f.workspaceRoot, result);
  } finally {
    f.clean();
  }
});

test('preview runs the entry-authoring overlay without writes and reports the same final identity as add', async () => {
  const f = await fixture();
  try {
    const before = snapshotWorkspace(f.workspaceRoot);
    const plan = await planUltramodernVertical(f.options());
    assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
    assertOnceOnlyEvaluations(f, f.observations());
    assert.equal(plan.createdApps[0]!.rendererIdentity!.entryName, 'dashboard');
    assert.deepEqual(
      Object.keys(plan.createdApps[0]!.rendererIdentities!).sort(),
      ['dashboard', 'preview'],
    );
    fs.writeFileSync(f.trace, '');
    const result = await addUltramodernVertical(f.options());
    assertOnceOnlyEvaluations(f, f.observations());
    assert.deepEqual(plan.createdApps, result.createdApps);
    assert.deepEqual(plan.deliveryUnits, result.deliveryUnits);
    assertPublishedIdentity(f.workspaceRoot, result);
  } finally {
    f.clean();
  }
});

test('a post-overlay renderer switch rejects before publication and leaves the live workspace byte-identical', async () => {
  const f = await fixture();
  try {
    const before = snapshotWorkspace(f.workspaceRoot);
    await assert.rejects(
      addUltramodernVertical(f.options('solid')),
      /uses react templates.*final modern\.config resolves solid.*matching compiler and source templates/isu,
    );
    assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
    assertOnceOnlyEvaluations(f, f.observations());
  } finally {
    f.clean();
  }
});

test('an overlay cannot edit existing imported source outside the new application', async () => {
  const f = await fixture();
  try {
    const before = snapshotWorkspace(f.workspaceRoot);
    const existingSource = `${f.originalApps[0]!.directory}/renderer-selection.ts`;
    await assert.rejects(
      addUltramodernVertical(f.options('react', existingSource)),
      /CodeSmith overlay changed existing authored source.*renderer-selection\.ts.*Edit original source before add/isu,
    );
    assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
    const observations = f.observations();
    assert.equal(
      observations.filter(event => event.kind === 'original-config').length,
      f.originalApps.length,
    );
    assert.deepEqual(
      observations.filter(event => event.kind === 'new-config'),
      [],
    );
  } finally {
    f.clean();
  }
});

test('add-shell publishes the final Solid entry identities and overlay package version', async () => {
  const f = await fixture('solid');
  try {
    const result = await addUltramodernShell(f.shellOptions());
    assertOnceOnlyEvaluations(f, f.observations(), 'shell-analytics');
    assertPublishedIdentity(f.workspaceRoot, result, 'solid');
    assertExistingShellIdentity(f.workspaceRoot);
  } finally {
    f.clean();
  }
});

test('native shell preview runs its overlay without writes and agrees with the later add', async () => {
  const f = await fixture('solid');
  try {
    const before = snapshotWorkspace(f.workspaceRoot);
    const plan = await planUltramodernShell(f.shellOptions());
    assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
    assertOnceOnlyEvaluations(f, f.observations(), 'shell-analytics');
    assert.equal(plan.createdApps[0]!.renderer, 'solid');
    assert.equal(plan.createdApps[0]!.rendererIdentity!.entryName, 'dashboard');
    assert.deepEqual(
      Object.keys(plan.createdApps[0]!.rendererIdentities!).sort(),
      ['dashboard', 'preview'],
    );
    fs.writeFileSync(f.trace, '');
    const result = await addUltramodernShell(f.shellOptions());
    assertOnceOnlyEvaluations(f, f.observations(), 'shell-analytics');
    assert.deepEqual(plan.createdApps, result.createdApps);
    assert.deepEqual(plan.deliveryUnits, result.deliveryUnits);
    assertPublishedIdentity(f.workspaceRoot, result, 'solid');
    assertExistingShellIdentity(f.workspaceRoot);
  } finally {
    f.clean();
  }
});
