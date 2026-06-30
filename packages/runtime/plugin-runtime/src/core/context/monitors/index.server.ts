import { storage } from '@modern-js/runtime-utils/node';
import { defaultMonitors, type RuntimeMonitors } from './default';

export const getMonitors = (): RuntimeMonitors => {
  const storageContext = storage.useContext();
  return storageContext.monitors || defaultMonitors;
};
