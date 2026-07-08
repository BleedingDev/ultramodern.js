// @effect-diagnostics strictBooleanExpressions:off

const BLOCKING_SUBSCRIBE_SYMBOL = Symbol.for(
  '@modern-js/plugin-tanstack:blocking-subscribe',
);
const BLOCKING_STATE_SYMBOL = Symbol.for(
  '@modern-js/plugin-tanstack:blocking-state',
);

type TanstackRouterWithSubscribe = {
  [BLOCKING_STATE_SYMBOL]?: () => boolean;
  [BLOCKING_SUBSCRIBE_SYMBOL]?: boolean;
  subscribe?: (
    eventType: string,
    listener: (...args: unknown[]) => void,
  ) => () => void;
};

export function wrapRouterSubscribeWithBlockState(
  router: unknown,
  getBlockNavState?: () => boolean,
) {
  if (!router || typeof router !== 'object') {
    return;
  }

  const target = router as TanstackRouterWithSubscribe;
  target[BLOCKING_STATE_SYMBOL] = getBlockNavState;
  if (
    target[BLOCKING_SUBSCRIBE_SYMBOL] ||
    typeof target.subscribe !== 'function'
  ) {
    return;
  }

  const originSubscribe = target.subscribe.bind(target);
  target.subscribe = (eventType, listener) => {
    const wrappedListener = (...args: unknown[]) => {
      const blockRoute = target[BLOCKING_STATE_SYMBOL]?.() || false;
      if (blockRoute) {
        return;
      }
      return listener(...args);
    };
    return originSubscribe(eventType, wrappedListener);
  };
  target[BLOCKING_SUBSCRIBE_SYMBOL] = true;
}
