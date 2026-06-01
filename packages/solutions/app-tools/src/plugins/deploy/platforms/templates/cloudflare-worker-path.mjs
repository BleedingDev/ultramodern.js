const trimSlashes = value => String(value).replace(/^\/+|\/+$/gu, '');
const normalizeSeparators = value => String(value).replace(/\\+/gu, '/');

export const sep = '/';
export const delimiter = ':';

export function isAbsolute(filePath) {
  return normalizeSeparators(filePath).startsWith('/');
}

export function normalize(filePath) {
  const normalized = normalizeSeparators(filePath);
  const absolute = isAbsolute(normalized);
  const parts = [];

  for (const part of normalized.split('/')) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }

    parts.push(part);
  }

  const joined = parts.join('/');

  if (absolute) {
    return joined ? `/${joined}` : '/';
  }

  return joined || '.';
}

export function join(...segments) {
  const joined = segments
    .map(normalizeSeparators)
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? segment : trimSlashes(segment)))
    .filter(Boolean)
    .join('/');

  return joined ? normalize(joined) : '.';
}

export function resolve(...segments) {
  const joined = join(...segments);

  return joined.startsWith('/') ? joined : `/${joined}`;
}

export function dirname(filePath) {
  const normalized = normalizeSeparators(filePath).replace(/\/+$/u, '');
  const index = normalized.lastIndexOf('/');

  if (index <= 0) {
    return '/';
  }

  return normalized.slice(0, index);
}

export function basename(filePath, suffix = '') {
  const normalized = normalizeSeparators(filePath).replace(/\/+$/u, '');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);

  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

export function extname(filePath) {
  const base = basename(filePath);
  const index = base.lastIndexOf('.');

  if (index <= 0) {
    return '';
  }

  return base.slice(index);
}

export default {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
};
