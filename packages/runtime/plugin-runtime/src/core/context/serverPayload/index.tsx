import type { PayloadRoute, ServerPayload } from './index.server';

export type { PayloadRoute, ServerPayload };

export const getServerPayload = (): ServerPayload | undefined => undefined;

export const setServerPayload = (payload: ServerPayload): void => {};
