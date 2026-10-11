const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseWorkspacePatterns } = require('../workspace-patterns');

const packages = "packages:\n  - 'packages/*'\n";

test('the complete repository manifest uses the supported block YAML grammar', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../pnpm-workspace.yaml'),
    'utf8',
  );
  const patterns = parseWorkspacePatterns(source);
  assert.equal(patterns.length, 25);
  assert.equal(patterns[0], 'packages/*');
  assert.deepEqual(
    patterns.filter(pattern => pattern.startsWith('!')),
    [
      '!tests/integration/**/dist/**',
      '!tests/integration/**/dist-*/**',
      '!tests/integration/**/node_modules/**',
    ],
  );
});

test('quoted scalars and comments preserve pattern bytes while other fields support scalar types and nested blocks', () => {
  const source = `
"\\u0070ackages": # decoded key
  - "packages/runtime/*" # trailing comment
  - 'packages/it''s/#*'
  - '!packages/runtime/fixtures/**'
metadata:
  url: https://example.org/x#fragment
  enabled: false
  nullable: null
  number: -1.2e3
  integer: 0x10
  text: 'true'
  values:
    - True
    - ~
    - 2
    - 'literal # comment'
`;
  assert.deepEqual(parseWorkspacePatterns(source), [
    'packages/runtime/*',
    "packages/it's/#*",
    '!packages/runtime/fixtures/**',
  ]);
  assert.deepEqual(
    parseWorkspacePatterns(`\uFEFF${packages.replaceAll('\n', '\r\n')}`),
    ['packages/*'],
  );
});

test('duplicate decoded keys fail throughout the document', () => {
  for (const extra of [
    'packages:\n  - packages/runtime/*\n',
    '"packages":\n  - packages/runtime/*\n',
    '"\\u0070ackages":\n  - packages/runtime/*\n',
    "metadata:\n  key: true\n  'key': false\n",
    'metadata:\n  1: true\n  "1": false\n',
  ]) {
    assert.throws(() => parseWorkspacePatterns(packages + extra), /ambiguous/);
  }
});

test('unsupported YAML features and malformed unrelated fields fail closed', () => {
  for (const extra of [
    'metadata: &anchor value\n',
    'metadata: *alias\n',
    'metadata: !!str value\n',
    'metadata:\n  <<: value\n',
    'metadata: [one, two]\n',
    'metadata: {one: two}\n',
    'metadata: |\n  value\n',
    'metadata: >\n  value\n',
    '---\nmetadata: value\n',
    '--- metadata: value\n',
    '... metadata: value\n',
    '...\n',
    '%YAML 1.2\n',
    '? complex\n: value\n',
    'metadata: "unterminated\n',
    "metadata: 'unterminated\n",
    'metadata: "value" extra\n',
    "metadata: 'value' extra\n",
    'metadata: "unsupported\\x20escape"\n',
    'metadata: - nested-sequence\n',
    'metadata: value\n  orphan: child\n',
    'metadata:\n  first: true\n   second: false\n',
    'metadata:\n  first: true\n  - mixed-kind\n',
    'metadata:\n\tfirst: true\n',
    'metadata: invalid\uFFFE\n',
    'metadata: invalid\uFFFF\n',
    'metadata: invalid\uD800\n',
  ]) {
    assert.throws(() => parseWorkspacePatterns(packages + extra), /ambiguous/);
  }
  assert.deepEqual(parseWorkspacePatterns("packages:\n  - 'packages/🚀/*'\n"), [
    'packages/🚀/*',
  ]);
});

test('packages requires one top-level nonempty sequence of nonempty strings', () => {
  for (const source of [
    '',
    'metadata:\n  packages:\n    - packages/*\n',
    'packages:\n',
    'packages: value\n',
    'packages:\n  - true\n',
    'packages:\n  - 12\n',
    'packages:\n  - null\n',
    'packages:\n  -\n',
    "packages:\n  - ''\n",
    'packages:\n  -\n    nested: value\n',
    '\u00a0packages:\n  - packages/*\n',
    ' packages:\n  - packages/*\n',
  ]) {
    assert.throws(() => parseWorkspacePatterns(source), /workspace/);
  }
  assert.deepEqual(
    parseWorkspacePatterns("packages:\n  - 'true'\n  - '12'\n  - 'null'\n"),
    ['true', '12', 'null'],
  );
});
