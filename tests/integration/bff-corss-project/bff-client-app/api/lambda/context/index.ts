import { useHonoContext } from '@modern-js/server-runtime';

export default async () => {
  const ctx = useHonoContext();
  ctx.res.headers.append('x-id', '1');
  return {
    message: 'Hello Modern.js',
  };
};
