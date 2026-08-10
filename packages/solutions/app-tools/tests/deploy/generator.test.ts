import path from 'node:path';
import vm from 'node:vm';
import * as deployUtils from '../../src/plugins/deploy/utils' with {
  rstest: 'importActual',
};
import { serverAppContextTemplate } from '../../src/plugins/deploy/utils/generator';

rstest.mock('../../src/plugins/deploy/utils', () => ({
  __esModule: true,
  ...deployUtils,
  normalizePath: (filePath: string) => filePath,
}));

describe('deploy generator', () => {
  it('preserves Windows separators when generated paths are evaluated', () => {
    rstest
      .spyOn(path, 'relative')
      .mockReturnValueOnce('shared')
      .mockReturnValueOnce('api')
      .mockReturnValueOnce('api\\lambda');

    const appContext = {
      appDirectory: 'C:\\project',
      sharedDirectory: 'C:\\project\\shared',
      apiDirectory: 'C:\\project\\api',
      lambdaDirectory: 'C:\\project\\api\\lambda',
      metaName: 'modern-js',
      bffRuntimeFramework: 'hono',
    } satisfies {
      appDirectory: string;
      sharedDirectory: string;
      apiDirectory: string;
      lambdaDirectory: string;
      metaName: string;
      bffRuntimeFramework: string;
    };

    const context = serverAppContextTemplate(appContext);
    const generatedModule = {
      exports: {} as Record<string, unknown>,
    };

    new vm.Script(`
      module.exports = {
        sharedDirectory: ${context.sharedDirectory},
        apiDirectory: ${context.apiDirectory},
        lambdaDirectory: ${context.lambdaDirectory},
      };
    `).runInNewContext({
      __dirname: '/generated/server',
      module: generatedModule,
      path: path.posix,
    });

    expect(generatedModule.exports).toEqual({
      sharedDirectory: '/generated/server/shared',
      apiDirectory: '/generated/server/api',
      lambdaDirectory: '/generated/server/api\\lambda',
    });
  });
});
