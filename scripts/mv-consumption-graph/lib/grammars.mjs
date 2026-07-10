// Observed-consumption grammars. Net-new layer the reused walker/DFS lacks
// (spike §6). Literal specifiers only — dynamic/nonliteral MF loads are a
// documented hard boundary (spike §8.1) and surface as a warning, not an edge.
//
// Grammars:
//   G1  package-subpath (static import/export-from, side-effect, dynamic
//       import(), require):  '@<scope>/<suffix>/<sub>'
//         sub Widget->#Widget, Route->#Route, api/client(s)->#api
//   G2  MF runtime literal, two shapes both resolving alias->unit via remotes[]:
//         (a) createHydratedRemote(Ident, '<alias>/<Expose>')      [spike shape]
//         (b) import('<alias>/<Expose>') bare literal               [current gen]
//             (e.g. createRemoteComponent(() => import('catalog/Widget')))
//   warn  loadRemote(<non-literal>)  — dynamic-consumption, G12a policy input.

// --- literal specifier collection -------------------------------------------
const STATIC_FROM_RE = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const HYDRATED_RE = /createHydratedRemote\s*\(\s*[A-Za-z0-9_$]+\s*,\s*['"]([^'"]+)['"]/g;
// loadRemote( ... ) where the first non-space char is NOT a quote or `<` (a
// generic type arg) followed by a quote — i.e. a non-string-literal argument.
const LOAD_REMOTE_NONLITERAL_RE = /\bloadRemote\s*(?:<[^>]*>)?\s*\(\s*(?!['"])([^)]*?)\)/g;

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
