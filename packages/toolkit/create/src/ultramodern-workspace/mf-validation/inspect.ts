import {
  parseArrayLiteral,
  parseLiteralString,
  parseObjectLiteral,
} from './object-literal';
import {
  findCreateModuleFederationConfigObject,
  findExportDefaultObject,
} from './syntax';
import type { ModuleFederationConfigInspection } from './types';

function extractExposes(
  configPath: string,
  value: string | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }

  const object = parseObjectLiteral(value);
  if (object) {
    if (object.hasSpread) {
      throw new Error(
        `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object without spreads.`,
      );
    }
    return Array.from(object.properties.keys()).sort();
  }

  const array = parseArrayLiteral(value);
  if (array) {
    return array.sort();
  }

  throw new Error(
    `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object or string array.`,
  );
}

function extractDtsSettings(
  configPath: string,
  value: string | undefined,
): ModuleFederationConfigInspection['dts'] {
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

  return {
    compilerInstance: parseLiteralString(
      generateTypes?.properties.get('compilerInstance'),
    ),
    tsConfigPath: parseLiteralString(dts.properties.get('tsConfigPath')),
  };
}

function hasHostOnlyNoExposesDeclaration(source: string): boolean {
  return /@?ultramodern-mf\s*:?\s*(?:host-only|no-exposes)\b/iu.test(source);
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

  const exposes = extractExposes(
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
    dts: extractDtsSettings(configPath, properties.properties.get('dts')),
    exposes,
    hostOnlyNoExposes,
  };
}
