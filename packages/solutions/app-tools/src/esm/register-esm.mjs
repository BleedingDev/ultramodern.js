export const registerPathsLoader = async ({ appDir, baseUrl, paths }) => {
  const { register } = await import('node:module');
  register('./ts-paths-loader.mjs', import.meta.url, {
    data: {
      appDir,
      baseUrl,
      paths,
    },
  });
};
