import type { JSX } from '@solidjs/web';
import { NoHydration } from '@solidjs/web';
import type { RouterManagedTag } from '@tanstack/router-core';
import {
  composeSsrBodyScripts,
  getSsrBodyScriptParts,
  replaceEqualDeep,
} from '@tanstack/router-core';
import { isServer } from '@tanstack/router-core/isServer';
import * as Solid from 'solid-js';
import { Asset } from './Asset';
import { useRouter } from './useRouter';

export const Scripts = (): JSX.Element => {
  const router = useRouter();
  const nonce = router.options.ssr?.nonce;

  const scripts = Solid.createMemo(
    (previous: Array<RouterManagedTag> | undefined) => {
      const next = composeSsrBodyScripts(
        getSsrBodyScriptParts(
          router.stores.matches.get(),
          router.ssr?.manifest,
          nonce,
        ),
      );
      return previous ? replaceEqualDeep(previous, next) : next;
    },
  );
  const initialHydrationScripts =
    (isServer ?? router.isServer) && router.serverSsr
      ? router.serverSsr.takeInitialHydrationScriptTags()
      : undefined;
  const tags = () =>
    initialHydrationScripts
      ? composeSsrBodyScripts([scripts(), []], initialHydrationScripts)
      : scripts();

  return (
    <NoHydration>
      <Solid.For each={tags()}>{asset => <Asset {...asset} />}</Solid.For>
    </NoHydration>
  );
};
