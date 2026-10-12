import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import type { MicroVerticalApiBaselineExpectation } from './microvertical-api-baseline';

export const baselinePackage = '@modern-js/bff-effect/microvertical-api';
const ownerName = '@modern-js/bff-effect';
const within = (root: string, file: string) =>
  file.startsWith(`${root}${path.sep}`);

/** Locate the installed package from this consumer's resolver, never this tool's installation. */
export function resolveBaselinePackageDirectory(fromFile: string): string {
  const lookup = createRequire(fromFile).resolve.paths(baselinePackage);
  for (const directory of lookup ?? []) {
    const candidate = path.join(directory, ownerName);
    if (!fs.existsSync(candidate)) continue;
    const root = fs.realpathSync(candidate);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    if (
      ![ownerName, '@bleedingdev/modern-js-bff-effect'].includes(manifest.name)
    )
      throw new Error(
        `${fromFile}: ${baselinePackage} resolved to unrelated package ${String(manifest.name)}`,
      );
    const target = importTarget(manifest.exports?.['./microvertical-api']);
    if (!target?.startsWith('./'))
      throw new Error(
        `${fromFile}: ${baselinePackage} has no public Node import export`,
      );
    fs.statSync(path.resolve(root, target));
    return root;
  }
  throw new Error(`${fromFile}: cannot resolve installed ${baselinePackage}`);
}

function importTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  for (const [condition, target] of Object.entries(value)) {
    if (['node', 'import', 'default'].includes(condition)) {
      const resolved = importTarget(target);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

/** Follow only public bindings and local barrels. Never examine schema implementation expressions. */
export function baselinePublicIdentityIsExact(
  fromFile: string,
  expectation: MicroVerticalApiBaselineExpectation,
  reportMismatch?: (message: string) => void,
): boolean {
  const owner = fs.realpathSync(expectation.baselinePackageDirectory);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(owner, 'package.json'), 'utf8'),
  );
  if (
    expectation.baselinePackage !== baselinePackage ||
    ![ownerName, '@bleedingdev/modern-js-bff-effect'].includes(manifest.name)
  )
    return false;
  let resolvedOwner: string;
  try {
    resolvedOwner = resolveBaselinePackageDirectory(fromFile);
  } catch (error) {
    // An installed decoy is a consumer violation; unavailable resolution is a tool failure.
    if (
      error instanceof Error &&
      error.message.includes('resolved to unrelated package')
    )
      return false;
    throw error;
  }
  if (resolvedOwner !== owner) {
    reportMismatch?.(
      `selected owner ${owner}; consumer resolves ${resolvedOwner}`,
    );
    return false;
  }
  const target = importTarget(manifest.exports?.['./microvertical-api']);
  if (!target?.startsWith('./')) return false;
  const modules = new Map<string, t.File>();
  const load = (
    filename: string,
  ): { file: t.File; real: string } | undefined => {
    const real = fs.realpathSync(filename);
    if (!within(owner, real)) return undefined;
    let file = modules.get(real);
    if (!file) {
      if (modules.size >= 64 || fs.statSync(real).size > 1_000_000)
        throw new Error(`${real}: public export analysis budget exceeded`);
      file = parse(fs.readFileSync(real, 'utf8'), {
        sourceType: 'module',
        sourceFilename: real,
        plugins: ['typescript'],
      });
      modules.set(real, file);
    }
    return { file, real };
  };
  const follow = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const candidate = path.resolve(path.dirname(from), specifier);
    if (!within(owner, candidate)) return undefined;
    return [
      candidate,
      `${candidate}.ts`,
      `${candidate}.js`,
      path.join(candidate, 'index.ts'),
      path.join(candidate, 'index.js'),
    ].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  };
  const exportedOwner = (
    filename: string,
    name: string,
    seen = new Set<string>(),
  ): string | undefined => {
    const loaded = load(filename);
    if (!loaded) return undefined;
    const { file, real } = loaded;
    const key = `${real}:${name}`;
    if (seen.has(key)) return undefined;
    seen = new Set([...seen, key]);
    const explicit: (string | undefined)[] = [];
    const stars: string[] = [];
    for (const statement of file.program.body) {
      if (
        t.isExportAllDeclaration(statement) &&
        statement.exportKind !== 'type'
      ) {
        const next = follow(real, statement.source.value);
        if (!next) return undefined;
        stars.push(next);
      }
      if (
        !t.isExportNamedDeclaration(statement) ||
        statement.exportKind === 'type'
      )
        continue;
      const declaration = statement.declaration;
      if (
        t.isVariableDeclaration(declaration) &&
        declaration.declarations.some(value =>
          t.isIdentifier(value.id, { name }),
        )
      )
        explicit.push(real);
      if (
        (t.isFunctionDeclaration(declaration) ||
          t.isClassDeclaration(declaration)) &&
        t.isIdentifier(declaration.id, { name })
      )
        explicit.push(real);
      for (const value of statement.specifiers) {
        if (
          !t.isExportSpecifier(value) ||
          value.exportKind === 'type' ||
          !t.isIdentifier(value.exported, { name })
        )
          continue;
        if (!t.isIdentifier(value.local, { name })) {
          explicit.push(undefined);
          continue;
        }
        if (statement.source) {
          const next = follow(real, statement.source.value);
          explicit.push(next ? exportedOwner(next, name, seen) : undefined);
        } else {
          const local = file.program.body.find(
            item =>
              (t.isVariableDeclaration(item) &&
                item.declarations.some(value =>
                  t.isIdentifier(value.id, { name }),
                )) ||
              ((t.isFunctionDeclaration(item) || t.isClassDeclaration(item)) &&
                t.isIdentifier(item.id, { name })),
          );
          if (local) {
            explicit.push(real);
            continue;
          }
          const imported = file.program.body.find(
            item =>
              t.isImportDeclaration(item) &&
              item.importKind !== 'type' &&
              item.specifiers.some(
                value =>
                  t.isImportSpecifier(value) &&
                  value.importKind !== 'type' &&
                  t.isIdentifier(value.local, { name }) &&
                  t.isIdentifier(value.imported, { name }),
              ),
          );
          const next = t.isImportDeclaration(imported)
            ? follow(real, imported.source.value)
            : undefined;
          explicit.push(next ? exportedOwner(next, name, seen) : undefined);
        }
      }
    }
    if (explicit.length) return explicit.length === 1 ? explicit[0] : undefined;
    const owners = stars.map(next => exportedOwner(next, name, seen));
    const unique = new Set(
      owners.filter((value): value is string => value !== undefined),
    );
    return unique.size === 1 ? [...unique][0] : undefined;
  };
  const entry = path.resolve(owner, target);
  const owners = [
    'MicroVerticalBuildMarkerSchema',
    'MicroVerticalReadinessSchema',
    'createMicroVerticalOperationContext',
  ].map(name => exportedOwner(entry, name));
  return owners[0] !== undefined && owners.every(value => value === owners[0]);
}
