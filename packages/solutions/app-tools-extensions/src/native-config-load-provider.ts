import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  CLIOptions,
  CLIPlugin,
  CLIPluginExtends,
} from '@modern-js/plugin/cli';

export type NativeConfigLoadIntegration = Pick<
  CLIOptions,
  'wrapConfigLoad' | 'internalPlugins'
>;

// Declaration identities remain stable when publishing rewrites import names.
const providerNames = new Set([
  ['@modern-js', 'ultramodern-app-tools'].join('/'),
  '@bleedingdev/modern-js-ultramodern-app-tools',
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plugin(value: unknown): value is CLIPlugin<CLIPluginExtends> {
  return (
    record(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (value.setup === undefined || typeof value.setup === 'function')
  );
}

function integration(value: unknown): value is NativeConfigLoadIntegration {
  return (
    record(value) &&
    typeof value.wrapConfigLoad === 'function' &&
    Array.isArray(value.internalPlugins) &&
    Array.from(value.internalPlugins).every(plugin)
  );
}

function contains(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Opt in before config evaluation through the application's declared provider. */
export async function resolveNativeConfigLoadProvider({
  appDirectory,
  command,
}: {
  appDirectory: string;
  command: string;
}): Promise<NativeConfigLoadIntegration | undefined> {
  if (command !== 'dev' && command !== 'build') return undefined;
  if (!path.isAbsolute(appDirectory)) {
    throw new Error(
      'Native config provider requires the resolved app directory',
    );
  }
  const manifestFile = path.join(appDirectory, 'package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!record(manifest))
    throw new Error(`Invalid app manifest: ${manifestFile}`);
  const declarations = new Map<string, string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = manifest[field];
    if (!record(dependencies)) continue;
    for (const [name, specifier] of Object.entries(dependencies)) {
      const alias =
        typeof specifier === 'string'
          ? /^npm:(@[^/]+\/[^@]+|[^@/]+)(?:@.+)?$/u.exec(specifier)?.[1]
          : undefined;
      const target = alias ?? name;
      if (!providerNames.has(target)) continue;
      if (
        !/^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(
          name,
        ) ||
        typeof specifier !== 'string' ||
        !specifier
      ) {
        throw new Error(`Invalid native config provider declaration: ${name}`);
      }
      const prior = declarations.get(name);
      if (prior !== undefined && prior !== target) {
        throw new Error(
          `Conflicting native config provider declaration: ${name}`,
        );
      }
      declarations.set(name, target);
    }
  }
  if (declarations.size === 0) return undefined;

  const require = createRequire(manifestFile);
  let selected: { root: string; entry: string } | undefined;
  for (const [name, target] of declarations) {
    const request = `${name}/native-config-load`;
    const entry = fs.realpathSync(require.resolve(request));
    const lexicalRoot = require.resolve
      .paths(request)
      ?.map(directory => path.join(directory, name))
      .find(directory => fs.existsSync(directory));
    if (!lexicalRoot) {
      throw new Error(`Missing declared native config provider owner: ${name}`);
    }
    const root = fs.realpathSync(lexicalRoot);
    const metadata: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    if (
      !record(metadata) ||
      metadata.name !== target ||
      !contains(root, entry)
    ) {
      throw new Error(`Invalid declared native config provider owner: ${name}`);
    }
    if (selected && (selected.root !== root || selected.entry !== entry)) {
      throw new Error(
        'Multiple declared native config providers are ambiguous',
      );
    }
    selected = { root, entry };
  }
  if (!selected) return undefined;
  const namespace: unknown = require(selected.entry);
  if (
    !record(namespace) ||
    typeof namespace.createNativeConfigLoad !== 'function'
  ) {
    throw new Error(
      'Native config provider must export createNativeConfigLoad',
    );
  }
  const result: unknown = await namespace.createNativeConfigLoad();
  if (!integration(result)) {
    throw new Error(
      'Native config provider returned an invalid CLI integration',
    );
  }
  return result;
}
