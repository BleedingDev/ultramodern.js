import fs from 'node:fs';
import path from 'node:path';
import { type MigrationIo } from './io';

export function ensureGeneratedOxfmtIgnorePatterns(io: MigrationIo) {
  const configPath = path.join(io.workspaceRoot, 'oxfmt.config.ts');
  if (!fs.existsSync(configPath)) {
    return false;
  }

  const source = fs.readFileSync(configPath, 'utf-8');
  const legacyPreset = /^([ \t]*)extends:\s*\[\s*ultracite\s*\],?[ \t]*$/mu;
  const nextPresetSource = legacyPreset.test(source)
    ? source.replace(legacyPreset, '$1...ultracite,')
    : source;
  const requiredPatterns = [
    '.modernjs',
    '.output',
    '**/modern-tanstack/**',
    '**/routeTree.gen.*',
  ];

  const warnUnparseable = () => {
    const message =
      `Could not update oxfmt.config.ts ignorePatterns automatically; ` +
      `add these entries manually: ${requiredPatterns.join(', ')}.`;
    if (io.dryRun) {
      io.log(message);
    } else {
      process.stderr.write(`[ultramodern] ${message}\n`);
    }
  };

  const writePresetReconciliation = () =>
    nextPresetSource === source
      ? false
      : io.write(configPath, nextPresetSource);

  const anchor = nextPresetSource.indexOf('ignorePatterns:');
  if (anchor === -1) {
    warnUnparseable();
    return writePresetReconciliation();
  }

  const openBracket = nextPresetSource.indexOf('[', anchor);
  if (openBracket === -1) {
    warnUnparseable();
    return writePresetReconciliation();
  }

  // Bracket-match to find the matching closing ], skipping brackets inside
  // string literals (e.g. a glob like '**/[locale]/**').
  let depth = 0;
  let closeBracket = -1;
  let stringQuote: string | undefined;
  for (let index = openBracket; index < nextPresetSource.length; index += 1) {
    const char = nextPresetSource[index];
    if (stringQuote) {
      if (char === '\\') {
        index += 1;
      } else if (char === stringQuote) {
        stringQuote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      stringQuote = char;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        closeBracket = index;
        break;
      }
    }
  }

  if (closeBracket === -1) {
    warnUnparseable();
    return writePresetReconciliation();
  }

  const body = nextPresetSource.slice(openBracket + 1, closeBracket);
  // Reject dynamic/spread ignorePattern arrays we cannot safely edit.
  if (body.includes('...')) {
    warnUnparseable();
    return writePresetReconciliation();
  }

  const literalPattern = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  const existing = new Set<string>();
  for (const match of body.matchAll(literalPattern)) {
    existing.add(match[2]);
  }

  const missing = requiredPatterns.filter(pattern => !existing.has(pattern));
  if (missing.length === 0) {
    return writePresetReconciliation();
  }

  // Derive indentation and quote style from the last existing literal line.
  const bodyLines = body.split('\n');
  let indent = '  ';
  let quote = "'";
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const literal = bodyLines[index].match(/^(\s*)(['"`])/u);
    if (literal) {
      indent = literal[1];
      quote = literal[2];
      break;
    }
  }

  const head = nextPresetSource.slice(0, closeBracket);
  const rest = nextPresetSource.slice(closeBracket);
  const tailMatch = head.match(/(\r?\n[ \t]*)$/u);
  const tail = tailMatch ? tailMatch[1] : '\n';
  let bodyContent = tailMatch ? head.slice(0, head.length - tail.length) : head;
  if (!/[[,]\s*$/u.test(bodyContent)) {
    bodyContent = `${bodyContent},`;
  }

  const insertionLines = missing
    .map(pattern => `${indent}${quote}${pattern}${quote},`)
    .join('\n');
  const nextSource = `${bodyContent}\n${insertionLines}${tail}${rest}`;

  return io.write(configPath, nextSource);
}
