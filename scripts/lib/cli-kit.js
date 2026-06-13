/**
 * Shared CLI parsing helpers for fork-owned scripts.
 *
 * Thin wrapper around node:util parseArgs that preserves the historical
 * script conventions: unknown options say "Unknown argument: X", and
 * individual callers decide whether bare "--" is ignored and whether a
 * missing value is rejected by parsing or left for downstream validation.
 */
const { parseArgs: nodeParseArgs } = require('node:util');

const cloneDefaults = defaults =>
  Object.fromEntries(
    Object.entries(defaults || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );

const normalizeOptions = options =>
  Object.fromEntries(
    Object.entries(options).map(([name, option]) => [
      name,
      {
        key: option.key || name,
        multiple: Boolean(option.multiple),
        requiredValue: option.requiredValue !== false,
        short: option.short,
        type: option.type || 'string',
      },
    ]),
  );

const toNodeOptions = options =>
  Object.fromEntries(
    Object.entries(options).map(([name, option]) => [
      name,
      {
        type: 'boolean',
        ...(option.short ? { short: option.short } : {}),
      },
    ]),
  );

const assignValue = ({ parsed, spec, value }) => {
  if (spec.multiple) {
    parsed[spec.key].push(value);
    return;
  }
  parsed[spec.key] = value;
};

const parseCliArgs = (
  argv,
  { defaults = {}, ignoreTerminator = false, options },
) => {
  const normalizedOptions = normalizeOptions(options);
  const parsed = cloneDefaults(defaults);
  const consumed = new Set();
  const { tokens } = nodeParseArgs({
    args: argv,
    allowPositionals: true,
    options: toNodeOptions(normalizedOptions),
    strict: false,
    tokens: true,
  });

  for (const token of tokens) {
    if (consumed.has(token.index)) {
      continue;
    }

    if (token.kind === 'option-terminator') {
      if (ignoreTerminator) {
        continue;
      }
      throw new Error('Unknown argument: --');
    }

    if (token.kind === 'positional' && ignoreTerminator && token.index > 0) {
      const previousTerminator = tokens.some(
        item => item.kind === 'option-terminator' && item.index < token.index,
      );
      if (previousTerminator && token.value.startsWith('--')) {
        const retryArgv = argv.filter((_, index) =>
          tokens.every(
            item => item.kind !== 'option-terminator' || item.index !== index,
          ),
        );
        return parseCliArgs(retryArgv, { defaults, ignoreTerminator, options });
      }
    }

    if (token.kind !== 'option') {
      throw new Error(`Unknown argument: ${token.value}`);
    }

    const spec = normalizedOptions[token.name];
    if (!spec) {
      const rawArgument = token.inlineValue
        ? `${token.rawName}=${token.value}`
        : token.rawName;
      throw new Error(`Unknown argument: ${rawArgument}`);
    }

    if (spec.type === 'boolean') {
      if (token.inlineValue) {
        throw new Error(`Unknown argument: ${token.rawName}=${token.value}`);
      }
      parsed[spec.key] = true;
      continue;
    }

    let value = token.value;
    if (!token.inlineValue) {
      const valueIndex = token.index + 1;
      value = argv[valueIndex];
      if (value === undefined) {
        if (spec.requiredValue) {
          throw new Error(`${token.rawName} requires a value`);
        }
        value = undefined;
      } else if (value === '' && spec.requiredValue) {
        throw new Error(`${token.rawName} requires a value`);
      } else {
        consumed.add(valueIndex);
      }
    }

    assignValue({
      parsed,
      spec,
      value,
    });
  }

  return parsed;
};

module.exports = {
  parseCliArgs,
};
