import {
  type Expression,
  type File,
  parse,
  parseExpression,
} from '@babel/parser';
import type { LocatedObjectLiteral } from './types';

type ConfigNode = Expression | File['program']['body'][number];

function unwrapExpression(node: Expression): Expression {
  while (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion' ||
    node.type === 'ParenthesizedExpression'
  ) {
    node = node.expression;
  }
  return node;
}

export function parseStaticExpression(
  source: string | undefined,
): Expression | undefined {
  if (source === undefined) {
    return undefined;
  }
  try {
    return unwrapExpression(
      parseExpression(source, { plugins: ['typescript'] }),
    );
  } catch {
    return undefined;
  }
}

export function parseConfigModule(source: string) {
  return parse(source, { sourceType: 'module', plugins: ['typescript'] });
}

function locateExportedConfig(
  source: string,
  factory: boolean,
): LocatedObjectLiteral | undefined {
  const module = parseConfigModule(source);
  const constants = new Map<string, Expression>();
  const bindingStarts = new Map<string, number | null | undefined>();
  const resolvedBindings = new Set<string>();
  const allowedReferences = new Set<number>();
  const factories = new Set<string>();
  const namespaces = new Set<string>();
  const defaults: ConfigNode[] = [];

  for (const statement of module.program.body) {
    if (
      statement.type === 'ImportDeclaration' &&
      statement.importKind !== 'type' &&
      statement.source.value === '@module-federation/modern-js-v3'
    ) {
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(specifier.local.name);
        } else if (
          specifier.type === 'ImportSpecifier' &&
          specifier.importKind !== 'type' &&
          (specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : specifier.imported.value) === 'createModuleFederationConfig'
        ) {
          factories.add(specifier.local.name);
        }
      }
    }
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement;
    if (
      declaration?.type === 'VariableDeclaration' &&
      declaration.kind === 'const'
    ) {
      for (const binding of declaration.declarations) {
        if (binding.id.type === 'Identifier' && binding.init) {
          constants.set(binding.id.name, binding.init);
          bindingStarts.set(binding.id.name, binding.id.start);
        }
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      defaults.push(statement.declaration);
    } else if (
      statement.type === 'ExportNamedDeclaration' &&
      !statement.source &&
      statement.exportKind !== 'type'
    ) {
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === 'ExportSpecifier' &&
          specifier.exportKind !== 'type' &&
          (specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value) === 'default'
        ) {
          defaults.push(specifier.local);
        }
      }
    }
  }

  const resolve = (
    node: ConfigNode | undefined,
    seen = new Set<string>(),
  ): ConfigNode | undefined => {
    if (!node) return undefined;
    if (node.type === 'Identifier') {
      if (seen.has(node.name)) return undefined;
      seen.add(node.name);
      resolvedBindings.add(node.name);
      if (node.start != null) allowedReferences.add(node.start);
      const bindingStart = bindingStarts.get(node.name);
      if (bindingStart != null) allowedReferences.add(bindingStart);
      return resolve(constants.get(node.name), seen);
    }
    if (
      node.type === 'TSAsExpression' ||
      node.type === 'TSSatisfiesExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'TSTypeAssertion' ||
      node.type === 'ParenthesizedExpression'
    ) {
      return resolve(node.expression, seen);
    }
    return node;
  };

  if (defaults.length !== 1) return undefined;
  let node = resolve(defaults[0]);
  if (factory) {
    if (node?.type !== 'CallExpression' || node.arguments.length !== 1)
      return undefined;
    const callee = node.callee;
    const supported =
      (callee.type === 'Identifier' && factories.has(callee.name)) ||
      (callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        namespaces.has(callee.object.name) &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'createModuleFederationConfig');
    if (!supported) return undefined;
    const argument = node.arguments[0];
    if (
      !argument ||
      argument.type === 'SpreadElement' ||
      argument.type === 'ArgumentPlaceholder'
    )
      return undefined;
    node = resolve(argument);
  }
  if (
    node?.type !== 'ObjectExpression' ||
    node.start == null ||
    node.end == null
  )
    return undefined;
  // A const object can still be mutated or passed to arbitrary code. Only
  // references followed along the exported config chain are statically safe.
  const hasOtherReference = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasOtherReference);
    const entry = value as Record<string, unknown>;
    if (
      entry.type === 'Identifier' &&
      typeof entry.name === 'string' &&
      resolvedBindings.has(entry.name) &&
      (typeof entry.start !== 'number' || !allowedReferences.has(entry.start))
    )
      return true;
    return Object.entries(entry).some(
      ([key, child]) =>
        key !== 'loc' &&
        key !== 'comments' &&
        key !== 'leadingComments' &&
        key !== 'trailingComments' &&
        hasOtherReference(child),
    );
  };
  if (hasOtherReference(module.program)) return undefined;
  return {
    start: node.start,
    end: node.end,
    source: source.slice(node.start, node.end),
  };
}

export function locateCreateModuleFederationConfigObject(
  source: string,
): LocatedObjectLiteral | undefined {
  return locateExportedConfig(source, true);
}

export function findCreateModuleFederationConfigObject(
  source: string,
): string | undefined {
  return locateCreateModuleFederationConfigObject(source)?.source;
}

export function findExportDefaultObject(source: string): string | undefined {
  return locateExportedConfig(source, false)?.source;
}
