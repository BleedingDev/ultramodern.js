'use client';

import { createSerializationAdapter } from '@tanstack/react-router';
import { use } from 'react';
import { CompositeComponent } from './CompositeComponent';
import { createRscProxy } from './createRscProxy';
import type {
  AnyCompositeComponent,
  RscSlotUsageEvent,
  ServerComponentStream,
} from './symbols';

export type {
  AnyCompositeComponent,
  AnyRenderableServerComponent,
  CompositeComponentProps,
} from './symbols';
export { CompositeComponent };

type SerializedRsc = {
  kind: 'renderable' | 'composite';
  stream: ReadableStream<Uint8Array>;
  slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
};

type ModernRscClientRuntime = typeof import('../../../../rsc/client');

let modernRscClientRuntimePromise: Promise<ModernRscClientRuntime> | undefined;

function loadModernRscClientRuntime() {
  modernRscClientRuntimePromise ??= import('../../../../rsc/client').then(
    runtime => {
      runtime.setServerCallback(runtime.callServer);
      return runtime;
    },
  );
  return modernRscClientRuntimePromise;
}

function createTreeGetter(stream: ReadableStream<Uint8Array>) {
  let ready = false;
  let tree: unknown;
  const treePromise = loadModernRscClientRuntime()
    .then(runtime =>
      runtime.createFromReadableStream(stream, {
        callServer: runtime.callServer,
      }),
    )
    .then(value => {
      tree = value;
      ready = true;
      return value;
    });

  return () => {
    if (ready) {
      return tree;
    }
    return use(treePromise);
  };
}

function createFromFlightStream(serialized: SerializedRsc) {
  const streamWrapper: ServerComponentStream = {
    createReplayStream: () => serialized.stream,
  };

  return createRscProxy(createTreeGetter(serialized.stream), {
    renderable: serialized.kind === 'renderable',
    slotUsagesStream: serialized.slotUsagesStream,
    stream: streamWrapper,
  });
}

const adapter = createSerializationAdapter({
  key: '$MODERN_TANSTACK_RSC',
  test: (_value: unknown): _value is never => false,
  toSerializable: (): never => {
    throw new Error('TanStack RSC data cannot be serialized on client.');
  },
  fromSerializable: (value: SerializedRsc): AnyCompositeComponent =>
    createFromFlightStream(value) as AnyCompositeComponent,
});

export function getTanstackRscSerializationAdapters() {
  return [adapter];
}

export const rscSerializationAdapter = getTanstackRscSerializationAdapters;
