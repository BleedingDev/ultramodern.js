import type { BalancedBlock, LocatedObjectLiteral } from './types';

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === '\\';
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function skipQuoted(source: string, start: number, quote: "'" | '"'): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === quote && !isEscaped(source, index)) {
      return index + 1;
    }
  }

  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf('\n', start + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const close = source.indexOf('*/', start + 2);
  return close === -1 ? source.length : close + 2;
}

function skipTemplateExpression(source: string, start: number): number {
  let depth = 1;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "'") {
      index = skipQuoted(source, index, "'") - 1;
      continue;
    }
    if (char === '"') {
      index = skipQuoted(source, index, '"') - 1;
      continue;
    }
    if (char === '`') {
      index = skipTemplate(source, index) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index) - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index) - 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return source.length;
}

function skipTemplate(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '`' && !isEscaped(source, index)) {
      return index + 1;
    }
    if (char === '$' && next === '{' && !isEscaped(source, index)) {
      index = skipTemplateExpression(source, index + 1) - 1;
    }
  }

  return source.length;
}

export function skipSyntax(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === "'") {
    return skipQuoted(source, index, "'");
  }
  if (char === '"') {
    return skipQuoted(source, index, '"');
  }
  if (char === '`') {
    return skipTemplate(source, index);
  }
  if (char === '/' && next === '/') {
    return skipLineComment(source, index);
  }
  if (char === '/' && next === '*') {
    return skipBlockComment(source, index);
  }

  return index;
}

function findBalanced(
  source: string,
  start: number,
  open: '{' | '[' | '(',
  close: '}' | ']' | ')',
): number | undefined {
  let depth = 1;

  for (let index = start + 1; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    if (source[index] === open) {
      depth += 1;
      continue;
    }

    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/u.test(char ?? '')) {
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index);
      continue;
    }

    return index;
  }

  return index;
}

function hasIdentifierBoundary(source: string, start: number, end: number) {
  return (
    !/[$\w]/u.test(source[start - 1] ?? '') && !/[$\w]/u.test(source[end] ?? '')
  );
}

export function locateCreateModuleFederationConfigObject(
  source: string,
): LocatedObjectLiteral | undefined {
  const callee = 'createModuleFederationConfig';
  let offset = 0;

  while (offset < source.length) {
    const index = source.indexOf(callee, offset);
    if (index === -1) {
      break;
    }

    offset = index + callee.length;
    if (!hasIdentifierBoundary(source, index, offset)) {
      continue;
    }

    const parenIndex = skipWhitespaceAndComments(source, offset);
    if (source[parenIndex] !== '(') {
      continue;
    }

    const argumentIndex = skipWhitespaceAndComments(source, parenIndex + 1);
    if (source[argumentIndex] !== '{') {
      throw new Error(
        'Module Federation config must pass a static object literal to createModuleFederationConfig.',
      );
    }

    const closeIndex = findBalanced(source, argumentIndex, '{', '}');
    if (closeIndex === undefined) {
      throw new Error('Module Federation config object literal is not closed.');
    }

    return {
      end: closeIndex + 1,
      source: source.slice(argumentIndex, closeIndex + 1),
      start: argumentIndex,
    };
  }

  return undefined;
}

export function findCreateModuleFederationConfigObject(
  source: string,
): string | undefined {
  return locateCreateModuleFederationConfigObject(source)?.source;
}

export function findExportDefaultObject(source: string): string | undefined {
  const exportDefault = 'export default';
  const index = source.indexOf(exportDefault);
  if (index === -1) {
    return undefined;
  }

  const objectStart = skipWhitespaceAndComments(
    source,
    index + exportDefault.length,
  );
  if (source[objectStart] !== '{') {
    return undefined;
  }

  const objectEnd = findBalanced(source, objectStart, '{', '}');
  if (objectEnd === undefined) {
    throw new Error('Module Federation export default object is not closed.');
  }

  return source.slice(objectStart, objectEnd + 1);
}

export function getOuterBlock(
  source: string,
  open: '{' | '[',
  close: '}' | ']',
): BalancedBlock | undefined {
  const trimmed = source.trim();
  if (trimmed[0] !== open) {
    return undefined;
  }

  const end = findBalanced(trimmed, 0, open, close);
  if (end === undefined) {
    return undefined;
  }

  const suffix = trimmed.slice(end + 1).trim();
  if (
    suffix !== '' &&
    !suffix.startsWith('as ') &&
    !suffix.startsWith('satisfies ')
  ) {
    return undefined;
  }

  return {
    inner: trimmed.slice(1, end),
    suffix,
  };
}
