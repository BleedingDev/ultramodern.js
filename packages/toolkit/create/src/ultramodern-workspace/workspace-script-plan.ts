import { appHasApi, shellApp } from './descriptors';
import { relativeRootFor } from './naming';
import { createPublicSurfaceGenerationCommand } from './public-surface';
import {
  GENERATED_TOOLING_COMMANDS,
  type GeneratedToolingCommandKey,
} from './tooling-command-catalog';
import type { WorkspaceApp } from './types';

const toolingWrapperPath = (key: GeneratedToolingCommandKey) =>
  GENERATED_TOOLING_COMMANDS[key].wrapperPath;

const rootToolingScriptName = (key: GeneratedToolingCommandKey) => {
  const rootScript = GENERATED_TOOLING_COMMANDS[key].rootScript;
  if (!rootScript) {
    throw new Error(
      `Generated tooling command ${key} does not define a root package script.`,
    );
  }
  return rootScript;
};

const rootToolingWrapperCommand = (key: GeneratedToolingCommandKey) =>
  `node ./${toolingWrapperPath(key)}`;

const relativeToolingWrapperPath = (
  packageDir: string,
  key: GeneratedToolingCommandKey,
) => `${relativeRootFor(packageDir)}/${toolingWrapperPath(key)}`;

const packageToolingWrapperCommand = (
  packageDir: string,
  key: GeneratedToolingCommandKey,
) => `node ${relativeToolingWrapperPath(packageDir, key)}`;

export interface WorkspaceRootScriptPlan {
  build: string;
  cloudflareBuild: string;
  cloudflareDeploy: string;
  cloudflareProof: string;
  cloudflareOutputVerify: string;
  backendFederationGenerate: string;
  nodeProof: string;
  mfTypes: string;
  performanceReadiness: string;
  migrateStrictEffect: string;
  zeropsMaterialize: string;
  contractCheck: string;
  typecheck: string;
  check: string;
}

const workspaceRootPackageScriptNames = {
  build: 'build',
  cloudflareBuild: 'cloudflare:build',
  cloudflareDeploy: 'cloudflare:deploy',
  cloudflareProof: rootToolingScriptName('cloudflareProof'),
  cloudflareOutputVerify: rootToolingScriptName('cloudflareOutputVerify'),
  backendFederationGenerate: rootToolingScriptName('backendFederationGenerate'),
  nodeProof: rootToolingScriptName('backendFederationProof'),
  mfTypes: rootToolingScriptName('mfTypes'),
  performanceReadiness: rootToolingScriptName('performanceReadiness'),
  migrateStrictEffect: rootToolingScriptName('migrateStrictEffect'),
  zeropsMaterialize: 'zerops:materialize',
  contractCheck: rootToolingScriptName('validate'),
  typecheck: 'typecheck',
  check: 'check',
} as const satisfies Record<keyof WorkspaceRootScriptPlan, string>;

type WorkspaceRootPackageScriptName =
  (typeof workspaceRootPackageScriptNames)[keyof typeof workspaceRootPackageScriptNames];

type WorkspaceRootPackageScripts = Partial<
  Record<WorkspaceRootPackageScriptName, string>
>;

const shellOnlyOmittedRootScriptPlanKeys = new Set<
  keyof WorkspaceRootScriptPlan
>(['backendFederationGenerate', 'nodeProof', 'zeropsMaterialize']);

interface WorkspaceAppScriptPlan {
  dev: string;
  build: string;
  cloudflareBuild: string;
  cloudflareDeploy: string;
  cloudflarePreview: string;
  cloudflareProof: string;
  serve: string;
  typecheck: string;
}

const workspaceAppPackageScriptNames = {
  dev: 'dev',
  build: 'build',
  cloudflareBuild: 'cloudflare:build',
  cloudflareDeploy: 'cloudflare:deploy',
  cloudflarePreview: 'cloudflare:preview',
  cloudflareProof: 'cloudflare:proof',
  serve: 'serve',
  typecheck: 'typecheck',
} as const satisfies Record<keyof WorkspaceAppScriptPlan, string>;

