import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.join(__dirname, '../src');
const CAST_RATCHET_BASELINE = 40;
const CAST_PATTERN = /\bas\s+unknown\s+as\b|\bas\s+any\b/g;
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx)$/u;

type CastLocation = {
  cast: string;
  columnNumber: number;
  filePath: string;
  lineNumber: number;
  sourceLine: string;
};

const collectSourceFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return entries.flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }

    return SOURCE_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
  });
};

const collectCastLocations = (): CastLocation[] =>
  collectSourceFiles(SRC_DIR).flatMap(filePath => {
    const relativeFilePath = path
      .relative(SRC_DIR, filePath)
      .split(path.sep)
      .join('/');
    const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/u);
    const locations: CastLocation[] = [];

    lines.forEach((sourceLine, index) => {
      CAST_PATTERN.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = CAST_PATTERN.exec(sourceLine))) {
        locations.push({
          cast: match[0],
          columnNumber: match.index + 1,
          filePath: relativeFilePath,
          lineNumber: index + 1,
          sourceLine: sourceLine.trim(),
        });
      }
    });

    return locations;
  });

const formatCastLocations = (locations: CastLocation[]): string =>
  locations
    .map(
      location =>
        `  ${location.filePath}:${location.lineNumber}:${location.columnNumber} ${location.cast} :: ${location.sourceLine}`,
    )
    .join('\n');

describe('tanstack unsafe cast ratchet', () => {
  test('does not add new as-any casts in src', () => {
    const castLocations = collectCastLocations();

    if (castLocations.length > CAST_RATCHET_BASELINE) {
      throw new Error(
        [
          `Expected at most ${CAST_RATCHET_BASELINE} unsafe casts in plugin-tanstack src, found ${castLocations.length}.`,
          'Remove the new cast or lower the ratchet baseline after deleting existing casts.',
          'Current cast locations:',
          formatCastLocations(castLocations),
        ].join('\n'),
      );
    }

    expect(castLocations.length).toBeLessThanOrEqual(CAST_RATCHET_BASELINE);
  });
});
