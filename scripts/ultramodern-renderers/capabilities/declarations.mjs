import { dirname, extname, resolve } from 'node:path';

// Extract concrete declarations, not a configuration value or a TypeScript program.
// Provider-indexed/mapped types retain their separately inventoried provider contract.
function tokenize(source) {
  const tokens = [];
  let cursor = 0;
  let line = 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/.test(char)) {
      if (char === '\n') line++;
      cursor++;
      continue;
    }
    if (source.startsWith('//', cursor)) {
      while (cursor < source.length && source[cursor] !== '\n') cursor++;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      if (end < 0) throw new Error('Unterminated declaration comment');
      line += source.slice(cursor, end + 2).split('\n').length - 1;
      cursor = end + 2;
      continue;
    }
    const start = cursor;
    const tokenLine = line;
    let kind = 'punctuation';
    if (char === '"' || char === "'" || char === '`') {
      kind = 'string';
      cursor++;
      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === '\\') cursor++;
        if (source[cursor] === '\n') line++;
        cursor++;
      }
      if (cursor === source.length)
        throw new Error('Unterminated declaration string');
      cursor++;
    } else if (/[A-Za-z_$]/.test(char)) {
      kind = 'identifier';
      while (cursor < source.length && /[\w$]/.test(source[cursor])) cursor++;
    } else if (source.startsWith('=>', cursor)) cursor += 2;
    else cursor++;
    const raw = source.slice(start, cursor);
    tokens.push({
      value: kind === 'string' ? raw.slice(1, -1) : raw,
      kind,
      line: tokenLine,
    });
  }
  return tokens;
}

const pairs = { '(': ')', '[': ']', '{': '}', '<': '>' };
function updateStack(stack, token) {
  if (token.kind === 'string') return;
  if (pairs[token.value]) stack.push(pairs[token.value]);
  else if (stack.at(-1) === token.value) stack.pop();
}
function endOfGroup(tokens, start) {
  const stack = [];
  for (let index = start; index < tokens.length; index++) {
    updateStack(stack, tokens[index]);
    if (stack.length === 0) return index;
  }
  throw new Error(`Unterminated declaration group ${tokens[start]?.value}`);
}
function split(tokens, separators) {
  const chunks = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      stack.length === 0 &&
      token.kind !== 'string' &&
      separators.includes(token.value)
    ) {
      chunks.push(tokens.slice(start, index));
      start = index + 1;
    } else updateStack(stack, token);
  }
  chunks.push(tokens.slice(start));
  return chunks.filter(chunk => chunk.length > 0);
}
function declaration(tokens, name) {
  for (let index = 0; index < tokens.length - 1; index++) {
    const kind = tokens[index].value;
    if (
      tokens[index].kind !== 'identifier' ||
      !['interface', 'type'].includes(kind) ||
      tokens[index + 1].value !== name
    )
      continue;
    let cursor = index + 2;
    if (tokens[cursor]?.value === '<') cursor = endOfGroup(tokens, cursor) + 1;
    if (kind === 'interface') {
      const start = cursor;
      const stack = [];
      while (cursor < tokens.length) {
        if (tokens[cursor].value === '{' && stack.length === 0) break;
        updateStack(stack, tokens[cursor++]);
      }
      if (cursor === tokens.length)
        throw new Error(`Missing interface body ${name}`);
      const header = tokens.slice(start, cursor);
      return {
        kind,
        bases:
          header[0]?.value === 'extends' ? split(header.slice(1), [',']) : [],
        body: tokens.slice(cursor + 1, endOfGroup(tokens, cursor)),
      };
    }
    if (tokens[cursor]?.value !== '=') continue; // `import type`, not a declaration.
    const start = ++cursor;
    const stack = [];
    while (cursor < tokens.length) {
      if (tokens[cursor].value === ';' && stack.length === 0) break;
      updateStack(stack, tokens[cursor++]);
    }
    if (cursor === tokens.length)
      throw new Error(`Missing type declaration terminator ${name}`);
    return { kind, body: tokens.slice(start, cursor) };
  }
}
function imports(tokens) {
  const result = new Map();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== 'import' || tokens[index].kind !== 'identifier')
      continue;
    let end = index;
    while (end < tokens.length && tokens[end].value !== ';') end++;
    const statement = tokens.slice(index + 1, end);
    const from = statement.findIndex(token => token.value === 'from');
    const source = statement[from + 1];
    const start = statement.findIndex(token => token.value === '{');
    if (from < 0 || source?.kind !== 'string' || start < 0) continue;
    for (const binding of split(
      statement.slice(start + 1, endOfGroup(statement, start)),
      [','],
    )) {
      const names = binding.filter(token => token.value !== 'type');
      if (names[0])
        result.set(names[2]?.value ?? names[0].value, {
          name: names[0].value,
          source: source.value,
        });
    }
  }
  return result;
}

function merge(target, source, replace = false) {
  for (const [key, children] of source) {
    if (replace || !target.has(key)) target.set(key, new Map(children));
    else merge(target.get(key), children);
  }
  return target;
}
function propertyStart(tokens, index) {
  if (tokens[index]?.value === 'readonly') index++;
  if (!['identifier', 'string'].includes(tokens[index]?.kind)) return false;
  if (tokens[index + 1]?.value === '?') index++;
  return [':', '('].includes(tokens[index + 1]?.value);
}

