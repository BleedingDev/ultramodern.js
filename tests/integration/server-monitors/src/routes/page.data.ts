import { getMonitors } from '@modern-js/runtime';

export const loader = () => {
  const monitors = getMonitors();
  monitors.error('error in monitors');

  return {
    exist: Boolean(1),
  };
};
