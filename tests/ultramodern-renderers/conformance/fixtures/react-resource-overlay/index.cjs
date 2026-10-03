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

async function existing(target) {
  return fs.lstat(target).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
}

/** Adds authored entry sources before the owning generator captures config. */
module.exports = async context => {
  const cfg = context.config;
  const app = cfg?.generatedApp;
  if (
    app?.renderer !== 'react' ||
    typeof app.directory !== 'string' ||
    path.isAbsolute(app.directory) ||
    !path.isAbsolute(cfg.outputWorkspaceRoot ?? '') ||
    !path.isAbsolute(cfg.workspaceRoot ?? '')
  )
    throw new Error(
      'React overlay requires one app in the physical generator stage',
    );
  if (!(await existing(cfg.outputWorkspaceRoot))?.isDirectory())
    throw new Error(
      'React overlay requires an ordinary physical generator stage',
    );
  const stage = await fs.realpath(cfg.outputWorkspaceRoot);
  const logical = await fs.realpath(cfg.workspaceRoot).catch(error => {
    if (error.code === 'ENOENT') return path.resolve(cfg.workspaceRoot);
    throw error;
  });
  if (stage === logical)
    throw new Error(
      'React physical generator stage must differ from the logical workspace',
    );
  const declaredRoot = path.resolve(stage, app.directory);
  if (!contained(stage, declaredRoot) || declaredRoot === stage)
    throw new Error('React app escapes the physical generator stage');
  let appRoot = stage;
  for (const part of path.relative(stage, declaredRoot).split(path.sep)) {
    appRoot = path.join(appRoot, part);
    if (!(await existing(appRoot))?.isDirectory())
      throw new Error('React app requires ordinary physical stage directories');
  }
  const source = path.join(appRoot, 'src');
  const config = path.join(appRoot, 'modern.config.ts');
  if (
    !(await existing(source))?.isDirectory() ||
    !(await existing(config))?.isFile()
  )
    throw new Error(
      'React overlay requires ordinary authored source and config',
    );
  const base = path.join(appRoot, 'modern.entry-base.config.ts');
  const program = path.join(appRoot, 'tsconfig.react-acceptance.json');
  for (const target of [
    base,
    program,
    path.join(source, 'ssr'),
    path.join(source, 'csr'),
  ])
    if (await existing(target))
      throw new Error('EEXIST: React conformance source is already authored');
  const originalConfig = await fs.readFile(config);
  const packageFile = path.join(appRoot, 'package.json');
  const packageInfo = await existing(packageFile);
  if (!packageInfo?.isFile())
    throw new Error(
      'React observer requires an ordinary authored app manifest',
    );
  const packageManifest = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  for (const dependencies of [
    packageManifest.dependencies,
    packageManifest.devDependencies,
  ])
    if (
      dependencies?.['@rsbuild/core'] !== undefined &&
      dependencies['@rsbuild/core'] !== '2.2.9'
    )
      throw new Error(
        'React observer requires its exact public Rsbuild provider',
      );
  packageManifest.devDependencies = {
    ...packageManifest.devDependencies,
    '@rsbuild/core': '2.2.9',
  };
  await fs.writeFile(
    packageFile,
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  await fs.copyFile(
    path.resolve(__dirname, '../observe-native-compiler.ts'),
    path.join(appRoot, 'observe-native-compiler.ts'),
    fs.constants.COPYFILE_EXCL,
  );
  const corpus = path.resolve(__dirname, '../react/src');
  async function copy(directory, destination) {
    await fs.mkdir(destination);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const input = path.join(directory, entry.name);
      const output = path.join(destination, entry.name);
      if (entry.isDirectory()) await copy(input, output);
      else if (entry.isFile())
        await fs.writeFile(
          output,
          (await fs.readFile(input, 'utf8'))
            .replaceAll('@bleedingdev/modern-js-', '@modern-js/')
            .replace('Hand-authored', 'Generated'),
          { flag: 'wx' },
        );
      else throw new Error('React conformance source requires ordinary files');
    }
  }
  for (const entry of ['ssr', 'csr'])
    await copy(corpus, path.join(source, entry));
  await fs.writeFile(base, originalConfig, { flag: 'wx' });
  await fs.writeFile(
    program,
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: false },
        include: [
          'modern.config.ts',
          'modern.entry-base.config.ts',
          'src',
          'node_modules/.modern-js',
        ],
        exclude: [],
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
  await fs.writeFile(
    config,
    `import authoredConfig from './modern.entry-base.config';
import { observeNativeCompiler } from './observe-native-compiler';

const ssr = {
  ...(typeof authoredConfig.server?.ssr === 'object' ? authoredConfig.server.ssr : {}),
  mode: 'stream' as const,
};

export default {
  ...authoredConfig,
  builderPlugins: [...(authoredConfig.builderPlugins ?? []), observeNativeCompiler()],
  source: {
    ...authoredConfig.source,
    disableDefaultEntries: true,
    mainEntryName: 'ssr',
    entries: {
      ...authoredConfig.source?.entries,
      ssr: './src/ssr/routes',
      csr: './src/csr/routes',
    },
  },
  server: {
    ...authoredConfig.server,
    ssr,
    ssrByEntries: { ...authoredConfig.server?.ssrByEntries, csr: false, ssr },
    routes: { ...authoredConfig.server?.routes, ssr: '/ssr', csr: '/csr' },
  },
};
`,
  );
};
