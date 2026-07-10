import { i18n, localeKeys } from '../locale';
import {
  parseUltramodernBridgeCliOptions,
  ultramodernBridgeCliBooleanFlags,
  ultramodernBridgeCliValueFlags,
} from '../ultramodern-workspace/bridge-config';

export const WORKSPACE_PROTOCOL_FLAG = '--workspace';
export const DRY_RUN_FLAG = '--dry-run';
export const VERTICAL_FLAG = '--vertical';
const VERTICAL_NAME_FLAG = '--vertical-name';
export const CODESMITH_OVERLAY_FLAG = '--codesmith-overlay';
export const PRESET_FLAG = '--preset';
export const API_PROTOCOL_FLAG = '--api-protocol';
export const HORIZONTAL_REMOTE_FLAG = '--horizontal-remote';
const SUPPORTED_PRESETS = ['full-stack', 'api-only', 'ui-only'] as const;
const SUPPORTED_API_PROTOCOLS = ['rest', 'rpc'] as const;

export type VerticalPresetFlag = (typeof SUPPORTED_PRESETS)[number];
export type ApiProtocolFlag = (typeof SUPPORTED_API_PROTOCOLS)[number];

const BFF_FLAG = '--bff';
const BFF_RUNTIME_OPTION = '--bff-runtime';
const SUPPORTED_BFF_RUNTIMES = ['effect'] as const;

type SupportedBffRuntime = (typeof SUPPORTED_BFF_RUNTIMES)[number];

export function getOptionValue(
  args: string[],
  names: string[],
): string | undefined {
  for (const name of names) {
    const prefix = `${name}=`;
    const byEquals = args.find(arg => arg.startsWith(prefix));
    if (byEquals) {
      return byEquals.slice(prefix.length);
    }

    const index = args.findIndex(arg => arg === name);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
  }

  return undefined;
}

export const detectLanguage = (): 'zh' | 'en' => {
  const lang = getOptionValue(process.argv.slice(2), ['--lang', '-l']);
  if (lang === 'zh') {
    return 'zh';
  }

  return 'en';
};

// The UltraModern scaffold ships exactly one BFF shape: every MicroVertical
// exposes a strict Effect API runtime (plugin-bff runtimeFramework 'effect').
// `--bff` keeps working as an explicit opt-in to that default; `--bff-runtime`
// selects the runtime and rejects anything the workspace generator cannot
// scaffold (the pre-UltraModern hono single-app scaffold was removed together
// with the old CLI).
export function detectBffRuntime(args: string[]): SupportedBffRuntime {
  if (args.some(arg => arg.startsWith(`${BFF_FLAG}=`))) {
    console.error(
      `${BFF_FLAG} does not accept a value. Use: ${BFF_RUNTIME_OPTION} <runtime>`,
    );
    process.exit(1);
  }

  const runtimeRequested = args.some(
    arg =>
      arg === BFF_RUNTIME_OPTION || arg.startsWith(`${BFF_RUNTIME_OPTION}=`),
  );
  if (!runtimeRequested) {
    return 'effect';
  }

  const runtime = getOptionValue(args, [BFF_RUNTIME_OPTION]);
  if (!runtime) {
    console.error(
      `${BFF_RUNTIME_OPTION} requires a value (supported: ${SUPPORTED_BFF_RUNTIMES.join(', ')})`,
    );
    process.exit(1);
  }

  if (!(SUPPORTED_BFF_RUNTIMES as readonly string[]).includes(runtime)) {
    console.error(
      `Unsupported BFF runtime "${runtime}". UltraModern workspaces scaffold a strict Effect API runtime for every MicroVertical (supported: ${SUPPORTED_BFF_RUNTIMES.join(', ')}).`,
    );
    process.exit(1);
  }

  return runtime as SupportedBffRuntime;
}

export function detectTailwindFlag(): boolean {
  const args = process.argv.slice(2);
  return !args.includes('--no-tailwind');
}

