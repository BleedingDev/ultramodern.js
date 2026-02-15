const parseNodeVersion = () => {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return { major, minor };
};

export function isVersionAtLeast1819(): boolean {
  const { major, minor } = parseNodeVersion();
  return major > 18 || (major === 18 && minor >= 19);
}

export function isVersionAtLeast18(): boolean {
  const { major } = parseNodeVersion();
  return major >= 18;
}

export function isVersionAtLeast22(): boolean {
  const { major } = parseNodeVersion();
  return major >= 22;
}

export function isVersionAtLeast20(): boolean {
  const { major } = parseNodeVersion();
  return major >= 20;
}
