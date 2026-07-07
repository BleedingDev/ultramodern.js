import { renderFileTemplate } from '../fs-io';

export function createSharedModuleFederationConfig(): string {
  return renderFileTemplate(
    'workspace/apps/modern.config.shared-module-federation.ts',
    {},
  );
}

export function formatTsObjectLiteral(value: Record<string, string>): string {
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length === 0) {
    return '{}';
  }

  return `{
${entries.map(([key, entryValue]) => `    '${key}': '${entryValue}',`).join('\n')}
  }`;
}
