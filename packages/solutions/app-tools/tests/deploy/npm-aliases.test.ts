import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeDepEmit } from 'ndepe';
import {
  preserveNpmAliases,
  readPackageIdentity,
} from '../../src/plugins/deploy/utils/npmAliases';

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

describe('Node deployment npm aliases', () => {
  it('repairs real ndepe output produced from pnpm-style npm aliases', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-ndepe-alias-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    const storeDirectory = path.join(appDirectory, 'node_modules/.pnpm');
    const prodServerDirectory = path.join(
      storeDirectory,
      'prod-server/node_modules/@bleedingdev/modern-js-prod-server',
    );
    const serverCoreDirectory = path.join(
      storeDirectory,
      'server-core/node_modules/@bleedingdev/modern-js-server-core',
    );

    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'ndepe-alias-app',
      });
      await writeJson(path.join(prodServerDirectory, 'package.json'), {
        name: '@bleedingdev/modern-js-prod-server',
        version: '1.0.0',
        main: 'index.js',
        dependencies: {
          '@modern-js/server-core':
            'npm:@bleedingdev/modern-js-server-core@1.0.0',
        },
      });
      await writeFile(
        path.join(prodServerDirectory, 'index.js'),
        "module.exports = require('@modern-js/server-core');\n",
      );
      await writeJson(path.join(serverCoreDirectory, 'package.json'), {
        name: '@bleedingdev/modern-js-server-core',
        version: '1.0.0',
        main: 'index.js',
      });
      await writeFile(
        path.join(serverCoreDirectory, 'index.js'),
        "module.exports = 'real-ndepe-alias-ran';\n",
      );

      const rootProdAlias = path.join(
        appDirectory,
        'node_modules/@modern-js/prod-server',
      );
      const nestedCoreAlias = path.join(
        prodServerDirectory,
        'node_modules/@modern-js/server-core',
      );
      for (const [aliasPath, targetPath] of [
        [rootProdAlias, prodServerDirectory],
        [nestedCoreAlias, serverCoreDirectory],
      ]) {
        await mkdir(path.dirname(aliasPath), { recursive: true });
        await symlink(
          path.relative(path.dirname(aliasPath), targetPath),
          aliasPath,
          'dir',
        );
      }

      await mkdir(outputDirectory, { recursive: true });
      await writeFile(
        path.join(outputDirectory, 'index.js'),
        "module.exports = require('@modern-js/prod-server');\n",
      );
      await nodeDepEmit({
        appDir: appDirectory,
        sourceDir: outputDirectory,
        includeEntries: [path.join(prodServerDirectory, 'index.js')],
      });

      await preserveNpmAliases({
        appDirectory,
        outputDirectory,
        implicitAliases: [
          {
            aliasName: '@modern-js/prod-server',
            targetName: '@bleedingdev/modern-js-prod-server',
            targetVersion: '1.0.0',
          },
        ],
      });

      const relocatedOutput = path.join(appDirectory, '.relocated-output');
      await rename(outputDirectory, relocatedOutput);
      const requireFromOutput = createRequire(
        path.join(relocatedOutput, 'index.js'),
      );
      expect(requireFromOutput('./index.js')).toBe('real-ndepe-alias-ran');
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });

  it('preserves direct and transitive aliases in runnable and reinstallable output', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-npm-alias-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    const physicalRoot = path.join(
      outputDirectory,
      'node_modules/@bleedingdev',
    );

    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'alias-app',
        dependencies: {
          '@modern-js/plugin-example':
            'npm:@bleedingdev/modern-js-plugin-example@1.0.0',
        },
      });
      await writeJson(path.join(outputDirectory, 'package.json'), {
        name: 'alias-app-prod',
        version: '1.0.0',
        private: true,
        dependencies: {
          '@bleedingdev/modern-js-plugin-example': '1.0.0',
          '@bleedingdev/modern-js-prod-server': '1.0.0',
          '@bleedingdev/modern-js-server-core': '1.0.0',
        },
      });
      await writeJson(
        path.join(physicalRoot, 'modern-js-plugin-example/package.json'),
        {
          name: '@bleedingdev/modern-js-plugin-example',
          version: '1.0.0',
          main: 'index.js',
          dependencies: {
            '@modern-js/server-core':
              'npm:@bleedingdev/modern-js-server-core@1.0.0',
            '@modern-js/types': 'npm:@bleedingdev/modern-js-types@1.0.0',
          },
        },
      );
      await writeFile(
        path.join(physicalRoot, 'modern-js-plugin-example/index.js'),
        "module.exports = require('@modern-js/server-core');\n",
      );
      await writeJson(
        path.join(physicalRoot, 'modern-js-prod-server/package.json'),
        {
          name: '@bleedingdev/modern-js-prod-server',
          version: '1.0.0',
          main: 'index.js',
          dependencies: {
            '@modern-js/server-core':
              'npm:@bleedingdev/modern-js-server-core@1.0.0',
          },
        },
      );
      await writeFile(
        path.join(physicalRoot, 'modern-js-prod-server/index.js'),
        "module.exports = require('@modern-js/server-core');\n",
      );
      await writeJson(
        path.join(physicalRoot, 'modern-js-server-core/package.json'),
        {
          name: '@bleedingdev/modern-js-server-core',
          version: '1.0.0',
          main: 'index.js',
        },
      );
      await writeFile(
        path.join(physicalRoot, 'modern-js-server-core/index.js'),
        "module.exports = 'alias-chain-ran';\n",
      );

      await preserveNpmAliases({
        appDirectory,
        outputDirectory,
        implicitAliases: [
          {
            aliasName: '@modern-js/prod-server',
            targetName: '@bleedingdev/modern-js-prod-server',
            targetVersion: '1.0.0',
          },
        ],
      });

      const relocatedOutput = path.join(appDirectory, '.relocated-output');
      await rename(outputDirectory, relocatedOutput);
      const requireFromOutput = createRequire(
        path.join(relocatedOutput, 'index.js'),
      );
      expect(requireFromOutput('@modern-js/plugin-example')).toBe(
        'alias-chain-ran',
      );
      expect(requireFromOutput('@modern-js/prod-server')).toBe(
        'alias-chain-ran',
      );

      const outputPackageJson = JSON.parse(
        await readFile(path.join(relocatedOutput, 'package.json'), 'utf8'),
      );
      expect(outputPackageJson.dependencies).toMatchObject({
        '@modern-js/plugin-example':
          'npm:@bleedingdev/modern-js-plugin-example@1.0.0',
        '@modern-js/prod-server':
          'npm:@bleedingdev/modern-js-prod-server@1.0.0',
      });

      await expect(
        readPackageIdentity(
          path.join(
            relocatedOutput,
            'node_modules/@bleedingdev/modern-js-prod-server/index.js',
          ),
        ),
      ).resolves.toEqual({
        name: '@bleedingdev/modern-js-prod-server',
        version: '1.0.0',
      });
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });

  it('preserves each owner-specific target in an ndepe multi-version layout', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-multi-alias-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    const ownerRoot = path.join(outputDirectory, 'node_modules/@bleedingdev');
    const storeRoot = path.join(outputDirectory, 'node_modules/.ndepe');

    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'multi-alias-app',
      });
      await writeJson(path.join(outputDirectory, 'package.json'), {
        name: 'multi-alias-app-prod',
        version: '1.0.0',
      });

      for (const [owner, range] of [
        ['owner-one', '^1.0.0'],
        ['owner-two', '^2.0.0'],
      ]) {
        await writeJson(path.join(ownerRoot, owner, 'package.json'), {
          name: `@bleedingdev/${owner}`,
          version: '1.0.0',
          main: 'index.js',
          dependencies: {
            '@logical/core': `npm:@vendor/core@${range}`,
          },
        });
        await writeFile(
          path.join(ownerRoot, owner, 'index.js'),
          "module.exports = require('@logical/core');\n",
        );
      }

      for (const version of ['1.5.0', '2.5.0']) {
        const targetDirectory = path.join(
          storeRoot,
          `vendor-core@${version}`,
          'node_modules/@vendor/core',
        );
        await writeJson(path.join(targetDirectory, 'package.json'), {
          name: '@vendor/core',
          version,
          main: 'index.js',
        });
        await writeFile(
          path.join(targetDirectory, 'index.js'),
          `module.exports = '${version}';\n`,
        );
      }

      for (const [owner, version] of [
        ['owner-one', '1.5.0'],
        ['owner-two', '2.5.0'],
      ]) {
        const ownerNodeModules = path.join(ownerRoot, owner, 'node_modules');
        const targetDirectory = path.join(
          storeRoot,
          `vendor-core@${version}`,
          'node_modules/@vendor/core',
        );
        const physicalLink = path.join(ownerNodeModules, '@vendor/core');
        await mkdir(path.dirname(physicalLink), { recursive: true });
        await symlink(
          path.relative(path.dirname(physicalLink), targetDirectory),
          physicalLink,
          'dir',
        );
      }

      await preserveNpmAliases({ appDirectory, outputDirectory });

      const requireOwnerOne = createRequire(
        path.join(ownerRoot, 'owner-one/index.js'),
      );
      const requireOwnerTwo = createRequire(
        path.join(ownerRoot, 'owner-two/index.js'),
      );
      expect(requireOwnerOne('@logical/core')).toBe('1.5.0');
      expect(requireOwnerTwo('@logical/core')).toBe('2.5.0');
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });

  it('traverses scoped owners in the real ndepe multi-version store layout', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-scoped-store-alias-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    const ownerDirectory = path.join(
      outputDirectory,
      'node_modules/.ndepe/@bleedingdev/owner@1.0.0/node_modules/@bleedingdev/owner',
    );
    const targetDirectory = path.join(
      outputDirectory,
      'node_modules/@vendor/core',
    );

    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'scoped-store-alias-app',
      });
      await writeJson(path.join(outputDirectory, 'package.json'), {
        name: 'scoped-store-alias-app-prod',
        version: '1.0.0',
      });
      await writeJson(path.join(ownerDirectory, 'package.json'), {
        name: '@bleedingdev/owner',
        version: '1.0.0',
        main: 'index.js',
        dependencies: {
          '@logical/core': 'npm:@vendor/core@1.0.0',
        },
      });
      await writeFile(
        path.join(ownerDirectory, 'index.js'),
        "module.exports = require('@logical/core');\n",
      );
      await writeJson(path.join(targetDirectory, 'package.json'), {
        name: '@vendor/core',
        version: '1.0.0',
        main: 'index.js',
      });
      await writeFile(
        path.join(targetDirectory, 'index.js'),
        "module.exports = 'scoped-store-alias-ran';\n",
      );

      await preserveNpmAliases({ appDirectory, outputDirectory });

      const relocatedOutput = path.join(appDirectory, '.relocated-output');
      await rename(outputDirectory, relocatedOutput);
      const relocatedOwner = path.join(
        relocatedOutput,
        'node_modules/.ndepe/@bleedingdev/owner@1.0.0/node_modules/@bleedingdev/owner',
      );
      const requireFromOwner = createRequire(
        path.join(relocatedOwner, 'index.js'),
      );
      expect(requireFromOwner('./index.js')).toBe('scoped-store-alias-ran');
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });

  it('rejects npm alias targets that resolve outside the deployment output', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-external-alias-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    const externalTarget = path.join(appDirectory, 'external-target');
    const emittedTarget = path.join(
      outputDirectory,
      'node_modules/@vendor/core',
    );

    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'external-alias-app',
        dependencies: {
          '@logical/core': 'npm:@vendor/core@1.0.0',
        },
      });
      await writeJson(path.join(outputDirectory, 'package.json'), {
        name: 'external-alias-app-prod',
        version: '1.0.0',
      });
      await writeJson(path.join(externalTarget, 'package.json'), {
        name: '@vendor/core',
        version: '1.0.0',
      });
      await mkdir(path.dirname(emittedTarget), { recursive: true });
      await symlink(
        path.relative(path.dirname(emittedTarget), externalTarget),
        emittedTarget,
        'dir',
      );

      await expect(
        preserveNpmAliases({ appDirectory, outputDirectory }),
      ).rejects.toThrow('resolves outside deployment output');
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });

  it('leaves ordinary same-name packages unchanged', async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), 'app-tools-same-package-'),
    );
    const outputDirectory = path.join(appDirectory, '.output');
    try {
      await writeJson(path.join(appDirectory, 'package.json'), {
        name: 'ordinary-app',
      });
      await writeJson(path.join(outputDirectory, 'package.json'), {
        name: 'ordinary-app-prod',
        version: '1.0.0',
        dependencies: {
          '@modern-js/prod-server': '1.0.0',
        },
      });
      await writeJson(
        path.join(
          outputDirectory,
          'node_modules/@modern-js/prod-server/package.json',
        ),
        {
          name: '@modern-js/prod-server',
          version: '1.0.0',
        },
      );

      await preserveNpmAliases({
        appDirectory,
        outputDirectory,
        implicitAliases: [
          {
            aliasName: '@modern-js/prod-server',
            targetName: '@modern-js/prod-server',
            targetVersion: '1.0.0',
          },
        ],
      });

      const outputPackageJson = JSON.parse(
        await readFile(path.join(outputDirectory, 'package.json'), 'utf8'),
      );
      expect(outputPackageJson.dependencies['@modern-js/prod-server']).toBe(
        '1.0.0',
      );
    } finally {
      await rm(appDirectory, { recursive: true, force: true });
    }
  });
});
