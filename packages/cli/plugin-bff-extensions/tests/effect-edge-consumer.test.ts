import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

describe('canonical worker runtime integration', () => {
  test('worker consumer builds through canonical packages without a direct effect dependency', async () => {
    const { createRsbuild } = await import('@rsbuild/core');
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-edge-consumer-'),
    );

    try {
      const srcDir = path.join(appDir, 'src');
      await fs.promises.mkdir(srcDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify(
          {
            private: true,
            name: 'effect-edge-consumer-no-direct-effect',
            dependencies: {
              '@modern-js/bff-effect': 'workspace:*',
              '@modern-js/plugin-bff-extensions': 'workspace:*',
            },
          },
          null,
          2,
        ),
      );
      const require = createRequire(import.meta.url);
      const scopeDirectory = path.join(appDir, 'node_modules', '@modern-js');
      await fs.promises.mkdir(scopeDirectory, { recursive: true });
      for (const packageName of ['bff-effect', 'plugin-bff-extensions']) {
        const installedRoot = path.dirname(
          require.resolve(`@modern-js/${packageName}/package.json`),
        );
        await fs.promises.symlink(
          installedRoot,
          path.join(scopeDirectory, packageName),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      await fs.promises.writeFile(
        path.join(srcDir, 'worker.ts'),
        `import {
  createEffectBffEdgeHandler,
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  Schema,
} from '@modern-js/bff-effect/effect-edge';
import { loadBackendFederatedEffectApi } from '@modern-js/plugin-bff-extensions/backend-federation/edge';

export const loadBackend = loadBackendFederatedEffectApi;

const api = HttpApi.make('GeneratedEdgeApi').add(
  HttpApiGroup.make('status').add(
    HttpApiEndpoint.get('readiness', '/readiness', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

const statusLayer = HttpApiBuilder.group(api, 'status', handlers =>
  handlers.handle('readiness', () => Effect.succeed({ ok: true })),
);
const layer = HttpApiBuilder.layer(api).pipe(Layer.provide(statusLayer));
const module = defineEffectBff({ api, layer });

export default {
  async fetch(request: Request) {
    const edge = await createEffectBffEdgeHandler({
      module,
      prefix: '/api',
    });
    return edge.handler(request);
  },
};
`,
      );

      const rsbuild = await createRsbuild({
        cwd: appDir,
        rsbuildConfig: {
          source: {
            entry: {
              worker: path.join(srcDir, 'worker.ts'),
            },
          },
          output: {
            distPath: {
              root: path.join(appDir, 'dist'),
            },
            target: 'web-worker',
          },
          performance: {
            chunkSplit: {
              strategy: 'all-in-one',
            },
          },
          tools: {
            htmlPlugin: false,
          },
        },
      });

      const buildWarnings: string[] = [];
      rsbuild.onAfterBuild(({ stats }) => {
        if (!stats) {
          return;
        }
        const statsJson = stats.toJson({ all: false, warnings: true });
        const warnings = [
          ...(statsJson?.warnings ?? []),
          ...(statsJson?.children ?? []).flatMap(child => child.warnings ?? []),
        ];
        buildWarnings.push(
          ...warnings.map(
            warning => warning.message ?? JSON.stringify(warning),
          ),
        );
      });

      await expect(rsbuild.build()).resolves.toBeDefined();

      expect(buildWarnings).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /critical dependency|dependency is an expression|dynamic (?:import|request).*expression/iu,
          ),
        ]),
      );

      const distRoot = path.join(appDir, 'dist');
      const outputFiles = (
        await fs.promises.readdir(distRoot, { recursive: true })
      ).filter(file => file.endsWith('.js'));
      const bundledSource = (
        await Promise.all(
          outputFiles.map(file =>
            fs.promises.readFile(path.join(distRoot, file), 'utf8'),
          ),
        )
      ).join('\n');

      // Upstream Effect's FindMyWay tries a guarded `new Function` and builds
      // params by assignment when Workers block string code generation; the
      // bff-effect codegen-blocked test proves that path.
      expect(bundledSource).not.toContain('allowsEval');
      expect(bundledSource).not.toMatch(/\beval\s*\(/u);
      expect(bundledSource).not.toContain('node:crypto');
      expect(bundledSource).not.toContain('backend-federation-security/node');
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
