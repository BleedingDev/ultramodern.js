// @effect-diagnostics asyncFunction:off processEnv:off strictBooleanExpressions:off
'use client';

import { createElement } from 'react';
import { RscNodeRenderer } from './RscNodeRenderer';
import {
  RENDERABLE_RSC,
  RSC_PROXY_GET_TREE,
  RSC_PROXY_PATH,
  RSC_SLOT_USAGES,
  RSC_SLOT_USAGES_STREAM,
  type RscSlotUsageEvent,
  SERVER_COMPONENT_STREAM,
  type ServerComponentStream,
} from './symbols';

type CreateProxyOptions = {
  getTree: () => unknown;
  path: string[];
  renderable: boolean;
  slotUsages?: RscSlotUsageEvent[];
  slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
  stream?: ServerComponentStream;
};

const UNHANDLED = Symbol('modern.tanstack.rsc.unhandled');

function handleProxyTrap(
  kind: 'get' | 'has',
  prop: PropertyKey,
  options: CreateProxyOptions,
) {
  switch (prop) {
    case '__SEROVAL_STREAM__':
    case '__SEROVAL_SEQUENCE__':
    case Symbol.iterator:
    case Symbol.asyncIterator:
      return kind === 'get' ? undefined : false;
    case SERVER_COMPONENT_STREAM:
      return kind === 'get' ? options.stream : Boolean(options.stream);
    case RENDERABLE_RSC:
      return kind === 'get' ? options.renderable : true;
    case RSC_PROXY_GET_TREE:
      return kind === 'get' ? options.getTree : true;
    case RSC_PROXY_PATH:
      return kind === 'get' ? options.path : true;
    case RSC_SLOT_USAGES_STREAM:
      return kind === 'get'
        ? options.slotUsagesStream
        : Boolean(options.slotUsagesStream);
    case RSC_SLOT_USAGES:
      return kind === 'get' ? options.slotUsages : Boolean(options.slotUsages);
    case 'then':
      return kind === 'get' ? undefined : UNHANDLED;
    case 'toString':
      return kind === 'get' ? Object.prototype.toString : UNHANDLED;
    case 'valueOf':
      return kind === 'get' ? Object.prototype.valueOf : UNHANDLED;
    case 'constructor':
      return kind === 'get' ? Object : UNHANDLED;
    default:
      return UNHANDLED;
  }
}

function createRscProxyInternal(options: CreateProxyOptions): any {
  const childCache = new Map<string, unknown>();
  const dataProxy = options.renderable
    ? createRscProxyInternal({ ...options, renderable: false })
    : undefined;
  const target = options.renderable
    ? createElement(RscNodeRenderer, { data: dataProxy })
    : {};

  const getChild = (key: string) => {
    if (!childCache.has(key)) {
      childCache.set(
        key,
        createRscProxyInternal({
          ...options,
          path: [...options.path, key],
        }),
      );
    }
    return childCache.get(key);
  };

  return new Proxy(target as Record<PropertyKey, unknown>, {
    get(proxyTarget, prop) {
      const handled = handleProxyTrap('get', prop, options);
      if (handled !== UNHANDLED) {
        return handled;
      }

      if (options.renderable) {
        if (prop === 'props') {
          return proxyTarget.props;
        }
        if (prop === 'data') {
          return dataProxy;
        }
        if (prop in proxyTarget) {
          return proxyTarget[prop];
        }
      }

      if (typeof prop === 'symbol') {
        return undefined;
      }
      return getChild(prop);
    },
    getOwnPropertyDescriptor(proxyTarget, prop) {
      return options.renderable
        ? Object.getOwnPropertyDescriptor(proxyTarget, prop)
        : undefined;
    },
    getPrototypeOf(proxyTarget) {
      return options.renderable
        ? Object.getPrototypeOf(proxyTarget)
        : Object.prototype;
    },
    has(proxyTarget, prop) {
      const handled = handleProxyTrap('has', prop, options);
      if (handled !== UNHANDLED) {
        return Boolean(handled);
      }

      if (options.renderable) {
        return prop in proxyTarget || typeof prop === 'string';
      }

      return typeof prop === 'string';
    },
    ownKeys(proxyTarget) {
      return options.renderable ? Reflect.ownKeys(proxyTarget) : [];
    },
  });
}

export function createRscProxy(
  getTree: () => unknown,
  options: {
    renderable?: boolean;
    slotUsages?: RscSlotUsageEvent[];
    slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
    stream?: ServerComponentStream;
  } = {},
) {
  const slotUsages =
    process.env.NODE_ENV === 'development' && options.slotUsagesStream
      ? (options.slotUsages ?? [])
      : options.slotUsages;

  if (
    process.env.NODE_ENV === 'development' &&
    options.slotUsagesStream &&
    slotUsages
  ) {
    void consumeSlotUsages(options.slotUsagesStream, slotUsages);
  }

  return createRscProxyInternal({
    getTree,
    path: [],
    renderable: options.renderable === true,
    slotUsages,
    slotUsagesStream: options.slotUsagesStream,
    stream: options.stream,
  });
}

async function consumeSlotUsages(
  stream: ReadableStream<RscSlotUsageEvent>,
  slotUsages: RscSlotUsageEvent[],
) {
  try {
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value?.slot) {
        slotUsages.push(value);
      }
    }
  } catch {
    // Development-only metadata should not affect rendering.
  }
}
