export function replaceYamlLine(
  source: string,
  pattern: RegExp,
  replacement: string,
) {
  const updated = source.replace(pattern, replacement);
  return {
    source: updated,
    changed: updated !== source,
  };
}

export function ensureYamlListItem(source: string, key: string, item: string) {
  const itemLine = `  - '${item}'`;
  const headerPattern = new RegExp(`^${key}:\\n(?:(?:  - .+\\n)*)`, 'mu');
  const header = source.match(headerPattern);
  if (header) {
    if (header[0].split('\n').includes(itemLine)) {
      return { source, changed: false };
    }

    return {
      source: source.replace(headerPattern, `${header[0]}${itemLine}\n`),
      changed: true,
    };
  }

  const block = `${key}:\n${itemLine}\n`;
  const afterTrustPolicyIgnore = source.replace(
    /^(trustPolicyIgnoreAfter: .+\n)/mu,
    `$1${block}`,
  );
  if (afterTrustPolicyIgnore !== source) {
    return { source: afterTrustPolicyIgnore, changed: true };
  }

  return {
    source: `${source.trimEnd()}\n${block}`,
    changed: true,
  };
}

function yamlEntryPattern(entryKey: string, scalar = false): RegExp {
  const bareKey = entryKey.replace(/^['"]|['"]$/gu, '');
  if (scalar) {
    const esc = bareKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`^ {2}(?:'${esc}'|"${esc}"|${esc}): .+$`, 'gmu');
  }

  const packageName = bareKey.includes('@')
    ? bareKey.slice(0, bareKey.lastIndexOf('@'))
    : bareKey;
  const esc = packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `^ {2}(?:'${esc}@[^']+'|"${esc}@[^"]+"|${esc}@[^:'"\\s]+): .+$`,
    'gmu',
  );
}

function upsertYamlEntry(
  source: string,
  key: string,
  entryLine: string,
  pattern: RegExp,
) {
  const linePattern = new RegExp(pattern.source, 'u');
  const lines = source.split('\n');
  let seen = false;
  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    if (linePattern.test(line)) {
      if (seen) {
        // Drop duplicate matching entries; the first match is canonical.
        changed = true;
        continue;
      }
      seen = true;
      if (line !== entryLine) {
        changed = true;
      }
      out.push(entryLine);
    } else {
      out.push(line);
    }
  }

  if (seen) {
    return { source: out.join('\n'), changed };
  }

  const headerPattern = new RegExp(`^${key}:\\n(?:(?:  .+\\n)*)`, 'mu');
  const header = source.match(headerPattern);
  if (header) {
    if (header[0].split('\n').includes(entryLine)) {
      return { source, changed: false };
    }

    return {
      source: source.replace(headerPattern, `${header[0]}${entryLine}\n`),
      changed: true,
    };
  }

  return {
    source: `${source.trimEnd()}\n${key}:\n${entryLine}\n`,
    changed: true,
  };
}

export function ensureYamlMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  return upsertYamlEntry(
    source,
    key,
    `  '${entryKey}': ${value}`,
    yamlEntryPattern(entryKey),
  );
}

export function ensureYamlScalarMapEntry(
  source: string,
  key: string,
  entryKey: string,
  value: string,
) {
  return upsertYamlEntry(
    source,
    key,
    `  ${entryKey}: ${value}`,
    yamlEntryPattern(entryKey, true),
  );
}

export function removeYamlMapEntry(source: string, entryKey: string) {
  const linePattern = new RegExp(yamlEntryPattern(entryKey).source, 'u');
  const lines = source.split('\n');
  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    if (linePattern.test(line)) {
      changed = true;
      continue;
    }
    out.push(line);
  }

  return changed ? { source: out.join('\n'), changed } : { source, changed };
}
