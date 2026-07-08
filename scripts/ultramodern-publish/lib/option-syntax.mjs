function rejectInlineOptionSyntax(
  argv,
  { valueOptions, booleanOptions = new Set() },
) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (/^--[^=]+=/.test(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (value) {
        index += 1;
      }
      continue;
    }
    if (booleanOptions.has(arg)) {
      continue;
    }
    return;
  }
}

export { rejectInlineOptionSyntax };
