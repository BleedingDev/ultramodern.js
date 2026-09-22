import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deriveOperationVersion } from './operationIdentity';

/** Resolve the owning package once. Never borrow an ancestor's version when
 * the producer has an absent or invalid version of its own. */
export function resolveOperationProducer(options: {
  directories: Array<string | undefined>;
  requestId?: string;
  onDependency?: (filename: string) => void;
}) {
  for (const directory of options.directories) {
    if (!directory) continue;
    let current = path.resolve(directory);
    while (true) {
      const filename = path.join(current, 'package.json');
      if (existsSync(filename)) {
        options.onDependency?.(filename);
        let metadata: { name?: unknown; version?: unknown } = {};
        try {
          metadata = JSON.parse(readFileSync(filename, 'utf8')) ?? {};
        } catch {}
        return {
          requestId:
            options.requestId?.trim() ||
            (typeof metadata.name === 'string' && metadata.name.trim()) ||
            'default',
          operationVersion: deriveOperationVersion(metadata.version),
        };
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return {
    requestId: options.requestId?.trim() || 'default',
    operationVersion: deriveOperationVersion(),
  };
}
