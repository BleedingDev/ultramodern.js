import {
  createHandleAction,
  type RscActionRuntime,
} from '../../src/server/rsc/handle-action';

const encodeToStream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const createRuntime = (overrides: Partial<RscActionRuntime> = {}) => {
  const calls = {
    decodeReply: [] as Array<string | FormData>,
    loadServerAction: [] as string[],
    renderRsc: [] as unknown[],
  };

  const runtime: RscActionRuntime = {
    decodeReply: async body => {
      calls.decodeReply.push(body);
      return ['decoded-arg'];
    },
    loadServerAction: actionId => {
      calls.loadServerAction.push(actionId);
      return (...args: unknown[]) => `result:${args.join(',')}`;
    },
    renderRsc: options => {
      calls.renderRsc.push(options.element);
      return encodeToStream(String(options.element));
    },
    ...overrides,
  };

  return { runtime, calls };
};

describe('createHandleAction', () => {
  let errorSpy: ReturnType<typeof rstest.spyOn>;

  beforeEach(() => {
    errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns 404 when the x-rsc-action header is missing', async () => {
    const { runtime, calls } = createRuntime();
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(new Request('http://localhost/rsc-action'));

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Cannot find server reference');
    expect(calls.loadServerAction).toEqual([]);
  });

  it('returns 400 when the server reference does not resolve to a function', async () => {
    const { runtime, calls } = createRuntime({
      loadServerAction: () => undefined,
    });
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'missing#action' },
        body: '[]',
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid action');
    expect(calls.decodeReply).toEqual([]);
  });

  it('loads the action from the x-rsc-action header and decodes a text body', async () => {
    const { runtime, calls } = createRuntime();
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'mod#myAction' },
        body: '["raw"]',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/x-component');
    expect(calls.loadServerAction).toEqual(['mod#myAction']);
    expect(calls.decodeReply).toEqual(['["raw"]']);
    // The action result is rendered as the flight stream body.
    expect(await res.text()).toBe('result:decoded-arg');
  });

  it('decodes multipart bodies as FormData', async () => {
    const { runtime, calls } = createRuntime();
    const handleAction = createHandleAction(runtime);

    const formData = new FormData();
    formData.append('0', 'value');

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'mod#myAction' },
        body: formData,
      }),
    );

    expect(res.status).toBe(200);
    expect(calls.decodeReply).toHaveLength(1);
    expect(calls.decodeReply[0]).toBeInstanceOf(FormData);
  });

  it('awaits async actions before rendering the result', async () => {
    const { runtime } = createRuntime({
      loadServerAction: () => async (arg: unknown) => `async:${arg}`,
    });
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'mod#asyncAction' },
        body: '[]',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('async:decoded-arg');
  });

  it('returns 400 when decoding the request arguments fails', async () => {
    const { runtime } = createRuntime({
      decodeReply: async () => {
        throw new Error('bad payload');
      },
    });
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'mod#myAction' },
        body: 'not-decodable',
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Failed to decode request arguments');
  });

  it('returns 500 when the action itself throws', async () => {
    const { runtime } = createRuntime({
      loadServerAction: () => () => {
        throw new Error('action exploded');
      },
    });
    const handleAction = createHandleAction(runtime);

    const res = await handleAction(
      new Request('http://localhost/rsc-action', {
        method: 'POST',
        headers: { 'x-rsc-action': 'mod#myAction' },
        body: '[]',
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal server error');
  });
});
