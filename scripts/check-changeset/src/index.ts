import readChangesets from '@changesets/read';
import { getPackages, type Package } from '@manypkg/get-packages';
import path from 'path';

type VersionType = 'major' | 'minor' | 'patch' | 'none';
type Release = {
  name: string;
  type: VersionType;
};
type Changeset = {
  summary: string;
  releases: Array<Release>;
};
type NewChangeset = Changeset & {
  id: string;
};

// FORK: upstream only permits a `major` bump inside a changeset whose id
// contains `modern-3` (the Modern.js 3.0 release train). The UltraModern fork
// ships its own breaking changes outside that train, so each one is listed here
// deliberately, by id, instead of weakening the gate. Adding an entry is the
// conscious act of accepting a breaking change; the cohort change record
// (scripts/ultramodern-publish/gen-cohort-change-record.mjs) is what publishes
// it. Do NOT replace this with a wildcard, and do NOT drop it on a sync merge.
const FORK_ALLOWED_MAJOR_CHANGESET_IDS = new Set([
  'remove-bff-event-contracts',
  'remove-runtime-tanstack-router-alias',
  'ultramodern-i18n-instance-assignable',
]);

function checkChangeset(packages: Package[], changesets: NewChangeset[]) {
  for (const changeset of changesets) {
    const { id, releases } = changeset;
    releases.forEach(release => {
      if (
        !id.includes('modern-3') &&
        !FORK_ALLOWED_MAJOR_CHANGESET_IDS.has(id) &&
        release.type === 'major'
      ) {
        throw Error(
          `packages ${release.name} not allow bump major version in ${id}.md file`,
        );
      }
      if (!packages.find(pkg => pkg.packageJson.name === release.name)) {
        throw Error(`package ${release.name} is not found in ${id}.md file`);
      }
    });
  }
}

function validatePackagePeerDependencies(packages: Package[]) {
  packages.forEach(({ packageJson }) => {
    const { peerDependencies = {} } = packageJson;
    Object.keys(peerDependencies).forEach(dep => {
      const depPkg = packages.find(pkg => pkg.packageJson.name === dep);
      if (depPkg) {
        if (
          peerDependencies[dep] !== `workspace:^${depPkg.packageJson.version}`
        ) {
          throw Error(
            `${packageJson.name}'s peerDependencies ${dep} version is not right, expect "workspace:^${depPkg.packageJson.version}"`,
          );
        }
      }
    });
  });
}
async function run() {
  const cwd = process.cwd();
  const title = process.env.PULL_REQUEST_TITLE;
  if (title?.includes('[SKIP CHANGESET]')) {
    return;
  }
  const repoDir = path.join(cwd, '../../');
  const { packages } = await getPackages(repoDir);
  const changesets = await readChangesets(repoDir, process.env.BASE_BRANCH);
  checkChangeset(packages, changesets);
  validatePackagePeerDependencies(packages);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
