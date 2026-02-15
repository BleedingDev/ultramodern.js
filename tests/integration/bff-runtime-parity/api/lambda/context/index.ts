import { useBackendContext } from '@modern-js/server-runtime';

export default async () => {
  const ctx = useBackendContext();
  ctx.res.headers.set('x-id', '1');
  return {
    message: 'Hello Modern.js',
  };
};
