/**
 * Static import closure of a repository script, for jobs that run scripts
 * from a bare checkout (no dependency install).
 *
 * Only static edges are followed: `import ... from`, `import '...'`,
 * `export ... from` and `require('...')`. A dynamic `import()` is a lazy
 * boundary and is not followed. Dependency-free on purpose: the workflow
 * validator itself runs without a root install.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';

const identifierStart = /[A-Za-z_$]/u;
const identifierPart = /[\w$]/u;
// After these tokens a `/` starts a regular expression, not a division.
const regexPrecedingKeywords = new Set([
  'await',
  'case',
  'delete',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

const skipQuoted = (source, start) => {
  const quote = source[start];
  let index = start + 1;
  let value = '';
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\') {
      index += 1;
    }
    value += source[index];
    index += 1;
  }
  return { end: index + 1, value };
};

const skipRegex = (source, start) => {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== '\n') {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '[') {
      inClass = true;
    } else if (character === ']') {
      inClass = false;
    } else if (character === '/' && !inClass) {
      index += 1;
      break;
    }
    index += 1;
  }
  while (index < source.length && identifierPart.test(source[index])) {
    index += 1;
  }
  return index;
};

/**
 * Tokenizes JavaScript into identifiers, string literals and punctuators,
 * dropping comments, template text and regular expressions.
 */
export function tokenize(source) {
  const tokens = [];
  // Brace depths at which an open template literal resumes.
  const templateResumeDepths = [];
  let braceDepth = 0;
  let index = 0;

  const scanTemplate = start => {
    let cursor = start;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === '`') {
        tokens.push({ type: 'template' });
        return cursor + 1;
      }
      if (source[cursor] === '$' && source[cursor + 1] === '{') {
        templateResumeDepths.push(braceDepth);
        braceDepth += 1;
        tokens.push({ type: 'punct', value: '(' });
        return cursor + 2;
      }
      cursor += 1;
    }
    return cursor;
  };

  const regexAllowed = () => {
    const previous = tokens.at(-1);
    if (previous === undefined) {
      return true;
    }
    if (previous.type === 'identifier') {
      return regexPrecedingKeywords.has(previous.value);
    }
    if (previous.type === 'punct') {
      return ![')', ']', '}'].includes(previous.value);
    }
    return false;
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (/\s/u.test(character)) {
      index += 1;
    } else if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
    } else if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (character === "'" || character === '"') {
      const { end, value } = skipQuoted(source, index);
      tokens.push({ type: 'string', value });
      index = end;
    } else if (character === '`') {
      index = scanTemplate(index + 1);
    } else if (character === '/' && regexAllowed()) {
      index = skipRegex(source, index);
      tokens.push({ type: 'regex' });
    } else if (identifierStart.test(character)) {
      let end = index + 1;
      while (end < source.length && identifierPart.test(source[end])) {
        end += 1;
      }
      tokens.push({ type: 'identifier', value: source.slice(index, end) });
      index = end;
    } else if (character === '{') {
      braceDepth += 1;
      tokens.push({ type: 'punct', value: character });
      index += 1;
    } else if (character === '}') {
      braceDepth -= 1;
      if (templateResumeDepths.at(-1) === braceDepth) {
        templateResumeDepths.pop();
        tokens.push({ type: 'punct', value: ')' });
        index = scanTemplate(index + 1);
      } else {
        tokens.push({ type: 'punct', value: character });
        index += 1;
      }
    } else if (/[0-9]/u.test(character)) {
      let end = index + 1;
      while (end < source.length && /[\w.]/u.test(source[end])) {
        end += 1;
      }
      tokens.push({ type: 'number' });
      index = end;
    } else {
      tokens.push({ type: 'punct', value: character });
      index += 1;
    }
  }
  return tokens;
}

const isIdentifier = (token, value) =>
  token?.type === 'identifier' && token.value === value;
const isPunct = (token, value) =>
  token?.type === 'punct' && token.value === value;
const importClauseToken = token =>
  token?.type === 'identifier' ||
  (token?.type === 'punct' && ['{', '}', ',', '*'].includes(token.value));

// Returns the `from '...'` specifier that closes an import/export clause
// starting at `start`, or undefined when the clause has no `from`.
const clauseSource = (tokens, start) => {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isIdentifier(token, 'from') && tokens[index + 1]?.type === 'string') {
      return tokens[index + 1].value;
    }
    if (!importClauseToken(token)) {
      return undefined;
    }
  }
  return undefined;
};

/** Static module specifiers of a source text, in source order. */
export function collectStaticSpecifiers(source) {
  const tokens = tokenize(source);
  const specifiers = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (isPunct(previous, '.') || token.type !== 'identifier') {
      return;
    }
    if (token.value === 'import') {
      if (next?.type === 'string') {
        specifiers.push(next.value);
      } else if (!isPunct(next, '(') && !isPunct(next, '.')) {
        const specifier = clauseSource(tokens, index + 1);
        if (specifier !== undefined) {
          specifiers.push(specifier);
        }
      }
    } else if (token.value === 'export') {
      if (isPunct(next, '*') || isPunct(next, '{')) {
        const specifier = clauseSource(tokens, index + 1);
        if (specifier !== undefined) {
          specifiers.push(specifier);
        }
      }
    } else if (
      token.value === 'require' &&
      isPunct(next, '(') &&
      tokens[index + 2]?.type === 'string' &&
      isPunct(tokens[index + 3], ')')
    ) {
      specifiers.push(tokens[index + 2].value);
    }
  });
  return specifiers;
}

/** Repository-relative paths of every file tracked by git in `rootDir`. */
export function listTrackedFiles(rootDir) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed in ${rootDir}: ${result.stderr || result.error?.message}. The workflow validator needs a git checkout to know which files a bare job can load.`,
    );
  }
  return new Set(result.stdout.split('\0').filter(Boolean));
}

const toRelative = (rootDir, absolutePath) =>
  path.relative(rootDir, absolutePath).split(path.sep).join('/');

// Node's CommonJS resolver also covers exact-path ESM specifiers. An
// unresolvable path is undefined, which the caller reports as unloadable.
const resolveRelative = (rootDir, fromFile, specifier) => {
  try {
    return toRelative(
      rootDir,
      createRequire(path.resolve(rootDir, fromFile)).resolve(specifier),
    );
  } catch {
    return undefined;
  }
};

/**
 * Walks the static import closure of `entry` (repository-relative) and
 * returns every edge that a bare checkout cannot load: a package specifier
 * or a relative path that does not resolve to a tracked file.
 *
 * @returns {Array<{ chain: string[], specifier: string }>}
 */
export function findUnloadableImports(rootDir, entry, trackedFiles) {
  // require.resolve returns real paths; compare against the real root.
  const realRoot = fs.realpathSync(rootDir);
  if (!trackedFiles.has(entry)) {
    return [{ chain: [], specifier: entry }];
  }
  const failures = [];
  const chains = new Map([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    const chain = chains.get(file);
    const source = fs.readFileSync(path.join(realRoot, file), 'utf-8');
    for (const specifier of collectStaticSpecifiers(source)) {
      if (isBuiltin(specifier)) {
        continue;
      }
      const relative =
        specifier.startsWith('./') || specifier.startsWith('../');
      const target = relative
        ? resolveRelative(realRoot, file, specifier)
        : undefined;
      if (target === undefined || !trackedFiles.has(target)) {
        failures.push({ chain, specifier });
      } else if (!chains.has(target)) {
        chains.set(target, [...chain, target]);
        queue.push(target);
      }
    }
  }
  return failures;
}
