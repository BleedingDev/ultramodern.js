import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  declaredKeys,
  declaredPropertyPaths,
  rendererProfileCapabilities,
} from './declarations.mjs';
import { inventory } from './inventory.mjs';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const rendererIds = ['react', 'solid', 'octane'];
const statuses = new Set([
  'required',
  'preview-after-proof',
  'explicitly-unsupported',
  'unresolved',
]);
const evidenceKinds = new Set([
  'runtime-test',
  'configuration-test',
  'structural-test',
  'source-only',
]);

export { declaredKeys, declaredPropertyPaths } from './declarations.mjs';

export function validateInventory(
  candidate = inventory,
  root = repositoryRoot,
) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const read = path => {
    if (
      typeof path !== 'string' ||
      isAbsolute(path) ||
      relative(root, resolve(root, path)).startsWith('..')
    ) {
      errors.push(
        `Evidence must be a repository-relative path: ${String(path)}`,
      );
      return '';
    }
    try {
      check(
        statSync(resolve(root, path)).isFile(),
        `Evidence is not a file: ${path}`,
      );
      return readFileSync(resolve(root, path), 'utf8');
    } catch {
      errors.push(`Missing evidence source: ${path}`);
      return '';
    }
  };
  const gate = (value, label) =>
    check(
      /^modernjs-dnpv3\.\d+$/.test(value ?? ''),
      `${label} has no concrete proof gate`,
    );
  const declarationOptions = sourcePath => ({
    sourcePath: resolve(root, sourcePath),
    readSource: absolutePath => {
      const path = relative(root, absolutePath);
      if (path.startsWith('..'))
        throw new Error(`Inherited config source escapes repository: ${path}`);
      try {
        if (statSync(absolutePath).isFile()) return read(path);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    },
  });
  check(candidate.schemaVersion === 1, 'Unsupported inventory schema');
  check(
    /^[a-f\d]{40}$/.test(candidate.characterizationBase ?? ''),
    'Missing immutable characterization base',
  );
  const sections = candidate.config?.sections ?? [];
  const sectionKeys = sections.map(section => section.key);
  check(
    new Set(sectionKeys).size === sectionKeys.length,
    'Duplicate config section',
  );
  try {
    const actual = declaredKeys(
      read(candidate.config.source),
      candidate.config.symbol,
      declarationOptions(candidate.config.source),
    ).sort();
    check(
      JSON.stringify(actual) === JSON.stringify([...sectionKeys].sort()),
      `AppToolsUserConfig coverage drift: declared ${actual.join(', ')}; inventoried ${sectionKeys.join(', ')}`,
    );
  } catch (error) {
    errors.push(error.message);
  }
  for (const section of sections) {
    read(section.source);
    check(
      Boolean(section.owner && section.inheritedSurface && section.treatment),
      `Config section ${section.key} lacks owner/type/treatment`,
    );
    gate(section.proofGate, `Config section ${section.key}`);
  }
  for (const declaration of candidate.config?.declaredTypes ?? []) {
    try {
      const actual = declaredKeys(
        read(declaration.source),
        declaration.symbol,
        declarationOptions(declaration.source),
      ).sort();
      check(
        JSON.stringify(actual) ===
          JSON.stringify([...declaration.declaredKeys].sort()),
        `Declared config keys drift: ${declaration.symbol} in ${declaration.source}: ${actual.join(', ')}`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const declaration of candidate.config?.nestedTypes ?? []) {
    try {
      const actual = declaredPropertyPaths(
        read(declaration.source),
        declaration.symbol,
        declarationOptions(declaration.source),
      )
        .map(path =>
          declaration.pathPrefix ? `${declaration.pathPrefix}.${path}` : path,
        )
        .filter(path => path.includes('.'))
        .sort();
      check(
        JSON.stringify(actual) ===
          JSON.stringify([...declaration.declaredPaths].sort()),
        `Nested config keys drift: ${declaration.symbol} in ${declaration.source}: ${actual.join(', ')}`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const alias of candidate.config?.aliases ?? []) {
    check(
      new RegExp(`\\b${alias.symbol}\\b`).test(read(alias.source)),
      `Missing declared/re-exported config type ${alias.symbol}`,
    );
  }
  for (const provider of candidate.config?.forwardedProviders ?? []) {
    const source = read(provider.source);
    for (const symbol of provider.symbols)
      check(
        new RegExp(`\\b${symbol}\\b`).test(source),
        `Missing forwarded provider declaration ${symbol}`,
      );
  }
  const targets = candidate.config?.deployTargets;
  if (targets) {
    const declaration = new RegExp(
      `export\\s+(?:type|const)\\s+${targets.symbol}\\s*=([\\s\\S]*?);`,
    ).exec(read(targets.source));
    const actual = [...(declaration?.[1] ?? '').matchAll(/'([^']+)'/g)]
      .map(match => match[1])
      .sort();
    check(
      JSON.stringify(actual) === JSON.stringify([...targets.values].sort()),
      'Declared deployment target coverage drift',
    );
    for (const target of targets.values)
      check(
        candidate.deploymentProfiles?.some(
          profile => profile.target === target,
        ),
        `Deployment target ${target} has no profile`,
      );
  } else errors.push('Missing declared deployment targets');
  check(
    (candidate.composedPlugins ?? []).length > 0,
    'Missing composed plugin inventory',
  );
  for (const plugin of [
    ...(candidate.composedPlugins ?? []),
    ...(candidate.additionalDescriptors ?? []),
  ]) {
    read(plugin.source);
    check(
      Boolean(plugin.owner),
      `Composed plugin ${plugin.factory ?? plugin.id} lacks an owner`,
    );
    gate(plugin.proofGate, `Composed plugin ${plugin.factory ?? plugin.id}`);
  }
  const capabilities = candidate.capabilities ?? [];
  const capabilityIds = capabilities.map(row => row.id);
  check(
    capabilityIds.length > 0 &&
      new Set(capabilityIds).size === capabilityIds.length,
    'Missing or duplicate capability IDs',
  );
  for (const row of capabilities) {
    check(
      Boolean(row.owner) && row.sources?.length > 0 && row.evidence?.length > 0,
      `Capability ${row.id} needs owner/source/evidence`,
    );
    for (const path of row.sources ?? []) read(path);
    for (const evidence of row.evidence ?? []) {
      const source = read(evidence.path);
      check(
        evidenceKinds.has(evidence.kind) && Boolean(evidence.assertion),
        `Invalid evidence classification for ${row.id}`,
      );
      if (evidence.kind !== 'source-only') {
        check(
          /\.(test|spec)\.[cm]?[jt]sx?$/.test(evidence.path),
          `Test evidence points to a non-test file: ${evidence.path}`,
        );
        check(
          /\b(test|it|describe)\s*[.(]/.test(source),
          `No test definitions in ${evidence.path}`,
        );
      }
    }
    check(
      JSON.stringify(Object.keys(row.renderers ?? {}).sort()) ===
        JSON.stringify([...rendererIds].sort()),
      `Capability ${row.id} lacks exactly three renderer classifications`,
    );
    for (const renderer of rendererIds) {
      const cell = row.renderers?.[renderer];
      check(
        statuses.has(cell?.status),
        `Invalid ${renderer} status for ${row.id}`,
      );
      const expected = cell?.expectedTest;
      check(
        Boolean(expected?.owner && expected?.assertion),
        `${renderer}/${row.id} lacks a concrete expected test owner/assertion`,
      );
      gate(expected?.gate, `${renderer}/${row.id}`);
      check(
        expected?.kind ===
          (cell?.status === 'explicitly-unsupported'
            ? 'rejection'
            : 'positive-runtime'),
        `${renderer}/${row.id} must name a positive runtime or explicit rejection test`,
      );
      if (renderer !== 'react')
        check(
          cell?.status !== 'required',
          `Unexecuted ${renderer}/${row.id} cannot claim current required support`,
        );
    }
    if (row.id !== 'cross-renderer-remotes')
      check(
        row.renderers?.react?.status === 'required',
        `Current React capability ${row.id} may not be silently weakened`,
      );
  }
  for (const profile of candidate.deploymentProfiles ?? []) {
    read(profile.source);
    check(
      Boolean(profile.owner) && profile.capabilityIds?.length > 0,
      `Deployment profile ${profile.id} lacks owner/capabilities`,
    );
    for (const id of profile.capabilityIds ?? [])
      check(
        capabilityIds.includes(id),
        `Deployment profile ${profile.id} references unknown capability ${id}`,
      );
    gate(profile.proofGate, `Deployment profile ${profile.id}`);
  }
  for (const gap of candidate.explicitGaps ?? []) {
    check(
      capabilityIds.includes(gap.capabilityId) && Boolean(gap.reason),
      `Invalid explicit gap ${gap.id}`,
    );
    gate(gap.gate, `Explicit gap ${gap.id}`);
  }
  for (const id of [
    'worker-rsc-runtime',
    'native-svg-runtime',
    'mixed-entry-runtime',
    'ordinary-data-hydration-reuse',
  ]) {
    check(
      candidate.explicitGaps?.some(gap => gap.id === id),
      `Required explicit gap is missing: ${id}`,
    );
  }
  for (const api of candidate.actionProtocol?.currentAPIs ?? []) {
    check(
      new RegExp(`\\b${api.name}\\b`).test(read(api.source)),
      `Current action API ${api.name} is absent from its owning source`,
    );
  }
  check(
    JSON.stringify(candidate.actionProtocol?.nativeBindings) ===
      JSON.stringify(['Form', 'useSubmit', 'useFetcher']),
    'Native action/form public bindings must be named before implementation',
  );
  gate(candidate.actionProtocol?.proofGate, 'Native action protocol');
  for (const id of [
    'react-rsc',
    'worker-react-rsc',
    'cross-renderer-remotes',
    'ssg-by-entries',
    'mixed-ssg-ssr-csr',
    'i18n',
    'worker-fetch-export',
    'headless-worker',
    'worker-bindings-artifacts',
  ]) {
    const row = capabilities.find(row => row.id === id);
    for (const renderer of ['solid', 'octane'])
      check(
        row?.renderers[renderer]?.status === 'explicitly-unsupported',
        `${renderer}/${id} must reject explicitly`,
      );
  }
  // same-renderer-federation is not uniform across Solid and Octane: Octane's
  // candidate profile has moduleFederation: false, Solid's has 'client' (its
  // own CSR-only same-renderer federated components, never application SSR).
  {
    const row = capabilities.find(row => row.id === 'same-renderer-federation');
    check(
      row?.renderers.octane?.status === 'explicitly-unsupported',
      'octane/same-renderer-federation must reject explicitly',
    );
    check(
      row?.renderers.solid?.status !== 'explicitly-unsupported',
      'solid/same-renderer-federation must reflect its supported CSR-only federated components',
    );
  }
  // Cross-check claimed Solid/Octane support against the actual candidate
  // renderer profiles instead of trusting a hand-maintained copy of them.
  {
    const profileSources = {
      react:
        'packages/solutions/ultramodern-app-tools/src/renderers/react/profile.ts',
      solid:
        'packages/solutions/ultramodern-app-tools/src/renderers/solid/profile.ts',
      octane:
        'packages/solutions/ultramodern-app-tools/src/renderers/octane/profile.ts',
    };
    const capabilityByProfileKey = {
      ssg: 'ssg',
      svgComponent: 'svg-components',
      i18n: 'i18n',
      rsc: 'react-rsc',
      worker: 'worker-request-handler',
    };
    try {
      const profiles = Object.fromEntries(
        Object.entries(profileSources).map(([renderer, source]) => [
          renderer,
          rendererProfileCapabilities(read(source)),
        ]),
      );
      for (const renderer of ['solid', 'octane']) {
        for (const [profileKey, capabilityId] of Object.entries(
          capabilityByProfileKey,
        )) {
          const supported = profiles[renderer]?.[profileKey];
          const status = capabilities.find(row => row.id === capabilityId)
            ?.renderers[renderer]?.status;
          check(
            supported
              ? status !== 'explicitly-unsupported'
              : status === 'explicitly-unsupported',
            `${renderer}/${capabilityId} status (${status}) disagrees with the ${renderer} candidate profile's ${profileKey}=${JSON.stringify(supported)}`,
          );
        }
        const federation = profiles[renderer]?.moduleFederation;
        const federationStatus = capabilities.find(
          row => row.id === 'same-renderer-federation',
        )?.renderers[renderer]?.status;
        check(
          federation === false
            ? federationStatus === 'explicitly-unsupported'
            : federationStatus !== 'explicitly-unsupported',
          `${renderer}/same-renderer-federation status (${federationStatus}) disagrees with the ${renderer} candidate profile's moduleFederation=${JSON.stringify(federation)}`,
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    certifiesRuntimeSupport: false,
    configSections: sections.length,
    capabilities: capabilities.length,
    deploymentProfiles: candidate.deploymentProfiles?.length ?? 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const unknown = process.argv
    .slice(2)
    .filter(argument => argument !== '--json');
  if (unknown.length) {
    process.stderr.write(`Unknown arguments: ${unknown.join(' ')}\n`);
    process.exitCode = 2;
  } else {
    const result = validateInventory();
    if (process.argv.includes('--json'))
      process.stdout.write(
        `${JSON.stringify({ ...result, inventory }, null, 2)}\n`,
      );
    else if (result.valid)
      process.stdout.write(
        `Capability inventory valid: ${result.configSections} config sections, ${result.capabilities} capability rows, ${result.deploymentProfiles} deployment profiles. Test references are not execution receipts.\n`,
      );
    else process.stderr.write(`${result.errors.join('\n')}\n`);
    if (!result.valid) process.exitCode = 1;
  }
}
