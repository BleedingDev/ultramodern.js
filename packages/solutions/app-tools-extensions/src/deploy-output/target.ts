import { getArgv } from '@modern-js/utils';
import { provider as detectedProvider } from 'std-env';

export const DEPLOY_TARGETS = [
  'node',
  'vercel',
  'netlify',
  'ghPages',
  'cloudflare',
] as const;

export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export const DEPLOY_TARGET_FLAG = '--deploy-target';

const providerDeployTargets: Partial<Record<string, DeployTarget>> = {
  vercel: 'vercel',
  netlify: 'netlify',
  cloudflare: 'cloudflare',
  cloudflare_pages: 'cloudflare',
  cloudflare_workers: 'cloudflare',
};

export interface ResolvedDeployTarget {
  target: DeployTarget;
  /** The flag, `deploy.target` or `MODERNJS_DEPLOY` chose the target. */
  explicit: boolean;
}

export interface ResolveDeployTargetOptions {
  argv?: readonly string[];
  configTarget?: string;
  env?: string;
  provider?: string;
}

const readDeployTargetFlag = (argv: readonly string[]) => {
  for (const [index, arg] of argv.entries()) {
    if (arg === DEPLOY_TARGET_FLAG) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${DEPLOY_TARGET_FLAG} needs a value.`);
      }
      return value;
    }
    if (arg.startsWith(`${DEPLOY_TARGET_FLAG}=`)) {
      return arg.slice(DEPLOY_TARGET_FLAG.length + 1);
    }
  }
  return undefined;
};

const assertDeployTarget = (target: string, source: string): DeployTarget => {
  if (!(DEPLOY_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Unknown deploy target '${target}' from ${source}. Use one of: ${DEPLOY_TARGETS.join(', ')}.`,
    );
  }
  return target as DeployTarget;
};

/**
 * The one deploy-target resolver: `--deploy-target` > `deploy.target` >
 * `MODERNJS_DEPLOY` > detected CI provider > `node`. app-tools stores the
 * result in the app context once; config files that branch on the target call
 * it without `configTarget`.
 */
export const resolveDeployTarget = ({
  argv = getArgv(),
  configTarget,
  env = process.env.MODERNJS_DEPLOY,
  provider = detectedProvider,
}: ResolveDeployTargetOptions = {}): ResolvedDeployTarget => {
  const explicit = (
    [
      [readDeployTargetFlag(argv), DEPLOY_TARGET_FLAG],
      [configTarget, 'deploy.target'],
      [env, 'MODERNJS_DEPLOY'],
    ] as const
  ).find(([target]) => target);
  if (explicit?.[0]) {
    return {
      target: assertDeployTarget(explicit[0], explicit[1]),
      explicit: true,
    };
  }
  return {
    target: (provider && providerDeployTargets[provider]) || 'node',
    explicit: false,
  };
};

/**
 * The target `modern deploy` stages. Apps under another CLI meta name deploy
 * only when a flag, config or env chose the target explicitly.
 */
export const getDeployingTarget = ({
  deployTarget,
  metaName,
}: {
  deployTarget?: ResolvedDeployTarget;
  metaName: string;
}): DeployTarget | undefined =>
  deployTarget && (metaName === 'modern-js' || deployTarget.explicit)
    ? deployTarget.target
    : undefined;
