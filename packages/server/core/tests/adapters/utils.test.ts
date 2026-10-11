import { isResFinalized } from '../../src/adapters/node/helper';
import { httpCallBack2HonoMid } from '../../src/adapters/node/hono';

type FakeResponse = Record<string, unknown>;

const createLiveResponse = (overrides: FakeResponse = {}): any => ({
  headersSent: false,
  writableEnded: false,
  finished: false,
  destroyed: false,
  closed: false,
  socket: { writable: true },
  ...overrides,
});

describe('isResFinalized', () => {
  it.each([
    ['live HTTP/1 response', createLiveResponse(), false],
    ['socket not assigned', createLiveResponse({ socket: undefined }), false],
    [
      'detached destroyed response',
      createLiveResponse({ destroyed: true, socket: null }),
      true,
    ],
    [
      'unwritable socket',
      createLiveResponse({ socket: { writable: false } }),
      true,
    ],
    ['sent headers', createLiveResponse({ headersSent: true }), true],
    ['piped body', createLiveResponse({ _modernBodyPiped: true }), true],
    ['ended body', createLiveResponse({ writableEnded: true }), true],
    ['finished response', createLiveResponse({ finished: true }), true],
    [
      'destroyed HTTP/2 stream without a socket',
      {
        headersSent: false,
        writableEnded: false,
        finished: false,
        socket: undefined,
        stream: { destroyed: true, closed: true },
      },
      true,
    ],
  ])(
    'classifies a %s response by lifecycle state',
    (_, response, finalized) => {
      expect(isResFinalized(response as any)).toBe(finalized);
    },
  );
});

const createContext = (res: any) => ({
  env: { node: { req: {} as any, res } },
  req: {} as any,
  res: undefined as any,
  finalized: false,
  get: () => undefined,
});

describe('httpCallBack2HonoMid finalization gate', () => {
  it('should mark the context finalized when the handler destroyed the response', async () => {
    const res = createLiveResponse();
    const context = createContext(res);
    const next = rstest.fn(async () => {});

    const mid = httpCallBack2HonoMid((_req, response: any) => {
      response.destroyed = true;
      response.socket = null;
    });

    await mid(context as any, next as any);

    expect(context.finalized).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('should continue to the next middleware when the response is still live', async () => {
    const res = createLiveResponse();
    const context = createContext(res);
    const next = rstest.fn(async () => {});

    const mid = httpCallBack2HonoMid(() => {});

    await mid(context as any, next as any);

    expect(context.finalized).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should continue to the next middleware when the response has no socket yet', async () => {
    const res = createLiveResponse({ socket: undefined });
    const context = createContext(res);
    const next = rstest.fn(async () => {});

    const mid = httpCallBack2HonoMid(() => {});

    await mid(context as any, next as any);

    expect(context.finalized).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
