import type React from 'react';

export interface ServerComponentStream {
  createReplayStream: () => ReadableStream<Uint8Array>;
}

export const SERVER_COMPONENT_STREAM = Symbol.for('modern.tanstack.rsc.stream');

export const RENDERABLE_RSC = Symbol.for('modern.tanstack.rsc.renderable');

export const RSC_PROXY_GET_TREE = Symbol.for(
  'modern.tanstack.rsc.proxy.getTree',
);

export const RSC_PROXY_PATH = Symbol.for('modern.tanstack.rsc.proxy.path');

export const RSC_SLOT_USAGES_STREAM = Symbol.for(
  'modern.tanstack.rsc.slotUsages.stream',
);

export const RSC_SLOT_USAGES = Symbol.for('modern.tanstack.rsc.slotUsages');

export type SerializableSlotArg =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | SerializableSlotArg[]
  | { [key: string]: SerializableSlotArg };

export type RscSlotUsageEvent = {
  slot: string;
  args?: SerializableSlotArg[];
};

export interface AnyRenderableServerComponent<TNode = React.ReactNode> {
  [SERVER_COMPONENT_STREAM]: ServerComponentStream;
  [RENDERABLE_RSC]: true;
  [RSC_PROXY_GET_TREE]?: () => unknown;
  [RSC_PROXY_PATH]?: string[];
  [RSC_SLOT_USAGES_STREAM]?: ReadableStream<RscSlotUsageEvent>;
  '~types'?: {
    node: TNode;
  };
}

export interface AnyCompositeComponent<
  TProps extends object = Record<string, unknown>,
  TReturn = React.ReactNode,
> {
  [SERVER_COMPONENT_STREAM]?: ServerComponentStream;
  [RSC_PROXY_GET_TREE]?: () => unknown;
  [RSC_PROXY_PATH]?: string[];
  [RSC_SLOT_USAGES]?: RscSlotUsageEvent[];
  [RSC_SLOT_USAGES_STREAM]?: ReadableStream<RscSlotUsageEvent>;
  '~types'?: {
    props: TProps;
    return: TReturn;
  };
}

type InferCompositeProps<TComp extends AnyCompositeComponent> =
  TComp extends AnyCompositeComponent<infer TProps, unknown>
    ? TProps
    : Record<string, unknown>;

export type CompositeComponentProps<TComp extends AnyCompositeComponent> = {
  src: TComp;
  strict?: boolean;
} & InferCompositeProps<TComp>;

export function isServerComponent(
  value: unknown,
): value is AnyCompositeComponent | AnyRenderableServerComponent {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  return (
    SERVER_COMPONENT_STREAM in value &&
    typeof (value as { [SERVER_COMPONENT_STREAM]?: unknown })[
      SERVER_COMPONENT_STREAM
    ] !== 'undefined'
  );
}

export function isRenderableServerComponent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  return (
    RENDERABLE_RSC in value &&
    (value as { [RENDERABLE_RSC]?: unknown })[RENDERABLE_RSC] === true
  );
}