export function detectExplicitTailwindFlag(): boolean | undefined {
  const args = process.argv.slice(2);
  if (args.includes('--no-tailwind')) {
    return false;
  }
  if (args.includes('--tailwind')) {
    return true;
  }
  return undefined;
}

type VerticalCliInput =
  | {
      addVertical: false;
    }
  | {
      addVertical: true;
      name: string;
    };

type VerticalNameCandidate = {
  value: string;
  source: string;
};

export function collectPositionalArgs(args: string[]): string[] {
  const optionWithValue = new Set([
    '--lang',
    '-l',
    BFF_RUNTIME_OPTION,
    '--ultramodern-package-source',
    '--ultramodern-package-version',
    '--ultramodern-package-registry',
    '--ultramodern-package-scope',
    '--ultramodern-package-name-prefix',
    VERTICAL_NAME_FLAG,
    CODESMITH_OVERLAY_FLAG,
    PRESET_FLAG,
    API_PROTOCOL_FLAG,
    ...ultramodernBridgeCliValueFlags,
  ]);
  const optionWithoutValue = new Set([
    '--help',
    '-h',
    '--version',
    '-v',
    '--tailwind',
    '--no-tailwind',
    BFF_FLAG,
    WORKSPACE_PROTOCOL_FLAG,
    DRY_RUN_FLAG,
    VERTICAL_FLAG,
    HORIZONTAL_REMOTE_FLAG,
    ...ultramodernBridgeCliBooleanFlags,
  ]);
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (optionWithoutValue.has(arg)) {
      continue;
    }

    if (optionWithValue.has(arg)) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith('--lang=') ||
      arg.startsWith(`${BFF_RUNTIME_OPTION}=`) ||
      arg.startsWith('--ultramodern-package-source=') ||
      arg.startsWith('--ultramodern-package-version=') ||
      arg.startsWith('--ultramodern-package-registry=') ||
      arg.startsWith('--ultramodern-package-scope=') ||
      arg.startsWith('--ultramodern-package-name-prefix=') ||
      arg.startsWith(`${VERTICAL_FLAG}=`) ||
      arg.startsWith(`${VERTICAL_NAME_FLAG}=`) ||
      arg.startsWith(`${CODESMITH_OVERLAY_FLAG}=`) ||
      arg.startsWith(`${PRESET_FLAG}=`) ||
      arg.startsWith(`${API_PROTOCOL_FLAG}=`) ||
      ultramodernBridgeCliBooleanFlags.some(flag =>
        arg.startsWith(`${flag}=`),
      ) ||
      ultramodernBridgeCliValueFlags.some(flag => arg.startsWith(`${flag}=`))
    ) {
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

function readRequiredVerticalNameValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    console.error(i18n.t(localeKeys.error.verticalNameMissing));
    process.exit(1);
  }

  return value;
}

