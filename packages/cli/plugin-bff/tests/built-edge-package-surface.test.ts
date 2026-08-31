import path from 'node:path';
import { parseSync } from '@swc/core';
import { build } from 'esbuild';

const packageRoot = path.resolve(__dirname, '..');

const guardedAsyncHooksProbe =
  /\b[A-Za-z_$][\w$]*\.process\?\.getBuiltinModule\?\.\(\s*['"]node:async_hooks['"]\s*\)/gu;
function analyzeEdgeSyntax(source: string) {
  const builtinModuleCalls: string[] = [];
  const nonliteralDynamicImports: string[] = [];
  const forbiddenRuntimeSyntax: string[] = [];
  const identifierValues = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.flatMap(identifierValues);
    }
    if (!value || typeof value !== 'object') {
      return [];
    }
    const node = value as Record<string, unknown>;
    return [
      ...(node.type === 'Identifier' && typeof node.value === 'string'
        ? [node.value]
        : []),
      ...Object.values(node).flatMap(identifierValues),
    ];
  };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    const node = value as Record<string, unknown>;
    const callee = node.callee as Record<string, unknown> | undefined;
    if (node.type === 'CallExpression' && callee?.type === 'Import') {
      const argumentsList = Array.isArray(node.arguments)
        ? (node.arguments as Array<{ expression?: { type?: string } }>)
        : [];
      const argument = argumentsList[0];
      if (argument?.expression?.type !== 'StringLiteral') {
        nonliteralDynamicImports.push(
          argument?.expression?.type ?? 'MissingArgument',
        );
      }
    }

    const sourceNode = node.source as
      | { type?: string; value?: string }
      | undefined;
    if (
      [
        'ImportDeclaration',
        'ExportAllDeclaration',
        'ExportNamedDeclaration',
      ].includes(String(node.type)) &&
      sourceNode?.type === 'StringLiteral' &&
      sourceNode.value?.startsWith('node:')
    ) {
      forbiddenRuntimeSyntax.push(`import:${sourceNode.value}`);
    }

    const identifier = node as { type?: string; value?: string };
    if (
      identifier.type === 'Identifier' &&
      ['createRequire', 'evaluateNodeBackendFederationCommonJs'].includes(
        String(identifier.value),
      )
    ) {
      forbiddenRuntimeSyntax.push(`identifier:${identifier.value}`);
    }

    if (node.type === 'NewExpression') {
      const constructorNode = node.callee as {
        type?: string;
        value?: string;
      };
      if (
        constructorNode?.type === 'Identifier' &&
        constructorNode.value === 'Function'
      ) {
        forbiddenRuntimeSyntax.push('new Function');
      }
    }

    if (node.type === 'CallExpression') {
      const callArguments = Array.isArray(node.arguments)
        ? (node.arguments as Array<{
            expression?: { type?: string; value?: string };
          }>)
        : [];
      const firstArgument = callArguments[0]?.expression;
      const calleeIdentifiers = identifierValues(callee);
      if (calleeIdentifiers.includes('eval')) {
        forbiddenRuntimeSyntax.push('eval');
      }
      if (calleeIdentifiers.includes('Function')) {
        forbiddenRuntimeSyntax.push('Function');
      }
      if (
        calleeIdentifiers.includes('getBuiltinModule') &&
        firstArgument?.type === 'StringLiteral'
      ) {
        builtinModuleCalls.push(String(firstArgument.value));
      }
      if (
        calleeIdentifiers.some(name =>
          ['require', '__require'].includes(name),
        ) &&
        firstArgument?.type === 'StringLiteral' &&
        firstArgument.value?.startsWith('node:')
      ) {
        forbiddenRuntimeSyntax.push(`require:${firstArgument.value}`);
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(parseSync(source, { syntax: 'ecmascript' }));
  return {
    builtinModuleCalls,
    forbiddenRuntimeSyntax,
    nonliteralDynamicImports,
  };
}

async function bundlePublicExport(specifier: string) {
  return build({
    absWorkingDir: packageRoot,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    platform: 'browser',
    stdin: {
      contents: `export * from ${JSON.stringify(specifier)};`,
      loader: 'js',
      resolveDir: path.join(packageRoot, 'tests'),
      sourcefile: 'built-public-export.mjs',
    },
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
}

const publicEdgeExports = [
  {
    allowGuardedAsyncHooksProbe: true,
    builtEntry: 'dist/esm/runtime/effect/edge.mjs',
    forbiddenPackageCones: [],
    specifier: '@modern-js/plugin-bff/effect-edge',
  },
  {
    allowGuardedAsyncHooksProbe: true,
    builtEntry: 'dist/esm/runtime/effect/edge-dispatcher.mjs',
    forbiddenPackageCones: [],
    specifier: '@modern-js/plugin-bff/effect-edge/dispatcher',
  },
  {
    allowGuardedAsyncHooksProbe: false,
    builtEntry: '../plugin-bff-extensions/dist/esm/hono/index.mjs',
    forbiddenPackageCones: [
      /\/node_modules\/(?:@effect|effect)\//u,
      /\/backend-federation(?:\/|$)/u,
      /\/node_modules\/@module-federation\//u,
    ],
    specifier: '@modern-js/plugin-bff-extensions/hono',
  },
] as const;

describe('built edge package surfaces', () => {
  test.each(
    publicEdgeExports,
  )('bundles $specifier through its published export without Node evaluators', async ({
    allowGuardedAsyncHooksProbe,
    builtEntry,
    forbiddenPackageCones,
    specifier,
  }) => {
    const result = await bundlePublicExport(specifier);
    const inputs = Object.keys(result.metafile.inputs).map(input =>
      path.resolve(packageRoot, input).replaceAll('\\', '/'),
    );
    const expectedEntry = path
      .resolve(packageRoot, builtEntry)
      .replaceAll('\\', '/');

    expect(inputs).toContain(expectedEntry);
    expect(
      inputs.filter(input =>
        [
          path.join(packageRoot, 'src'),
          path.resolve(packageRoot, '../plugin-bff-extensions/src'),
          path.resolve(packageRoot, '../../server/bff-effect/src'),
        ].some(sourceRoot =>
          input.startsWith(sourceRoot.replaceAll('\\', '/')),
        ),
      ),
    ).toEqual([]);

    for (const forbiddenCone of forbiddenPackageCones) {
      expect(inputs).not.toEqual(
        expect.arrayContaining([expect.stringMatching(forbiddenCone)]),
      );
    }
    expect(
      inputs.filter(
        input =>
          input.includes('/adapter-kit/') ||
          input.includes('/backend-federation-security/node'),
      ),
    ).toEqual([]);

    const output = result.outputFiles.map(file => file.text).join('\n');
    const outputImports = Object.values(result.metafile.outputs).flatMap(
      output => output.imports,
    );
    expect(outputImports).toEqual([]);
    const guardedProbes = output.match(guardedAsyncHooksProbe) ?? [];
    if (!allowGuardedAsyncHooksProbe) {
      expect(guardedProbes).toEqual([]);
    } else {
      expect(guardedProbes).toHaveLength(1);
    }

    const outputWithoutGuardedProbe = output.replace(
      guardedAsyncHooksProbe,
      '',
    );
    const syntax = analyzeEdgeSyntax(output);
    expect(syntax.builtinModuleCalls).toEqual(
      allowGuardedAsyncHooksProbe ? ['node:async_hooks'] : [],
    );
    expect(syntax.nonliteralDynamicImports).toEqual([]);
    expect(syntax.forbiddenRuntimeSyntax).toEqual([]);
    expect(outputWithoutGuardedProbe).not.toMatch(
      /backend-federation-security\/node/u,
    );
  });

  test.each([
    ['import("literal")', []],
    ["import('literal')", []],
    ['const text = "import ()"', []],
    ['import(remote.entry)', ['MemberExpression']],
    ['import("remote/" + expose)', ['BinaryExpression']],
    [`import(\`remote/\${expose}\`)`, ['TemplateLiteral']],
    ['import(/* webpackIgnore: true */ remote.entry)', ['MemberExpression']],
  ])('classifies dynamic import syntax in %s', (source, expected) => {
    expect(analyzeEdgeSyntax(source).nonliteralDynamicImports).toEqual(
      expected,
    );
  });
});
