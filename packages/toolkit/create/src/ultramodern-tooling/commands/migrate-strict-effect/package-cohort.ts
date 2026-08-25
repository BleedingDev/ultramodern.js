import {
  modernPackageSpecifier,
  type ResolvedUltramodernPackageSource,
  ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES,
  ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
} from '../../../ultramodern-package-source';
import { ULTRAMODERN_PACKAGE_PINS } from '../../../ultramodern-workspace/policy';
import type { WorkspaceApp } from '../../../ultramodern-workspace/types';
import {
  createWorkspaceAppPackageScripts,
  createWorkspaceRootPackageScripts,
  GENERATED_POSTINSTALL_SCRIPT,
} from '../../../ultramodern-workspace/workspace-script-plan';
import { migratedWorkspaceScriptBasenames } from '../../../ultramodern-workspace/workspace-scripts';

const modernPackageNames = new Set<string>([
  ...ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES,
  ...ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
]);

export function updateModernDependencies(
  packageJson: Record<string, any>,
  packageSource: ResolvedUltramodernPackageSource,
) {
  let changed = false;
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const packageName of Object.keys(dependencies)) {
      if (!modernPackageNames.has(packageName)) {
        continue;
      }

      const nextSpecifier = modernPackageSpecifier(packageName, packageSource);
      if (dependencies[packageName] !== nextSpecifier) {
        dependencies[packageName] = nextSpecifier;
        changed = true;
      }
    }
  }

  return changed;
}

const generatedToolingDependencyPins = new Map<string, string>(
  Object.entries({
    ...ULTRAMODERN_PACKAGE_PINS.appDependencies,
    ...ULTRAMODERN_PACKAGE_PINS.appDevDependencies,
    ...ULTRAMODERN_PACKAGE_PINS.rootDevDependencies,
  }),
);

export function updateGeneratedToolingDependencies(
  packageJson: Record<string, any>,
) {
  let changed = false;
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const [packageName, version] of generatedToolingDependencyPins) {
      if (
        Object.prototype.hasOwnProperty.call(dependencies, packageName) &&
        dependencies[packageName] !== version
      ) {
        dependencies[packageName] = version;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * `@modern-js/plugin-bff` declares `effect` and `@effect/opentelemetry` as
 * OPTIONAL peers, so whoever depends on plugin-bff has to supply them. A
 * workspace generated before that change declares neither, and nothing else
 * pulls Effect in — so on migration the BFF lane has no Effect to load, and the
 * `effect@<version>` entry this command writes into `patchedDependencies`
 * matches no package, which pnpm rejects with ERR_PNPM_UNUSED_PATCH.
 *
 * Unlike `updateGeneratedToolingDependencies`, this adds the pins when they are
 * missing rather than only re-pinning what is already declared.
 */
export function ensureBffEffectDependencies(packageJson: Record<string, any>) {
  let changed = false;
  for (const section of ['dependencies', 'devDependencies']) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies) ||
      !Object.hasOwn(dependencies, '@modern-js/plugin-bff')
    ) {
      continue;
    }

    for (const [packageName, version] of Object.entries(
      ULTRAMODERN_PACKAGE_PINS.bffEffectDependencies,
    )) {
      if (dependencies[packageName] !== version) {
        dependencies[packageName] = version;
        changed = true;
      }
    }
  }

  return changed;
}

const cloudflareModernDeployCommand =
  'MODERNJS_DEPLOY=cloudflare modern deploy';

const cloudflareModernDeploySkipBuildCommand = `${cloudflareModernDeployCommand} --skip-build`;

const cloudflareWranglerDeployCommand =
  'wrangler deploy --config .output/wrangler.json';

const cloudflareWranglerDeployInvalidSkipBuildCommand = `${cloudflareWranglerDeployCommand} --skip-build`;

function removeStaleBackendFederationCommandSegments(command: string) {
  return command.replace(
    /\s+&&\s+node\s+\S*scripts\/generate-node-backend-federation\.m[ct]s(?:\s+--app\s+\S+)?(?:\s+--target\s+\S+)?(?=\s+&&|$)/gu,
    '',
  );
}

// Root package.json scripts that only apply to workspaces with API-bearing
// verticals. On shell-only workspaces they are neither injected nor kept
// (their wrappers/materializers are not generated), so leaving them would
// dangle at deleted files.

// Framework-owned root scripts that are CONDITIONAL on workspace shape: any
// of them present in package.json but absent from the freshly derived
// expected set is stale (e.g. backend wrappers after the last API unit was
// removed, or on a ui-only migration) and must be deleted, not kept.
const CONDITIONAL_FRAMEWORK_ROOT_SCRIPTS: readonly string[] = [
  'node:backend-federation:generate',
  'node:proof',
  'zerops:materialize',
];

// Split an aggregate script (`a && b && c`) into its `&&`-joined segments.

const splitScriptSegments = (command: string): string[] =>
  command
    .split('&&')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

// The pnpm script target a segment invokes (e.g. `pnpm api:check --foo` -> `api:check`).

