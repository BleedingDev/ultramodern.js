import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatGeneratedSourceCandidates } from '../src/ultramodern-workspace/fs-io';
import { preserveConsumerWorkspaceArtifacts } from '../src/ultramodern-workspace/workspace-artifact-ownership';

test('pre-install canonical refreshes preserve config bytes and permit changed JSON artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-noop-'));
  try {
    const relativePath = 'modern.config.ts';
    const filePath = path.join(root, relativePath);
    fs.writeFileSync(
      path.join(root, 'oxfmt.config.ts'),
      "import { defineConfig } from 'oxfmt';\nexport default defineConfig({});\n",
    );
    const generated =
      'export default {renderer: "solid", server: {port: 3000, ssr: true}};\n';
    const [formatted] = formatGeneratedSourceCandidates([
      [relativePath, generated],
    ]);
    assert.notEqual(formatted, generated);
    fs.writeFileSync(filePath, formatted!);
    const jsonPath = path.join(root, 'tsconfig.json');
    const previousJson = '{"files":["src/main.ts"]}\n';
    fs.writeFileSync(jsonPath, previousJson);
    const guarded = preserveConsumerWorkspaceArtifacts(root, [
      { relativePath, content: generated },
      { relativePath: 'tsconfig.json', content: previousJson },
    ]);
    assert.equal(guarded.io.write(filePath, generated), false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), formatted);
    const changed = generated.replace('3000', '3001');
    assert.equal(guarded.io.write(filePath, changed), true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), changed);
    const nextJson = '{"files":["src/main.ts","src/api/clients.ts"]}\n';
    assert.equal(guarded.io.write(jsonPath, nextJson), true);
    assert.equal(fs.readFileSync(jsonPath, 'utf8'), nextJson);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