export function resolveVerticalCliInput(args: string[]): VerticalCliInput {
  const candidates: VerticalNameCandidate[] = [];
  let addVertical = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === VERTICAL_FLAG) {
      addVertical = true;
      continue;
    }

    if (arg.startsWith(`${VERTICAL_FLAG}=`)) {
      addVertical = true;
      candidates.push({
        value: arg.slice(`${VERTICAL_FLAG}=`.length),
        source: `${VERTICAL_FLAG}=<name>`,
      });
      continue;
    }

    if (arg === VERTICAL_NAME_FLAG) {
      addVertical = true;
      candidates.push({
        value: readRequiredVerticalNameValue(args, i),
        source: VERTICAL_NAME_FLAG,
      });
      i += 1;
      continue;
    }

    if (arg.startsWith(`${VERTICAL_NAME_FLAG}=`)) {
      addVertical = true;
      candidates.push({
        value: arg.slice(`${VERTICAL_NAME_FLAG}=`.length),
        source: `${VERTICAL_NAME_FLAG}=<name>`,
      });
    }
  }

  if (!addVertical) {
    return { addVertical: false };
  }

  const positionalArgs = collectPositionalArgs(args);
  if (positionalArgs.length > 1) {
    console.error(`Unexpected positional argument: ${positionalArgs[1]}`);
    process.exit(1);
  }

  if (positionalArgs[0]) {
    candidates.push({
      value: positionalArgs[0],
      source: 'positional argument',
    });
  }

  const emptyCandidate = candidates.find(candidate => candidate.value === '');
  if (!candidates.length || emptyCandidate) {
    console.error(i18n.t(localeKeys.error.verticalNameMissing));
    process.exit(1);
  }

  const [firstCandidate] = candidates;
  const disagreement = candidates.find(
    candidate => candidate.value !== firstCandidate.value,
  );
  if (disagreement) {
    console.error(
      i18n.t(localeKeys.error.verticalNameAmbiguous, {
        firstName: firstCandidate.value,
        firstSource: firstCandidate.source,
        secondName: disagreement.value,
        secondSource: disagreement.source,
      }),
    );
    process.exit(1);
  }

  return {
    addVertical: true,
    name: firstCandidate.value,
  };
}

export function detectDryRunFlag(args: string[]): boolean {
  if (args.some(arg => arg.startsWith(`${DRY_RUN_FLAG}=`))) {
    console.error(`${DRY_RUN_FLAG} does not accept a value.`);
    process.exit(1);
  }

  return args.includes(DRY_RUN_FLAG);
}

export function detectCodeSmithOverlays(args: string[]) {
  const overlays: { generator: string }[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === CODESMITH_OVERLAY_FLAG) {
      const generator = args[i + 1];
      if (!generator || generator.startsWith('-')) {
        console.error(`${CODESMITH_OVERLAY_FLAG} requires a package or path.`);
        process.exit(1);
      }
      overlays.push({ generator });
      i += 1;
      continue;
    }

    if (arg.startsWith(`${CODESMITH_OVERLAY_FLAG}=`)) {
      const generator = arg.slice(`${CODESMITH_OVERLAY_FLAG}=`.length);
      if (!generator) {
        console.error(`${CODESMITH_OVERLAY_FLAG} requires a package or path.`);
        process.exit(1);
      }
      overlays.push({ generator });
    }
  }

  return overlays.length > 0 ? overlays : undefined;
}

export function detectHorizontalRemoteFlag(args: string[]): boolean {
  if (args.some(arg => arg.startsWith(`${HORIZONTAL_REMOTE_FLAG}=`))) {
    console.error(`${HORIZONTAL_REMOTE_FLAG} does not accept a value.`);
    process.exit(1);
  }
  return args.includes(HORIZONTAL_REMOTE_FLAG);
}

export function detectPresetFlag(
  args: string[],
): VerticalPresetFlag | undefined {
  const value = getOptionValue(args, [PRESET_FLAG]);
  if (value === undefined) {
    return undefined;
  }
  if (!(SUPPORTED_PRESETS as readonly string[]).includes(value)) {
    console.error(
      `Unsupported ${PRESET_FLAG} "${value}" (supported: ${SUPPORTED_PRESETS.join(', ')}).`,
    );
    process.exit(1);
  }
  return value as VerticalPresetFlag;
}

export function detectApiProtocolFlag(
  args: string[],
): ApiProtocolFlag | undefined {
  const value = getOptionValue(args, [API_PROTOCOL_FLAG]);
  if (value === undefined) {
    return undefined;
  }
  if (!(SUPPORTED_API_PROTOCOLS as readonly string[]).includes(value)) {
    console.error(
      `Unsupported ${API_PROTOCOL_FLAG} "${value}" (supported: ${SUPPORTED_API_PROTOCOLS.join(', ')}).`,
    );
    process.exit(1);
  }
  return value as ApiProtocolFlag;
}

export function readBridgeCliOptions(args: string[]) {
  try {
    return parseUltramodernBridgeCliOptions(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