function declarationShape(source, symbol, options = {}) {
  const modules = new Map();
  const active = new Set();
  const rootPath = options.sourcePath ?? '<inline>';
  const module = (text, path) => {
    if (!modules.has(path)) {
      const tokens = tokenize(text);
      modules.set(path, { path, tokens, imports: imports(tokens) });
    }
    return modules.get(path);
  };
  const load = (current, binding) => {
    if (!binding.source.startsWith('.')) return undefined;
    if (!options.readSource || current.path === '<inline>')
      throw new Error(
        `Cannot resolve inherited relative declaration ${binding.source}`,
      );
    const base = resolve(dirname(current.path), binding.source);
    const candidates = extname(base)
      ? [base]
      : [
          `${base}.ts`,
          `${base}.mts`,
          `${base}.tsx`,
          `${base}.d.ts`,
          resolve(base, 'index.ts'),
        ];
    for (const path of candidates) {
      const text = options.readSource(path);
      if (typeof text === 'string') return module(text, path);
    }
    throw new Error(`Missing inherited declaration source ${binding.source}`);
  };
  const named = (current, name) => {
    let target = current;
    let targetName = name;
    let declared = declaration(target.tokens, targetName);
    if (!declared) {
      const binding = current.imports.get(name);
      if (!binding) return new Map(); // Opaque provider/type parameter, separately inventoried.
      target = load(current, binding);
      if (!target) return new Map();
      targetName = binding.name;
      declared = declaration(target.tokens, targetName);
      if (!declared)
        throw new Error(
          `Missing inherited config declaration ${targetName} in ${target.path}`,
        );
    }
    const identity = `${target.path}:${targetName}`;
    if (active.has(identity))
      throw new Error(`Cyclic inherited config declaration ${targetName}`);
    active.add(identity);
    try {
      if (declared.kind === 'type')
        return typeShape(declared.body, target, true);
      const result = new Map();
      for (const base of declared.bases)
        merge(result, typeShape(base, target, true));
      return merge(result, members(declared.body, target), true);
    } finally {
      active.delete(identity);
    }
  };
  const members = (tokens, current) => {
    const result = new Map();
    let cursor = 0;
    while (cursor < tokens.length) {
      if ([';', ','].includes(tokens[cursor].value)) {
        cursor++;
        continue;
      }
      if (tokens[cursor].value === 'readonly') cursor++;
      let key = tokens[cursor++];
      if (key.value === '[') {
        const end = endOfGroup(tokens, cursor - 1);
        const expression = tokens.slice(cursor, end);
        if (expression.length !== 1 || expression[0].kind !== 'string')
          throw new Error('Unsupported dynamic declaration key');
        key = expression[0];
        cursor = end + 1;
      } else if (!['identifier', 'string'].includes(key.kind))
        throw new Error(`Unsupported declaration member ${key.value}`);
      if (tokens[cursor]?.value === '?') cursor++;
      if (tokens[cursor]?.value === '<')
        cursor = endOfGroup(tokens, cursor) + 1;
      if (tokens[cursor]?.value === '(')
        cursor = endOfGroup(tokens, cursor) + 1;
      if (tokens[cursor]?.value !== ':')
        throw new Error(`Missing member type for ${key.value}`);
      const start = ++cursor;
      const stack = [];
      while (cursor < tokens.length) {
        if (
          stack.length === 0 &&
          ([';', ','].includes(tokens[cursor].value) ||
            (cursor > start &&
              tokens[cursor].line > tokens[cursor - 1].line &&
              propertyStart(tokens, cursor)))
        )
          break;
        updateStack(stack, tokens[cursor++]);
      }
      result.set(
        key.value,
        typeShape(tokens.slice(start, cursor), current, false),
      );
    }
    return result;
  };
  const typeShape = (tokens, current, references) => {
    if (tokens.length === 0) return new Map();
    if (tokens[0].value === '(' && endOfGroup(tokens, 0) === tokens.length - 1)
      return typeShape(tokens.slice(1, -1), current, references);
    const branches = split(tokens, ['|', '&']);
    if (branches.length > 1) {
      const result = new Map();
      for (const branch of branches)
        merge(result, typeShape(branch, current, references));
      return result;
    }
    if (tokens[0].value === '{' && endOfGroup(tokens, 0) === tokens.length - 1)
      return members(tokens.slice(1, -1), current);
    if (!references || tokens[0].kind !== 'identifier') return new Map();
    const name = tokens[0].value;
    if (tokens.length === 1) return named(current, name);
    if (tokens[1].value !== '<' || endOfGroup(tokens, 1) !== tokens.length - 1)
      return new Map();
    const args = split(tokens.slice(2, -1), [',']);
    if (['Omit', 'Pick'].includes(name)) {
      const result = typeShape(args[0] ?? [], current, true);
      const keys = split(args[1] ?? [], ['|']);
      if (keys.some(key => key.length !== 1 || key[0].kind !== 'string'))
        throw new Error(`Unsupported ${name} key expression`);
      const selected = new Set(keys.map(key => key[0].value));
      for (const key of result.keys())
        if (name === 'Omit' ? selected.has(key) : !selected.has(key))
          result.delete(key);
      return result;
    }
    if (['Partial', 'Required', 'Readonly', 'NonNullable'].includes(name))
      return typeShape(args[0] ?? [], current, true);
    return named(current, name);
  };
  const initial = module(source, rootPath);
  if (!declaration(initial.tokens, symbol))
    throw new Error(`Missing config declaration ${symbol}`);
  return named(initial, symbol);
}

export function declaredPropertyPaths(source, symbol, options) {
  const result = [];
  const paths = (shape, prefix = []) => {
    for (const [key, children] of shape) {
      const path = [...prefix, key];
      result.push(path.join('.'));
      paths(children, path);
    }
  };
  paths(declarationShape(source, symbol, options));
  return result;
}

export function declaredKeys(source, symbol, options) {
  return [...declarationShape(source, symbol, options).keys()];
}
