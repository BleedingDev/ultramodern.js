import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { configuredDevelopmentPorts } from './add-vertical/workspace-state';
import { appHasApi, resolveRemoteRefs } from './descriptors';
import { formatGeneratedSourceCandidates, writeFileReplacing } from './fs-io';
import { createAppModernConfig } from './module-federation';
import { createRootTsConfig } from './tsconfigs';
import type { WorkspaceApp } from './types';
import {
  createWorkspaceScriptArtifacts,
  createWorkspaceValidationScript,
} from './workspace-scripts';
import { createZeropsYaml } from './zerops';

/** The same projections identify generator ownership for every update command. */
export function workspaceArtifactCandidates(
  scope: string,
  apps: WorkspaceApp[],
  enableTailwind: boolean,
  alternateApps: WorkspaceApp[] = [],
): ArtifactCandidate[] {
  const remotes = apps.filter(app => app.kind === 'vertical');
  return [
    ...createWorkspaceScriptArtifacts({
      shellOnly: remotes.length === 0,
      hasBackendSurface: remotes.some(appHasApi),
      validationScript: createWorkspaceValidationScript(),
    }),
    {
      relativePath: 'tsconfig.json',
      content: `${JSON.stringify(createRootTsConfig(apps), null, 2)}\n`,
    },
    ...[apps, ...(alternateApps.length ? [alternateApps] : [])].flatMap(
      projection => {
        const verticals = projection.filter(app => app.kind === 'vertical');
        const devPorts = workspaceDevelopmentPorts(projection);
        return [
          {
            relativePath: 'zerops.yaml',
            content: `${createZeropsYaml(scope, projection)}\n`,
          },
          ...projection.map(app => ({
            relativePath: `${app.directory}/modern.config.ts`,
            content: createAppModernConfig(
              scope,
              app,
              app.kind === 'shell'
                ? resolveRemoteRefs(app, verticals)
                : verticals,
              enableTailwind,
              devPorts,
            ),
          })),
        ];
      },
    ),
  ];
}

/** A single-shell workspace intentionally uses the framework's default ports. */
export function workspaceDevelopmentPorts(
  apps: WorkspaceApp[],
  ports: Record<string, unknown> = {},
): number[] | undefined {
  return apps.filter(app => app.kind === 'shell').length > 1
    ? configuredDevelopmentPorts({
        ...ports,
        ...Object.fromEntries(apps.map(app => [app.id, app.port])),
      }).toSorted((left, right) => left - right)
    : undefined;
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

/** Protect authored replacements before any stage can delete or regenerate them. */
export function preserveConsumerWorkspaceArtifacts(
  workspaceRoot: string,
  candidates: readonly ArtifactCandidate[],
) {
  const preservedPaths = new Set<string>();
  const recognizedPaths = new Map<string, boolean>();
  const physicalRoot = fs.realpathSync(workspaceRoot);
  const canonicalSources = formatGeneratedSourceCandidates(
    candidates.map(
      (candidate, index) =>
        [
          `canonical/${index}/${candidate.relativePath}`,
          withoutGeneratedData(
            candidate.content,
            candidate.generatedDataBinding,
          ),
        ] as const,
    ),
  );
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
    let recognized = source === candidate.content;
    if (!recognized) {
      try {
        const normalized = withoutGeneratedData(
          source,
          candidate.generatedDataBinding,
        );
        const canonical = canonicalSources[index];
        recognized =
          normalized === canonical ||
          formatGeneratedSourceCandidates([[relativePath, normalized]])[0] ===
            canonical;
      } catch {
        // An authored file that the generator cannot parse is still owned
        // by its author, not an invitation to overwrite it.
      }
    }
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
    io: {
      write: (filePath: string, content: string) => {
        if (isPreserved(filePath)) return false;
        writeFileReplacing(
          workspaceRoot,
          path.relative(workspaceRoot, filePath),
          content,
        );
        return true;
      },
    },
  };
}
