import { parseStaticExpression } from './syntax';
import type { ParsedObjectLiteral } from './types';

export function parseLiteralString(
  source: string | undefined,
): string | undefined {
  const node = parseStaticExpression(source);
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

export function parseObjectLiteral(
  source: string | undefined,
): ParsedObjectLiteral | undefined {
  const node = parseStaticExpression(source);
  if (source === undefined || node?.type !== 'ObjectExpression')
    return undefined;
  const properties = new Map<string, string>();
  let hasSpread = false;
  for (const property of node.properties) {
    if (
      property.type !== 'ObjectProperty' ||
      property.computed ||
      property.shorthand
    ) {
      hasSpread = true;
      continue;
    }
    const key =
      property.key.type === 'Identifier'
        ? property.key.name
        : property.key.type === 'StringLiteral'
          ? property.key.value
          : undefined;
    const value = parseStaticExpression(
      source.slice(property.value.start ?? 0, property.value.end ?? 0),
    );
    if (
      key === undefined ||
      properties.has(key) ||
      !value ||
      value.start == null ||
      value.end == null
    ) {
      hasSpread = true;
      continue;
    }
    const rawValue = source.slice(
      property.value.start ?? 0,
      property.value.end ?? 0,
    );
    properties.set(key, rawValue.slice(value.start, value.end));
  }
  return { hasSpread, properties };
}

export function parseArrayLiteral(
  source: string | undefined,
): string[] | undefined {
  const node = parseStaticExpression(source);
  if (source === undefined || node?.type !== 'ArrayExpression')
    return undefined;
  const values: string[] = [];
  for (const element of node.elements) {
    if (!element || element.type === 'SpreadElement') return undefined;
    const value = parseLiteralString(
      source.slice(element.start ?? 0, element.end ?? 0),
    );
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}
