import fs from 'node:fs/promises';
import path from 'node:path';
import { octaneProfile } from './profile';

export async function assertOctaneEntrySource(
  source: string | false | undefined,
): Promise<void> {
  if (
    source &&
    path.extname(source).toLowerCase() === '.jsx' &&
    (await fs.stat(source)).isFile()
  )
    throw new Error(
      `unsupported-renderer-capability: Octane does not support .jsx source: ${source}. Supported source extensions: ${octaneProfile.sourceExtensions.join(', ')}.`,
    );
}
