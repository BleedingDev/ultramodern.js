import { createPnpmDlxArgs } from './package-cohort.mjs';
import { run } from './process.mjs';

function createWorkspace(
  workDir,
  projectName,
  createPackage,
  env,
  runImpl = run,
) {
  runImpl(
    'pnpm',
    createPnpmDlxArgs(createPackage, [projectName, '--lang', 'en']),
    {
      cwd: workDir,
      env,
    },
  );
}

function addVertical(projectDir, vertical, createPackage, env, runImpl = run) {
  runImpl(
    'pnpm',
    createPnpmDlxArgs(createPackage, [vertical, '--vertical', '--lang', 'en']),
    { cwd: projectDir, env },
  );
}

export { addVertical, createWorkspace };
