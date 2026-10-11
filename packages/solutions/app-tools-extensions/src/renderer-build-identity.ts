import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  immutableRendererRouterBindings,
  type RendererIdentity,
  type RendererName,
  type RendererProfile,
  type RendererRouterBindings,
  type RouterFramework,
  validateRendererProfile,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import { resolveUltramodernSourceRevision } from './release-identity';

export type RendererProfileKeyInput = RendererProfile & {
  readonly dependencies?: Readonly<Record<string, string>>;
};

export interface RendererBuildIdentityOptions {
  projectRoot: string;
  renderer: RendererName;
  profile: RendererProfileKeyInput;
  entryNames: readonly string[];
  mode: 'development' | 'production';
  /** Delivery-unit app id; defaults to the application package name. */
  appId?: string;
  /** Externally authenticated source revision (delivery unit or CI). */
  sourceRevision?: string;
  /** Actual final entry ownership, supplied by the selected renderer composition. */
  routerBindings: RendererRouterBindings;
  /** Admitted router frameworks, supplied by the selected renderer owner. */
  routerFrameworks?: readonly RouterFramework[];
}

export interface RendererBuildIdentities {
  readonly identities: Readonly<Record<string, RendererIdentity>>;
  readonly buildId: string;
  readonly profileKey: string;
  readonly sourceRevision: string;
  readonly routerBindings: RendererRouterBindings;
}

const LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];

/** Stable per process: one dev session or dirty build keeps one buildId. */
const processNonce = randomUUID();

const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

/** Renderer, protocol and installed renderer/framework/compiler versions. */
export function rendererProfileKey(profile: RendererProfileKeyInput): string {
  return sha256(
    JSON.stringify([
      profile.renderer,
      profile.protocolVersion,
      profile.compiler,
      profile.hydration,
      profile.router,
      Object.entries(profile.dependencies ?? {}).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ]),
  );
}

/** Hash of the nearest lockfile, or an empty marker when there is none. */
function lockfileHash(projectRoot: string): string {
  let directory = path.resolve(projectRoot);
  for (;;) {
    for (const name of LOCKFILES) {
      try {
        return sha256(fs.readFileSync(path.join(directory, name)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return '';
    directory = parent;
  }
}

/** Resolve once per build before emitting entries; never rehashes sources. */
export function resolveRendererBuildIdentities(
  options: RendererBuildIdentityOptions,
): RendererBuildIdentities {
  const profile: RendererProfile = {
    renderer: options.profile.renderer,
    protocolVersion: options.profile.protocolVersion,
    compiler: options.profile.compiler,
    hydration: options.profile.hydration,
    router: options.profile.router,
  };
  const validation = validateRendererProfile(profile);
  if (!validation.ok || options.renderer !== profile.renderer)
    throw new Error(
      `Renderer/profile identity mismatch: ${JSON.stringify(validation.errors)}.`,
    );
  const entries = [...options.entryNames].sort();
  if (
    entries.length === 0 ||
    new Set(entries).size !== entries.length ||
    entries.some(value => !value || value === '__proto__')
  )
    throw new Error(
      'Renderer build identity requires unique nonempty entry names.',
    );
  const routerValidation = validateRendererRouterBindings(
    options.routerBindings,
    entries,
    'routerBindings',
    options.routerFrameworks,
  );
  if (!routerValidation.ok)
    throw new Error(
      `Invalid renderer router bindings: ${JSON.stringify(routerValidation.errors)}.`,
    );
  const projectRoot = path.resolve(options.projectRoot);
  const appId =
    options.appId ??
    JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
      .name;
  if (typeof appId !== 'string' || !appId || appId.trim() !== appId)
    throw new Error(
      'Renderer application identity requires a delivery artifact appId or a package name.',
    );
  const profileKey = rendererProfileKey(options.profile);
  const sourceRevision = resolveUltramodernSourceRevision(
    projectRoot,
    options.sourceRevision,
  );
  const buildId = sha256(
    JSON.stringify([
      profileKey,
      lockfileHash(projectRoot),
      options.mode === 'development' || sourceRevision === 'workspace'
        ? processNonce
        : sourceRevision,
    ]),
  );
  const identities = Object.fromEntries(
    entries.map(entryName => [
      entryName,
      Object.freeze({
        renderer: options.renderer,
        appId,
        entryName,
        protocolVersion: 1 as const,
        buildId,
      }),
    ]),
  );
  return Object.freeze({
    identities: Object.freeze(identities),
    buildId,
    profileKey,
    sourceRevision,
    routerBindings: immutableRendererRouterBindings(options.routerBindings),
  });
}
