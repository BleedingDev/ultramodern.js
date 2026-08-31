import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { workspaceUsesDependency } from '../src/ultramodern-tooling/commands/migrate-strict-effect/dependency-usage';

const drizzlePatchVersion = '1.0.0-rc.4';
const integrity =
  'sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==';

test('recognizes a ranged Drizzle patch target through its reachable lock resolution', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-drizzle-range-'),
  );

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({
        devDependencies: { 'drizzle-orm': '^1.0.0-rc.4' },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'pnpm-lock.yaml'),
      yaml.dump({
        lockfileVersion: '9.0',
        importers: {
          '.': {
            devDependencies: {
              'drizzle-orm': {
                specifier: '^1.0.0-rc.4',
                version: drizzlePatchVersion,
              },
            },
          },
        },
        packages: {
          [`drizzle-orm@${drizzlePatchVersion}`]: {
            resolution: { integrity },
          },
        },
        snapshots: { [`drizzle-orm@${drizzlePatchVersion}`]: {} },
      }),
    );

    assert.equal(
      workspaceUsesDependency(
        workspaceRoot,
        'drizzle-orm',
        drizzlePatchVersion,
      ),
      true,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('does not retain the Drizzle patch when a compatible range resolves to another version', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-drizzle-other-resolution-'),
  );
  const resolvedVersion = '1.0.0-rc.5';

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({
        devDependencies: { 'drizzle-orm': '^1.0.0-rc.4' },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'pnpm-lock.yaml'),
      yaml.dump({
        lockfileVersion: '9.0',
        importers: {
          '.': {
            devDependencies: {
              'drizzle-orm': {
                specifier: '^1.0.0-rc.4',
                version: resolvedVersion,
              },
            },
          },
        },
        packages: {
          [`drizzle-orm@${resolvedVersion}`]: {
            resolution: { integrity },
          },
        },
        snapshots: { [`drizzle-orm@${resolvedVersion}`]: {} },
      }),
    );

    assert.equal(
      workspaceUsesDependency(
        workspaceRoot,
        'drizzle-orm',
        drizzlePatchVersion,
      ),
      false,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('conservatively retains the Drizzle patch for a compatible range without a lockfile', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-drizzle-missing-lock-'),
  );

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({
        devDependencies: { 'drizzle-orm': '^1.0.0-rc.4' },
      })}\n`,
    );

    assert.equal(
      workspaceUsesDependency(
        workspaceRoot,
        'drizzle-orm',
        drizzlePatchVersion,
      ),
      true,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('does not apply the Drizzle prerelease patch to an unrelated stable version', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-drizzle-stable-'),
  );

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      `${JSON.stringify({
        dependencies: { 'drizzle-orm': '0.45.2' },
      })}\n`,
    );

    assert.equal(
      workspaceUsesDependency(
        workspaceRoot,
        'drizzle-orm',
        drizzlePatchVersion,
      ),
      false,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
