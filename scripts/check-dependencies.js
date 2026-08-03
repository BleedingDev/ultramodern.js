const ignoreDeps = ['fs-extra', 'tsconfig-paths'];

// Use the workspace-pinned version to avoid unexpected breaking changes from @latest.
const command = `pnpm exec check-dependency-version-consistency . ${ignoreDeps
  .map(dep => `--ignore-dep "${dep}"`)
  .join(' ')} --ignore-package-pattern "^@examples/"`;

console.log(`> ${command}`);

try {
  require('child_process').execSync(command, { stdio: 'inherit' });
} catch (e) {
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}
