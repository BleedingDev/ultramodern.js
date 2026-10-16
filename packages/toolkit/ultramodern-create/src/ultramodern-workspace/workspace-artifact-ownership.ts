import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { formatGeneratedSourceCandidates, writeFileReplacing } from './fs-io';
import { createRootTsConfig } from './tsconfigs';
import type { WorkspaceApp } from './types';
import { createWorkspaceScriptArtifacts } from './workspace-scripts';
import { createZeropsYaml } from './zerops';

/** Identify generator ownership only for workspace-managed artifacts. */
export function workspaceArtifactCandidates(
  scope: string,
  apps: WorkspaceApp[],
  alternateApps: WorkspaceApp[] = [],
): ArtifactCandidate[] {
  return [
    ...createWorkspaceScriptArtifacts(apps[0]?.renderer),
    {
      relativePath: 'tsconfig.json',
      content: `${JSON.stringify(createRootTsConfig(apps), null, 2)}\n`,
    },
    ...[apps, ...(alternateApps.length ? [alternateApps] : [])].map(
      projection => ({
        relativePath: 'zerops.yaml',
        content: `${createZeropsYaml(scope, projection)}\n`,
      }),
    ),
  ];
}

type ArtifactCandidate = {
  relativePath: string;
  content: string;
  generatedDataBinding?: string;
};

function isLiteralData(
  node: any,
  literalIdentifiers?: ReadonlySet<string>,
): boolean {
  if (!node) return false;
  if (node.type === 'Identifier')
    return literalIdentifiers?.has(node.name) ?? false;
  if (
    [
      'StringLiteral',
      'NumericLiteral',
      'BooleanLiteral',
      'NullLiteral',
    ].includes(node.type)
  )
    return true;
  if (node.type === 'UnaryExpression')
    return node.operator === '-' && node.argument.type === 'NumericLiteral';
  if (node.type === 'ArrayExpression')
    return node.elements.every((element: any) =>
      isLiteralData(element, literalIdentifiers),
    );
  return (
    node.type === 'ObjectExpression' &&
    node.properties.every(
      (property: any) =>
        property.type === 'ObjectProperty' &&
        !property.computed &&
        !property.shorthand &&
        ['Identifier', 'StringLiteral', 'NumericLiteral'].includes(
          property.key.type,
        ) &&
        isLiteralData(property.value, literalIdentifiers),
    )
  );
}

function withoutGeneratedData(source: string, binding?: string) {
  if (!binding) return source;
  const parsed = parse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  for (const statement of parsed.program.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const')
      continue;
    for (const declaration of statement.declarations) {
      if (
        declaration.id.type !== 'Identifier' ||
        declaration.id.name !== binding ||
        !declaration.init ||
        !isLiteralData(declaration.init)
      )
        continue;
      return (
        source.slice(0, declaration.init.start!) +
        '{}' +
        source.slice(declaration.init.end!)
      );
    }
  }
  return source;
}

function createArtifactSourceFormatter(protectInvalidSources = false) {
  const cache = new Map<string, Map<string, string>>();
  const remember = (
    relativePath: string,
    source: string,
    formatted: string,
  ) => {
    let sources = cache.get(relativePath);
    if (!sources) {
      sources = new Map();
      cache.set(relativePath, sources);
    }
    sources.set(source, formatted);
    sources.set(formatted, formatted);
  };
  return (
    sources: readonly (readonly [relativePath: string, source: string])[],
  ) => {
    // Consumer filenames retain native ignore rules; generated comparisons use
    // canonical paths. Evidence from those contexts must not share a cache.
    const missing = new Map<string, Set<string>>();
    for (const [relativePath, source] of sources) {
      if (cache.get(relativePath)?.has(source)) continue;
      let pending = missing.get(relativePath);
      if (!pending) {
        pending = new Set();
        missing.set(relativePath, pending);
      }
      pending.add(source);
    }
    const batches: (readonly [relativePath: string, source: string])[][] = [];
    for (const [relativePath, pending] of missing) {
      [...pending].forEach((source, index) => {
        // Literal consumer paths cannot hold two source variants in one batch.
        const batchIndex = protectInvalidSources ? index : 0;
        (batches[batchIndex] ??= []).push([relativePath, source]);
      });
    }
    for (const inputs of batches) {
      const targets = protectInvalidSources
        ? inputs
        : inputs.map(
            ([relativePath, source], index) =>
              [`canonical/${index}/${relativePath}`, source] as const,
          );
      try {
        const formatted = formatGeneratedSourceCandidates(targets);
        inputs.forEach(([relativePath, source], index) =>
          remember(relativePath, source, formatted[index]!),
        );
      } catch (error) {
        if (!protectInvalidSources) throw error;
        // A malformed authored file must not prevent recognizing its neighbors.
        for (const [index, [relativePath, source]] of inputs.entries()) {
          try {
            const [formatted] = formatGeneratedSourceCandidates([
              targets[index]!,
            ]);
            remember(relativePath, source, formatted!);
          } catch {
            // Unparseable consumer source remains consumer-owned.
          }
        }
      }
    }
    return sources.map(([relativePath, source]) =>
      cache.get(relativePath)?.get(source),
    );
  };
}

