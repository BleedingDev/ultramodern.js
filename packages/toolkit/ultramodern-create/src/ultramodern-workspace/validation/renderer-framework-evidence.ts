import fs from 'node:fs';
import path from 'node:path';
import {
  hasCreateReleaseCohort,
  isCreatePackageSourceCheckout,
  readCreateReleaseCohort,
} from '../../ultramodern-release-cohort';
import { createPackageRoot } from '../fs-io';
import { assert } from './assertions';

type FrameworkPackageEvidence = {
  sourceName: string;
  targetName: string;
  version: string;
  kind: 'release-cohort' | 'source-checkout';
  evidencePath: string;
};

function readSourceManifest(file: string): {
  name: string;
  version: string;
  private?: boolean;
} {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  assert(
    stat?.isFile() && !stat.isSymbolicLink(),
    `Renderer source cohort manifest is missing or unsafe: ${file}`,
  );
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.name === 'string',
    `Renderer source cohort manifest is invalid: ${file}`,
  );
  return value;
}

/** Producer evidence only: consumer node_modules cannot establish this ABI. */
export function readRendererFrameworkPackageEvidence(
  sourceName: string,
): FrameworkPackageEvidence {
  assert(
    /^@modern-js\/renderer-(solid|octane)$/u.test(sourceName),
    `Unsupported renderer framework ABI package: ${sourceName}`,
  );
  if (hasCreateReleaseCohort()) {
    const cohort = readCreateReleaseCohort();
    const member = cohort.packages.find(item => item.sourceName === sourceName);
    assert(
      member,
      `${sourceName} is absent from the authenticated create release cohort`,
    );
    const producerMember = cohort.packages.find(
      item => item.sourceName === '@modern-js/ultramodern-create',
    );
    const producer = readSourceManifest(
      path.join(createPackageRoot, 'package.json'),
    );
    assert(
      producerMember &&
        producer.name === producerMember.targetName &&
        producer.version === cohort.release.version,
      `${sourceName} authenticated release cohort disagrees with the actual create producer`,
    );
    return {
      ...member,
      kind: 'release-cohort',
      evidencePath: path.join(createPackageRoot, 'release-cohort.json'),
    };
  }
  assert(
    isCreatePackageSourceCheckout(),
    `${sourceName} requires authenticated release cohort or actual source checkout evidence`,
  );
  const repositoryRoot = path.resolve(createPackageRoot, '../../..');
  const root = readSourceManifest(path.join(repositoryRoot, 'package.json'));
  assert(
    root.name === 'modern-js-monorepo' &&
      root.private === true &&
      fs.existsSync(path.join(repositoryRoot, 'pnpm-workspace.yaml')),
    `${sourceName} source cohort must be anchored to the actual create monorepo`,
  );
  const producer = readSourceManifest(
    path.join(createPackageRoot, 'package.json'),
  );
  assert(
    producer.name === '@modern-js/ultramodern-create',
    'Renderer source cohort must use the actual create producer',
  );
  const manifestPath = path.join(
    repositoryRoot,
    'packages/runtime',
    sourceName.slice('@modern-js/'.length),
    'package.json',
  );
  const member = readSourceManifest(manifestPath);
  assert(
    member.name === sourceName &&
      typeof member.version === 'string' &&
      member.version.length > 0 &&
      member.version === producer.version,
    `${sourceName} source manifest identity/version disagrees with the actual create producer`,
  );
  return {
    sourceName,
    targetName: sourceName,
    version: member.version,
    kind: 'source-checkout',
    evidencePath: manifestPath,
  };
}
