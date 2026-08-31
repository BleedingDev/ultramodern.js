import { loadableReady } from '@loadable/component';
import { SSR_HYDRATION_ID_PREFIX } from '@modern-js/utils/universal/constants';
import type React from 'react';
import { hydrateRoot as hydrateReactRoot, type Root } from 'react-dom/client';
import { RenderLevel } from '../constants';
import type { TRuntimeContext } from '../context/runtime';
import { wrapRuntimeContextProvider } from '../react/wrapper';
import { WithCallback } from './withCallback';

declare const __MODERN_CHUNK_LOADING_GLOBAL__: string | undefined;

const loadableReadyOptions = {
  chunkLoadingGlobal:
    typeof __MODERN_CHUNK_LOADING_GLOBAL__ === 'string' &&
    __MODERN_CHUNK_LOADING_GLOBAL__ !== ''
      ? __MODERN_CHUNK_LOADING_GLOBAL__
      : '__LOADABLE_LOADED_CHUNKS__',
};

export function hydrateWithReact(
  App: React.ReactElement,
  rootElement: HTMLElement,
) {
  return Promise.resolve(
    hydrateReactRoot(rootElement, App, {
      identifierPrefix: SSR_HYDRATION_ID_PREFIX,
    }),
  );
}

export function hydrateRoot(
  App: React.ReactElement,
  context: TRuntimeContext,
  ModernRender: (App: React.ReactElement) => Promise<HTMLElement | Root>,
  ModernHydrate: (
    App: React.ReactElement,
    callback?: () => void,
  ) => Promise<HTMLElement | Root>,
) {
  const hydrateContext: TRuntimeContext & { __hydration?: boolean } = {
    ...context,
    get routes() {
      return context.routes;
    },
    _hydration: true,
  };

  const callback = () => {
    // won't cause component re-render because context's reference identity doesn't change
    delete hydrateContext._hydration;
  };

  // if render level not exist, use client render
  const renderLevel =
    window?._SSR_DATA?.renderLevel ?? RenderLevel.CLIENT_RENDER;

  const renderMode = window?._SSR_DATA?.mode ?? 'string';

  if (renderMode === 'stream') {
    return streamSSRHydrate();
  }

  function streamSSRHydrate() {
    if (renderLevel === RenderLevel.SERVER_RENDER) {
      // callback: https://github.com/reactwg/react-18/discussions/5
      const SSRApp: React.FC = () => (
        <WithCallback callback={callback}>{App}</WithCallback>
      );
      return ModernHydrate(
        wrapRuntimeContextProvider(<SSRApp />, hydrateContext),
      );
    } else {
      return ModernRender(wrapRuntimeContextProvider(App, context));
    }
  }

  return stringSSRHydrate();

  function stringSSRHydrate() {
    // client render and server prefetch use same logic
    if (renderLevel === RenderLevel.CLIENT_RENDER) {
      return ModernRender(wrapRuntimeContextProvider(App, context));
    } else if (renderLevel === RenderLevel.SERVER_RENDER) {
      return loadableReady(() => undefined, loadableReadyOptions).then(() => {
        // callback: https://github.com/reactwg/react-18/discussions/5
        const SSRApp: React.FC = () => (
          <WithCallback callback={callback}>{App}</WithCallback>
        );
        return ModernHydrate(
          wrapRuntimeContextProvider(<SSRApp />, hydrateContext),
        );
      });
    } else {
      // unknown renderlevel or renderlevel is server prefetch.
      const runtimeConsole: unknown = Reflect.get(globalThis, 'console');
      if (runtimeConsole !== null && typeof runtimeConsole === 'object') {
        const warn: unknown = Reflect.get(runtimeConsole, 'warn');
        if (typeof warn === 'function') {
          Reflect.apply(warn, runtimeConsole, [
            `unknow render level: ${renderLevel}, execute render()`,
          ]);
        }
      }
      return ModernRender(wrapRuntimeContextProvider(App, context));
    }
  }
}
