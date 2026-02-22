import { useBackendContext } from '@modern-js/server-runtime';

export default async () => {
  const ctx = useBackendContext();
  const { res } = ctx;
  res.headers.set('x-id', '1');
  return {
    message: 'Hello Modern.js',
  };
};
