let invocationCount = 0;

export const routerPlugin = (
  _userConfig: Record<string, unknown> = {},
): { name?: string; setup?: (...args: unknown[]) => unknown } => {
  invocationCount += 1;
  throw new Error('The legacy global router wrapper must not be invoked.');
};

export const getLegacyRouterPluginInvocationCount = () => invocationCount;
