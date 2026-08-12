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
  it('should not finalize a plain live response with a writable socket', () => {
    expect(isResFinalized(createLiveResponse())).toBe(false);
  });

  it('should not finalize a live response whose socket is not yet assigned', () => {
    expect(isResFinalized(createLiveResponse({ socket: undefined }))).toBe(
      false,
    );
    expect(isResFinalized(createLiveResponse({ socket: null }))).toBe(false);
  });

  it('should not finalize a response object that never exposes a socket', () => {
    // worker / webworker style mocks: no `socket` key at all
    expect(isResFinalized({ headersSent: false } as any)).toBe(false);
  });

  it('should finalize a destroyed response whose socket was detached', () => {
    expect(
      isResFinalized(createLiveResponse({ destroyed: true, socket: null })),
    ).toBe(true);
  });

  it('should finalize a closed response whose socket was detached', () => {
    expect(
      isResFinalized(createLiveResponse({ closed: true, socket: undefined })),
    ).toBe(true);
  });

  it('should finalize an HTTP/2 compat response whose stream was destroyed', () => {
    // `Http2ServerResponse` exposes neither `destroyed` nor `closed`; a
    // client-cancelled stream also detaches the socket.
    expect(
      isResFinalized({
        headersSent: false,
        writableEnded: false,
        finished: false,
        socket: undefined,
        stream: { destroyed: true, closed: true },
      } as any),
    ).toBe(true);
  });

  it('should not finalize a live HTTP/2 compat response', () => {
    expect(
      isResFinalized({
        headersSent: false,
        writableEnded: false,
        finished: false,
        socket: { writable: true },
        stream: { destroyed: false, closed: false },
      } as any),
    ).toBe(false);
  });

  it('should finalize when the socket is present but not writable', () => {
    expect(
      isResFinalized(createLiveResponse({ socket: { writable: false } })),
    ).toBe(true);
  });

  it('should finalize when headers have been sent', () => {
    expect(isResFinalized(createLiveResponse({ headersSent: true }))).toBe(
      true,
    );
  });

  it('should finalize when the body has been piped', () => {
    expect(isResFinalized(createLiveResponse({ _modernBodyPiped: true }))).toBe(
      true,
    );
  });

  it('should finalize when writableEnded is set', () => {
    expect(isResFinalized(createLiveResponse({ writableEnded: true }))).toBe(
      true,
    );
  });

  it('should finalize when finished is set', () => {
    expect(isResFinalized(createLiveResponse({ finished: true }))).toBe(true);
  });
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
