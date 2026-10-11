import {
  hydrateApplication,
  readSolidDocumentBootstrap,
} from '@modern-js/renderer-solid/client';
import { ApplicationRouter } from '@modern-js/renderer-solid/router';
import { createDeferredRouter, identity } from './routes';

const bootstrap = readSolidDocumentBootstrap(document, identity);
const { router, counters } = createDeferredRouter(
  'client',
  Promise.resolve({ text: 'native-client-retry-success' }),
);
const transferred = router.state.matches.length;
const root = document.getElementById('root');
if (!root) throw new Error('Expected the owning native document root');
const original = document.getElementById('deferred-value');
const dispose = hydrateApplication(
  () => <ApplicationRouter router={router} />,
  root,
  { renderId: bootstrap.documentId },
);
Object.assign(globalThis, {
  managedDeferredProbe: {
    bootstrapAt: Date.now(),
    router,
    counters,
    transferred,
    sameNode: document.getElementById('deferred-value') === original,
    dispose,
  },
});
