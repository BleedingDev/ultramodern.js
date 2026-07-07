// @effect-diagnostics strictBooleanExpressions:off

import type { ServerPayload } from '@modern-js/runtime/context';
import { storage } from '@modern-js/runtime-utils/node';
import type { TanstackRouterWithServerSsr } from '../ssrTypes';

type TanstackRscStorageContext = {
  serverPayload?: ServerPayload;
  tanstackRscRouter?: TanstackRouterWithServerSsr;
};

export const setTanstackRscServerPayload = (payload: ServerPayload) => {
  const storageContext = storage.useContext?.() as
    | TanstackRscStorageContext
    | undefined;
  if (storageContext) {
    storageContext.serverPayload = payload;
  }
};

export const setTanstackRscRouter = (router: TanstackRouterWithServerSsr) => {
  const storageContext = storage.useContext?.() as
    | TanstackRscStorageContext
    | undefined;
  if (storageContext) {
    storageContext.tanstackRscRouter = router;
  }
};

export const getTanstackRscRouter = () => {
  const storageContext = storage.useContext?.() as
    | TanstackRscStorageContext
    | undefined;
  return storageContext?.tanstackRscRouter;
};
