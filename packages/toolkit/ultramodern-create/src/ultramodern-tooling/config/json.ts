import fs from 'node:fs';
import type { WorkspaceSourceReadObserver } from '../../ultramodern-workspace/publication-inputs';

export function readJsonObject(
  filePath: string,
  observeInput?: WorkspaceSourceReadObserver,
): Record<string, any> {
  const source = fs.readFileSync(filePath, 'utf-8');
  observeInput?.(filePath, 'content', true);
  const value = JSON.parse(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `UltraModern config must contain a JSON object: ${filePath}`,
    );
  }
  return value;
}

export function readOptionalJsonObject(
  filePath: string,
  observeInput?: WorkspaceSourceReadObserver,
): Record<string, any> {
  const existed = fs.existsSync(filePath);
  observeInput?.(filePath, 'entry-kind', existed);
  return existed ? readJsonObject(filePath, observeInput) : {};
}
