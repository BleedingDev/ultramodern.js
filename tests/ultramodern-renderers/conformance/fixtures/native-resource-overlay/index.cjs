const fs = require('node:fs/promises');
const path = require('node:path');

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Supported authoring input; the generator owns this physical staging root. */
module.exports = async context => {
  const cfg = context.config;
  const app = cfg?.generatedApp;
  if (
    !['solid', 'octane'].includes(app?.renderer) ||
    typeof app.directory !== 'string'
  )
    throw new Error(
      'Native resource overlay requires one native generated app',
    );
  if (
    !path.isAbsolute(cfg.outputWorkspaceRoot ?? '') ||
    !path.isAbsolute(cfg.workspaceRoot ?? '') ||
    path.isAbsolute(app.directory)
  )
    throw new Error(
      'Native resource overlay requires the physical generator stage',
    );
  if (!(await fs.lstat(cfg.outputWorkspaceRoot)).isDirectory())
    throw new Error(
      'Native overlay requires an ordinary physical generator stage',
    );
  const stage = await fs.realpath(cfg.outputWorkspaceRoot);
  const logical = await fs.realpath(cfg.workspaceRoot).catch(error => {
    if (error.code === 'ENOENT') return path.resolve(cfg.workspaceRoot);
    throw error;
  });
  if (stage === logical)
    throw new Error(
      'Native physical generator stage must differ from the logical workspace',
    );
  const appRoot = await fs.realpath(path.resolve(stage, app.directory));
  if (!contained(stage, appRoot) || appRoot === stage)
    throw new Error(
      'Generated app must belong to the physical generator stage',
    );
  const programFiles = ['browser', 'server'].map(role =>
    path.join(appRoot, `tsconfig.native-${role}.json`),
  );
  for (const programFile of programFiles)
    if (
      await fs.lstat(programFile).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      })
    )
      throw new Error(
        'EEXIST: native acceptance type program is already authored',
      );
  const authoredRoot = path.resolve(__dirname, '..', app.renderer);
  async function sourceDirectory(relative) {
    let current = appRoot;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let entry = await fs.lstat(current).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!entry) {
        await fs.mkdir(current);
        entry = await fs.lstat(current);
      }
      if (
        !entry.isDirectory() ||
        !contained(appRoot, await fs.realpath(current))
      )
        throw new Error(
          'Native authored source directory escapes the generator stage',
        );
    }
  }
  async function conformanceSources(directory, relative) {
    await sourceDirectory(relative);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory())
        await conformanceSources(path.join(directory, entry.name), next);
      else if (entry.isFile()) {
        const target = path.join(appRoot, next);
        const existing = await fs.lstat(target).catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (existing && !existing.isFile())
          throw new Error(
            'Native authored source target must be an ordinary file',
          );
        const contents = await fs.readFile(
          path.join(directory, entry.name),
          'utf8',
        );
        await fs.writeFile(
          target,
          contents
            .replaceAll('@bleedingdev/modern-js-', '@modern-js/')
            .replace('Hand-authored', 'Generated'),
        );
      } else
        throw new Error(
          'Native conformance source must be ordinary authored input',
        );
    }
  }
  if (cfg.conformanceRoutes === true)
    await conformanceSources(path.join(authoredRoot, 'src'), 'src');
  for (const file of [
    'src/components/Counter.tsx',
    'src/components/Stable.tsx',
    'src/conformance.ts',
  ]) {
    const destination = path.join(appRoot, file);
    const parent = await fs.realpath(path.dirname(destination));
    if (!contained(appRoot, parent))
      throw new Error('Native overlay source parent escapes the generated app');
    const existing = await fs.lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing && !existing.isFile())
      throw new Error(
        'Native overlay refuses a linked or non-file source target',
      );
    await fs.copyFile(path.join(authoredRoot, file), destination);
  }
  const { nativeTypePrograms } = await import(
    path.resolve(
      __dirname,
      '../../../../../scripts/ultramodern-renderers/acceptance/type-programs.mjs',
    )
  );
  const programs = nativeTypePrograms(
    app.renderer,
    cfg.twoEntryConformance === true ? ['ssr', 'csr'] : ['main'],
  );
  for (const [index, role] of ['browser', 'server'].entries())
    await fs.writeFile(
      programFiles[index],
      `${JSON.stringify(programs[role], null, 2)}\n`,
      { flag: 'wx' },
    );
  if (cfg.twoEntryConformance === true) {
    const packageFile = path.join(appRoot, 'package.json');
    if (!(await fs.lstat(packageFile)).isFile())
      throw new Error(
        'Compiler observation requires the authored app manifest',
      );
    const manifest = JSON.parse(await fs.readFile(packageFile, 'utf8'));
    const { resolveRsbuildDependency } = await import(
      path.resolve(
        __dirname,
        '../../../../../scripts/ultramodern-renderers/acceptance/rsbuild-dependency.mjs',
      )
    );
    const admittedCore = resolveRsbuildDependency({
      releaseManifest: cfg.releaseManifest,
    });
    let declaredCore = false;
    for (const block of [manifest.dependencies, manifest.devDependencies]) {
      if (block?.['@rsbuild/core'] === undefined) continue;
      block['@rsbuild/core'] = resolveRsbuildDependency({
        releaseManifest: cfg.releaseManifest,
        specifier: block['@rsbuild/core'],
      });
      declaredCore = true;
    }
    if (!declaredCore) {
      manifest.devDependencies = {
        ...manifest.devDependencies,
        '@rsbuild/core': admittedCore,
      };
    }
    await fs.writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.copyFile(
      path.resolve(__dirname, '../observe-native-compiler.ts'),
      path.join(appRoot, 'observe-native-compiler.ts'),
      fs.constants.COPYFILE_EXCL,
    );
    const { authorEntryVariants } = await import(
      path.resolve(
        __dirname,
        '../../../../../scripts/ultramodern-renderers/acceptance/entries.mjs',
      )
    );
    await authorEntryVariants(appRoot, { compilerObservation: true });
  }
};
