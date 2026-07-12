import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateUltramodernWorkspace,
  OverlayBaselineRelaxationError,
} from '../src/ultramodern-workspace';

function writeOverlayGenerator(tempRoot: string, name: string, body: string) {
  const generatorDir = path.join(tempRoot, name);
  fs.mkdirSync(generatorDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatorDir, 'package.json'),
    JSON.stringify(
      { name: `test-${name}`, version: '0.0.0', main: './index.cjs' },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(generatorDir, 'index.cjs'), body);
  return generatorDir;
}

function generateWithOverlay(targetDir: string, generatorDir: string) {
  generateUltramodernWorkspace({
    targetDir,
    packageName: path.basename(targetDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    overlays: [{ generator: generatorDir }],
    packageSource: { strategy: 'workspace' },
  });
}

function assertRelaxationOverlay(name: string, mutation: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-guard-'));
  try {
    const generatorDir = writeOverlayGenerator(
      tempRoot,
      `${name}-overlay`,
      `
const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const shellPkgPath = path.join(
    context.config.workspaceRoot,
    'apps/shell-super-app/package.json',
  );
  const shellPkg = JSON.parse(fs.readFileSync(shellPkgPath, 'utf-8'));
  ${mutation}
  fs.writeFileSync(shellPkgPath, JSON.stringify(shellPkg, null, 2));
};
`,
    );
    const targetDir = path.join(tempRoot, name);
    assert.throws(
      () => generateWithOverlay(targetDir, generatorDir),
      (error: unknown) => {
        assert.ok(
          error instanceof OverlayBaselineRelaxationError,
          String(error),
        );
        assert.ok(
          error.violations.some(
            violation =>
              violation.kind === 'baseline-version-relaxation' &&
              violation.detail.includes('react'),
          ),
          error.message,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('overlay that downgrades a Platform Baseline pin fails with a typed error before acceptance', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-guard-'));
  try {
    const generatorDir = writeOverlayGenerator(
      tempRoot,
      'relax-baseline-overlay',
      `
const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const shellPkgPath = path.join(
    context.config.workspaceRoot,
    'apps/shell-super-app/package.json',
  );
  const shellPkg = JSON.parse(fs.readFileSync(shellPkgPath, 'utf-8'));
  shellPkg.dependencies = shellPkg.dependencies || {};
  shellPkg.dependencies.react = '18.0.0';
  fs.writeFileSync(shellPkgPath, JSON.stringify(shellPkg, null, 2));
};
`,
    );
    const targetDir = path.join(tempRoot, 'relax-baseline');
    assert.throws(
      () => generateWithOverlay(targetDir, generatorDir),
      (error: unknown) => {
        assert.ok(
          error instanceof OverlayBaselineRelaxationError,
          `expected OverlayBaselineRelaxationError, got ${String(error)}`,
        );
        assert.equal(error.code, 'ULTRAMODERN_OVERLAY_BASELINE_RELAXATION');
        assert.ok(
          error.violations.some(
            violation =>
              violation.kind === 'baseline-version-relaxation' &&
              violation.detail.includes('react'),
          ),
          error.message,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('overlay that removes a baseline-pinned dependency fails closed', () => {
  assertRelaxationOverlay(
    'remove-baseline',
    'delete shellPkg.dependencies.react;',
  );
});

test('overlay npm aliases that resolve to a baseline package are checked', () => {
  assertRelaxationOverlay(
    'npm-alias-baseline',
    "shellPkg.dependencies['react-alias'] = 'npm:react@18.0.0';",
  );
});

test('overlay overrides are checked through nested keys', () => {
  assertRelaxationOverlay(
    'overrides-baseline',
    "shellPkg.overrides = { tooling: { react: '18.0.0' } };",
  );
});

test('overlay resolutions are checked', () => {
  assertRelaxationOverlay(
    'resolutions-baseline',
    "shellPkg.resolutions = { react: '18.0.0' };",
  );
});

test('overlay pnpm.overrides are checked', () => {
  assertRelaxationOverlay(
    'pnpm-overrides-baseline',
    "shellPkg.pnpm = { overrides: { react: '18.0.0' } };",
  );
});

test('overlay catalog entries are checked', () => {
  assertRelaxationOverlay(
    'catalog-baseline',
    "shellPkg.catalog = { react: '18.0.0' };",
  );
});

test('overlay that reintroduces a forbidden thin-shell artifact fails with a typed error', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-guard-'));
  try {
    const generatorDir = writeOverlayGenerator(
      tempRoot,
      'forbidden-artifact-overlay',
      `
const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const apiDir = path.join(
    context.config.workspaceRoot,
    'apps/shell-super-app/api',
  );
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(path.join(apiDir, 'handler.ts'), 'export const handler = () => {};\\n');
};
`,
    );
    const targetDir = path.join(tempRoot, 'forbidden-artifact');
    assert.throws(
      () => generateWithOverlay(targetDir, generatorDir),
      (error: unknown) => {
        assert.ok(
          error instanceof OverlayBaselineRelaxationError,
          String(error),
        );
        assert.ok(
          error.violations.some(
            violation => violation.kind === 'forbidden-shell-artifact',
          ),
          error.message,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('overlay that only adds neutral output preserves the Platform Baseline', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-overlay-guard-'));
  try {
    const generatorDir = writeOverlayGenerator(
      tempRoot,
      'neutral-overlay',
      `
const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const outDir = path.join(context.config.workspaceRoot, 'overlay-output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ok.json'), JSON.stringify({ ok: true }));
};
`,
    );
    const targetDir = path.join(tempRoot, 'neutral');
    generateWithOverlay(targetDir, generatorDir);
    assert.equal(
      fs.existsSync(path.join(targetDir, 'overlay-output/ok.json')),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
