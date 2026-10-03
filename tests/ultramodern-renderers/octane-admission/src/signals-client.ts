import { hydrateRoot } from 'octane';
import { bootstrapStreamedSignalHydration } from 'octane/hydration/streamed-signals';

const container = document.querySelector<HTMLElement>('#app');
const identityElement = document.getElementById('signal-identity');
if (!container || !identityElement?.textContent)
  throw new Error('Missing native signal identity');
const identity: { buildId: string; documentId: string; url: string } =
  JSON.parse(identityElement.textContent);
const bridge = bootstrapStreamedSignalHydration(identity);

async function hydrate() {
  // Live signal modules must observe the installed server-authorized owner.
  const { Signals } = await import('./Signals.tsrx');
  const root = hydrateRoot(
    container!,
    Signals,
    { url: identity.url },
    { signalOwner: bridge.signalOwner },
  );
  Object.assign(globalThis, {
    admissionSignalUnmount() {
      root.unmount();
      bridge.dispose();
    },
  });
}
void hydrate();
