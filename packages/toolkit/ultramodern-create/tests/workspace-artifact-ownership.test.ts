import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import {
  preserveConsumerWorkspaceArtifacts,
  workspaceArtifactCandidates,
} from '../src/ultramodern-workspace/workspace-artifact-ownership';

test('workspace ownership excludes application configs from every topology projection', () => {
  const catalog = createVerticalDescriptor('catalog', 3101);
  const orders = createVerticalDescriptor('orders', 3102);
  const apps = [{ ...shellApp, verticalRefs: ['catalog'] }, catalog];
  const alternateApps = [
    { ...shellApp, verticalRefs: ['catalog', 'orders'] },
    {
      ...shellApp,
      id: 'shell-admin',
      directory: 'apps/shell-admin',
      packageSuffix: 'shell-admin',
      mfName: 'shellAdmin',
      port: 3121,
      verticalRefs: ['orders'],
    },
    catalog,
    orders,
  ];

  const paths = workspaceArtifactCandidates(
    'workspace',
    apps,
    alternateApps,
  ).map(candidate => candidate.relativePath);

  assert.deepEqual(
    paths.filter(relativePath => relativePath.endsWith('/modern.config.ts')),
    [],
    'pristine and authored app configs are both outside generator ownership',
  );
  assert.ok(paths.includes('tsconfig.json'));
  assert.ok(paths.includes('zerops.yaml'));
  assert.ok(paths.some(relativePath => relativePath.startsWith('scripts/')));
});

test('generated contract data can refresh without treating authored behavior as generated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-ownership-'));
  try {
    const relativePath = 'scripts/check.mts';
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath));
    const canonical =
      "const workspaceValidationContract = {version: 'new'};\nconsole.log(workspaceValidationContract);\n";
    const variants = [
      { source: canonical.replace("'new'", "'old'"), protected: false },
      {
        source: `${canonical}console.log('consumer authorization');\n`,
        protected: true,
      },
      {
        source: canonical.replace("'new'", 'getConsumerPolicy()'),
        protected: true,
      },
      {
        source: canonical.replace("{version: 'new'}", '{...consumerPolicy}'),
        protected: true,
      },
      { source: 'invalid consumer source {', protected: true },
    ];
    for (const variant of variants) {
      fs.writeFileSync(filePath, variant.source);
      const guarded = preserveConsumerWorkspaceArtifacts(root, [
        {
          relativePath,
          content: canonical,
          generatedDataBinding: 'workspaceValidationContract',
        },
      ]);
      assert.equal(guarded.preservedPaths.has(relativePath), variant.protected);
      guarded.io.write(filePath, canonical);
      assert.equal(
        fs.readFileSync(filePath, 'utf8'),
        variant.protected ? variant.source : canonical,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
