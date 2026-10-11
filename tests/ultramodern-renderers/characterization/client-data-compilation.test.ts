import type { Rspack } from '@rsbuild/core';
import loader from '../../../packages/cli/plugin-data-loader/src/cli/loader';

function compilerContext(target: string | string[]) {
  const reads: string[] = [];
  const dependencies: string[] = [];
  const context = {
    _compiler: { options: { target } },
    resourcePath: '/app/routes/page.data.ts',
    resourceQuery:
      '?loaderId=item&routeId=item&inline=true&action=true&clientData=true',
    cacheable() {},
    addDependency(path: string) {
      dependencies.push(path);
    },
    fs: {
      readFile(path: string, callback: (error: null, content: Buffer) => void) {
        reads.push(path);
        callback(null, Buffer.from('export const loader = () => "browser";'));
      },
    },
  };
  return {
    context: context as unknown as Rspack.LoaderContext<any>,
    reads,
    dependencies,
  };
}

test.each(['node', 'async-node', 'webworker', ['webworker', 'es2024']])(
  'keeps .data server exports on target %s without reading clientData',
  async target => {
    const fixture = compilerContext(target);
    const serverSource = 'export const loader = () => process.env.SECRET;';
    expect(await loader.call(fixture.context, serverSource)).toBe(serverSource);
    expect(fixture.reads).toEqual([]);
    expect(fixture.dependencies).toEqual([]);
  },
);

test('uses the browser .data.client module and registers its HMR dependency', async () => {
  const fixture = compilerContext('web');
  const result = await loader.call(
    fixture.context,
    'export const loader = () => process.env.SECRET;',
  );
  expect(String(result)).toBe('export const loader = () => "browser";');
  expect(fixture.reads).toEqual(['/app/routes/page.data.client.ts']);
  expect(fixture.dependencies).toEqual(['/app/routes/page.data.client.ts']);
});

test('browser server-only .data emits loader/action request proxies without its original source', async () => {
  const fixture = compilerContext('web');
  fixture.context.resourceQuery =
    '?loaderId=item&routeId=item&inline=true&action=true';
  const result = await loader.call(
    fixture.context,
    'export const loader = () => process.env.SECRET;',
  );
  expect(String(result)).toContain("loader = createRequest('item')");
  expect(String(result)).toContain("action = createActionRequest('item')");
  expect(String(result)).not.toContain('process.env.SECRET');
  expect(fixture.reads).toEqual([]);
});
