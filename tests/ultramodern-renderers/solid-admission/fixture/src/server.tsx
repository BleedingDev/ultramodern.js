import { generateHydrationScript, renderToStream } from '@solidjs/web';
import { App, createAppRouter } from './App';
export async function renderApp(manifest, url = '/') {
  const router = createAppRouter(true, url);
  await router.load();
  const errors = [];
  const html = await renderToStream(() => <App router={router} />, {
    renderId: 'admission',
    manifest,
    onError: error => {
      errors.push(error);
    },
  });
  if (errors.length) throw errors[0];
  return html;
}
export function hydrationScript() {
  return generateHydrationScript();
}
export { probeStreaming } from './stream-probe';
