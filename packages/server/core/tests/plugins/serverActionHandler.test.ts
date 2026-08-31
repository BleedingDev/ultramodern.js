import { serverActionHandler } from '../../src/plugins/render/serverActionHandler';

describe('serverActionHandler', () => {
  it('rejects non-POST action requests before dispatching the server bundle', async () => {
    const handleAction = rstest.fn(async () => new Response('executed'));
    const options = {
      routeInfo: { entryName: 'main' },
      serverManifest: {
        renderBundles: { main: { handleAction } },
      },
    } as unknown as Parameters<typeof serverActionHandler>[1];

    const response = await serverActionHandler(
      new Request('http://localhost/', {
        headers: { 'x-rsc-action': 'mod#action' },
      }),
      options,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.text()).toBe('Method not allowed');
    expect(handleAction).not.toHaveBeenCalled();
  });
});
