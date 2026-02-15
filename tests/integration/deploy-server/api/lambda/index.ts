import { useBackendContext } from '@modern-js/server-runtime';

export const post = async () => {
  const ctx = useBackendContext();
  return {
    message: 'Hello Modern.js',
  };
};
