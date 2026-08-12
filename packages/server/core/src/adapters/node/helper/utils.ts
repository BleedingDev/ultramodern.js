import type {
  ClientManifest,
  NodeRequest,
  NodeResponse,
  SSRManifest,
} from '@modern-js/types/server';
import type { HonoRequest, ServerManifest } from '../../../types';

type ExtendedNodeRequest = NodeRequest & {
  __honoRequest?: HonoRequest;
  __templates?: Record<string, string>;
  __serverManifest?: ServerManifest;
  __rscServerManifest?: ServerManifest;
  __rscClientManifest?: ClientManifest;
  __rscSSRManifest?: SSRManifest;
};

type ExtendedNodeResponse = NodeResponse & {
  _modernBodyPiped?: boolean;
};

type ResponseStatusSnapshot = {
  headersSent?: boolean;
  writableEnded?: boolean;
  finished?: boolean;
  destroyed?: boolean;
  closed?: boolean;
  socket?: {
    writable?: boolean;
  } | null;
  stream?: {
    destroyed?: boolean;
    closed?: boolean;
  } | null;
};

export type NodeBindings = {
  node: {
    req: ExtendedNodeRequest;
    res: ExtendedNodeResponse;
  };
};

export const isResFinalized = (res: ExtendedNodeResponse): boolean => {
  const response = res as ExtendedNodeResponse & ResponseStatusSnapshot;
  return (
    Boolean(response.headersSent) ||
    Boolean(response._modernBodyPiped) ||
    Boolean(response.writableEnded) ||
    Boolean(response.finished) ||
    // HTTP/1: a destroyed/closed response detaches its socket, so
    // `socket?.writable` alone reports `undefined` and would wrongly look
    // writable.
    Boolean(response.destroyed) ||
    Boolean(response.closed) ||
    // HTTP/2 compat (`Http2ServerResponse`) exposes neither `destroyed` nor
    // `closed`; its liveness lives on `res.stream`, whose socket detaches once
    // the stream is destroyed (a cancelled request leaves `socket` undefined).
    Boolean(response.stream?.destroyed) ||
    Boolean(response.stream?.closed) ||
    // Only a socket that exists and is explicitly unwritable counts. A response
    // that never had a socket (mocks, worker runtimes, socket not yet assigned)
    // is still live and must not be treated as finalized.
    response.socket?.writable === false
  );
};
