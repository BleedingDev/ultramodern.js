import type { JSX } from '@solidjs/web';
import { getScrollRestorationScriptForRouter } from '@tanstack/router-core/scroll-restoration-script';
import { ScriptOnce } from './ScriptOnce';
import { useRouter } from './useRouter';

export function ScrollRestoration(): JSX.Element {
  const router = useRouter();
  const script = getScrollRestorationScriptForRouter(router);

  if (!script) {
    return null;
  }

  return <ScriptOnce children={script} />;
}
