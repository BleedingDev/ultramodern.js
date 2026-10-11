// The published generator selects the Module Federation sidecar alias; the
// monorepo resolves the same patched upstream through .pnpmfile.cjs.
const ignoreDeps = [
  'fs-extra',
  'tailwindcss',
  '@module-federation/modern-js-v3',
];

// Use the workspace-pinned version to avoid unexpected breaking changes from @latest.
const command = `pnpm exec check-dependency-version-consistency . ${ignoreDeps
  .map(dep => `--ignore-dep "${dep}"`)
  .join(' ')} --ignore-package-pattern "^@examples/"`;

console.log(`> ${command}`);

try {
  require('child_process').execSync(command, { stdio: 'inherit' });
} catch {
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}
