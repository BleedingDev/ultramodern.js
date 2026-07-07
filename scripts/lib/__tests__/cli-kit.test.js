const assert = require('node:assert/strict');
const test = require('node:test');

const { parseCliArgs, rejectInlineOptionValues } = require('../cli-kit');

const parseSample = (argv, overrides = {}) =>
  parseCliArgs(argv, {
    defaults: {
      allowEmpty: false,
      entries: [],
      optional: 'default',
      required: undefined,
    },
    options: {
      'allow-empty': {
        key: 'allowEmpty',
        type: 'boolean',
      },
      entry: {
        key: 'entries',
        multiple: true,
        requiredValue: false,
      },
      optional: {
        requiredValue: false,
      },
      required: {},
    },
    ...overrides,
  });

test('parseCliArgs preserves booleans, repeated values, and inline values', () => {
  assert.deepEqual(
    parseSample([
      '--allow-empty',
      '--entry',
      'first',
      '--entry=second',
      '--optional',
      'value',
    ]),
    {
      allowEmpty: true,
      entries: ['first', 'second'],
      optional: 'value',
      required: undefined,
    },
  );
});

test('parseCliArgs can leave missing values for downstream validators', () => {
  assert.deepEqual(parseSample(['--optional']), {
    allowEmpty: false,
    entries: [],
    optional: undefined,
    required: undefined,
  });
});

test('parseCliArgs preserves explicit empty values for optional value options', () => {
  assert.deepEqual(parseSample(['--optional', '', '--entry', '']), {
    allowEmpty: false,
    entries: [''],
    optional: '',
    required: undefined,
  });
});

test('parseCliArgs rejects inline values on boolean options as unknown arguments', () => {
  assert.throws(
    () => parseSample(['--allow-empty=false']),
    /^Error: Unknown argument: --allow-empty=false$/,
  );
});

test('parseCliArgs rejects missing required values with historical wording', () => {
  assert.throws(
    () => parseSample(['--required']),
    /^Error: --required requires a value$/,
  );
});

test('parseCliArgs preserves unknown argument wording', () => {
  assert.throws(() => parseSample(['--bad']), /^Error: Unknown argument: --bad$/);
  assert.throws(
    () => parseSample(['--bad=value']),
    /^Error: Unknown argument: --bad=value$/,
  );
});

test('parseCliArgs keeps bare terminator behavior explicit per caller', () => {
  assert.throws(() => parseSample(['--']), /^Error: Unknown argument: --$/);
  assert.deepEqual(parseSample(['--', '--optional', 'value'], {
    ignoreTerminator: true,
  }), {
    allowEmpty: false,
    entries: [],
    optional: 'value',
    required: undefined,
  });
});

test('rejectInlineOptionValues rejects selected inline value options', () => {
  assert.throws(
    () => rejectInlineOptionValues(['--out=file.json'], ['--out']),
    /^Error: Unknown argument: --out=file\.json$/,
  );
  assert.doesNotThrow(() =>
    rejectInlineOptionValues(['--other=file.json'], ['--out']),
  );
});
