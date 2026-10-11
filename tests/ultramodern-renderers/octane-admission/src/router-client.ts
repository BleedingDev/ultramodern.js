import { RouterClient } from '@octanejs/tanstack-router/ssr/client';
import { hydrateRoot } from 'octane';
import { getRouter } from './router';

const container = document.getElementById('__app');
if (!container)
  throw new Error('Missing native router Body hydration container');
const root = hydrateRoot(container, RouterClient, { router: getRouter() });
Object.assign(globalThis, { admissionUnmount: () => root.unmount() });