type WorkspaceAppPackageScriptName =
  (typeof workspaceAppPackageScriptNames)[keyof typeof workspaceAppPackageScriptNames];

type WorkspaceAppPackageScripts = Record<WorkspaceAppPackageScriptName, string>;

export const createStrictTsgoTypecheckCommand = (packageDir: string) =>
  `${packageToolingWrapperCommand(packageDir, 'typecheck')} --project tsconfig.json`;

function createWorkspaceAppScriptPlan(
  app: WorkspaceApp,
): WorkspaceAppScriptPlan {
  const backendFederationBuildCommand = appHasApi(app)
    ? `${packageToolingWrapperCommand(
        app.directory,
        'backendFederationGenerate',
      )} --app ${app.id}`
    : undefined;
  const backendFederationCloudflareBuildCommand = backendFederationBuildCommand
    ? `${backendFederationBuildCommand} --target dist-cloudflare`
    : undefined;
  const buildSteps = [
    'modern build',
    backendFederationBuildCommand,
    createPublicSurfaceGenerationCommand(app, 'dist'),
    app.exposes
      ? packageToolingWrapperCommand(app.directory, 'mfTypes')
      : undefined,
  ].filter((step): step is string => Boolean(step));
  const cloudflareBuildSteps = [
    'MODERNJS_DEPLOY=cloudflare modern build',
    backendFederationCloudflareBuildCommand,
    'MODERNJS_DEPLOY=cloudflare modern deploy --skip-build',
    createPublicSurfaceGenerationCommand(app, 'cloudflare'),
    `${packageToolingWrapperCommand(
      app.directory,
      'cloudflareOutputVerify',
    )} --app ${app.id}`,
  ].filter((step): step is string => Boolean(step));

  return {
    dev: 'modern dev',
    build: buildSteps.join(' && '),
    cloudflareBuild: cloudflareBuildSteps.join(' && '),
    cloudflareDeploy:
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    cloudflarePreview:
      'pnpm run cloudflare:build && wrangler dev --config .output/wrangler.json',
    cloudflareProof: `${packageToolingWrapperCommand(
      app.directory,
      'cloudflareProof',
    )} --app ${app.id}`,
    serve: 'modern serve',
    typecheck: createStrictTsgoTypecheckCommand(app.directory),
  };
}

export function createWorkspaceAppPackageScripts(
  app: WorkspaceApp,
): WorkspaceAppPackageScripts {
  const plan = createWorkspaceAppScriptPlan(app);

  return Object.fromEntries(
    Object.entries(workspaceAppPackageScriptNames).map(
      ([planKey, packageScriptName]) => [
        packageScriptName,
        plan[planKey as keyof WorkspaceAppScriptPlan],
      ],
    ),
  ) as WorkspaceAppPackageScripts;
}

