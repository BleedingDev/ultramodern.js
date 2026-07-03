// Behavioral coverage for the headless routes-generate entry point: the
// export-shape test in cli.test.ts would pass even if the body were
// reverted, so this file pins the actual prepare-only drive contract —
// createRunOptions against the app dir, cli.init with build-command
// semantics, and the MODERN_ARGV gate that makes analyze.onPrepare fire
// generateEntryCode.
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

import { INTERNAL_RUNTIME_PLUGINS } from '@modern-js/utils';
import { generateTanstackRouteArtifacts } from '../../src/cli';

describe('generateTanstackRouteArtifacts (headless routes-generate)', () => {
  it('drives a prepare-only cli.init with build-command semantics', async () => {
    const previousArgv = process.env.MODERN_ARGV;

    try {
      await generateTanstackRouteArtifacts({
        appDirectory: '/workspace/apps/shell',
        version: '9.9.9-test',
      });

      expect(createRunOptionsMock).toHaveBeenCalledTimes(1);
      const runOptionsArg = createRunOptionsMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(runOptionsArg.cwd).toBe('/workspace/apps/shell');
      expect(runOptionsArg.version).toBe('9.9.9-test');
      expect(runOptionsArg.internalPlugins).toBe(INTERNAL_RUNTIME_PLUGINS);

      expect(cliInitMock).toHaveBeenCalledTimes(1);
      const initArg = cliInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(initArg.command).toBe('build');
      expect(initArg.mockRunOptions).toBe(true);

      // checkIsBuildCommands() resolves the command from MODERN_ARGV — this
      // is what lets analyze.onPrepare fire generateEntryCode headlessly.
      expect(process.env.MODERN_ARGV).toBe('node modern build');
    } finally {
      if (previousArgv === undefined) {
        delete process.env.MODERN_ARGV;
      } else {
        process.env.MODERN_ARGV = previousArgv;
      }
    }
  });
});
