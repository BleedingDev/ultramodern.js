// Behavioral coverage for the headless routes-generate entry point: the
// export-shape test in cli.test.ts would pass even if the body were
// reverted, so this file pins the actual prepare-only drive contract —
// createRunOptions against the app dir, cli.init with build-command
// semantics, the MODERN_ARGV gate that makes analyze.onPrepare fire
// generateEntryCode, and the absolute config-file resolution that keeps
// headless runs (cwd != appDirectory) from feeding `false` into node's
// path APIs.
const createRunOptionsMock = rstest.fn(async (options: unknown) => ({
  mockRunOptions: true,
  received: options,
}));
const cliInitMock = rstest.fn(async (options: unknown) => ({
  appContext: {},
  received: options,
}));

rstest.mock('@modern-js/app-tools/cli/run', () => ({
  createRunOptions: createRunOptionsMock,
}));
rstest.mock('@modern-js/plugin/cli', () => ({
  cli: { init: cliInitMock },
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INTERNAL_RUNTIME_PLUGINS } from '@modern-js/utils';
import { generateTanstackRouteArtifacts } from '../../src/cli';

function makeAppDir(withConfig: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstack-routes-gen-'));
  if (withConfig) {
    fs.writeFileSync(
      path.join(dir, 'modern.config.ts'),
      'export default {};\n',
      'utf-8',
    );
  }
  return dir;
}

describe('generateTanstackRouteArtifacts (headless routes-generate)', () => {
  beforeEach(() => {
    createRunOptionsMock.mockClear();
    cliInitMock.mockClear();
  });

  it('drives a prepare-only cli.init with build-command semantics', async () => {
    const previousArgv = process.env.MODERN_ARGV;
    const appDirectory = makeAppDir(true);

    try {
      await generateTanstackRouteArtifacts({
        appDirectory,
        version: '9.9.9-test',
      });

      expect(createRunOptionsMock).toHaveBeenCalledTimes(1);
      const runOptionsArg = createRunOptionsMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(runOptionsArg.cwd).toBe(appDirectory);
      expect(runOptionsArg.version).toBe('9.9.9-test');
      expect(runOptionsArg.internalPlugins).toBe(INTERNAL_RUNTIME_PLUGINS);

      // The config file is resolved to an absolute base path against the app
      // directory (not process.cwd()). Without this, a headless run from a
      // different cwd finds no config, `findExists` returns `false`, and that
      // boolean reaches `path.isAbsolute` deep inside plugin/cli.
      expect(runOptionsArg.configFile).toBe(
        path.resolve(appDirectory, 'modern.config'),
      );

      expect(cliInitMock).toHaveBeenCalledTimes(1);
      const initArg = cliInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(initArg.command).toBe('build');
      expect(initArg.mockRunOptions).toBe(true);

      // checkIsBuildCommands() resolves the command from MODERN_ARGV — this
      // is what lets analyze.onPrepare fire generateEntryCode headlessly.
      expect(process.env.MODERN_ARGV).toBe('node modern build');
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
      if (previousArgv === undefined) {
        delete process.env.MODERN_ARGV;
      } else {
        process.env.MODERN_ARGV = previousArgv;
      }
    }
  });

  it('throws a clear error (never a boolean path crash) when no config file exists', async () => {
    const appDirectory = makeAppDir(false);

    try {
      await expect(
        generateTanstackRouteArtifacts({ appDirectory }),
      ).rejects.toThrow(/Unable to locate a Modern\.js config file/u);
      expect(createRunOptionsMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });
});
