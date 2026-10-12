import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const generatorFiles = [
  'packages/toolkit/ultramodern-create/tests/add-shell.test.ts',
  'packages/toolkit/ultramodern-create/tests/workspace-integration.test.ts',
];
export const windowsLanes = ['1/4', '2/4', '3/4', '4/4', 'generators'];
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = file => JSON.stringify([file.project, file.testPath]);
const relativeFile = (root, file) =>
  path.relative(root, file).split(path.sep).join('/');

export function selectWindowsUnitFiles(root, baseline, lane) {
  if (!windowsLanes.includes(lane))
    throw new Error(`Unknown Windows lane: ${lane}`);
  for (const file of generatorFiles) {
    if (!baseline.some(entry => relativeFile(root, entry.testPath) === file)) {
      throw new Error(`Measured Windows generator test is missing: ${file}`);
    }
  }
  return baseline.filter(
    entry =>
      generatorFiles.includes(relativeFile(root, entry.testPath)) ===
      (lane === 'generators'),
  );
}

export function assertWindowsCoverage(baseline, lanes) {
  const expected = new Set(baseline.map(identity));
  if (expected.size !== baseline.length)
    throw new Error('Duplicate baseline project/file identity');
  const actual = new Set();
  for (const files of lanes) {
    for (const file of files) {
      const key = identity(file);
      if (!expected.has(key))
        throw new Error(`Unexpected Windows test identity: ${key}`);
      if (actual.has(key))
        throw new Error(`Windows test runs more than once: ${key}`);
      actual.add(key);
    }
  }
  const missing = [...expected].filter(key => !actual.has(key));
  if (missing.length)
    throw new Error(`Missing Windows test identities: ${missing.join(', ')}`);
}

export function excludeUnselected(project, files) {
  // CLI --exclude replaces project excludes and would rediscover other lanes.
  const exclude = project.exclude;
  const patterns = [
    ...(Array.isArray(exclude) ? exclude : (exclude?.patterns ?? [])),
    ...files,
  ];
  return {
    ...project,
    exclude:
      Array.isArray(exclude) || !exclude ? patterns : { ...exclude, patterns },
  };
}

export async function windowsUnitConfig(
  root,
  base,
  loadConfig,
  lane,
  baseline,
) {
  if (!['ordinary', 'generators'].includes(lane))
    throw new Error(`Unknown Windows test group: ${lane}`);
  const slow = generatorFiles.map(file =>
    path.join(root, file).split(path.sep).join('/'),
  );
  const excluded =
    lane === 'ordinary'
      ? slow
      : [
          ...new Set(
            baseline.map(file => file.testPath.split(path.sep).join('/')),
          ),
        ].filter(file => !slow.includes(file));
  const projects = [];
  for (const pattern of base.projects ?? []) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) {
      throw new Error('Windows selection requires root project config paths');
    }
    for (const file of fs.globSync(pattern, { cwd: root })) {
      const configPath = path.resolve(root, file);
      const projectRoot = path.dirname(configPath);
      const { content } = await loadConfig({
        cwd: projectRoot,
        path: configPath,
      });
      const name = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
      ).name;
      // Pinned Rstest resolves nested inline leaves without inheriting the
      // containing file's defaults. Retain leaf extends objects so its native
      // resolver applies the same explicit common config and child overrides.
      const leaves = content.projects ?? [
        {
          ...content,
          name: content.name ?? name,
          root: content.root ?? projectRoot,
        },
      ];
      for (const project of leaves) {
        if (typeof project !== 'object' || project.projects) {
          throw new Error(`Unsupported nested Windows project in ${file}`);
        }
        projects.push(
          excludeUnselected({ root: projectRoot, ...project }, excluded),
        );
      }
    }
  }
  if (!projects.length)
    throw new Error('Windows selection resolved no projects');
  return { ...base, root: base.root ?? root, projects };
}

export async function loadWindowsUnitInputs(root) {
  const require = createRequire(path.join(root, 'package.json'));
  // Load the exact Rsbuild dependency of pinned Rstest; no additional loader.
  const rstestRequire = createRequire(
    require.resolve('@rstest/core/package.json'),
  );
  const [{ createRstest }, { loadConfig }] = await Promise.all([
    import(pathToFileURL(require.resolve('@rstest/core/api')).href),
    import(pathToFileURL(rstestRequire.resolve('@rsbuild/core')).href),
  ]);
  const { content: base } = await loadConfig({
    cwd: root,
    path: path.join(root, 'rstest.config.mts'),
  });
  return { createRstest, loadConfig, base };
}

export async function verifyWindowsUnitSelection(root) {
  const { createRstest, loadConfig, base } = await loadWindowsUnitInputs(root);
  const original = await createRstest({ cwd: root, config: base });
  const baseline = await original.listTests({ filesOnly: true });
  const lanes = [];
  for (const group of ['ordinary', 'generators']) {
    const config = await windowsUnitConfig(
      root,
      base,
      loadConfig,
      group,
      baseline,
    );
    const rstest = await createRstest({ cwd: root, config });
    const unsharded = await rstest.listTests({ filesOnly: true });
    assertWindowsCoverage(
      selectWindowsUnitFiles(
        root,
        baseline,
        group === 'generators' ? group : '1/4',
      ),
      [unsharded],
    );
    for (const lane of group === 'ordinary'
      ? windowsLanes.slice(0, 4)
      : ['generators']) {
      const files = await rstest.listTests({
        filesOnly: true,
        ...(lane === 'generators' ? {} : { shard: lane }),
      });
      lanes.push(files);
      console.log(
        JSON.stringify({
          windowsUnitLane: lane,
          testFiles: new Set(files.map(file => file.testPath)).size,
          projectFileIdentities: files.length,
          testFileWorkers: 1,
        }),
      );
    }
  }
  assertWindowsCoverage(baseline, lanes);
  console.log(
    `Verified ${baseline.length} Windows project/file identities exactly once.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify')
    throw new Error('Use --verify to check Windows test coverage');
  await verifyWindowsUnitSelection(repoRoot);
}
