import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Schema } from 'effect';

const packageRoot = path.resolve(__dirname, '..');
const requireCjs = createRequire(import.meta.url);
const { resolveTsgoBin } = requireCjs(
  path.resolve(__dirname, '../../../../scripts/lib/tsgo-invocation.js'),
);
const publicSubpaths = [
  '.',
  './assembly',
  './effect',
  './effect-edge',
  './effect-client',
  './microvertical-api',
  './data-platform',
] as const;

describe('@modern-js/bff-effect package surface', () => {
  test('loads public CJS and ESM entry points through package resolution', async () => {
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), 'bff-effect-package-consumer-'),
    );

    try {
      const packageLinkParent = path.join(
        fixtureRoot,
        'node_modules/@modern-js',
      );
      mkdirSync(packageLinkParent, { recursive: true });
      symlinkSync(
        packageRoot,
        path.join(packageLinkParent, 'bff-effect'),
        'dir',
      );

      const cjsConsumer = path.join(fixtureRoot, 'consumer.cjs');
      const cjsImports = publicSubpaths
        .map(subpath => {
          const specifier =
            subpath === '.'
              ? '@modern-js/bff-effect'
              : `@modern-js/bff-effect/${subpath.slice(2)}`;
          return `  require(${JSON.stringify(specifier)}),`;
        })
        .join('\n');
      writeFileSync(
        cjsConsumer,
        `module.exports = [\n${cjsImports}\n].map(entry => Object.keys(entry).length > 0);\n`,
      );
      expect(requireCjs(cjsConsumer)).toEqual(publicSubpaths.map(() => true));

      const esmConsumer = path.join(fixtureRoot, 'consumer.mjs');
      const esmImports = publicSubpaths
        .map((subpath, index) => {
          const specifier =
            subpath === '.'
              ? '@modern-js/bff-effect'
              : `@modern-js/bff-effect/${subpath.slice(2)}`;
          return `import * as Entry${index} from ${JSON.stringify(specifier)};`;
        })
        .join('\n');
      const esmEntries = publicSubpaths
        .map((_, index) => `Entry${index}`)
        .join(', ');
      writeFileSync(
        esmConsumer,
        `${esmImports}\nexport default [${esmEntries}].map(entry => Object.keys(entry).length > 0);\n`,
      );
      const loaded = await import(pathToFileURL(esmConsumer).href);
      expect(loaded.default).toEqual(publicSubpaths.map(() => true));
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  test('shares validator-aware factory identity across CJS and ESM builds', async () => {
    const cjsEntryShape = requireCjs(
      path.join(packageRoot, 'dist/cjs/effect/entry-shape.js'),
    ) as {
      registerValidatorAwareHandlerFactory: <TFactory extends Function>(
        factory: TFactory,
      ) => TFactory;
    };
    const esmEntryShape = (await import(
      pathToFileURL(
        path.join(packageRoot, 'dist/esm-node/effect/entry-shape.mjs'),
      ).href
    )) as {
      isValidatorAwareHandlerFactory: (factory: unknown) => boolean;
    };
    const factory = () => undefined;

    cjsEntryShape.registerValidatorAwareHandlerFactory(factory);

    expect(esmEntryShape.isValidatorAwareHandlerFactory(factory)).toBe(true);
  });

  test('keeps browser factory registration isolated from the Node registry', async () => {
    const browserEntryShape = await import(
      pathToFileURL(path.join(packageRoot, 'dist/esm/effect/entry-shape.mjs'))
        .href
    );
    const cjsEntryShape = requireCjs(
      path.join(packageRoot, 'dist/cjs/effect/entry-shape.js'),
    );
    const nodeFactory = () => undefined;
    cjsEntryShape.registerValidatorAwareHandlerFactory(nodeFactory);
    expect(browserEntryShape.isValidatorAwareHandlerFactory(nodeFactory)).toBe(
      false,
    );
    const browserFactory = () => undefined;
    browserEntryShape.registerValidatorAwareHandlerFactory(browserFactory);
    expect(
      browserEntryShape.isValidatorAwareHandlerFactory(browserFactory),
    ).toBe(true);
    expect(cjsEntryShape.isValidatorAwareHandlerFactory(browserFactory)).toBe(
      false,
    );
  });

  test('decodes built micro-vertical schemas with the consumer Effect singleton', async () => {
    const cjsEntry = requireCjs('@modern-js/bff-effect/microvertical-api');
    const esmEntry = await import(
      pathToFileURL(
        path.join(packageRoot, 'dist/esm-node/microvertical-api.mjs'),
      ).href
    );

    for (const entry of [cjsEntry, esmEntry]) {
      const context = entry.createMicroVerticalOperationContext({
        method: 'GET',
        operationId: 'catalog.list',
        routePath: '/catalog',
      });
      expect(
        Schema.decodeUnknownSync(entry.MicroVerticalOperationContextSchema)(
          context,
        ),
      ).toEqual(context);
    }
  });

  test('resolves every declared types export with TypeScript 7', () => {
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), 'bff-effect-types-surface-'),
    );

    try {
      const packageLinkParent = path.join(
        fixtureRoot,
        'node_modules/@modern-js',
      );
      mkdirSync(packageLinkParent, { recursive: true });
      symlinkSync(
        packageRoot,
        path.join(packageLinkParent, 'bff-effect'),
        'dir',
      );

      const typeImports = publicSubpaths
        .map((subpath, index) => {
          const specifier =
            subpath === '.'
              ? '@modern-js/bff-effect'
              : `@modern-js/bff-effect/${subpath.slice(2)}`;
          return `import * as Entry${index} from ${JSON.stringify(
            specifier,
          )};\ntype ExportKeys${index} = keyof typeof Entry${index};\ndeclare const key${index}: ExportKeys${index};\nvoid key${index};`;
        })
        .join('\n');
      writeFileSync(path.join(fixtureRoot, 'index.ts'), `${typeImports}\n`);
      const nodeTypesManifestPath = requireCjs.resolve(
        '@types/node/package.json',
      );
      const reactTypesManifestPath = requireCjs.resolve(
        '@types/react/package.json',
      );
      writeFileSync(
        path.join(fixtureRoot, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              lib: ['DOM', 'ESNext'],
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              skipLibCheck: false,
              strict: true,
              target: 'ES2024',
              typeRoots: [
                path.dirname(path.dirname(nodeTypesManifestPath)),
                path.dirname(path.dirname(reactTypesManifestPath)),
              ],
              types: ['node', 'react'],
            },
            include: ['index.ts'],
          },
          null,
          2,
        )}\n`,
      );

      const compilerPath = resolveTsgoBin({ requireFrom: requireCjs });
      const result = spawnSync(
        process.execPath,
        [compilerPath, '--project', path.join(fixtureRoot, 'tsconfig.json')],
        {
          encoding: 'utf8',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
