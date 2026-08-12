// @effect-diagnostics asyncFunction:off processEnv:off strictBooleanExpressions:off
import { renderRsc } from '@modern-js/runtime/rsc/server';
import { createSerializationAdapter, RawStream } from '@tanstack/router-core';
import React, { createElement } from 'react';
import { ClientSlot } from './ClientSlot';
import { ReplayableStream } from './ReplayableStream';
import { sanitizeSlotArgs } from './slotUsageSanitizer';
import {
  type AnyCompositeComponent,
  type AnyRenderableServerComponent,
  isRenderableServerComponent,
  isServerComponent,
  RENDERABLE_RSC,
  RSC_SLOT_USAGES_STREAM,
  type RscSlotUsageEvent,
  SERVER_COMPONENT_STREAM,
  type ServerComponentStream,
} from './symbols';

export { CompositeComponent } from './CompositeComponent';
export type {
  AnyCompositeComponent,
  AnyRenderableServerComponent,
  CompositeComponentProps,
} from './symbols';

type SlotEmitter<T> = {
  close: () => void;
  emit: (value: T) => void;
  stream: ReadableStream<T>;
};

function createSlotProxy(options?: {
  onSlotCall?: (slot: string, args: unknown[]) => void;
}) {
  const cache = new Map<string, (...args: unknown[]) => React.ReactNode>();
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop !== 'string') {
        return undefined;
      }

      if (prop === 'children') {
        options?.onSlotCall?.('children', []);
        return createElement(ClientSlot, { args: [], slot: 'children' });
      }

      if (!cache.has(prop)) {
        cache.set(prop, (...args: unknown[]) => {
          options?.onSlotCall?.(prop, args);
          return createElement(ClientSlot, { args, slot: prop });
        });
      }
      return cache.get(prop);
    },
  });
}

function createServerRscValue(options: {
  renderable: boolean;
  slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
  stream: ServerComponentStream;
}) {
  return {
    [SERVER_COMPONENT_STREAM]: options.stream,
    ...(options.renderable ? { [RENDERABLE_RSC]: true } : {}),
    ...(options.slotUsagesStream
      ? { [RSC_SLOT_USAGES_STREAM]: options.slotUsagesStream }
      : {}),
  };
}

function toReplayableFlightStream(
  node: React.ReactElement,
  handlers?: {
    onCancel?: () => void;
    onDone?: () => void;
    onError?: () => void;
  },
) {
  const flightStream = renderRsc({
    element: node,
  }) as ReadableStream<Uint8Array>;
  return new ReplayableStream(
    handlers ? wrapReadableStream(flightStream, handlers) : flightStream,
  );
}

export async function renderServerComponent<TNode extends React.ReactNode>(
  node: TNode,
): Promise<TNode & AnyRenderableServerComponent<TNode>> {
  const stream = toReplayableFlightStream(<>{node}</>);
  const streamWrapper: ServerComponentStream = {
    createReplayStream: () => stream.createReplayStream(),
  };

  return createServerRscValue({
    renderable: true,
    stream: streamWrapper,
  }) as TNode & AnyRenderableServerComponent<TNode>;
}

export async function createCompositeComponent<
  TProps extends object = Record<string, unknown>,
  TReturn = React.ReactNode,
>(
  component: (props: TProps) => React.ReactNode | Promise<React.ReactNode>,
): Promise<AnyCompositeComponent<TProps, TReturn>> {
  const slotUsagesEmitter =
    process.env.NODE_ENV === 'development'
      ? createReadableStreamEmitter<RscSlotUsageEvent>()
      : undefined;

  const slotProxy = createSlotProxy({
    onSlotCall: slotUsagesEmitter
      ? (slot, args) => {
          const sanitizedArgs = sanitizeSlotArgs(args);
          slotUsagesEmitter.emit({
            slot,
            ...(sanitizedArgs.length ? { args: sanitizedArgs } : {}),
          });
        }
      : undefined,
  }) as TProps;

  async function ServerComponentWrapper() {
    return component(slotProxy);
  }

  const flightStream = toReplayableFlightStream(
    createElement(ServerComponentWrapper as React.FC),
    slotUsagesEmitter
      ? {
          onCancel: slotUsagesEmitter.close,
          onDone: slotUsagesEmitter.close,
          onError: slotUsagesEmitter.close,
        }
      : undefined,
  );
  const streamWrapper: ServerComponentStream = {
    createReplayStream: () => flightStream.createReplayStream(),
  };

  return createServerRscValue({
    renderable: false,
    slotUsagesStream: slotUsagesEmitter?.stream,
    stream: streamWrapper,
  }) as AnyCompositeComponent<TProps, TReturn>;
}

type SerializedRsc = {
  kind: 'renderable' | 'composite';
  stream: RawStream;
  slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
};

const adapter = createSerializationAdapter({
  key: '$MODERN_TANSTACK_RSC',
  test: isServerComponent,
  toSerializable: (component): SerializedRsc => {
    const streamWrapper = component[SERVER_COMPONENT_STREAM];
    if (!streamWrapper) {
      throw new Error('Cannot serialize TanStack RSC without a Flight stream.');
    }

    const kind = isRenderableServerComponent(component)
      ? 'renderable'
      : 'composite';
    const slotUsagesStream =
      process.env.NODE_ENV === 'development' && kind === 'composite'
        ? component[RSC_SLOT_USAGES_STREAM]
        : undefined;

    return {
      kind,
      stream: new RawStream(streamWrapper.createReplayStream(), {
        hint: 'text',
      }),
      ...(slotUsagesStream ? { slotUsagesStream } : {}),
    };
  },
  fromSerializable: (): never => {
    throw new Error('TanStack RSC data should not be deserialized on server.');
  },
});

export function getTanstackRscSerializationAdapters() {
  return [adapter];
}

function createReadableStreamEmitter<T>(): SlotEmitter<T> {
  let closed = false;
  const queue: T[] = [];
  let controller: ReadableStreamDefaultController<T> | null = null;

  const stream = new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl;
      for (const value of queue) {
        ctrl.enqueue(value);
      }
      queue.length = 0;
      if (closed) {
        ctrl.close();
      }
    },
    cancel() {
      closed = true;
      controller = null;
      queue.length = 0;
    },
  });

  const emit = (value: T) => {
    if (closed) {
      return;
    }
    if (!controller) {
      queue.push(value);
      return;
    }
    try {
      controller.enqueue(value);
    } catch {}
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controller?.close();
    } catch {}
    controller = null;
  };

  return { close, emit, stream };
}

function wrapReadableStream<T>(
  source: ReadableStream<T>,
  handlers: {
    onCancel?: () => void;
    onDone?: () => void;
    onError?: () => void;
  },
) {
  const reader = source.getReader();
  let finished = false;

  const finish = (kind: 'cancel' | 'done' | 'error') => {
    if (finished) {
      return;
    }
    finished = true;
    if (kind === 'cancel') {
      handlers.onCancel?.();
    } else if (kind === 'error') {
      handlers.onError?.();
    } else {
      handlers.onDone?.();
    }
    try {
      reader.releaseLock();
    } catch {}
  };

  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish('done');
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        try {
          controller.error(err);
        } catch {}
        finish('error');
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {}
      finish('cancel');
    },
  });
}
