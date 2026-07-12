// Observed-consumption grammars. Net-new layer the reused walker/DFS lacks
// (spike §6). Literal specifiers only — dynamic/nonliteral MF loads are a
// documented hard boundary (spike §8.1) and surface as a warning, not an edge.
//
// Grammars:
//   G1  package-subpath (static import/export-from, side-effect, dynamic
//       import(), require):  '@<scope>/<suffix>/<sub>'
//         sub Widget->#Widget, Route->#Route, api/client(s)->#api
//   G2  MF runtime literal, three shapes all resolving alias->unit via remotes[]:
//         (a) createHydratedRemote(Ident, '<alias>/<Expose>')      [spike shape]
//         (b) import('<alias>/<Expose>') bare literal               [current gen]
//             (e.g. createRemoteComponent(() => import('catalog/Widget')))
//         (c) loadRemote('<alias>/<Expose>') string literal
//   G4  consume-surface literal: consumeSurface({ ref: 'unitId#surfaceId[@vN]' })
//       — unitId is the canonical `${scope}/${domain ?? id}` form.
//   warn  loadRemote(<non-literal>)  — dynamic-consumption, G12a policy input.

// --- literal specifier collection -------------------------------------------
const STATIC_FROM_RE = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const HYDRATED_RE = /createHydratedRemote\s*\(\s*[A-Za-z0-9_$]+\s*,\s*['"]([^'"]+)['"]/g;
// loadRemote('<alias>/<Expose>') — a STRING-LITERAL MF load. Statically
// resolvable to an edge (G2), unlike the non-literal form below.
const LOAD_REMOTE_LITERAL_RE = /\bloadRemote\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// loadRemote( ... ) where the first non-space char is NOT a quote or `<` (a
// generic type arg) followed by a quote — i.e. a non-string-literal argument.
const LOAD_REMOTE_NONLITERAL_RE = /\bloadRemote\s*(?:<[^>]*>)?\s*\(\s*(?!['"])([^)]*?)\)/g;

// G4-consume-surface is deliberately parsed as one bounded call site. The
// old pair of regexes could scan through a later property/call and classify
// the same consumeSurface invocation as both literal and dynamic (or neither
// when the argument was shorthand/spread syntax). This small tokenizer is not
// a JavaScript parser; it only needs balanced call/object regions and the
// string/template forms that can contain commas, braces, or parentheses.
const CONSUME_SURFACE_NAME_RE = /\bconsumeSurface\b/g;
const OPEN_TO_CLOSE = { '(': ')', '{': '}', '[': ']' };

function skipTrivia(code, start) {
  let index = start;
  while (index < code.length) {
    if (/\s/.test(code[index])) {
      index += 1;
      continue;
    }
    if (code.startsWith('//', index)) {
      const newline = code.indexOf('\n', index + 2);
      index = newline === -1 ? code.length : newline + 1;
      continue;
    }
    if (code.startsWith('/*', index)) {
      const end = code.indexOf('*/', index + 2);
      index = end === -1 ? code.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function scanQuoted(code, start) {
  const quote = code[start];
  for (let index = start + 1; index < code.length; index += 1) {
    if (code[index] === '\\') {
      index += 1;
      continue;
    }
    if (code[index] === quote) {
      return { end: index + 1, hasInterpolation: false };
    }
  }
  return { end: -1, hasInterpolation: false };
}

function scanTemplate(code, start) {
  let hasInterpolation = false;
  for (let index = start + 1; index < code.length; index += 1) {
    if (code[index] === '\\') {
      index += 1;
      continue;
    }
    if (code[index] === '$' && code[index + 1] === '{') {
      hasInterpolation = true;
      const expressionEnd = scanBalancedRegion(code, index + 1);
      if (expressionEnd === -1) return { end: -1, hasInterpolation };
      index = expressionEnd;
      continue;
    }
    if (code[index] === '`') {
      return { end: index + 1, hasInterpolation };
    }
  }
  return { end: -1, hasInterpolation };
}

function scanStringLike(code, start) {
  if (code[start] === '`') {
    return scanTemplate(code, start);
  }
  return scanQuoted(code, start);
}

function scanBalancedRegion(code, openIndex) {
  const stack = [OPEN_TO_CLOSE[code[openIndex]]];
  if (stack[0] === undefined) {
    return -1;
  }

  for (let index = openIndex + 1; index < code.length; index += 1) {
    const character = code[index];
    if (character === '"' || character === "'" || character === '`') {
      const string = scanStringLike(code, index);
      if (string.end === -1) return -1;
      index = string.end - 1;
      continue;
    }
    if (code.startsWith('//', index)) {
      const newline = code.indexOf('\n', index + 2);
      index = newline === -1 ? code.length : newline;
      continue;
    }
    if (code.startsWith('/*', index)) {
      const end = code.indexOf('*/', index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    const close = OPEN_TO_CLOSE[character];
    if (close !== undefined) {
      stack.push(close);
      continue;
    }
    if (character === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function scanGenericRegion(code, start) {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (character === '"' || character === "'" || character === '`') {
      const string = scanStringLike(code, index);
      if (string.end === -1) return -1;
      index = string.end - 1;
      continue;
    }
    if (code.startsWith('//', index)) {
      const newline = code.indexOf('\n', index + 2);
      index = newline === -1 ? code.length : newline;
      continue;
    }
    if (code.startsWith('/*', index)) {
      const end = code.indexOf('*/', index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (character === '<') depth += 1;
    if (character === '>') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function findCallOpenParen(code, nameEnd) {
  let index = skipTrivia(code, nameEnd);
  if (code[index] === '<') {
    index = scanGenericRegion(code, index);
    if (index === -1) return -1;
    index = skipTrivia(code, index);
  }
  return code[index] === '(' ? index : -1;
}

function findTopLevelDelimiter(code, start, end) {
  const stack = [];
  for (let index = start; index < end; index += 1) {
    const character = code[index];
    if (character === '"' || character === "'" || character === '`') {
      const string = scanStringLike(code, index);
      if (string.end === -1) return end;
      index = string.end - 1;
      continue;
    }
    if (code.startsWith('//', index)) {
      const newline = code.indexOf('\n', index + 2);
      index = newline === -1 ? end : Math.min(newline, end - 1);
      continue;
    }
    if (code.startsWith('/*', index)) {
      const commentEnd = code.indexOf('*/', index + 2);
      if (commentEnd === -1) return end;
      index = Math.min(commentEnd + 1, end - 1);
      continue;
    }
    const close = OPEN_TO_CLOSE[character];
    if (close !== undefined) {
      stack.push(close);
      continue;
    }
    if (character === stack[stack.length - 1]) {
      stack.pop();
      continue;
    }
    if (character === ',' && stack.length === 0) return index;
  }
  return end;
}

function isIdentifierStart(character) {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character) {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function decodeLiteralText(code, start, end) {
  const quote = code[start];
  const raw = code.slice(start + 1, end - 1);
  // Surface refs are restricted to identifier-safe characters, so escaped
  // characters are not expected. Preserve the old grammar's raw capture while
  // unescaping the common quote/backslash spelling for completeness.
  return raw.replace(new RegExp(`\\\\${quote}`, 'g'), quote).replace(/\\\\/g, '\\');
}

function readLiteralAt(code, start, end) {
  if (code[start] !== '"' && code[start] !== "'" && code[start] !== '`') {
    return undefined;
  }
  const string = scanStringLike(code, start);
  if (string.end === -1 || string.end > end) return undefined;
  const after = skipTrivia(code, string.end);
  if (after !== end && code[after] !== ',') return undefined;
  if (code[start] === '`' && string.hasInterpolation) return undefined;
  return {
    value: decodeLiteralText(code, start, string.end),
    end: string.end,
  };
}

function readObjectRefLiteral(code, openIndex, closeIndex) {
  let index = openIndex + 1;
  let refValue;
  while (index < closeIndex) {
    index = skipTrivia(code, index);
    if (index >= closeIndex) break;
    if (code.startsWith('...', index) || code[index] === '[') {
      return undefined;
    }

    let key;
    let keyEnd = index;
    if (isIdentifierStart(code[index])) {
      keyEnd += 1;
      while (isIdentifierPart(code[keyEnd])) keyEnd += 1;
      key = code.slice(index, keyEnd);
    } else if (code[index] === '"' || code[index] === "'") {
      const string = scanQuoted(code, index);
      if (string.end === -1 || string.end > closeIndex) return undefined;
      key = decodeLiteralText(code, index, string.end);
      keyEnd = string.end;
    }

    if (key === 'ref') {
      const colon = skipTrivia(code, keyEnd);
      if (code[colon] !== ':') return undefined;
      const valueStart = skipTrivia(code, colon + 1);
      const literal = readLiteralAt(code, valueStart, closeIndex);
      if (literal === undefined) return undefined;
      refValue = literal.value;
    }

    const propertyEnd = findTopLevelDelimiter(code, index, closeIndex);
    if (propertyEnd >= closeIndex) break;
    index = propertyEnd + 1;
  }
  return refValue;
}

function classifyConsumeSurfaceArgument(code, argumentStart, argumentEnd) {
  const start = skipTrivia(code, argumentStart);
  const argument = code.slice(start, argumentEnd).trim();
  if (argument === '') {
    return { kind: 'dynamic', argument: '<missing>' };
  }

  const directLiteral = readLiteralAt(code, start, argumentEnd);
  if (directLiteral !== undefined && skipTrivia(code, directLiteral.end) === argumentEnd) {
    return { kind: 'literal', value: directLiteral.value };
  }

  if (code[start] === '{') {
    const close = scanBalancedRegion(code, start);
    if (close !== -1 && skipTrivia(code, close + 1) === argumentEnd) {
      const value = readObjectRefLiteral(code, start, close);
      if (value !== undefined) return { kind: 'literal', value };
    }
  }

  return { kind: 'dynamic', argument };
}

function consumeSurfaceCalls(code) {
  const calls = [];
  CONSUME_SURFACE_NAME_RE.lastIndex = 0;
  let match;
  while ((match = CONSUME_SURFACE_NAME_RE.exec(code))) {
    const open = findCallOpenParen(code, match.index + match[0].length);
    if (open === -1) continue;
    const close = scanBalancedRegion(code, open);
    if (close === -1) continue;
    const firstArgumentEnd = findTopLevelDelimiter(code, open + 1, close);
    calls.push(
      classifyConsumeSurfaceArgument(code, open + 1, firstArgumentEnd),
    );
  }
  return calls;
}

export function collectLiteralSpecifiers(code) {
  const specs = [];
  for (const re of [STATIC_FROM_RE, SIDE_EFFECT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) specs.push(m[1]);
  }
  return specs;
}

export function surfaceForSubpath(sub) {
  if (sub === 'Widget') return 'Widget';
  if (sub === 'Route') return 'Route';
  if (sub === 'api/client' || sub === 'api/clients') return 'api';
  return null;
}

// Classify one file's literal specifiers + MF runtime literals into observed
// hits. `emit(consumer, provider, surface, grammar, evidence)` records an edge.
// `warn(evidence)` records a dynamic-consumption warning. Returns
// { loadRemoteLiteralHits } counters.
export function extractFromFile({ ws, consumer, rel, code, emit, warn }) {
  const scopePrefix = `@${ws.scope}/`;
  let loadRemoteLiteralHits = 0;

  // G1 + G2b (both come from the flat literal-specifier set).
  for (const spec of collectLiteralSpecifiers(code)) {
    if (spec.startsWith(scopePrefix)) {
      // G1 package-subpath.
      const rest = spec.slice(scopePrefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) continue; // bare package import, not a surface subpath
      const suffix = rest.slice(0, slash);
      const sub = rest.slice(slash + 1);
      const provider = ws.suffixToUnit.get(suffix);
      const surface = surfaceForSubpath(sub);
      if (provider && surface) {
        emit(consumer, provider, surface, 'G1-pkg-subpath', `${rel}: ${spec}`);
      }
      continue;
    }
    // G2b bare MF literal '<alias>/<Expose>' (dynamic import / side-effect).
    const slash = spec.indexOf('/');
    if (slash === -1 || spec.startsWith('.')) continue;
    const alias = spec.slice(0, slash);
    const expose = spec.slice(slash + 1).replace(/^\.\//, '');
    const provider = ws.aliasToUnit.get(alias);
    if (provider && expose) {
      emit(consumer, provider, expose, 'G2-mf-literal', `${rel}: '${spec}'`);
    }
  }

  // G2a createHydratedRemote(Ident, '<alias>/<Expose>') — spike shape.
  HYDRATED_RE.lastIndex = 0;
  let h;
  while ((h = HYDRATED_RE.exec(code))) {
    const [alias, expose] = h[1].split('/');
    const provider = ws.aliasToUnit.get(alias);
    if (provider && expose) {
      emit(consumer, provider, expose, 'G2-mf-literal', `${rel}: '${h[1]}'`);
    }
  }

  // G2 via loadRemote('<alias>/<Expose>') string literal (statically resolvable).
  LOAD_REMOTE_LITERAL_RE.lastIndex = 0;
  let lr;
  while ((lr = LOAD_REMOTE_LITERAL_RE.exec(code))) {
    const spec = lr[1];
    const slash = spec.indexOf('/');
    if (slash === -1 || spec.startsWith('.')) continue;
    const alias = spec.slice(0, slash);
    const expose = spec.slice(slash + 1).replace(/^\.\//, '');
    const provider = ws.aliasToUnit.get(alias);
    if (provider && expose) {
      loadRemoteLiteralHits += 1;
      emit(consumer, provider, expose, 'G2-mf-literal', `${rel}: loadRemote('${spec}')`);
    }
  }

  // G4-consume-surface: consumeSurface({ ref: 'unitId#surfaceId[@vN]' }). The
  // unitId is the canonical `${scope}/${domain ?? id}` form; resolve it back to
  // the owning delivery unit. surfaceId is the consumed surface.
  for (const call of consumeSurfaceCalls(code)) {
    if (call.kind === 'dynamic') {
      warn({
        consumer,
        site: rel,
        argument: call.argument,
        reason: 'consumeSurface called with a non-literal ref',
      });
      continue;
    }
    const raw = call.value;
    const hash = raw.indexOf('#');
    if (hash === -1) continue;
    const unitId = raw.slice(0, hash);
    const surface = raw.slice(hash + 1).replace(/@v[1-9]\d*$/, '');
    const provider = ws.unitByCanonical.get(unitId);
    if (provider && surface) {
      emit(consumer, provider, surface, 'G4-consume-surface', `${rel}: consumeSurface('${raw}')`);
    }
  }

  // dynamic-consumption warnings: loadRemote(<non-literal>) (spike §8.1).
  LOAD_REMOTE_NONLITERAL_RE.lastIndex = 0;
  let l;
  while ((l = LOAD_REMOTE_NONLITERAL_RE.exec(code))) {
    const arg = l[1].trim();
    if (arg === '') continue;
    warn({ consumer, site: rel, argument: arg, reason: 'loadRemote called with a non-literal specifier' });
  }

  return { loadRemoteLiteralHits };
}
