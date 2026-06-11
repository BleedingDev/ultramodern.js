const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PLACEHOLDER_VALUES,
  ensureBoolean,
  ensureFileExists,
  ensureInteger,
  ensureNonEmptyArray,
  ensureNonEmptyStringArray,
  ensureNonPlaceholderString,
  ensureObject,
  ensurePositiveInteger,
  ensureSchemaVersion,
  ensureString,
  ensureStringArray,
  ensureUniqueIds,
  escapeRegExp,
  isPlaceholderValue,
  normalizeIdentifier,
  readJsonFile,
  resolvePath,
} = require('../validation-kit');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'validation-kit-'));

test('readJsonFile parses valid JSON', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'valid.json');
    fs.writeFileSync(filePath, '{"answer":42}');
    assert.deepEqual(readJsonFile(filePath), { answer: 42 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonFile reports the file path on parse errors', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'broken.json');
    fs.writeFileSync(filePath, '{"answer":');
    assert.throws(
      () => readJsonFile(filePath),
      error =>
        error.message.includes('Failed to parse JSON') &&
        error.message.includes(filePath),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonFile propagates missing-file errors', () => {
  assert.throws(
    () => readJsonFile(path.join(os.tmpdir(), 'does-not-exist.json')),
    /ENOENT/,
  );
});

test('ensureFileExists supports custom labels', () => {
  assert.throws(
    () => ensureFileExists('/nonexistent/file'),
    /Required file does not exist: \/nonexistent\/file/,
  );
  assert.throws(
    () => ensureFileExists('/nonexistent/file', { label: 'File' }),
    /^Error: File does not exist: \/nonexistent\/file$/,
  );
  assert.doesNotThrow(() => ensureFileExists(__filename));
});

test('resolvePath resolves against the provided base directory', () => {
  assert.equal(resolvePath('b.json', '/a'), path.resolve('/a', 'b.json'));
  assert.equal(resolvePath('/abs/b.json', '/a'), path.resolve('/abs/b.json'));
  assert.equal(resolvePath('b.json'), path.resolve(process.cwd(), 'b.json'));
});

test('primitive guards accept valid values and reject invalid ones', () => {
  assert.doesNotThrow(() => ensureObject({}, 'ctx'));
  assert.throws(() => ensureObject([], 'ctx'), /ctx must be an object/);
  assert.throws(() => ensureObject(null, 'ctx'), /ctx must be an object/);

  assert.doesNotThrow(() => ensureNonEmptyArray([1], 'ctx'));
  assert.throws(() => ensureNonEmptyArray([], 'ctx'), /ctx must not be empty/);
  assert.throws(() => ensureNonEmptyArray('x', 'ctx'), /ctx must be an array/);

  assert.doesNotThrow(() => ensureString('x', 'ctx'));
  assert.throws(
    () => ensureString('  ', 'ctx'),
    /ctx must be a non-empty string/,
  );

  assert.doesNotThrow(() => ensureBoolean(false, 'ctx'));
  assert.throws(() => ensureBoolean('true', 'ctx'), /ctx must be a boolean/);

  assert.doesNotThrow(() => ensureInteger(0, 'ctx'));
  assert.throws(
    () => ensureInteger(-1, 'ctx'),
    /ctx must be a non-negative integer/,
  );

  assert.doesNotThrow(() => ensurePositiveInteger(1, 'ctx'));
  assert.throws(
    () => ensurePositiveInteger(0, 'ctx'),
    /ctx must be a positive integer/,
  );
});

test('ensureStringArray allows empty arrays but rejects non-string items', () => {
  assert.doesNotThrow(() => ensureStringArray([], 'ctx'));
  assert.doesNotThrow(() => ensureStringArray(['a'], 'ctx'));
  assert.throws(() => ensureStringArray('a', 'ctx'), /ctx must be an array/);
  assert.throws(
    () => ensureStringArray(['a', ''], 'ctx'),
    /ctx must contain non-empty string values/,
  );
});

test('ensureNonEmptyStringArray rejects empty arrays with indexed messages', () => {
  assert.doesNotThrow(() => ensureNonEmptyStringArray(['a'], 'ctx'));
  assert.throws(
    () => ensureNonEmptyStringArray([], 'ctx'),
    /ctx must not be empty/,
  );
  assert.throws(
    () => ensureNonEmptyStringArray(['a', ' '], 'ctx'),
    /ctx\[1\] must be a non-empty string/,
  );
});

test('ensureUniqueIds rejects duplicate and missing ids', () => {
  assert.doesNotThrow(() =>
    ensureUniqueIds([{ id: 'a' }, { id: 'b' }], 'ctx'),
  );
  assert.throws(
    () => ensureUniqueIds([{ id: 'a' }, { id: 'a' }], 'ctx'),
    /ctx contains duplicate id "a"/,
  );
  assert.throws(
    () => ensureUniqueIds([{}], 'ctx'),
    /ctx\[0\].id must be a non-empty string/,
  );
});

test('placeholder detection matches the historical token lists', () => {
  assert.ok(PLACEHOLDER_VALUES.has('tbd'));
  assert.ok(PLACEHOLDER_VALUES.has('to-be-filled'));
  assert.equal(isPlaceholderValue(' TBD '), true);
  assert.equal(isPlaceholderValue('todo: later'), true);
  assert.equal(isPlaceholderValue('owner-team'), false);
  assert.equal(normalizeIdentifier('  MixedCase '), 'mixedcase');
  assert.throws(
    () => ensureNonPlaceholderString('TBD', 'ctx'),
    /ctx must not use placeholder value "TBD"/,
  );
  assert.doesNotThrow(() => ensureNonPlaceholderString('real-value', 'ctx'));
});

test('ensureSchemaVersion produces the standard message', () => {
  assert.doesNotThrow(() =>
    ensureSchemaVersion({ actual: 1, expected: 1, label: 'profile' }),
  );
  assert.throws(
    () => ensureSchemaVersion({ actual: 2, expected: 1, label: 'profile' }),
    /Unsupported profile schemaVersion: 2\. Expected 1\./,
  );
});

test('escapeRegExp escapes regex metacharacters', () => {
  const pattern = new RegExp(escapeRegExp('a.b*c(d)'));
  assert.ok(pattern.test('a.b*c(d)'));
  assert.equal(pattern.test('aXbYc(d)'), false);
});