const scriptSegmentTarget = (segment: string): string =>
  segment.replace(/^pnpm\s+/u, '').split(/\s+/u)[0] ?? segment;

// Every check segment the framework manages, across both shell-only and
// full-stack shapes. A segment whose target is in this set is framework-owned
// even when the current shape omits it (e.g. `node:proof` on a shell-only
// workspace); it must never be preserved as a "consumer extra", otherwise
// migrate would reintroduce a gate pointing at a script it did not generate.

const FRAMEWORK_CHECK_TARGETS: ReadonlySet<string> = new Set([
  'format:check',
  'lint',
  'typecheck',
  'skills:check',
  'i18n:boundaries',
  'api:check',
  'contract:check',
  'node:backend-federation:generate',
  'node:proof',
  'performance:readiness',
  'bridge:check',
]);

// Merge a framework aggregate `check` into a consumer-curated one: framework
// segments are updated/ordered as the framework dictates, while consumer-owned
// segments (targets the framework does not manage) are preserved. Consumer
// extras are kept ahead of the framework block so the framework tail
// (`... && pnpm performance:readiness`) stays intact for the validator.

function mergeAggregateCheckScript(
  consumer: string,
  framework: string,
): string {
  const frameworkSegments = splitScriptSegments(framework);
  const consumerExtras = splitScriptSegments(consumer).filter(
    segment => !FRAMEWORK_CHECK_TARGETS.has(scriptSegmentTarget(segment)),
  );
  return [...consumerExtras, ...frameworkSegments].join(' && ');
}

function mergeGeneratedScript(
  consumer: string,
  framework: string,
): { command: string; preservedConsumerSegments: boolean } {
  const consumerSegments = splitScriptSegments(consumer);
  const frameworkSegments = splitScriptSegments(framework);
  const frameworkSegmentSet = new Set(frameworkSegments);
  const canonicalFrameworkSegment = (segment: string) => {
    if (frameworkSegmentSet.has(segment)) {
      return segment;
    }

    // Generated deploy commands gained --skip-build after Modern began
    // separating build and deploy. The unflagged predecessor is framework
    // history, not a consumer command to append after its replacement.
    if (
      frameworkSegmentSet.has(`${segment} --skip-build`) &&
      /\bmodern deploy$/u.test(segment)
    ) {
      return `${segment} --skip-build`;
    }

    // The dedicated verifier wrapper was folded into ultramodern-tooling.
    // Its app selector remains in the canonical replacement, so the legacy
    // wrapper is safe to classify as generated ownership.
    if (
      /\bnode\s+\S*scripts\/verify-cloudflare-output\.m[ct]s\s+--app\s+\S+$/u.test(
        segment,
      ) &&
      frameworkSegments.find(candidate =>
        candidate.includes('ultramodern-tooling.mts cloudflare-output-verify'),
      )
    ) {
      return frameworkSegments.find(candidate =>
        candidate.includes('ultramodern-tooling.mts cloudflare-output-verify'),
      );
    }

    return undefined;
  };
  const frameworkIndexes = consumerSegments.flatMap((segment, index) =>
    canonicalFrameworkSegment(segment) ? [index] : [],
  );

  // With no exact generated segment there is no defensible ownership proof.
  if (frameworkIndexes.length === 0) {
    return { command: consumer, preservedConsumerSegments: true };
  }

  const firstFrameworkIndex = frameworkIndexes[0];
  const lastFrameworkIndex = frameworkIndexes.at(-1)!;
  const consumerPrefix = consumerSegments
    .slice(0, firstFrameworkIndex)
    .filter(segment => canonicalFrameworkSegment(segment) === undefined);
  const consumerExtrasAfter = new Map<string, string[]>();
  let precedingFrameworkSegment: string | undefined;
  for (const segment of consumerSegments.slice(
    firstFrameworkIndex,
    lastFrameworkIndex + 1,
  )) {
    const canonicalSegment = canonicalFrameworkSegment(segment);
    if (canonicalSegment !== undefined) {
      precedingFrameworkSegment = canonicalSegment;
    } else if (precedingFrameworkSegment !== undefined) {
      const extras = consumerExtrasAfter.get(precedingFrameworkSegment) ?? [];
      extras.push(segment);
      consumerExtrasAfter.set(precedingFrameworkSegment, extras);
    }
  }
  const consumerSuffix = consumerSegments
    .slice(lastFrameworkIndex + 1)
    .filter(segment => canonicalFrameworkSegment(segment) === undefined);
  const consumerMiddle = [...consumerExtrasAfter.values()].flat();
  const consumerExtras = [
    ...consumerPrefix,
    ...consumerMiddle,
    ...consumerSuffix,
  ];

  return {
    command: [
      ...consumerPrefix,
      ...frameworkSegments.flatMap(segment => [
        segment,
        ...(consumerExtrasAfter.get(segment) ?? []),
      ]),
      ...consumerSuffix,
    ].join(' && '),
    preservedConsumerSegments: consumerExtras.length > 0,
  };
}

