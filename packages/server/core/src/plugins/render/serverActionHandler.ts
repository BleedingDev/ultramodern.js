import { MAIN_ENTRY_NAME } from '@modern-js/utils/universal/constants';
import type { SSRRenderOptions } from './ssrRender';

export const serverActionHandler = async (
  req: Request,
  { serverManifest, routeInfo, rscClientManifest }: SSRRenderOptions,
) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }

  const serverBundle =
    serverManifest?.renderBundles?.[routeInfo.entryName || MAIN_ENTRY_NAME];

  if (!serverBundle) {
    return new Response('Cannot find server bundle for server action', {
      status: 500,
    });
  }

  const { handleAction } = serverBundle;
  if (!handleAction) {
    return new Response('Cannot find server action handler', { status: 500 });
  }

  return handleAction(req);
};
