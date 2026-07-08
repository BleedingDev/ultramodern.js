import { getOuterBlock, skipSyntax } from './syntax';
import type { ParsedObjectLiteral } from './types';

function splitTopLevelEntries(source: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    const char = source[index];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    } else if (
      char === ',' &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      const entry = source.slice(start, index).trim();
      if (entry) {
        entries.push(entry);
      }
      start = index + 1;
    }
  }

  const finalEntry = source.slice(start).trim();
  if (finalEntry) {
    entries.push(finalEntry);
  }

  return entries;
}

function findTopLevelColon(source: string): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    const char = source[index];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    } else if (
      char === ':' &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function stripConstAssertion(source: string): string {
  return source
    .trim()
    .replace(/\s+as\s+const\s*$/u, '')
    .trim();
}

function unescapeSingleQuotedString(value: string): string {
  return value.replace(/\\(['"\\nrtbfv0])/gu, (_, sequence: string) => {
    switch (sequence) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '0':
        return '\0';
      default:
        return sequence;
    }
  });
}

export function parseLiteralString(
  source: string | undefined,
): string | undefined {
  if (source === undefined) {
    return undefined;
  }

  const trimmed = stripConstAssertion(source);
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return undefined;
  }

  if (quote === '`') {
    if (trimmed.includes('${')) {
      return undefined;
    }
    const close = trimmed.lastIndexOf('`');
    return close > 0
      ? trimmed.slice(1, close).replaceAll('\\`', '`')
      : undefined;
  }

  const close = trimmed.lastIndexOf(quote);
  if (close <= 0 || trimmed.slice(close + 1).trim() !== '') {
    return undefined;
  }

  const content = trimmed.slice(1, close);
  if (quote === '"') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  return unescapeSingleQuotedString(content);
}

function parseObjectKey(source: string): string | undefined {
  const trimmed = source.trim();
  const literal = parseLiteralString(trimmed);
  if (literal !== undefined) {
    return literal;
  }

  return /^[$A-Z_a-z][$\w]*$/u.test(trimmed) ? trimmed : undefined;
}

export function parseObjectLiteral(
  source: string | undefined,
): ParsedObjectLiteral | undefined {
  if (source === undefined) {
    return undefined;
  }

  const block = getOuterBlock(source, '{', '}');
  if (!block) {
    return undefined;
  }

  const properties = new Map<string, string>();
  let hasSpread = false;

  for (const entry of splitTopLevelEntries(block.inner)) {
    if (entry.startsWith('...')) {
      hasSpread = true;
      continue;
    }

    const colon = findTopLevelColon(entry);
    if (colon === -1) {
      hasSpread = true;
      continue;
    }

    const key = parseObjectKey(entry.slice(0, colon));
    if (key === undefined) {
      hasSpread = true;
      continue;
    }

    properties.set(key, entry.slice(colon + 1).trim());
  }

  return { hasSpread, properties };
}

export function parseArrayLiteral(
  source: string | undefined,
): string[] | undefined {
  if (source === undefined) {
    return undefined;
  }

  const block = getOuterBlock(source, '[', ']');
  if (!block) {
    return undefined;
  }

  const entries = splitTopLevelEntries(block.inner);
  const exposes: string[] = [];

  for (const entry of entries) {
    const expose = parseLiteralString(entry);
    if (expose === undefined) {
      return undefined;
    }
    exposes.push(expose);
  }

  return exposes;
}
