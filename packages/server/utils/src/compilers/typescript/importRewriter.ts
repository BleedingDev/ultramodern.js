// Lexer-based import-specifier rewriting for emitted JavaScript.
//
// The previous implementation applied a global regex to whole file contents,
// which also matched `from '...'` / `require('...')`-shaped text inside string
// literals and comments. This module scans the file once with a minimal
// JavaScript lexer (strings, template literals + interpolations, comments and
// regex literals are tracked) and only treats a string literal as an import
// specifier when it appears in one of the actual module-syntax shapes:
//
//   import ... from 'x'   export ... from 'x'   import 'x'
//   import('x')           require('x')
//
// Property accesses such as `Array.from('x')` or `foo.require('x')` and
// identifiers that merely end in `require` are not matched.

type SpecifierRewrite = (specifier: string) => string | undefined;

type SpecifierToken = {
  /** Index of the first character of the specifier (after the opening quote). */
  start: number;
  /** Index just past the last character (before the closing quote). */
  end: number;
  value: string;
};

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const WHITESPACE = /\s/;

// Tokens after which a `/` starts a regular-expression literal rather than a
// division operator (the standard heuristic used by minimal JS lexers).
const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const PUNCTUATORS_BEFORE_REGEX = new Set('{}(,;[=:?!&|+-*%^~<>/');

const isRegexAllowed = (lastToken: string): boolean => {
  if (!lastToken) {
    return true;
  }
  if (KEYWORDS_BEFORE_REGEX.has(lastToken)) {
    return true;
  }
  return lastToken.length === 1 && PUNCTUATORS_BEFORE_REGEX.has(lastToken);
};

const isSpecifierContext = (
  prev1: string,
  prev2: string,
  prev3: string,
): boolean => {
  // `import ... from 'x'`, `export ... from 'x'` and bare `import 'x'`.
  // `from` / `import` as property names (`Array.from 'x'` is not valid JS,
  // `foo.import` cannot be followed by a string either) are excluded via the
  // preceding `.` check for safety.
  if ((prev1 === 'from' || prev1 === 'import') && prev2 !== '.') {
    return true;
  }
  // `import('x')` / `require('x')`, excluding member calls like
  // `foo.require('x')` or `foo?.import('x')`.
  return (
    prev1 === '(' &&
    (prev2 === 'import' || prev2 === 'require') &&
    prev3 !== '.'
  );
};

const skipRegexLiteral = (content: string, start: number): number => {
  let i = start + 1;
  let inClass = false;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') {
      // Unterminated regex — bail out without consuming the line.
      return i;
    }
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      i++;
      while (i < content.length && IDENTIFIER_CHAR.test(content[i])) {
        i++;
      }
      return i;
    }
    i++;
  }
  return i;
};

const scanSpecifiers = (content: string): SpecifierToken[] => {
  const specifiers: SpecifierToken[] = [];
  const length = content.length;

  // Brace depth for each open template-literal interpolation, so a `}` can be
  // matched back to the template it belongs to.
  const templateExpressionDepths: number[] = [];

  // Ring of the last three meaningful tokens (identifier text or a
  // single-character punctuator), newest first.
  let prev1 = '';
  let prev2 = '';
  let prev3 = '';
  const pushToken = (token: string) => {
    prev3 = prev2;
    prev2 = prev1;
    prev1 = token;
  };

  let mode: 'code' | 'template' = 'code';
  let i = 0;

  while (i < length) {
    const ch = content[i];

    if (mode === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        mode = 'code';
        pushToken('`');
        i++;
        continue;
      }
      if (ch === '$' && content[i + 1] === '{') {
        // Interpolations contain real code (including dynamic imports), so
        // switch back to code scanning until the matching `}`.
        templateExpressionDepths.push(0);
        mode = 'code';
        pushToken('{');
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (WHITESPACE.test(ch)) {
      i++;
      continue;
    }

    if (ch === '/') {
      const next = content[i + 1];
      if (next === '/') {
        const newline = content.indexOf('\n', i + 2);
        i = newline === -1 ? length : newline + 1;
        continue;
      }
      if (next === '*') {
        const end = content.indexOf('*/', i + 2);
        i = end === -1 ? length : end + 2;
        continue;
      }
      if (isRegexAllowed(prev1)) {
        i = skipRegexLiteral(content, i);
        pushToken('/regex/');
        continue;
      }
      pushToken('/');
      i++;
      continue;
    }

    if (ch === '`') {
      mode = 'template';
      i++;
      continue;
    }

    if (ch === '{') {
      if (templateExpressionDepths.length > 0) {
        templateExpressionDepths[templateExpressionDepths.length - 1]++;
      }
      pushToken('{');
      i++;
      continue;
    }

    if (ch === '}') {
      if (templateExpressionDepths.length > 0) {
        const top = templateExpressionDepths.length - 1;
        if (templateExpressionDepths[top] === 0) {
          templateExpressionDepths.pop();
          mode = 'template';
          i++;
          continue;
        }
        templateExpressionDepths[top]--;
      }
      pushToken('}');
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      let j = i + 1;
      let terminated = false;
      while (j < length) {
        const sch = content[j];
        if (sch === '\\') {
          j += 2;
          continue;
        }
        if (sch === ch) {
          terminated = true;
          j++;
          break;
        }
        if (sch === '\n') {
          // Unterminated string literal — not valid module syntax.
          break;
        }
        j++;
      }
      if (terminated && isSpecifierContext(prev1, prev2, prev3)) {
        specifiers.push({
          start: start + 1,
          end: j - 1,
          value: content.slice(start + 1, j - 1),
        });
      }
      pushToken('"string"');
      i = j;
      continue;
    }

    if (IDENTIFIER_CHAR.test(ch)) {
      let j = i + 1;
      while (j < length && IDENTIFIER_CHAR.test(content[j])) {
        j++;
      }
      pushToken(content.slice(i, j));
      i = j;
      continue;
    }

    pushToken(ch);
    i++;
  }

  return specifiers;
};

/**
 * Rewrite the import/export/require specifiers of emitted JavaScript.
 *
 * Specifiers whose contents contain escape sequences are left untouched (the
 * raw source slice would not round-trip), which never happens for the
 * compiler-emitted relative/alias specifiers this is used on.
 */
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