// Rewrite any script references to a workspace-owned .mjs script that migrate
// renamed to .mts, so no package.json script points at a deleted file.

function rewriteMigratedScriptReferences(scripts: Record<string, any>) {
  let changed = false;
  const pattern = new RegExp(
    `(scripts/(?:${migratedWorkspaceScriptBasenames.join('|')}))\\.mjs`,
    'gu',
  );
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') {
      continue;
    }
    const next = value.replace(pattern, '$1.mts');
    if (next !== value) {
      scripts[name] = next;
      changed = true;
    }
  }
  return changed;
}

export function updateGeneratedPackageScripts(
  packageJson: Record<string, any>,
  options: {
    relativePackageFile?: string;
    apps?: WorkspaceApp[];
    shellOnly?: boolean;
    onPreserveScript?: (scriptName: string) => void;
  } = {},
) {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return false;
  }

  let changed = false;
  const apps = options.apps ?? [];
  const app = apps.find(
    candidate =>
      `${candidate.directory}/package.json` === options.relativePackageFile,
  );
  const isRootPackage = options.relativePackageFile === 'package.json';

  if (rewriteMigratedScriptReferences(scripts)) {
    changed = true;
  }

  if (isRootPackage) {
    const existingPostinstall = scripts.postinstall;
    const mergedPostinstall =
      typeof existingPostinstall === 'string'
        ? mergeGeneratedScript(
            existingPostinstall,
            GENERATED_POSTINSTALL_SCRIPT,
          )
        : {
            command: GENERATED_POSTINSTALL_SCRIPT,
            preservedConsumerSegments: false,
          };
    if (mergedPostinstall.preservedConsumerSegments) {
      options.onPreserveScript?.('postinstall');
    }
    if (scripts.postinstall !== mergedPostinstall.command) {
      scripts.postinstall = mergedPostinstall.command;
      changed = true;
    }
  }

  const expectedScripts = isRootPackage
    ? createWorkspaceRootPackageScripts(
        apps.filter(candidate => candidate.kind !== 'shell'),
        {
          shells: apps.filter(candidate => candidate.kind === 'shell'),
        },
      )
    : app
      ? createWorkspaceAppPackageScripts(app)
      : undefined;

  if (expectedScripts) {
    // Remove stale conditional framework scripts the current workspace shape
    // no longer derives (split backend vs Zerops gating upstream decides).
    if (isRootPackage) {
      for (const name of CONDITIONAL_FRAMEWORK_ROOT_SCRIPTS) {
        if (!(name in expectedScripts) && name in scripts) {
          delete scripts[name];
          changed = true;
        }
      }
    }
    for (const [name, value] of Object.entries(expectedScripts)) {
      // Shell-only workspaces never materialize backend-federation/Zerops
      // wrappers, so their root scripts must not be injected either.

      if (value === undefined) {
        continue;
      }

      // `check` is a consumer-curated aggregate; framework segments must be
      // present/updated but consumer-owned segments must never be dropped.
      const existingScript = scripts[name];
      const mergedScript =
        typeof existingScript === 'string'
          ? mergeGeneratedScript(existingScript, value)
          : { command: value, preservedConsumerSegments: false };
      const nextValue =
        name === 'check' && typeof existingScript === 'string'
          ? mergeAggregateCheckScript(existingScript, value)
          : mergedScript.command;

      if (name !== 'check' && mergedScript.preservedConsumerSegments) {
        options.onPreserveScript?.(name);
      }

      if (scripts[name] !== nextValue) {
        scripts[name] = nextValue;
        changed = true;
      }
    }
  }

  const build = scripts.build;
  if (typeof build === 'string') {
    const nextBuild = removeStaleBackendFederationCommandSegments(build);
    if (nextBuild !== build) {
      scripts.build = nextBuild;
      changed = true;
    }
  }

  const cloudflareBuild = scripts['cloudflare:build'];
  if (typeof cloudflareBuild === 'string') {
    let nextCloudflareBuild =
      removeStaleBackendFederationCommandSegments(cloudflareBuild);
    if (
      nextCloudflareBuild.includes(cloudflareModernDeployCommand) &&
      !nextCloudflareBuild.includes(cloudflareModernDeploySkipBuildCommand)
    ) {
      nextCloudflareBuild = nextCloudflareBuild.replace(
        cloudflareModernDeployCommand,
        cloudflareModernDeploySkipBuildCommand,
      );
    }

    if (nextCloudflareBuild !== cloudflareBuild) {
      scripts['cloudflare:build'] = nextCloudflareBuild;
      changed = true;
    }
  }

  const cloudflareDeploy = scripts['cloudflare:deploy'];
  if (
    typeof cloudflareDeploy === 'string' &&
    cloudflareDeploy.includes(cloudflareWranglerDeployInvalidSkipBuildCommand)
  ) {
    scripts['cloudflare:deploy'] = cloudflareDeploy.replace(
      cloudflareWranglerDeployInvalidSkipBuildCommand,
      cloudflareWranglerDeployCommand,
    );
    changed = true;
  }

  return changed;
}
