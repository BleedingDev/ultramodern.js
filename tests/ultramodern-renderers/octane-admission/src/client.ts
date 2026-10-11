import { createRoot, hydrateRoot } from 'octane';
import { App } from './App';

declare const __webpack_hash__: string;

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('Missing Octane admission mount');
const props = {};
const root = container.hasChildNodes()
  ? hydrateRoot(container, App, props)
  : createRoot(container);
if (!container.hasChildNodes()) root.render(App, props);
Object.assign(globalThis, {
  admissionUnmount: () => root.unmount(),
  admissionNativeHydrationBuildId: __webpack_hash__,
});
