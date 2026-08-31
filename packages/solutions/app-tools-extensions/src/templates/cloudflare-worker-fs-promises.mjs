const unavailable = method => async () => {
  throw new Error(
    `node:fs/promises.${method} is unavailable in Cloudflare Worker SSR`,
  );
};

export const readFile = unavailable('readFile');

export default {
  readFile,
};
