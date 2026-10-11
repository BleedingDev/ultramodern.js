import { createRoot } from 'octane';
import PlainApp from './PlainApp';

const container = document.getElementById('app');
if (!container) throw new Error('Missing plain component admission mount');
createRoot(container).render(PlainApp, {});
