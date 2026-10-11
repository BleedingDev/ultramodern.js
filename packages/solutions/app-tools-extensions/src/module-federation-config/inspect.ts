import {
  parseArrayLiteral,
  parseLiteralString,
  parseObjectLiteral,
} from './object-literal';
import {
  findCreateModuleFederationConfigObject,
  findExportDefaultObject,
  parseConfigModule,
} from './syntax';
import type { ModuleFederationConfigInspection } from './types';

type ExtractedExposes = Pick<
  ModuleFederationConfigInspection,
  'exposePaths' | 'exposes'
>;

function extractExposes(
  configPath: string,
  value: string | undefined,
): ExtractedExposes {
  if (value === undefined) {
    return { exposePaths: {}, exposes: [] };
  }

  const object = parseObjectLiteral(value);
  if (object) {
    if (object.hasSpread) {
      throw new Error(
        `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object without spreads.`,
      );
    }
    const exposePaths: Record<string, string> = {};
    for (const [expose, source] of object.properties) {
      const exposePath = parseLiteralString(source);
      if (exposePath !== undefined) {
        exposePaths[expose] = exposePath;
      }
    }
    return {
      exposePaths,
      exposes: Array.from(object.properties.keys()).sort(),
    };
  }

  const array = parseArrayLiteral(value);
  if (array) {
    return { exposePaths: {}, exposes: array.sort() };
  }

  throw new Error(
    `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object or string array.`,
  );
}

function extractDtsSettings(
  configPath: string,
  value: string | undefined,
  exposes: string[],
): ModuleFederationConfigInspection['dts'] {
  if (value === 'false') {
    if (exposes.length > 0) {
      throw new Error(
        `Module Federation DTS cannot be disabled for exposed app ${configPath}.`,
      );
    }
    return {};
  }
  if (value === undefined) {
    return {};
  }

  const dts = parseObjectLiteral(value);
  if (!dts || dts.hasSpread) {
    throw new Error(
      `Cannot statically extract Module Federation DTS settings from ${configPath}; use a literal dts object.`,
    );
  }

  const generateTypes = parseObjectLiteral(dts.properties.get('generateTypes'));
  if (generateTypes?.hasSpread) {
    throw new Error(
      `Cannot statically extract Module Federation generateTypes settings from ${configPath}; use a literal generateTypes object.`,
    );
  }

  const compilerInstanceSource =
    generateTypes?.properties.get('compilerInstance');
  return {
    compilerInstance:
      parseLiteralString(compilerInstanceSource) ??
      (compilerInstanceSource === 'tsgoCompilerInstance'
        ? 'effect-tsgo'
        : undefined),
    tsConfigPath: parseLiteralString(dts.properties.get('tsConfigPath')),
  };
}

function hasHostOnlyNoExposesDeclaration(source: string): boolean {
  return (parseConfigModule(source).comments ?? []).some(comment =>
    /@?ultramodern-mf\s*:?\s*(?:host-only|no-exposes)\b/iu.test(comment.value),
  );
}

export function inspectModuleFederationConfigSource(
  source: string,
  appDir: string,
  configPath: string,
): ModuleFederationConfigInspection {
  const configObject =
    findCreateModuleFederationConfigObject(source) ??
    findExportDefaultObject(source);

  if (!configObject) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; export or pass a literal config object.`,
    );
  }

  const properties = parseObjectLiteral(configObject);
  if (!properties) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; expected a literal config object.`,
    );
  }

  if (properties.hasSpread) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; top-level config spreads are not supported.`,
    );
  }

  const { exposePaths, exposes } = extractExposes(
    configPath,
    properties.properties.get('exposes'),
  );
  const hostOnlyNoExposes = hasHostOnlyNoExposesDeclaration(source);

  if (hostOnlyNoExposes && exposes.length > 0) {
    throw new Error(
      `Module Federation host-only/no-exposes declaration conflicts with actual exposes in ${configPath}.`,
    );
  }

  return {
    appDir,
    configPath,
    dts: extractDtsSettings(
      configPath,
      properties.properties.get('dts'),
      exposes,
    ),
    exposePaths,
    exposes,
    hostOnlyNoExposes,
  };
}
