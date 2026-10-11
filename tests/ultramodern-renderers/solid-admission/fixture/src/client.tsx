import { hydrate, render } from '@solidjs/web';
import { App, createAppRouter } from './App';

const router = createAppRouter();
globalThis.__solidRouter = router;
const root = document.getElementById('root');
globalThis.__initialButton = root.querySelector('button');
globalThis.__solidDispose = (root.hasChildNodes() ? hydrate : render)(
  () => <App router={router} />,
  root,
  { renderId: 'admission' },
);
globalThis.__hydratedSameNode =
  globalThis.__initialButton === root.querySelector('button');
