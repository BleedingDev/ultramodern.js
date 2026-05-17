// @effect-diagnostics asyncFunction:off
import { useHonoContext } from '@modern-js/server-runtime';

export default async () => {
  const ctx = useHonoContext();
  ctx.res.headers.set('x-id', '1');
  return {
    message: 'Hello Modern.js',
  };
};
