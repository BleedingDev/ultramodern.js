import path from 'node:path';
import type { WorkspaceApp } from './types';

const TAILWIND_PREFIX_DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
] as const;

export function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function toPackageScope(packageName: string): string {
  const normalized = packageName
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'ultramodern-superapp';
}

export function toKebabCase(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/[._]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

export function toEnvSegment(value: string): string {
  return toKebabCase(value).replace(/-/g, '_').toUpperCase();
}

export function createRspackUniqueName(app: WorkspaceApp): string {
  return app.mfName;
}

export function createRspackChunkLoadingGlobal(app: WorkspaceApp): string {
  return `__ULTRAMODERN_${toEnvSegment(app.mfName)}_LOADED_CHUNKS__`;
}

export function packageName(scope: string, suffix: string): string {
  return `@${scope}/${suffix}`;
}

export function relativeRootFor(packageDir: string): string {
  return normalizePath(path.relative(packageDir, '.') || '.');
}

function createTailwindPrefix(raw: string): string {
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/gu, '');

  if (!normalized) {
    throw new Error(`Cannot derive a Tailwind prefix from ${raw}`);
  }

  return normalized.replace(
    /[0-9]/gu,
    digit => TAILWIND_PREFIX_DIGIT_WORDS[Number(digit)],
  );
}

export function tailwindPrefixForApp(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'shell';
  }

  return createTailwindPrefix(app.domain ?? app.id);
}

export function assertUniqueTailwindPrefixes(apps: WorkspaceApp[]) {
  const seen = new Map<string, string>();
  const entries = apps.map(app => [app.id, tailwindPrefixForApp(app)] as const);

  for (const [id, prefix] of entries) {
    const previous = seen.get(prefix);
    if (previous) {
      throw new Error(
        `Tailwind prefix ${prefix} for ${id} collides with ${previous}`,
      );
    }
    seen.set(prefix, id);
  }
}

export function createTw(prefix: string) {
  return (classList: string) =>
    classList
      .split(/\s+/u)
      .filter(Boolean)
      .map(candidate => `${prefix}:${candidate.replace(/\[&&\]:/gu, '')}`)
      .join(' ');
}

export function toPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}
