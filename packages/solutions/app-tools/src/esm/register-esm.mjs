let registeredPathHooks;

export const registerPathsLoader = async ({ appDir, baseUrl, paths }) => {
  const { register, registerHooks } = await import('node:module');

  if (typeof registerHooks === 'function') {
    const loader = await import('./ts-paths-loader.mjs');

    await loader.initialize({
      appDir,
      baseUrl,
      paths,
    });

    registeredPathHooks ??= registerHooks({
      resolve: loader.resolve,
    });

    return registeredPathHooks;
  }

  register('./ts-paths-loader.mjs', import.meta.url, {
    data: {
      appDir,
      baseUrl,
      paths,
    },
  });
};
