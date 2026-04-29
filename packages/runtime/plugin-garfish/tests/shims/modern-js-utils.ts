import fs from 'fs';
import path from 'path';

export function createDebugger() {
  return () => {};
}

export function createRuntimeExportsUtils(
  internalDirectory: string,
  filename: string,
) {
  const filepath = path.resolve(internalDirectory, `${filename}.ts`);
  const exportsSet = new Set<string>();

  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, 'export {};\n');
  }

  return {
    addExport(exportStatement: string) {
      const normalized = exportStatement?.trim();
      if (!normalized) {
        return;
      }
      exportsSet.add(normalized);
      fs.writeFileSync(filepath, `${Array.from(exportsSet).join('\n')}\n`);
    },
    getPath() {
      return filepath.split(path.sep).join('/');
    },
  };
}
