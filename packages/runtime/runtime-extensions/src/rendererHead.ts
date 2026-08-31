const MARKER_ATTRIBUTE = 'data-modern-helmet';
const MARKER_PREFIX = `<template ${MARKER_ATTRIBUTE}="`;
const MARKER_SUFFIX = '"></template>';
const RECORD_ID_WIDTH = 12;
const MARKER_LENGTH =
  MARKER_PREFIX.length + 1 + 36 + RECORD_ID_WIDTH + MARKER_SUFFIX.length;

export type RendererHeadMarkerProps = Record<typeof MARKER_ATTRIBUTE, string>;
export * from './helmetCompat';

type PublishRecords = (records: unknown[]) => void;

type HeadTransaction = {
  recordsByToken: Map<string, unknown>;
  committedRecords: unknown[];
  committedTokens: Set<string>;
  nextRecordId: number;
  nonce: string;
  previousRecords: unknown[];
  sealed: boolean;
};

type HeadState = {
  publishedRecords: unknown[];
  publish?: PublishRecords;
  transaction?: HeadTransaction;
};

const HEAD_STATE = Symbol('modern.rendererHead');
type HeadContext = { [HEAD_STATE]?: HeadState };

const getState = (context: object): HeadState => {
  const headContext = context as HeadContext;
  let state = headContext[HEAD_STATE];
  if (state === undefined) {
    state = { publishedRecords: [] };
    Object.defineProperty(headContext, HEAD_STATE, { value: state });
  }
  return state;
};

const formatId = (value: number): string =>
  value.toString(36).padStart(RECORD_ID_WIDTH, '0');

const createToken = (transaction: HeadTransaction): string => {
  const token = `h${transaction.nonce}${formatId(transaction.nextRecordId)}`;
  transaction.nextRecordId += 1;
  return token;
};

export const beginHeadRender = (context: object): void => {
  const state = getState(context);
  state.transaction = {
    recordsByToken: new Map(),
    committedRecords: [],
    committedTokens: new Set(),
    nextRecordId: 0,
    nonce: globalThis.crypto.randomUUID(),
    previousRecords: state.publishedRecords,
    sealed: false,
  };
  state.publish?.([]);
};

export const collectHeadRecord = <RecordType>(
  context: object,
  createRecord: () => RecordType,
  publish: (records: RecordType[]) => void,
): RendererHeadMarkerProps | null | undefined => {
  const state = getState(context);
  const transaction = state.transaction;
  if (transaction === undefined) {
    return undefined;
  }

  const hadPublisher = state.publish !== undefined;
  state.publish = records => publish(records as RecordType[]);
  if (!hadPublisher) {
    state.publish([]);
  }
  if (transaction.sealed) {
    return null;
  }

  const token = createToken(transaction);
  transaction.recordsByToken.set(token, createRecord());
  return { [MARKER_ATTRIBUTE]: token };
};

export const collectHeadState = <RecordType, StateType>(
  context: object,
  createRecord: () => RecordType,
  derive: (records: RecordType[]) => StateType,
  target: { helmet?: StateType },
): RendererHeadMarkerProps | null | undefined =>
  collectHeadRecord(context, createRecord, records => {
    target.helmet = derive(records);
  });

const consumeMarkers = (context: object, html: string): string => {
  const transaction = getState(context).transaction;
  if (transaction === undefined) {
    return html;
  }

  let cursor = 0;
  let stripped = '';
  while (cursor < html.length) {
    const start = html.indexOf(MARKER_PREFIX, cursor);
    if (start === -1) {
      stripped += html.slice(cursor);
      break;
    }
    const tokenStart = start + MARKER_PREFIX.length;
    const end = html.indexOf(MARKER_SUFFIX, tokenStart);
    if (end === -1) {
      stripped += html.slice(cursor);
      break;
    }

    const token = html.slice(tokenStart, end);
    if (!transaction.recordsByToken.has(token)) {
      stripped += html.slice(cursor, end + MARKER_SUFFIX.length);
    } else {
      stripped += html.slice(cursor, start);
      if (!transaction.sealed && !transaction.committedTokens.has(token)) {
        transaction.committedTokens.add(token);
        transaction.committedRecords.push(
          transaction.recordsByToken.get(token),
        );
      }
    }
    cursor = end + MARKER_SUFFIX.length;
  }
  return stripped;
};

const publish = (context: object): void => {
  const state = getState(context);
  const records = state.transaction?.committedRecords ?? [];
  state.publishedRecords = records;
  state.publish?.(records);
};

export const publishHeadRender = (context: object): void => {
  const transaction = getState(context).transaction;
  if (transaction !== undefined) {
    transaction.sealed = true;
    publish(context);
  }
};

export const finishHeadRender = (context: object): void => {
  const state = getState(context);
  if (state.transaction !== undefined) {
    if (!state.transaction.sealed) {
      publish(context);
    }
    state.transaction = undefined;
  }
};

export const completeHeadRender = (context: object, html: string): string => {
  const stripped = consumeMarkers(context, html);
  finishHeadRender(context);
  return stripped;
};

export const abortHeadRender = (context: object): void => {
  const state = getState(context);
  const transaction = state.transaction;
  if (transaction !== undefined) {
    state.publishedRecords = transaction.previousRecords;
    state.publish?.(transaction.previousRecords);
    state.transaction = undefined;
  }
};

const findCarryStart = (input: string): number => {
  const windowStart = Math.max(0, input.length - MARKER_LENGTH + 1);
  const markerStart = input.lastIndexOf(MARKER_PREFIX);
  if (
    markerStart >= windowStart &&
    input.length - markerStart < MARKER_LENGTH
  ) {
    return markerStart;
  }

  const maxPrefixLength = Math.min(MARKER_PREFIX.length - 1, input.length);
  for (let length = maxPrefixLength; length > 0; length -= 1) {
    if (MARKER_PREFIX.startsWith(input.slice(-length))) {
      return input.length - length;
    }
  }
  return input.length;
};

export const createHeadChunkProcessor = (context: object) => {
  let carry = '';
  return {
    push(chunk: string): string {
      const input = carry + chunk;
      const carryStart = findCarryStart(input);
      const output = consumeMarkers(context, input.slice(0, carryStart));
      carry = input.slice(carryStart);
      return output;
    },
    finish(chunk = ''): string {
      const output = completeHeadRender(context, carry + chunk);
      carry = '';
      return output;
    },
  };
};

export const createWebHeadMarkerStripper = (
  context: object,
): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const processor = createHeadChunkProcessor(context);
  return new TransformStream({
    transform(chunk, controller) {
      const output = processor.push(decoder.decode(chunk, { stream: true }));
      if (output) {
        controller.enqueue(encoder.encode(output));
      }
    },
    flush(controller) {
      const output = processor.finish(decoder.decode());
      if (output) {
        controller.enqueue(encoder.encode(output));
      }
    },
  });
};