/** Share only generated-source formatting evidence within one operation. */
export function createCanonicalWorkspaceArtifactFormatter(
  candidates: readonly ArtifactCandidate[],
) {
  const formatSources = createArtifactSourceFormatter();
  try {
    formatSources(
      candidates.flatMap(candidate => {
        const original = [candidate.relativePath, candidate.content] as const;
        const normalized = withoutGeneratedData(
          candidate.content,
          candidate.generatedDataBinding,
        );
        return normalized === candidate.content
          ? [original]
          : [original, [candidate.relativePath, normalized] as const];
      }),
    );
  } catch {
    // Future artifacts may be preserved without formatting. Priming is optional;
    // required ownership checks and writes still report their own format errors.
  }
  return formatSources;
}

/** Protect authored replacements before any stage can delete or regenerate them. */
export function preserveConsumerWorkspaceArtifacts(
  workspaceRoot: string,
  candidates: readonly ArtifactCandidate[],
  formatCanonicalSources = createCanonicalWorkspaceArtifactFormatter([]),
) {
  const preservedPaths = new Set<string>();
  const recognizedPaths = new Map<string, boolean>();
  const physicalRoot = fs.realpathSync(workspaceRoot);
  const formatConsumerSources = createArtifactSourceFormatter(true);
  const canonicalSources = formatCanonicalSources(
    candidates.map(
      candidate =>
        [
          candidate.relativePath,
          withoutGeneratedData(
            candidate.content,
            candidate.generatedDataBinding,
          ),
        ] as const,
    ),
  );
  const inspected: {
    relativePath: string;
    recognized: boolean;
    normalized?: string;
    canonical?: string;
  }[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const relativePath = candidate.relativePath;
    const filePath = path.join(workspaceRoot, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const physicalRelative = path.relative(
      physicalRoot,
      fs.realpathSync(filePath),
    );
    if (
      physicalRelative === '..' ||
      physicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(physicalRelative)
    ) {
      throw new Error(
        `Refusing to inspect an artifact outside the workspace: ${relativePath}`,
      );
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const inspection: (typeof inspected)[number] = {
      relativePath,
      recognized: source === candidate.content,
      canonical: canonicalSources[index],
    };
    if (!inspection.recognized) {
      try {
        const normalized = withoutGeneratedData(
          source,
          candidate.generatedDataBinding,
        );
        inspection.normalized = normalized;
        inspection.recognized = normalized === inspection.canonical;
      } catch {
        // An authored file that the generator cannot parse is still owned
        // by its author, not an invitation to overwrite it.
      }
    }
    inspected.push(inspection);
  }
  // A before/next pair needs no consumer formatting once either source matches.
  const matchedPaths = new Set(
    inspected
      .filter(inspection => inspection.recognized)
      .map(inspection => inspection.relativePath),
  );
  const pending = inspected.filter(
    inspection =>
      !matchedPaths.has(inspection.relativePath) &&
      inspection.normalized !== undefined,
  );
  const normalizedSources = formatConsumerSources(
    pending.map(
      inspection => [inspection.relativePath, inspection.normalized!] as const,
    ),
  );
  pending.forEach((inspection, index) => {
    inspection.recognized = normalizedSources[index] === inspection.canonical;
  });
  for (const { relativePath, recognized } of inspected) {
    recognizedPaths.set(
      relativePath,
      recognizedPaths.get(relativePath) === true || recognized,
    );
  }
  for (const [relativePath, recognized] of recognizedPaths) {
    if (!recognized) preservedPaths.add(relativePath);
  }
  const reported = new Set<string>();
  const isPreserved = (filePath: string) => {
    const relativePath = path
      .relative(workspaceRoot, filePath)
      .split(path.sep)
      .join('/');
    if (!preservedPaths.has(relativePath)) return false;
    if (!reported.has(relativePath)) {
      console.warn(
        `${relativePath} preserved consumer-owned artifact: its canonical generated source does not match.`,
      );
      reported.add(relativePath);
    }
    return true;
  };
  return {
    preservedPaths,
    canonicalGeneratedPaths: new Set(
      [...recognizedPaths].flatMap(([relativePath, recognized]) =>
        recognized ? [relativePath] : [],
      ),
    ),
    io: {
      write: (filePath: string, content: string) => {
        if (isPreserved(filePath)) return false;
        const relativePath = path
          .relative(workspaceRoot, filePath)
          .split(path.sep)
          .join('/');
        if (recognizedPaths.get(relativePath) && fs.existsSync(filePath)) {
          const current = fs.readFileSync(filePath, 'utf8');
          if (current === content) return false;
          const [canonicalCurrent, canonicalNext] = formatCanonicalSources([
            [relativePath, current],
            [relativePath, content],
          ]);
          if (canonicalCurrent === canonicalNext) return false;
        }
        writeFileReplacing(workspaceRoot, relativePath, content);
        return true;
      },
    },
  };
}
