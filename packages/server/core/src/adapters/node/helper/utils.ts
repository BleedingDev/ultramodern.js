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
  socket?: {
    writable?: boolean;
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
    response.socket?.writable === false
  );
};
