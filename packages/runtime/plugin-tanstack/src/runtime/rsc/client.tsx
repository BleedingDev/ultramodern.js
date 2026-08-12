'use client';

import { createSerializationAdapter } from '@tanstack/react-router';
import { CompositeComponent } from './CompositeComponent';
import { createRscProxy } from './createRscProxy';
import type { SerializedTanstackRscFlightValue } from './shared';
import type {
  AnyCompositeComponent,
  RscSlotUsageEvent,
  ServerComponentStream,
} from './symbols';
import { createTreeGetterFromFlightStream } from './treeGetter';

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

function createFromFlightStream(
  serialized: SerializedRsc | SerializedTanstackRscFlightValue,
) {
  const streamWrapper: ServerComponentStream = {
    createReplayStream: () => serialized.stream,
  };

  return createRscProxy(createTreeGetterFromFlightStream(serialized.stream), {
    renderable: serialized.kind === 'renderable',
    slotUsagesStream: serialized.slotUsagesStream,
    stream: streamWrapper,
  });
}

export function createTanstackRscValueFromFlight(
  serialized: SerializedTanstackRscFlightValue,
): AnyCompositeComponent {
  return createFromFlightStream(serialized) as AnyCompositeComponent;
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