export function createWorkspaceRootScriptPlan(
  remotes: WorkspaceApp[] = [],
  options: {
    bridgeCheck?: string;
    typecheck?: string;
    shells?: WorkspaceApp[];
  } = {},
): WorkspaceRootScriptPlan {
  const hasRemotes = remotes.length > 0;
  // Enumerate configured shells (G28) instead of hard-coding the single
  // ./apps/shell-super-app. The default is the primary shell alone, so a
  // single-shell workspace produces byte-identical legacy scripts.
  const shells =
    options.shells && options.shells.length > 0 ? options.shells : [shellApp];
  const shellBuild = shells
    .map(shell => `pnpm --filter "./${shell.directory}" run build`)
    .join(' && ');
  const shellCloudflareBuild = shells
    .map(shell => `pnpm --filter "./${shell.directory}" run cloudflare:build`)
    .join(' && ');
  const shellCloudflareDeploy = shells
    .map(shell => `pnpm --filter "./${shell.directory}" run cloudflare:deploy`)
    .join(' && ');
  const mfTypesScript = rootToolingScriptName('mfTypes');
  const performanceReadinessScript = rootToolingScriptName(
    'performanceReadiness',
  );
  const cloudflareOutputVerifyScript = rootToolingScriptName(
    'cloudflareOutputVerify',
  );
  const backendFederationGenerateScript = rootToolingScriptName(
    'backendFederationGenerate',
  );
  const nodeProofScript = rootToolingScriptName('backendFederationProof');
  const bridgeCheck = options.bridgeCheck ?? '';
  const remoteBuildPrefix = hasRemotes
    ? 'pnpm -r --filter "./verticals/*" run build && '
    : '';
  const remoteCloudflareBuildPrefix = hasRemotes
    ? 'pnpm -r --filter "./verticals/*" run cloudflare:build && '
    : '';
  const remoteCloudflareDeployPrefix = hasRemotes
    ? 'pnpm -r --filter "./verticals/*" run cloudflare:deploy && '
    : '';

  return {
    build: `${remoteBuildPrefix}${shellBuild} && pnpm ${mfTypesScript} && pnpm ${performanceReadinessScript}`,
    cloudflareBuild: `${remoteCloudflareBuildPrefix}${shellCloudflareBuild} && pnpm ${mfTypesScript} && pnpm ${cloudflareOutputVerifyScript}`,
    cloudflareDeploy: `${remoteCloudflareDeployPrefix}${shellCloudflareDeploy}`,
    cloudflareProof: `${rootToolingWrapperCommand(
      'cloudflareProof',
    )} --out .codex/reports/cloudflare-version-proof/public-url-proof.json`,
    cloudflareOutputVerify: rootToolingWrapperCommand('cloudflareOutputVerify'),
    backendFederationGenerate: rootToolingWrapperCommand(
      'backendFederationGenerate',
    ),
    nodeProof: `pnpm ${backendFederationGenerateScript} && ${rootToolingWrapperCommand(
      'backendFederationProof',
    )}`,
    mfTypes: rootToolingWrapperCommand('mfTypes'),
    performanceReadiness: rootToolingWrapperCommand('performanceReadiness'),
    migrateStrictEffect: rootToolingWrapperCommand('migrateStrictEffect'),
    zeropsMaterialize: 'node ./scripts/materialize-zerops-runtime.mjs',
    contractCheck: rootToolingWrapperCommand('validate'),
    typecheck:
      options.typecheck ??
      `${rootToolingWrapperCommand('typecheck')} --project tsconfig.json`,
    // Backend-federation gates only apply when the workspace exposes
    // API-bearing verticals. Shell-only workspaces omit them so migrate does
    // not inject `node:proof`/`node:backend-federation:generate` into a
    // workspace that has no backend surfaces (matches the validator contract).
    check: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm i18n:boundaries && pnpm api:check && pnpm contract:check${
      hasRemotes ? ` && pnpm ${nodeProofScript}` : ''
    } && pnpm performance:readiness${bridgeCheck}`,
  };
}

export function createWorkspaceRootPackageScripts(
  remotes: WorkspaceApp[] = [],
  options: {
    bridgeCheck?: string;
    typecheck?: string;
    shells?: WorkspaceApp[];
  } = {},
): WorkspaceRootPackageScripts {
  const plan = createWorkspaceRootScriptPlan(remotes, options);
  const shellOnly = remotes.length === 0;

  return Object.fromEntries(
    Object.entries(workspaceRootPackageScriptNames)
      .filter(
        ([planKey]) =>
          !(
            shellOnly &&
            shellOnlyOmittedRootScriptPlanKeys.has(
              planKey as keyof WorkspaceRootScriptPlan,
            )
          ),
      )
      .map(([planKey, packageScriptName]) => [
        packageScriptName,
        plan[planKey as keyof WorkspaceRootScriptPlan],
      ]),
  ) as WorkspaceRootPackageScripts;
}
