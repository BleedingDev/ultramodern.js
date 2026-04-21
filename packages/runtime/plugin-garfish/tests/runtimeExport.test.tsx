import React from 'react';
import { garfishPlugin } from '../src/cli';

global.React = React;

const addExportList: any[] = [];
rstest.mock('@modern-js/utils', () => {
  const originalModule = rstest.requireActual('@modern-js/utils');
  return {
    __esModule: true,
    ...originalModule,
    createRuntimeExportsUtils: () => ({
      addExport: (val: any) => {
        addExportList.push(val);
      },
      getPath: () => 'test',
    }),
  };
});

describe('plugin-garfish', () => {
  test('cli addRuntimeExports', async () => {
    const resolveConfig: any = {};
    const mfPackagePath = '@modern-js/test/plugin-garfish';
    const plugin = garfishPlugin({
      mfPackagePath,
    });

    const lifecycle = await plugin.setup!({
      useResolvedConfigContext: () => resolveConfig,
      useConfigContext: () => resolveConfig,
      useAppContext: () => ({
        internalDirectory: 'dist/.rstest-temp/test',
      }),
    } as any);

    lifecycle?.config!();
    lifecycle?.addRuntimeExports!();
    expect(addExportList).toMatchSnapshot();
  });

  test('cli modifyEntryExport injects runtime metadata contract', async () => {
    const resolveConfig: any = {
      deploy: {
        microFrontend: {
          runtimeDigest: 'runtime-v1-digest',
          integrity: 'sha256-runtimeIntegrityDigest==',
          attestation: 'attestation-token-v1',
        },
      },
    };
    const plugin = garfishPlugin();

    const lifecycle = await plugin.setup!({
      useResolvedConfigContext: () => resolveConfig,
      useConfigContext: () => resolveConfig,
      useAppContext: () => ({
        internalDirectory: 'dist/.rstest-temp/test',
      }),
    } as any);

    const res = lifecycle?.modifyEntryExport?.({
      entrypoint: 'main',
      exportStatement: '',
    } as any);

    expect(res?.exportStatement).toContain(
      '__GARFISH_EXPORTS__.runtimeMetadata = runtimeMetadata;',
    );
    expect(res?.exportStatement).toContain(
      '__GARFISH_EXPORTS__.runtimeDigest = runtimeMetadata.runtimeDigest;',
    );
    expect(res?.exportStatement).toContain(
      'process.env.MODERN_MF_REMOTE_ENTRY_INTEGRITY',
    );
    expect(res?.exportStatement).toContain(
      'process.env.MODERN_MF_REMOTE_ENTRY_ATTESTATION',
    );
  });
});
