import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeReadFileSync } from '../src/cli/run/utils/createFileWatcher';

describe('safeReadFileSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-js-watcher-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads the file content when it exists', () => {
    const filePath = path.join(tmpDir, 'layout.tsx');
    fs.writeFileSync(filePath, 'hello');

    expect(safeReadFileSync(filePath)).toBe('hello');
  });

  it('returns undefined instead of throwing when the file vanished before the read (ENOENT race)', () => {
    // Simulate an editor temp file that is created and deleted faster than
    // the watch event callback can read it (the reported MF DTS crash).
    const filePath = path.join(tmpDir, 'layout.tsx.tmp.78659.e67d3a82');
    fs.writeFileSync(filePath, 'temp');
    fs.unlinkSync(filePath);

    expect(() => safeReadFileSync(filePath)).not.toThrow();
    expect(safeReadFileSync(filePath)).toBeUndefined();
  });

  it('still throws for non-ENOENT errors (e.g. reading a directory)', () => {
    expect(() => safeReadFileSync(tmpDir)).toThrow();
  });

  it('continues to work for subsequent valid reads after handling a vanished file', () => {
    const goneFile = path.join(tmpDir, 'gone.tsx.tmp.1.abc');
    fs.writeFileSync(goneFile, 'x');
    fs.unlinkSync(goneFile);
    expect(safeReadFileSync(goneFile)).toBeUndefined();

    const validFile = path.join(tmpDir, 'valid.tsx');
    fs.writeFileSync(validFile, 'world');
    expect(safeReadFileSync(validFile)).toBe('world');
  });
});
