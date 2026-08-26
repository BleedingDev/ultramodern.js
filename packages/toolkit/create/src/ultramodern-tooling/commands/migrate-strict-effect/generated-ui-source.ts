import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import type { MigrationIo } from './io';
import {} from './io';

const multiCharacterTokens = [
  '===',
  '!==',
  '**=',
  '&&=',
  '||=',
  '??=',
  '...',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '++',
  '--',
  '&&',
  '||',
  '??',
  '?.',
  '**',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '</',
  '/>',
] as const;

function isIdentifierPart(character: string) {
  return /[$_\p{ID_Continue}\u200C\u200D]/u.test(character);
}

function generatedUiSourceTokens(source: string) {
  // This lexer is deliberately limited to generator-owned federation
  // registries and empty fragment markers. It preserves literal contents and
  // operator boundaries while ignoring formatting trivia. Never use it for
  // arbitrary application UI, where JSX text whitespace can be meaningful.
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      const lineEnd = source.indexOf('\n', index + 2);
      index = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      const start = index;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const current = source[index] ?? '';
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (current === '\\') {
          escaped = true;
        } else if (current === quote) {
          break;
        }
      }
      tokens.push(`literal:${source.slice(start, index)}`);
      continue;
    }
    if (isIdentifierPart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index] ?? '')) {
        index += 1;
      }
      tokens.push(`word:${source.slice(start, index)}`);
      continue;
    }
    const multiCharacterToken = multiCharacterTokens.find(token =>
      source.startsWith(token, index),
    );
    if (multiCharacterToken) {
      tokens.push(`punctuator:${multiCharacterToken}`);
      index += multiCharacterToken.length;
      continue;
    }
    tokens.push(`punctuator:${character}`);
    index += 1;
  }
  return tokens;
}

export function generatedUiSourceRequiresRewrite(
  existingSource: string,
  nextSource: string,
) {
  return !isDeepStrictEqual(
    generatedUiSourceTokens(existingSource),
    generatedUiSourceTokens(nextSource),
  );
}

export function writeGeneratedUiSourceIfChanged(
  io: MigrationIo,
  filePath: string,
  nextSource: string,
) {
  if (fs.existsSync(filePath)) {
    const existingSource = fs.readFileSync(filePath, 'utf-8');
    if (!generatedUiSourceRequiresRewrite(existingSource, nextSource)) {
      return io.writeGenerated(filePath, existingSource);
    }
  }
  return io.writeGenerated(filePath, nextSource);
}
