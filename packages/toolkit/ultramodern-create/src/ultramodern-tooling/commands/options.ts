export function readOption(args: string[], name: string) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) {
    const value = inline.slice(prefix.length);
    if (!value) {
      throw new Error(`${name} needs a value.`);
    }
    return value;
  }

  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a value.`);
  }
  return value;
}

export function hasFlag(args: string[], name: string) {
  return args.includes(name);
}
