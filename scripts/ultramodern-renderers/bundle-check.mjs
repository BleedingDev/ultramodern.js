#!/usr/bin/env node
// Fails when a Solid or Octane build pulls in React: any import, export-from,
// import() or require() of a React package, or an inlined React runtime. The
// runtime is recognised by its element tag; Octane itself only reads
// Symbol.for('react.context') to adopt React contexts, which is allowed.
//
//   node scripts/ultramodern-renderers/bundle-check.mjs <app>/dist
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from '@babel/core';

const reactPackage =
  /^(?:react|react-dom|scheduler)(?:\/|$)|^react-server-dom-|^react\/jsx(?:-dev)?-runtime$/u;

function* scripts(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* scripts(file);
    else if (/\.[cm]?js$/u.test(entry.name)) yield file;
  }
}

const reactElementTag = /^react\.(?:transitional\.)?element$/u;

const literal = node =>
  node?.type === 'StringLiteral' ? node.value : undefined;

function isMember(node, object, property) {
  return (
    node?.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === object &&
    !node.computed &&
    node.property.name === property
  );
}

/** Returns the React references found in one parsed program. */
function findReact(ast) {
  const found = [];
  const visit = node => {
    if (!node || typeof node.type !== 'string') return;
    let specifier;
    if (
      [
        'ImportDeclaration',
        'ExportAllDeclaration',
        'ExportNamedDeclaration',
      ].includes(node.type)
    )
      specifier = literal(node.source);
    else if (node.type === 'ImportExpression') specifier = literal(node.source);
    else if (node.type === 'CallExpression') {
      const [first] = node.arguments;
      if (
        node.callee.type === 'Import' ||
        (node.callee.type === 'Identifier' && node.callee.name === 'require')
      )
        specifier = literal(first);
      else if (
        isMember(node.callee, 'Symbol', 'for') &&
        reactElementTag.test(literal(first) ?? '')
      )
        found.push(`Symbol.for('${literal(first)}')`);
    }
    if (specifier && reactPackage.test(specifier))
      found.push(`import of ${specifier}`);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.program);
  return found;
}

/** Lists `<file>: <reference>` for every React reference under distDir. */
export function checkBundle(distDir) {
  const violations = [];
  for (const file of scripts(distDir)) {
    const ast = parseSync(fs.readFileSync(file, 'utf8'), {
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      parserOpts: { errorRecovery: true },
    });
    for (const reference of new Set(findReact(ast)))
      violations.push(`${path.relative(distDir, file)}: ${reference}`);
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = path.resolve(process.argv[2] ?? 'dist');
  const violations = checkBundle(distDir);
  for (const violation of violations) console.error(violation);
  if (violations.length) process.exit(1);
  console.log(`bundle-check: no React in ${distDir}`);
}
