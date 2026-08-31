import { parseSync } from '@swc/core';

type SpecifierRewrite = (specifier: string) => string | undefined;

type SpecifierToken = {
  /** Index of the first character of the specifier (after the opening quote). */
  start: number;
  /** Index just past the last character (before the closing quote). */
  end: number;
  value: string;
};

type AstNode = Record<string, unknown> & {
  type: string;
};

type StringLiteralNode = AstNode & {
  type: 'StringLiteral';
  span: {
    start: number;
    end: number;
  };
  value: string;
};

export const assertNoNativeModuleOutputCollision = (
  sourceFile: string,
  fileExists: (file: string) => boolean,
) => {
  const rawModuleFile = sourceFile.endsWith('.mts')
    ? `${sourceFile.slice(0, -4)}.mjs`
    : sourceFile.endsWith('.cts')
      ? `${sourceFile.slice(0, -4)}.cjs`
      : undefined;
  if (rawModuleFile && fileExists(rawModuleFile)) {
    throw new Error(
      `Native module sources collide: "${sourceFile}" and "${rawModuleFile}" publish the same output.`,
    );
  }
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAstNode = (value: unknown): value is AstNode =>
  isObjectRecord(value) && typeof value.type === 'string';

const isStringLiteral = (value: unknown): value is StringLiteralNode =>
  isAstNode(value) &&
  value.type === 'StringLiteral' &&
  typeof value.value === 'string' &&
  typeof value.span === 'object' &&
  value.span !== null &&
  typeof (value.span as { start?: unknown }).start === 'number' &&
  typeof (value.span as { end?: unknown }).end === 'number';

const getCallSpecifier = (node: AstNode): StringLiteralNode | undefined => {
  if (node.type !== 'CallExpression' || !Array.isArray(node.arguments)) {
    return;
  }

  const callee = node.callee;
  const isDynamicImport = isAstNode(callee) && callee.type === 'Import';
  const isCommonJsRequire =
    isAstNode(callee) &&
    callee.type === 'Identifier' &&
    callee.value === 'require';

  if (!isDynamicImport && !isCommonJsRequire) {
    return;
  }

  const firstArgument = node.arguments[0];
  if (!isObjectRecord(firstArgument)) {
    return;
  }

  return isStringLiteral(firstArgument.expression)
    ? firstArgument.expression
    : undefined;
};

const collectSpecifierLiterals = (content: string): StringLiteralNode[] => {
  // This parser runs only on TypeScript's emitted JavaScript and declarations.
  // TypeScript syntax is required for import types in `.d.ts` output; it also
  // accepts the JavaScript emitted for both ESM and CommonJS modules.
  const parserOptions = {
    decorators: true,
    syntax: 'typescript',
    target: 'esnext',
  } as const;
  let program;
  try {
    program = parseSync(content, parserOptions);
  } catch (typescriptError) {
    try {
      program = parseSync(content, { ...parserOptions, tsx: true });
    } catch {
      throw typescriptError;
    }
  }
  const literals: StringLiteralNode[] = [];
  const seenSpans = new Set<string>();

  const add = (value: unknown) => {
    if (!isStringLiteral(value)) {
      return;
    }
    const spanKey = `${value.span.start}:${value.span.end}`;
    if (!seenSpans.has(spanKey)) {
      seenSpans.add(spanKey);
      literals.push(value);
    }
  };

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObjectRecord(value)) {
      return;
    }

    if (isAstNode(value)) {
      switch (value.type) {
        case 'ImportDeclaration':
        case 'ExportAllDeclaration':
        case 'ExportNamedDeclaration':
          add(value.source);
          break;
        case 'TsImportType':
          add(value.argument);
          break;
        case 'TsExternalModuleReference':
          add(value.expression);
          break;
        case 'CallExpression':
          add(getCallSpecifier(value));
          break;
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key !== 'span') {
        visit(child);
      }
    }
  };

  visit(program);
  return literals.sort((left, right) => left.span.start - right.span.start);
};

/** Convert SWC's one-based UTF-8 byte spans to JavaScript string offsets. */
const mapUtf8ByteOffsets = (
  content: string,
  byteOffsets: number[],
): Map<number, number> => {
  const pending = new Set(byteOffsets);
  const result = new Map<number, number>();
  let byteOffset = 0;
  let stringOffset = 0;

  while (stringOffset <= content.length && pending.size > 0) {
    if (pending.delete(byteOffset)) {
      result.set(byteOffset, stringOffset);
    }
    if (stringOffset === content.length) {
      break;
    }

    const codePoint = content.codePointAt(stringOffset);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    byteOffset += Buffer.byteLength(character);
    stringOffset += character.length;
  }

  if (pending.size > 0) {
    throw new Error('SWC returned an import specifier span outside its source');
  }
  return result;
};

const scanSpecifiers = (content: string): SpecifierToken[] => {
  const literals = collectSpecifierLiterals(content);
  const byteOffsets = literals.flatMap(literal => [
    // SWC spans are one-based and include the opening and closing quote.
    literal.span.start,
    literal.span.end - 2,
  ]);
  const stringOffsets = mapUtf8ByteOffsets(content, byteOffsets);

  return literals.map(literal => {
    const start = stringOffsets.get(literal.span.start);
    const end = stringOffsets.get(literal.span.end - 2);
    if (start === undefined || end === undefined) {
      throw new Error('Could not locate an SWC import specifier in its source');
    }
    return {
      start,
      end,
      value: content.slice(start, end),
    };
  });
};

/** Rewrite static module specifiers without touching runtime data or syntax. */
export const rewriteImportSpecifiers = (
  content: string,
  rewrite: SpecifierRewrite,
): { content: string; changed: boolean } => {
  const specifiers = scanSpecifiers(content);
  if (specifiers.length === 0) {
    return { content, changed: false };
  }

  let result = '';
  let cursor = 0;
  let changed = false;

  for (const specifier of specifiers) {
    // Compiler-emitted relative/alias specifiers do not need escapes. Leaving
    // escaped source untouched avoids changing its raw JavaScript spelling.
    if (specifier.value.includes('\\')) {
      continue;
    }
    const next = rewrite(specifier.value);
    if (next === undefined || next === specifier.value) {
      continue;
    }
    changed = true;
    result += content.slice(cursor, specifier.start) + next;
    cursor = specifier.end;
  }

  if (!changed) {
    return { content, changed: false };
  }

  return { content: result + content.slice(cursor), changed: true };
};
