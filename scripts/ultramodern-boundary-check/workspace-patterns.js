// This bare-checkout guard reads our repository's workspace manifest. Its
// bounded YAML grammar supports indented block mappings/sequences, single-line
// quoted strings (JSON escapes for double quotes), plain scalars and comments.
// Validate the whole document before using packages; unsupported YAML features
// never fall back to guessed patterns or an installed/network parser.
const parseWorkspacePatterns = source => {
  const trimSpaces = text => text.replace(/^ +| +$/g, '');
  const fail = line => {
    throw new Error(
      `Unsupported or ambiguous measured workspace YAML at line ${line}. Use block mappings/sequences and single-line scalar values; aliases, anchors, tags, flow collections, directives and document markers are unsupported.`,
    );
  };
  const lines = [];
  for (const [index, original] of source
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = index + 1;
    if (
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\uD800-\uDFFF\uFEFF\uFFFE\uFFFF]/u.test(
        original,
      )
    )
      fail(line);
    let quote = null;
    let end = original.length;
    for (let cursor = 0; cursor < original.length; cursor += 1) {
      const char = original[cursor];
      if (quote === '"' && char === '\\') {
        cursor += 1;
      } else if (char === quote) {
        if (quote === "'" && original[cursor + 1] === "'") cursor += 1;
        else quote = null;
      } else if (!quote && (char === "'" || char === '"')) {
        quote = char;
      } else if (
        !quote &&
        char === '#' &&
        (cursor === 0 || original[cursor - 1] === ' ')
      ) {
        end = cursor;
        break;
      }
    }
    if (quote) fail(line);
    const text = original.slice(0, end).replace(/ +$/, '');
    if (!text) continue;
    const indent = text.match(/^ */)[0].length;
    lines.push({ indent, text: text.slice(indent), line });
  }
  const scalar = (text, line) => {
    if (text.startsWith('"')) {
      try {
        const value = JSON.parse(text);
        if (typeof value === 'string') return value;
      } catch {
        fail(line);
      }
      fail(line);
    }
    if (text.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(text)) fail(line);
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (
      !text ||
      /^-(?: |$)/.test(text) ||
      /^(?:---|\.\.\.)(?: |$)/.test(text) ||
      /^[!&*%@`[{\]}|>?]/.test(text) ||
      /['"[\]{},]/.test(text) ||
      /:\s|:$/.test(text) ||
      /^(?:---|\.\.\.|<<)$/.test(text)
    )
      fail(line);
    if (/^(?:null|Null|NULL|~)$/.test(text)) return null;
    if (/^(?:true|True|TRUE)$/.test(text)) return true;
    if (/^(?:false|False|FALSE)$/.test(text)) return false;
    if (/^[+-]?0(?:o[0-7]+|x[\da-fA-F]+)$/.test(text))
      return (
        (text.startsWith('-') ? -1 : 1) * Number(text.replace(/^[+-]/, ''))
      );
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
      return Number(text);
    if (/^[+-]?\.(?:inf|Inf|INF)$/.test(text))
      return text.startsWith('-') ? -Infinity : Infinity;
    if (/^\.(?:nan|NaN|NAN)$/.test(text)) return NaN;
    return text;
  };
  const mappingColon = text => {
    let quote = null;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote === '"' && char === '\\') index += 1;
      else if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = null;
      } else if (!quote && (char === '"' || char === "'")) quote = char;
      else if (
        !quote &&
        char === ':' &&
        (index === text.length - 1 || text[index + 1] === ' ')
      )
        return index;
    }
    return -1;
  };
  const sequenceItem = text => text === '-' || text.startsWith('- ');
  const block = start => {
    const indent = lines[start].indent;
    const sequence = sequenceItem(lines[start].text);
    const value = sequence ? [] : Object.create(null);
    let cursor = start;
    while (cursor < lines.length && lines[cursor].indent >= indent) {
      const { text, line, indent: currentIndent } = lines[cursor];
      if (currentIndent !== indent || sequenceItem(text) !== sequence)
        fail(line);
      let key;
      let rest;
      if (sequence) rest = trimSpaces(text.slice(1));
      else {
        const colon = mappingColon(text);
        if (colon < 1) fail(line);
        key = String(scalar(trimSpaces(text.slice(0, colon)), line));
        if (Object.hasOwn(value, key)) fail(line);
        rest = trimSpaces(text.slice(colon + 1));
      }
      cursor += 1;
      let item;
      if (rest) {
        item = scalar(rest, line);
        if (cursor < lines.length && lines[cursor].indent > indent)
          fail(lines[cursor].line);
      } else if (cursor < lines.length && lines[cursor].indent > indent) {
        const child = block(cursor);
        item = child.value;
        cursor = child.cursor;
      } else item = null;
      if (sequence) value.push(item);
      else value[key] = item;
    }
    return { value, cursor };
  };
  if (!lines.length || lines[0].indent !== 0) fail(lines[0]?.line ?? 1);
  const { value, cursor } = block(0);
  if (cursor !== lines.length) fail(lines[cursor].line);
  const patterns = value.packages;
  if (
    Array.isArray(value) ||
    !Array.isArray(patterns) ||
    patterns.length === 0 ||
    patterns.some(pattern => typeof pattern !== 'string' || !pattern)
  ) {
    throw new Error(
      'Import ownership requires one top-level nonempty measured workspace packages string sequence.',
    );
  }
  return patterns;
};

module.exports = { parseWorkspacePatterns };
