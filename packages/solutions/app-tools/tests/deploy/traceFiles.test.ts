import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBuildHostIgnore,
  traceDeployFiles,
} from '../../src/plugins/deploy/utils/traceFiles';

const ENTRY = `
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const name = process.argv[2];
try { require(process.env.PLUGIN_ROOT + '/plugin.js'); } catch {}
try { fs.readFileSync(path.join(os.homedir(), name)); } catch {}
try { fs.readFileSync(path.join(os.tmpdir(), name)); } catch {}
try { fs.readFileSync('/proc/self/' + name); } catch {}
try { fs.readdirSync('/dev/' + name); } catch {}
try { require('/etc/' + name); } catch {}
require('./local');
`;

describe('deploy file trace', () => {
  it('does not enumerate the build host for dynamic paths', async () => {
    const fixtureDir = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'deploy-trace-')),
    );
    try {
      const entry = path.join(fixtureDir, 'index.js');
      await writeFile(entry, ENTRY);
      await writeFile(path.join(fixtureDir, 'local.js'), 'module.exports = 1;');

      const { fileList } = await traceDeployFiles({
        entryFiles: [entry],
        sourceDir: fixtureDir,
      });

      const traced = [...fileList].map(file => path.resolve('/', file));
      // Symlinked ancestors of the fixture (e.g. macOS /var -> /private/var)
      // are recorded too; everything else must come from the fixture itself.
      const outside = traced.filter(
        file =>
          !file.startsWith(`${fixtureDir}${path.sep}`) &&
          !fixtureDir.startsWith(`${file}${path.sep}`),
      );
      expect(outside).toEqual([]);
      expect(traced).toContain(path.join(fixtureDir, 'local.js'));
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('ignores whole-directory globs of root, home and temp only', () => {
    const ignore = createBuildHostIgnore('/');
    const rel = (file: string) => path.relative('/', file);
    const home = os.homedir();

    expect(ignore(rel(path.join(home, '**/*')))).toBe(true);
    expect(ignore(rel(path.join(os.tmpdir(), '*')))).toBe(true);
    expect(ignore('**/*')).toBe(true);
    expect(ignore(rel(path.join(home, 'store/pkg/index.js')))).toBe(false);
    expect(ignore(rel(path.join(home, 'store/pkg/locales/**/*')))).toBe(false);
    if (process.platform !== 'win32') {
      expect(ignore('proc/self/**/*')).toBe(true);
      expect(ignore('dev/null')).toBe(true);
      expect(ignore('var/run/docker.sock')).toBe(true);
      expect(ignore('var/lib/app/index.js')).toBe(false);
    }
  });
});
