import { builtinModules } from 'node:module';
import ncc from '@vercel/ncc';
import fastGlob from 'fast-glob';
import fs from 'fs-extra';
import { dirname, join } from 'path';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { DEFAULT_EXTERNALS } from './constant';
import { pick } from './helper';
import type { ParsedTask } from './types';

function emitAssets(
  assets: Record<string, { source: string }>,
  distPath: string,
) {
  for (const key of Object.keys(assets)) {
    const asset = assets[key];
    fs.outputFileSync(join(distPath, key), asset.source);
  }
}

function emitIndex(code: string, distPath: string) {
  const distIndex = join(distPath, 'index.js');
  fs.outputFileSync(distIndex, code);
}

function emitESMIndex(code: string, distPath: string) {
  const distIndex = join(distPath, 'index.mjs');
  fs.outputFileSync(
    distIndex,
    `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n${code}`,
  );
}

async function emitDts(task: ParsedTask) {
  if (!task.emitDts) return;
  const manifest = fs.readJSONSync(join(task.depPath, 'package.json'));
  const types =
    manifest.types ??
    manifest.typings ??
    manifest.exports?.types ??
    manifest.exports?.['.']?.types ??
    (fs.existsSync(join(task.depPath, 'index.d.ts'))
      ? 'index.d.ts'
      : undefined);
  const input = types
    ? join(task.depPath, types)
    : join(
        dirname(require.resolve(`@types/${task.depName}/package.json`)),
        'index.d.ts',
      );
  const externals = { ...DEFAULT_EXTERNALS, ...task.externals };
  const bundle = await rollup({
    input,
    external: name =>
      name.startsWith('node:') ||
      builtinModules.includes(name) ||
      name in externals,
    plugins: [dts({ respectExternal: true })],
  });
  try {
    await bundle.write({
      file: join(task.distPath, 'index.d.ts'),
      format: 'es',
      paths: externals,
    });
  } finally {
    await bundle.close();
  }
}

function emitPackageJson(task: ParsedTask) {
  const packageJsonPath = join(task.depPath, 'package.json');
  const packageJson = fs.readJsonSync(packageJsonPath, 'utf-8');
  const outputPath = join(task.distPath, 'package.json');

  const pickedPackageJson = pick(packageJson, [
    'name',
    'author',
    'version',
    'funding',
    'license',
    'types',
    'typing',
    'typings',
    ...task.packageJsonField,
  ]);

  pickedPackageJson.types = 'index.d.ts';

  if (task.depName !== pickedPackageJson.name) {
    pickedPackageJson.name = task.depName;
  }

  if (task.ignoreDts) {
    delete pickedPackageJson.typing;
    delete pickedPackageJson.typings;
    pickedPackageJson.types = 'index.d.ts';
  }

  fs.writeJSONSync(outputPath, pickedPackageJson);
}

function emitLicense(task: ParsedTask) {
  const licensePath = join(task.depPath, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    fs.copySync(licensePath, join(task.distPath, 'license'));
  }
}

function emitExtraFiles(task: ParsedTask) {
  const { emitFiles } = task;
  emitFiles.forEach(item => {
    const path = join(task.distPath, item.path);
    fs.outputFileSync(path, item.content);
  });
}

function removeSourceMap(task: ParsedTask) {
  const maps = fastGlob.sync(join(task.distPath, '**/*.map'));
  maps.forEach(mapPath => {
    fs.removeSync(mapPath);
  });
}

const pkgName = process.argv[2];

export async function prebundle(task: ParsedTask) {
  if (pkgName && task.depName !== pkgName) {
    return;
  }

  console.log(`==== Start prebundle "${task.depName}" ====`);

  if (task.clear) {
    fs.removeSync(task.distPath);
  }

  if (task.beforeBundle) {
    await task.beforeBundle(task);
  }

  const { code, assets } = await ncc(task.depEntry, {
    externals: {
      ...DEFAULT_EXTERNALS,
      ...task.externals,
    },
    assetBuilds: false,
    minify: task.minify,
    esm: false,
  });

  if (task.depEsmEntry) {
    const { code: esmCode } = await ncc(task.depEsmEntry, {
      externals: {
        ...DEFAULT_EXTERNALS,
        ...task.externals,
      },
      assetBuilds: false,
      minify: task.minify,
      esm: true,
    });
    emitESMIndex(esmCode, task.distPath);
  }

  emitIndex(code, task.distPath);
  emitAssets(assets, task.distPath);
  await emitDts(task);
  if (
    (task.depEsmEntry ||
      task.emitFiles.some(file => file.path === 'index.mjs')) &&
    task.emitDts
  ) {
    fs.copySync(
      join(task.distPath, 'index.d.ts'),
      join(task.distPath, 'index.d.mts'),
    );
  }
  emitLicense(task);
  emitPackageJson(task);
  removeSourceMap(task);
  emitExtraFiles(task);

  if (task.afterBundle) {
    await task.afterBundle(task);
  }

  console.log(`==== Finish prebundle "${task.depName}" ====\n\n`);
}
