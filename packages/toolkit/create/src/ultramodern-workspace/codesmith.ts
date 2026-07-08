import path from 'node:path';
import type {
  AddUltramodernVerticalOptions,
  UltramodernGenerationResult,
  UltramodernVerticalPlan,
  UltramodernWorkspaceOptions,
} from './public-api';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernVertical,
} from './public-api';

type UltramodernCodeSmithMode = 'workspace' | 'vertical';

type UltramodernCodeSmithConfig = {
  mode?: UltramodernCodeSmithMode;
  name?: string;
  targetName?: string;
  packageName?: string;
  targetDir?: string;
  workspaceRoot?: string;
  modernVersion?: string;
  enableTailwind?: boolean;
  tailwind?: boolean;
  dryRun?: boolean;
  logResult?: boolean;
  bridge?: UltramodernWorkspaceOptions['bridge'];
  overlays?: UltramodernWorkspaceOptions['overlays'];
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
  packageSourceStrategy?: NonNullable<
    UltramodernWorkspaceOptions['packageSource']
  >['strategy'];
  modernPackageVersion?: string;
  registry?: string;
  aliasScope?: string;
  aliasPackageNamePrefix?: string;
};

type UltramodernCodeSmithResult =
  | UltramodernGenerationResult
  | UltramodernVerticalPlan;

type CodeSmithPromptQuestion = {
  type: 'input' | 'list';
  name: string;
  message: string;
  choices?: string[];
};

type CodeSmithPrompt = (
  questions: CodeSmithPromptQuestion[],
) => Promise<Record<string, unknown>>;

type CodeSmithLogger = {
  info?: (...messages: unknown[]) => void;
};

type UltramodernCodeSmithContext = {
  config?: UltramodernCodeSmithConfig;
  data?: Record<string, unknown>;
  materials?: {
    default?: {
      basePath?: string;
    };
  };
  prompt?: CodeSmithPrompt;
  inquirer?: {
    prompt?: CodeSmithPrompt;
  };
  logger?: CodeSmithLogger;
};

type UltramodernCodeSmithRuntime = {
  outputPath?: string;
  logger?: CodeSmithLogger;
};

export default async function ultramodernCodeSmithAdapter(
  context: UltramodernCodeSmithContext,
  runtime?: UltramodernCodeSmithRuntime,
): Promise<UltramodernCodeSmithResult> {
  const config = context.config ?? {};
  const mode = resolveMode(config);
  const basePath = path.resolve(
    runtime?.outputPath ??
      context.materials?.default?.basePath ??
      process.cwd(),
  );
  const modernVersion = config.modernVersion ?? 'latest';
  const packageSource = resolvePackageSource(config);
  const enableTailwind = config.enableTailwind ?? config.tailwind;

  if (config.dryRun && mode !== 'vertical') {
    throw new Error(
      'UltraModern CodeSmith dry-run is supported only in vertical mode.',
    );
  }

  const name = await resolveName(context, config, mode);
  const result =
    mode === 'workspace'
      ? generateUltramodernWorkspace({
          targetDir: resolveTargetDir(basePath, config.targetDir, name),
          packageName: name,
          modernVersion,
          enableTailwind,
          bridge: config.bridge,
          overlays: config.overlays,
          packageSource,
        })
      : runVerticalMode(
          {
            workspaceRoot: resolveWorkspaceRoot(basePath, config.workspaceRoot),
            name,
            modernVersion,
            enableTailwind,
            overlays: config.overlays,
            packageSource,
          },
          Boolean(config.dryRun),
        );

  context.data ??= {};
  context.data.ultramodernResult = result;

  if (config.logResult) {
    const logger = context.logger ?? runtime?.logger;
    logger?.info?.(JSON.stringify(result, null, 2));
  }

  return result;
}

function resolveMode(
  config: UltramodernCodeSmithConfig,
): UltramodernCodeSmithMode {
  if (config.mode === undefined) {
    return 'workspace';
  }

  if (config.mode !== 'workspace' && config.mode !== 'vertical') {
    throw new Error(
      `Unsupported UltraModern CodeSmith mode "${String(config.mode)}". Use "workspace" or "vertical".`,
    );
  }

  return config.mode;
}

async function resolveName(
  context: UltramodernCodeSmithContext,
  config: UltramodernCodeSmithConfig,
  label: UltramodernCodeSmithMode,
): Promise<string> {
  const configuredName = config.name ?? config.targetName ?? config.packageName;
  if (configuredName) {
    return configuredName;
  }

  const prompt = context.prompt ?? context.inquirer?.prompt;
  if (!prompt) {
    throw new Error(
      `Missing UltraModern ${label} name. Pass config.name for non-interactive CodeSmith usage.`,
    );
  }

  const answer = await prompt([
    {
      type: 'input',
      name: 'name',
      message: `UltraModern ${label} name`,
    },
  ]);
  const promptedName = answer.name;

  if (typeof promptedName !== 'string' || promptedName.length === 0) {
    throw new Error(`Missing UltraModern ${label} name.`);
  }

  return promptedName;
}

function resolveTargetDir(
  basePath: string,
  targetDir: string | undefined,
  name: string,
) {
  return path.resolve(basePath, targetDir ?? name);
}

function resolveWorkspaceRoot(basePath: string, workspaceRoot?: string) {
  return path.resolve(basePath, workspaceRoot ?? '.');
}

function resolvePackageSource(
  config: UltramodernCodeSmithConfig,
): UltramodernWorkspaceOptions['packageSource'] | undefined {
  const packageSource = {
    ...(config.packageSource ?? {}),
    ...(config.packageSourceStrategy
      ? { strategy: config.packageSourceStrategy }
      : {}),
    ...(config.modernPackageVersion
      ? { modernPackageVersion: config.modernPackageVersion }
      : {}),
    ...(config.registry ? { registry: config.registry } : {}),
    ...(config.aliasScope ? { aliasScope: config.aliasScope } : {}),
    ...(config.aliasPackageNamePrefix
      ? { aliasPackageNamePrefix: config.aliasPackageNamePrefix }
      : {}),
  };

  return Object.keys(packageSource).length > 0 ? packageSource : undefined;
}

function runVerticalMode(
  options: AddUltramodernVerticalOptions,
  dryRun: boolean,
) {
  return dryRun
    ? planUltramodernVertical(options)
    : addUltramodernVertical(options);
}
