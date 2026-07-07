import fs from 'node:fs';

export function readJsonObject(filePath: string): Record<string, any> {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `UltraModern config must contain a JSON object: ${filePath}`,
    );
  }
  return value;
}

export function readOptionalJsonObject(filePath: string): Record<string, any> {
  return fs.existsSync(filePath) ? readJsonObject(filePath) : {};
}
