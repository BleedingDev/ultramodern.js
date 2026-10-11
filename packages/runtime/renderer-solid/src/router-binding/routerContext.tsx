import type { AnyRouter } from '@tanstack/router-core';
import * as Solid from 'solid-js';

export const routerContext = Solid.createContext<AnyRouter>(
  null as unknown as AnyRouter,
);
