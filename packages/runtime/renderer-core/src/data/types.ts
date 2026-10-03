import type { RendererIdentity } from '../identity';

export const DATA_PROTOCOL_VERSION = 1 as const;
export const DATA_CONTENT_TYPE = 'application/vnd.ultramodern.data+json';
export const DATA_STREAM_CONTENT_TYPE =
  'application/vnd.ultramodern.data-stream+json';
export const LOADER_ID_PARAM = '__loader';
export const DIRECT_PARAM = '__ssrDirect';

export type DataOperation = 'loader' | 'action';
export type DataHeaders = [string, string][];

export interface DataResponseMetadata {
  status: number;
  statusText: string;
  headers: DataHeaders;
  cachePolicy: 'no-store' | 'private' | 'public';
}

export interface PublicDataError {
  name: string;
  message: string;
  stack?: string;
}

export type DataOutcome =
  | { kind: 'success'; value: unknown; response: DataResponseMetadata }
  | { kind: 'redirect'; location: string; response: DataResponseMetadata }
  | {
      kind: 'not-found';
      value: unknown;
      thrown: boolean;
      response: DataResponseMetadata;
    }
  | {
      kind: 'error';
      error: PublicDataError;
      data?: unknown;
      thrown: boolean;
      response: DataResponseMetadata;
    }
  | {
      kind: 'deferred';
      critical: Record<string, unknown>;
      deferred: Record<string, Promise<unknown>>;
      response: DataResponseMetadata;
    };

export interface DataHandlerInput<Context = unknown> {
  request: Request;
  routeId: string;
  params: Readonly<Record<string, string>>;
  context: Context;
}

export type DataHandler<Context = unknown> = (
  input: DataHandlerInput<Context>,
) => unknown | Promise<unknown>;

/** The native router supplies an authorized match, never a shared matcher. */
export interface SelectedDataRoute<Context = unknown> {
  routeId: string;
  params: Readonly<Record<string, string>>;
  handler: DataHandler<Context>;
}

export interface DataWireEnvelope {
  version: typeof DATA_PROTOCOL_VERSION;
  identity: RendererIdentity;
  routeId: string;
  operation: DataOperation;
  outcome: PublicDataOutcome;
  deferredKeys?: string[];
}

/** Header values and request-owned context never enter a public payload. */
export type PublicDataOutcome =
  | { kind: 'success'; value: unknown; status: number }
  | { kind: 'redirect'; location: string; status: number }
  | { kind: 'not-found'; value: unknown; thrown: boolean; status: number }
  | {
      kind: 'error';
      error: PublicDataError;
      data?: unknown;
      thrown: boolean;
      status: number;
    };

/** A deferred body is successful only when its terminal framing completes. */
export type DecodedDataOutcome = PublicDataOutcome & {
  completion?: Promise<void>;
};

export type DataStreamFrame =
  | { type: 'initial'; envelope: DataWireEnvelope }
  | { type: 'resolve'; key: string; value: unknown }
  | { type: 'reject'; key: string; error: PublicDataError }
  | { type: 'complete' };
